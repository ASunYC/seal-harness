import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AutonomousSshClient } from './autonomous-ssh.js';
import { resolveDockerRegistryCredential, } from './autonomous-registry-credential.js';
const REGISTRY = 'metaversedockerrepo.geovisearth.com';
const EventSchema = z.object({
    v: z.literal(1),
    stage: z.string().min(1).max(64),
    state: z.enum(['running', 'succeeded', 'failed']),
    message: z.string().min(1).max(512),
});
const AssetManifestSchema = z.object({
    schemaVersion: z.literal(1),
    deploymentVersion: z.string().min(1),
    files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)),
});
const RuntimePackSchema = z.object({
    schemaVersion: z.literal(1),
    product: z.literal('stratex-langgraph'),
    version: z.string().regex(/^0\.1\.[1-9]\d{0,8}$/u),
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    imageReference: z
        .string()
        .regex(/^metaversedockerrepo\.geovisearth\.com\/agentearth\/stratex-langgraph:0\.1\.[1-9]\d{0,8}$/u),
    platform: z.literal('linux/amd64'),
    image: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});
/** 固定主机只拉取安装包锁定的版本镜像；离线 tar 始终留给本机发布。 */
export class WorkflowRemoteRuntime {
    options;
    ssh;
    constructor(options) {
        this.options = options;
        this.ssh = options.ssh ?? new AutonomousSshClient();
    }
    async check(input) {
        const target = sshTarget(input);
        const result = await this.ssh.execute(target, `test "$(uname -s)" = Linux && test "$(uname -m)" = x86_64`, '', 20_000);
        if (result.code !== 0)
            throw new Error('remoteHostUnsupported');
        await this.ensurePrivilege(target);
    }
    async deploy(input, id, model, onEvent, action = 'deploy') {
        const registry = await (this.options.registryCredential?.() ??
            resolveDockerRegistryCredential(REGISTRY));
        if (!registry)
            throw new Error('registryCredentialUnavailable');
        const manifest = AssetManifestSchema.parse(JSON.parse(await readFile(join(this.options.assetsDirectory, 'manifest.json'), 'utf8')));
        const pack = RuntimePackSchema.parse(JSON.parse(await readFile(join(this.options.runtimePackDirectory, 'runtime-pack.json'), 'utf8')));
        if (!pack.imageReference.endsWith(`:${pack.version}`))
            throw new Error('runtimePackInvalid');
        await verifyAssets(this.options.assetsDirectory, manifest.files);
        const target = sshTarget(input);
        await this.prepare(target, id, Object.keys(manifest.files));
        let completed = false;
        const result = await this.ssh.execute(target, privilegedCommand(target, `${deployerCommand(id)} ${action} ${id}`), privilegedInput(target, deploymentInput(input, pack.imageReference, registry, model)), 45 * 60_000, (line) => {
            const event = EventSchema.safeParse(safeJson(line));
            if (!event.success)
                return;
            if (event.data.stage === 'complete' && event.data.state === 'succeeded')
                completed = true;
            onEvent(event.data);
        });
        if (result.code !== 0 || !completed)
            throw new Error('remoteDeployFailed');
        const lock = await this.ssh.execute(target, privilegedCommand(target, `cat /opt/stratex/workflow/${id}/images.lock`), privilegedInput(target), 20_000);
        if (lock.code !== 0)
            throw new Error('remoteImageLockUnavailable');
        const digest = lock.output.match(/(?:@|=)(sha256:[a-f0-9]{64})/u)?.[1];
        if (!digest)
            throw new Error('remoteImageLockUnavailable');
        return {
            version: `${manifest.deploymentVersion}+${pack.version}`,
            images: [{ role: 'runtime', reference: pack.imageReference, digest }],
        };
    }
    async action(record, password, action, onEvent = () => undefined) {
        const target = sshTarget({
            host: record.host,
            sshPort: record.sshPort,
            username: record.username,
            password,
        });
        if (action !== 'status')
            await this.prepare(target, record.id, ['deploy.sh']);
        else
            await this.ensurePrivilege(target);
        let completed = action === 'status';
        const result = await this.ssh.execute(target, privilegedCommand(target, action === 'status'
            ? `/bin/bash -c ${shellQuote(statusCommand(record.id))}`
            : `${deployerCommand(record.id)} ${action} ${record.id}`), privilegedInput(target, encodeFields({ RUNTIME_PORT: String(record.input.port) })), action === 'status' ? 20_000 : 10 * 60_000, (line) => {
            const event = EventSchema.safeParse(safeJson(line));
            if (!event.success)
                return;
            if (event.data.stage === 'complete' && event.data.state === 'succeeded')
                completed = true;
            onEvent(event.data);
        });
        if (result.code !== 0 || !completed)
            throw new Error('remoteActionFailed');
        if (action === 'stop' || action === 'remove')
            return 'stopped';
        return result.output.includes('流程服务暂不可用') ? 'unavailable' : 'running';
    }
    async prepare(target, id, files) {
        const root = `/opt/stratex/workflow/${id}`;
        const uploads = await Promise.all(files.map(async (file) => ({
            file,
            content: await readFile(join(this.options.assetsDirectory, ...file.split('/'))),
            mode: file.endsWith('.sh') ? 0o700 : 0o600,
        })));
        await this.ensurePrivilege(target);
        if (!needsSudo(target)) {
            const ready = await this.ssh.execute(target, `install -d -m 700 /opt/stratex/workflow ${root}`, '', 20_000);
            if (ready.code !== 0)
                throw new Error('remoteDirectoryUnavailable');
            await this.ssh.upload(target, uploads.map(({ file, content, mode }) => ({
                remotePath: `${root}/${file}`,
                content,
                mode,
            })));
            return;
        }
        const staged = await this.ssh.execute(target, `umask 077; mktemp -d /tmp/stratex-workflow.XXXXXX`, '', 20_000);
        const staging = staged.output.trim();
        if (staged.code !== 0 || !/^\/tmp\/stratex-workflow\.[a-zA-Z0-9]+$/u.test(staging))
            throw new Error('remoteDirectoryUnavailable');
        try {
            await this.ssh.upload(target, uploads.map(({ file, content, mode }) => ({
                remotePath: `${staging}/${file}`,
                content,
                mode,
            })));
            const install = [
                `install -d -m 700 /opt/stratex/workflow ${root}`,
                ...uploads.map(({ file, mode }) => `install -m ${mode.toString(8)} ${shellQuote(`${staging}/${file}`)} ${shellQuote(`${root}/${file}`)}`),
            ].join(' && ');
            const ready = await this.ssh.execute(target, privilegedCommand(target, `/bin/bash -c ${shellQuote(install)}`), privilegedInput(target), 20_000);
            if (ready.code !== 0)
                throw new Error('remoteDirectoryUnavailable');
        }
        finally {
            await this.ssh
                .execute(target, `rm -rf -- ${shellQuote(staging)}`, '', 20_000)
                .catch(() => undefined);
        }
    }
    async ensurePrivilege(target) {
        if (!needsSudo(target))
            return;
        const result = await this.ssh.execute(target, `sudo -k -S -p '' -v`, `${target.password}\n`, 20_000);
        if (result.code !== 0)
            throw new Error('remotePrivilegeUnavailable');
    }
}
function deployerCommand(id) {
    return `/bin/bash /opt/stratex/workflow/${id}/deploy.sh`;
}
function statusCommand(id) {
    return `/bin/bash /opt/stratex/workflow/${id}/deploy.sh status ${id}`;
}
function needsSudo(target) {
    return target.username !== 'root';
}
function privilegedCommand(target, command) {
    if (!needsSudo(target))
        return command;
    const runWithInput = `exec ${command} < "$1"`;
    const elevated = `sudo -k -S -p '' env STRATEX_MANAGEMENT_PEER_IP="\${SSH_CONNECTION%% *}" /bin/bash -c ${shellQuote(runWithInput)} bash "$STRATEX_INPUT_FILE"`;
    const authenticate = [
        `STRATEX_INPUT_FILE="$(mktemp /tmp/stratex-remote-input.XXXXXX)"`,
        `trap 'rm -f -- "$STRATEX_INPUT_FILE"' EXIT`,
        `trap 'exit 1' HUP INT TERM`,
        `chmod 600 "$STRATEX_INPUT_FILE"`,
        `IFS= read -r STRATEX_SUDO_PASSWORD`,
        `cat > "$STRATEX_INPUT_FILE"`,
        `printf '%s\\n' "$STRATEX_SUDO_PASSWORD" | ${elevated}`,
    ].join(' && ');
    return `/bin/bash -c ${shellQuote(authenticate)}`;
}
function privilegedInput(target, input = '') {
    return needsSudo(target) ? `${target.password}\n${input}` : input;
}
function shellQuote(value) {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}
function sshTarget(input) {
    return {
        host: input.host,
        port: input.sshPort,
        username: input.username,
        password: input.password,
    };
}
function deploymentInput(input, image, registry, model) {
    return encodeFields({
        RUNTIME_PORT: String(input.port),
        PUBLIC_ORIGIN: `http://${input.host}:${input.port}`,
        MODEL_NAME: model.model,
        MODEL_BASE_URL: model.baseUrl,
        MODEL_API_KEY: model.apiKey ?? '',
        MODEL_PROTOCOL: model.protocol ?? 'chat-completions',
        REGISTRY_USER: registry.username,
        REGISTRY_PASSWORD: registry.password,
        RUNTIME_IMAGE: image,
    });
}
function encodeFields(fields) {
    return `${Object.entries(fields)
        .map(([key, value]) => `${key}=${Buffer.from(value).toString('base64')}`)
        .join('\n')}\n`;
}
async function verifyAssets(root, files) {
    for (const [file, expected] of Object.entries(files)) {
        if (!file ||
            file.split('/').some((part) => !part || part === '.' || part === '..' || part.includes('\\')))
            throw new Error('invalid deploy asset path');
        const bytes = await readFile(join(root, ...file.split('/')));
        if (createHash('sha256').update(bytes).digest('hex') !== expected)
            throw new Error('deploy asset digest mismatch');
    }
}
function safeJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
