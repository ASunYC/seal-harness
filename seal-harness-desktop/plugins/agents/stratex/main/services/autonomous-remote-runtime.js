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
const ManifestSchema = z.object({
    schemaVersion: z.literal(1),
    deploymentVersion: z.string(),
    files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)),
    images: z.object({
        runtime: z.string(),
        chat: z.string(),
        map: z.string(),
        knowledge: z.string(),
        model: z.string(),
        database: z.string(),
    }),
});
export class AutonomousRemoteRuntime {
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
        const credential = await (this.options.registryCredential?.() ??
            resolveDockerRegistryCredential(REGISTRY));
        if (!credential)
            throw new Error('registryCredentialUnavailable');
        const manifest = ManifestSchema.parse(JSON.parse(await readFile(join(this.options.assetsDirectory, 'manifest.json'), 'utf8')));
        await verifyAssets(this.options.assetsDirectory, manifest.files);
        const target = sshTarget(input);
        await this.prepare(target, id, Object.keys(manifest.files).filter((file) => !file.endsWith('.test.sh')));
        const request = deploymentInput(input, manifest.images, credential, model);
        let completed = false;
        const result = await this.ssh.execute(target, privilegedCommand(target, `${deployerCommand(id)} ${action} ${id}`), privilegedInput(target, request), 45 * 60_000, (line) => {
            const parsed = EventSchema.safeParse(safeJson(line));
            if (parsed.success) {
                if (parsed.data.stage === 'complete' && parsed.data.state === 'succeeded')
                    completed = true;
                onEvent(parsed.data);
            }
        });
        if (result.code !== 0 || !completed)
            throw new Error('remoteDeployFailed');
        const lock = await this.ssh.execute(target, privilegedCommand(target, `cat /opt/stratex/autonomous/${id}/images.lock`), privilegedInput(target), 20_000);
        if (lock.code !== 0)
            throw new Error('remoteImageLockUnavailable');
        return {
            version: manifest.deploymentVersion,
            images: parseImageLock(lock.output, manifest.images),
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
        const input = encodeFields({ RUNTIME_PORT: String(record.input.port) });
        let completed = action === 'status';
        const result = await this.ssh.execute(target, privilegedCommand(target, action === 'status'
            ? `/bin/bash -c ${shellQuote(statusCommand(record.id))}`
            : `${deployerCommand(record.id)} ${action} ${record.id}`), privilegedInput(target, input), action === 'status' ? 20_000 : 10 * 60_000, (line) => {
            const parsed = EventSchema.safeParse(safeJson(line));
            if (parsed.success) {
                if (parsed.data.stage === 'complete' && parsed.data.state === 'succeeded')
                    completed = true;
                onEvent(parsed.data);
            }
        });
        if (result.code !== 0 || !completed)
            throw new Error('remoteActionFailed');
        if (action === 'stop' || action === 'remove')
            return 'stopped';
        return result.output.includes('智能体暂不可用') ? 'unavailable' : 'running';
    }
    async prepare(target, id, files) {
        const root = `/opt/stratex/autonomous/${id}`;
        const uploads = await Promise.all(files.map(async (file) => ({
            file,
            content: await readFile(join(this.options.assetsDirectory, ...file.split('/'))),
            mode: file.endsWith('.sh') ? 0o700 : 0o600,
        })));
        if (!needsSudo(target)) {
            const command = `install -d -m 700 /opt/stratex/autonomous ${root}`;
            const ready = await this.ssh.execute(target, command, '', 20_000);
            if (ready.code !== 0)
                throw new Error('remoteDirectoryUnavailable');
            await this.ssh.upload(target, uploads.map(({ file, content, mode }) => ({
                remotePath: `${root}/${file}`,
                content,
                mode,
            })));
            return;
        }
        await this.ensurePrivilege(target);
        const stagingResult = await this.ssh.execute(target, `umask 077; mktemp -d /tmp/stratex-autonomous.XXXXXX`, '', 20_000);
        const staging = stagingResult.output.trim();
        if (stagingResult.code !== 0 || !/^\/tmp\/stratex-autonomous\.[a-zA-Z0-9]+$/u.test(staging))
            throw new Error('remoteDirectoryUnavailable');
        try {
            const stagingDirectories = [
                ...new Set(files
                    .map((file) => file.split('/').slice(0, -1))
                    .filter((parts) => parts.length > 0)
                    .flatMap((parts) => parts.map((_, index) => parts.slice(0, index + 1).join('/')))),
            ];
            if (stagingDirectories.length) {
                const staged = await this.ssh.execute(target, `install -d -m 700 ${stagingDirectories
                    .map((directory) => shellQuote(`${staging}/${directory}`))
                    .join(' ')}`, '', 20_000);
                if (staged.code !== 0)
                    throw new Error('remoteDirectoryUnavailable');
            }
            await this.ssh.upload(target, uploads.map(({ file, content, mode }) => ({
                remotePath: `${staging}/${file}`,
                content,
                mode,
            })));
            const install = [
                `install -d -m 700 /opt/stratex/autonomous ${root}`,
                ...uploads.map(({ file, mode }) => `install -m ${mode.toString(8)} ${shellQuote(`${staging}/${file}`)} ${shellQuote(`${root}/${file}`)}`),
            ].join(' && ');
            const ready = await this.ssh.execute(target, privilegedCommand(target, `/bin/bash -c ${shellQuote(install)}`), privilegedInput(target), 20_000);
            if (ready.code !== 0)
                throw new Error('remoteDirectoryUnavailable');
        }
        finally {
            // 临时目录只包含公开部署资产；连接中断时无法继续远程清理，保留原始失败供上层重试。
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
    return `/bin/bash /opt/stratex/autonomous/${id}/deploy.sh`;
}
function statusCommand(id) {
    const instance = `/opt/stratex/autonomous/${id}/deploy.sh`;
    return `if test -f ${instance}; then /bin/bash ${instance} status ${id}; else /bin/bash /opt/stratex/autonomous/deploy.sh status ${id}; fi`;
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
function sshTarget(input) {
    return {
        host: input.host,
        port: input.sshPort,
        username: input.username,
        password: input.password,
    };
}
function deploymentInput(input, images, registry, model) {
    const fields = {
        RUNTIME_PORT: String(input.port),
        MAP_PORT: String(input.viewerPort),
        MODEL_NAME: model?.model ?? '',
        MODEL_BASE_URL: model?.baseUrl ?? '',
        MODEL_API_KEY: model?.apiKey ?? '',
        MODEL_PROTOCOL: model?.protocol ?? 'chat-completions',
        REGISTRY_USER: registry.username,
        REGISTRY_PASSWORD: registry.password,
        PUBLIC_HOST: input.host,
        RUNTIME_IMAGE: images.runtime,
        CHAT_IMAGE: images.chat,
        MAP_IMAGE: images.map,
        KNOWLEDGE_IMAGE: images.knowledge,
        MODEL_SERVICE_IMAGE: images.model,
        DATABASE_IMAGE: images.database,
    };
    return encodeFields(fields);
}
function encodeFields(fields) {
    return (Object.entries(fields)
        .map(([key, value]) => `${key}=${Buffer.from(value).toString('base64')}`)
        .join('\n') + '\n');
}
function parseImageLock(output, references) {
    const roles = {
        RUNTIME_IMAGE: 'runtime',
        CHAT_IMAGE: 'chat',
        MAP_IMAGE: 'map',
        KNOWLEDGE_IMAGE: 'knowledge',
        MODEL_SERVICE_IMAGE: 'model',
        DATABASE_IMAGE: 'database',
    };
    const refs = {
        runtime: references.runtime,
        chat: references.chat,
        map: references.map,
        knowledge: references.knowledge,
        model: references.model,
        database: references.database,
    };
    const parsed = output
        .trim()
        .split(/\r?\n/u)
        .map((line) => {
        const [key, value] = line.split('=', 2);
        const role = roles[key];
        const digest = value?.match(/@?(sha256:[a-f0-9]{64})$/u)?.[1];
        if (!role || !digest)
            throw new Error('invalid image lock');
        return { role, reference: refs[role], digest };
    });
    if (parsed.length !== 6 || new Set(parsed.map((image) => image.role)).size !== 6)
        throw new Error('invalid image lock');
    return parsed;
}
function safeJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
