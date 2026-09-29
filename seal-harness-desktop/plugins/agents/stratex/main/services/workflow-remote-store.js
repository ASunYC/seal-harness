import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { WorkflowCreateSchema, WorkflowDeploymentRecordSchema, WorkflowOperationSchema, } from '../../shared/protocol/workflow-instances.js';
const WorkflowRemoteImageSchema = z.object({
    role: z.literal('runtime'),
    reference: z.string().min(1).max(512),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});
export const WorkflowRemoteRecordSchema = z.object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^flow-[a-f0-9]{24}$/u),
    input: WorkflowCreateSchema,
    host: z.ipv4(),
    sshPort: z.number().int().min(1).max(65535),
    username: z.string().min(1).max(64),
    credentialRef: z.uuid(),
    remoteDirectory: z.string().regex(/^\/opt\/stratex\/workflow\/flow-[a-f0-9]{24}$/u),
    deploymentVersion: z.string().min(1).max(128),
    images: z.array(WorkflowRemoteImageSchema).length(1),
    installed: z.boolean(),
    createdAt: z.number().nonnegative(),
    updatedAt: z.number().nonnegative(),
});
const WorkflowRemoteCatalogSchema = z.object({
    schemaVersion: z.literal(1),
    owner: z.string(),
    records: z.array(WorkflowRemoteRecordSchema),
    credentials: z.record(z.uuid(), z.string().min(1).max(1024)),
    operation: WorkflowOperationSchema.nullable(),
    history: z.array(WorkflowDeploymentRecordSchema).max(50).default([]),
});
/** 每账号加密保存固定主机实例；明文 SSH 密码不会进入普通运行记录。 */
export class WorkflowRemoteStore {
    directory;
    encryption;
    writes = Promise.resolve();
    constructor(directory, encryption) {
        this.directory = directory;
        this.encryption = encryption;
    }
    async read(actor) {
        await this.writes;
        return this.readDirect(this.owner(actor));
    }
    async write(actor, catalog) {
        const owner = this.owner(actor);
        const parsed = WorkflowRemoteCatalogSchema.parse(catalog);
        if (parsed.owner !== owner)
            throw new Error('Owner mismatch');
        const write = this.writes.catch(() => undefined).then(() => this.writeDirect(owner, parsed));
        this.writes = write;
        await write;
    }
    async update(actor, reducer) {
        const owner = this.owner(actor);
        const update = this.writes
            .catch(() => undefined)
            .then(async () => {
            const current = await this.readDirect(owner);
            const next = WorkflowRemoteCatalogSchema.parse(reducer(current));
            if (next.owner !== owner)
                throw new Error('Owner mismatch');
            await this.writeDirect(owner, next);
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
        await this.write(actor, {
            ...catalog,
            credentials: Object.fromEntries(Object.entries(catalog.credentials).filter(([key]) => key !== reference)),
        });
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
        if (!this.encryption.isEncryptionAvailable())
            throw new Error('Secure storage unavailable');
        try {
            const value = WorkflowRemoteCatalogSchema.parse(JSON.parse(this.encryption.decryptString(await readFile(this.path(owner)))));
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
        if (!this.encryption.isEncryptionAvailable())
            throw new Error('Secure storage unavailable');
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
