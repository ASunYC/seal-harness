import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
const ManifestSchema = z.strictObject({
    schemaVersion: z.literal(1),
    version: z.string().regex(/^0\.1\.\d+(?:[-+].+)?$/u),
    file: z.literal('stratex-flow.mjs'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    runtimeImage: z
        .string()
        .regex(/^sha256:[a-f0-9]{64}$/u)
        .optional(),
    postgresImage: z
        .string()
        .regex(/^sha256:[a-f0-9]{64}$/u)
        .optional(),
    bundleImage: z
        .string()
        .regex(/^sha256:[a-f0-9]{64}$/u)
        .optional(),
    bootstrapSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .optional(),
});
const EventSchema = z.object({
    schemaVersion: z.literal(1),
    seq: z.number().int().nonnegative(),
    type: z.string(),
    data: z.unknown().optional(),
});
const MAX_OUTPUT = 2 * 1024 * 1024;
const PublicErrorCode = z.enum([
    'networkPoolExhausted',
    'runtimeUnavailable',
    'portUnavailable',
    'runtimeNotCreated',
    'invalidResponse',
]);
const ENVIRONMENT_KEYS = new Set([
    'systemroot',
    'programw6432',
    'programfiles',
    'programdata',
    'windir',
    'path',
    'temp',
    'tmp',
    'userprofile',
    'home',
    'appdata',
    'localappdata',
    'comspec',
    'pathext',
    'lang',
    'lc_all',
    'ssl_cert_file',
    'ssl_cert_dir',
    'node_extra_ca_certs',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'all_proxy',
]);
export class WorkflowCliError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
/** A fixed, hash-verified program; requests and credentials travel only over stdin. */
export class WorkflowCli {
    options;
    constructor(options) {
        this.options = options;
    }
    async execute(args, envelope) {
        this.options.signal?.throwIfAborted();
        if (!isAbsolute(this.options.executable))
            throw new WorkflowCliError('artifactUnavailable');
        let entry;
        let images = {};
        let runtimePack;
        try {
            const root = await realpath(this.options.resourceDirectory);
            const manifest = ManifestSchema.parse(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')));
            images = {
                runtimeImage: manifest.runtimeImage,
                postgresImage: manifest.postgresImage,
                bundleImage: manifest.bundleImage,
            };
            entry = await realpath(join(root, manifest.file));
            const local = relative(root, entry);
            if (local.startsWith('..') || isAbsolute(local))
                throw new Error('outside artifact');
            const digest = createHash('sha256')
                .update(await readFile(entry))
                .digest('hex');
            if (digest !== manifest.sha256)
                throw new Error('digest mismatch');
            if (manifest.bootstrapSha256 &&
                createHash('sha256')
                    .update(await readFile(join(root, 'prepare-docker.ps1')))
                    .digest('hex') !== manifest.bootstrapSha256)
                throw new Error('bootstrap digest mismatch');
            try {
                const packRoot = this.options.runtimePackDirectory || join(root, '..', 'workflow-runtime');
                const pack = z
                    .object({
                    schemaVersion: z.literal(1),
                    product: z.literal('stratex-langgraph'),
                    platform: z.literal('linux/amd64'),
                    imageReference: z.string().regex(/^metaversedockerrepo\.geovisearth\.com\/agentearth\/stratex-langgraph:0\.1\.[1-9]\d*$/u).optional(),
                    image: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
                    archive: z.literal('stratex-langgraph.tar'),
                    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
                })
                    .parse(JSON.parse(await readFile(join(packRoot, 'runtime-pack.json'), 'utf8')));
                runtimePack = { ...pack, archive: join(packRoot, pack.archive) };
                images.bundleImage = pack.image;
            }
            catch (cause) {
                if (!(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT'))
                    throw cause;
            }
        }
        catch {
            throw new WorkflowCliError('artifactUnavailable');
        }
        return this.run(entry, args, { input: envelope, images, runtimePack });
    }
    run(entry, args, envelope) {
        return new Promise((resolve, reject) => {
            const child = spawn(this.options.executable, [entry, ...args, '--json', '--input-stdin'], {
                shell: false,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => ENVIRONMENT_KEYS.has(key.toLowerCase()))),
                    ELECTRON_RUN_AS_NODE: '1',
                },
            });
            let output = '';
            let bytes = 0;
            let settled = false;
            const decoder = new StringDecoder('utf8');
            const timer = setTimeout(() => finish(new WorkflowCliError('timeout')), this.options.timeoutMs ??
                (args[0] === 'prepare'
                    ? 20 * 60_000
                    : ['doctor', 'status'].includes(args[0] ?? '')
                        ? 8000
                        : 180_000));
            const finish = (error, value) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                this.options.signal?.removeEventListener('abort', abort);
                if (error) {
                    child.kill();
                    reject(error);
                }
                else
                    resolve(value);
            };
            const abort = () => finish(new WorkflowCliError('operationCancelled'));
            this.options.signal?.addEventListener('abort', abort, { once: true });
            if (this.options.signal?.aborted) abort();
            child.on('error', () => finish(new WorkflowCliError('artifactUnavailable')));
            child.stdin.on('error', () => finish(new WorkflowCliError('unavailable')));
            child.stdout.on('data', (chunk) => {
                bytes += chunk.length;
                if (bytes > MAX_OUTPUT)
                    finish(new WorkflowCliError('invalidResponse'));
                else
                    output += decoder.write(chunk);
            });
            // Never copy subprocess stderr (which may contain upstream credentials) to UI/logs.
            child.stderr.on('data', (chunk) => {
                bytes += chunk.length;
                if (bytes > MAX_OUTPUT)
                    finish(new WorkflowCliError('invalidResponse'));
            });
            child.on('close', (code) => {
                try {
                    output += decoder.end();
                    const events = output
                        .split('\n')
                        .filter((line) => line.trim())
                        .map((line) => EventSchema.parse(JSON.parse(line)));
                    if (events.some((event, index) => index > 0 && event.seq <= (events[index - 1]?.seq ?? -1)))
                        throw new Error('sequence');
                    const failed = events.find((event) => event.type === 'error');
                    if (code !== 0 || failed) {
                        const publicError = z.object({ code: PublicErrorCode }).safeParse(failed?.data);
                        return finish(new WorkflowCliError(publicError.success ? publicError.data.code : 'requestFailed'));
                    }
                    const result = [...events]
                        .reverse()
                        .find((event) => event.type === 'result' || event.type === 'done');
                    if (!result)
                        throw new Error('missing result');
                    finish(undefined, result.data);
                }
                catch {
                    finish(new WorkflowCliError('invalidResponse'));
                }
            });
            child.stdin.end(JSON.stringify(envelope));
        });
    }
}
