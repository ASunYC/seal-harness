import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AutonomousDeploymentRecordSchema, AutonomousOperationSchema, AutonomousRemoteInputSchema, } from '../../shared/protocol/autonomous-instances.js';
const RemoteImageSchema = z.object({
    role: z.enum(['runtime', 'chat', 'map', 'knowledge', 'model', 'database']),
    reference: z.string().min(1).max(512),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});
export const AutonomousRemoteRecordSchema = z.object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^auto-[a-f0-9]{24}$/u),
    input: AutonomousRemoteInputSchema,
    host: z.ipv4(),
    sshPort: z.number().int().min(1).max(65535),
    username: z.string().min(1).max(64),
    credentialRef: z.uuid(),
    remoteDirectory: z.string().regex(/^\/opt\/stratex\/autonomous\/auto-[a-f0-9]{24}$/u),
    deploymentVersion: z.string().min(1).max(128),
    images: z.array(RemoteImageSchema).max(64),
    installed: z.boolean(),
    createdAt: z.number().nonnegative(),
    updatedAt: z.number().nonnegative(),
});
const RemoteCatalogSchema = z.object({
    schemaVersion: z.literal(1),
    owner: z.string(),
    records: z.array(AutonomousRemoteRecordSchema),
    credentials: z.record(z.uuid(), z.string().min(1).max(1024)),
    operation: AutonomousOperationSchema.nullable(),
    history: z.array(AutonomousDeploymentRecordSchema).max(50).default([]),
});
export class AutonomousRemoteStore {
    directory;
    encryption;
    writes = Promise.resolve();
    constructor(directory, encryption) {
        this.directory = directory;
        this.encryption = encryption;
    }
    async read(actor) {
        await this.writes;
        if (!this.encryption.isEncryptionAvailable())
            throw new Error('Secure storage unavailable');
        const owner = this.owner(actor);
        try {
            const value = RemoteCatalogSchema.parse(JSON.parse(this.encryption.decryptString(await readFile(this.path(owner)))));
            if (value.owner !== owner)
                throw new Error('Owner mismatch');
            return value;
        }
        catch (error) {
            if (isMissing(error))
                return this.empty(owner);
            throw error;
        }
    }
    async write(actor, catalog) {
        const parsed = RemoteCatalogSchema.parse(catalog);
        const owner = this.owner(actor);
        if (!this.encryption.isEncryptionAvailable() || parsed.owner !== owner)
            throw new Error('Secure storage unavailable');
        const write = this.writes
            .catch(() => undefined)
            .then(async () => {
            await mkdir(this.directory, { recursive: true });
            const path = this.path(owner);
            const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
            await writeFile(temporary, this.encryption.encryptString(JSON.stringify(parsed)), {

            });
            await rename(temporary, path);
        });
        this.writes = write;
        await write;
    }
    async update(actor, reducer) {
        const owner = this.owner(actor);
        const update = this.writes
            .catch(() => undefined)
            .then(async () => {
            const current = await this.readDirect(owner);
            const parsed = RemoteCatalogSchema.parse(reducer(current));
            if (parsed.owner !== owner)
                throw new Error('Owner mismatch');
            await this.writeDirect(owner, parsed);
        });
        this.writes = update;
        await update;
    }
    async saveCredential(actor, password, existing) {
        const catalog = await this.read(actor);
        const reference = existing ?? randomUUID();
        await this.write(actor, {
            ...catalog,
            credentials: { ...catalog.credentials, [reference]: password },
        });
        return reference;
    }
    async resolveCredential(actor, reference) {
        return (await this.read(actor)).credentials[reference] ?? null;
    }
    async removeCredential(actor, reference) {
        const catalog = await this.read(actor);
        const credentials = Object.fromEntries(Object.entries(catalog.credentials).filter(([key]) => key !== reference));
        await this.write(actor, { ...catalog, credentials });
    }
    owner(actor) {
        return createHash('sha256').update(actor).digest('hex');
    }
    path(owner) {
        return join(this.directory, `${owner}.bin`);
    }
    empty(owner) {
        return { schemaVersion: 1, owner, records: [], credentials: {}, operation: null, history: [] };
    }
    async readDirect(owner) {
        try {
            const value = RemoteCatalogSchema.parse(JSON.parse(this.encryption.decryptString(await readFile(this.path(owner)))));
            if (value.owner !== owner)
                throw new Error('Owner mismatch');
            return value;
        }
        catch (error) {
            if (isMissing(error))
                return this.empty(owner);
            throw error;
        }
    }
    async writeDirect(owner, catalog) {
        await mkdir(this.directory, { recursive: true });
        const path = this.path(owner);
        const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
        await writeFile(temporary, this.encryption.encryptString(JSON.stringify(catalog)), {

        });
        await rename(temporary, path);
    }
}
function isMissing(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
