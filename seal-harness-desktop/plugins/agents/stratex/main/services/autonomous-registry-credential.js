import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
const RegistryCredentialSchema = z.object({
    Username: z.string().min(1),
    Secret: z.string().min(1),
});
const DockerConfigSchema = z.object({
    auths: z.record(z.string(), z.object({ auth: z.string().optional() })).optional(),
    credsStore: z
        .string()
        .regex(/^[A-Za-z0-9._-]+$/u)
        .optional(),
    credHelpers: z.record(z.string(), z.string().regex(/^[A-Za-z0-9._-]+$/u)).optional(),
});
export async function resolveDockerRegistryCredential(registry, configPath = join(homedir(), '.docker', 'config.json')) {
    const config = DockerConfigSchema.parse(JSON.parse(await readFile(configPath, 'utf8')));
    const direct = config.auths?.[registry]?.auth;
    if (direct) {
        const decoded = Buffer.from(direct, 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator > 0 && separator < decoded.length - 1)
            return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
    }
    const helper = config.credHelpers?.[registry] ?? config.credsStore;
    if (!helper)
        return null;
    return runCredentialHelper(helper, registry);
}
function runCredentialHelper(helper, registry) {
    return new Promise((resolve) => {
        const child = spawn(`docker-credential-${helper}`, ['get'], {
            shell: false,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        let output = '';
        let bytes = 0;
        const timer = setTimeout(() => child.kill(), 5000);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes <= 64 * 1024)
                output += chunk;
            else
                child.kill();
        });
        child.once('error', () => {
            clearTimeout(timer);
            resolve(null);
        });
        child.once('close', (code) => {
            clearTimeout(timer);
            if (code !== 0)
                return resolve(null);
            const parsed = RegistryCredentialSchema.safeParse(safeJson(output));
            resolve(parsed.success ? { username: parsed.data.Username, password: parsed.data.Secret } : null);
        });
        child.stdin.end(registry);
    });
}
function safeJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
