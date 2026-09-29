import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { WorkflowCreateSchema } from '../../shared/protocol/workflow-instances.js';
const recordSchema = z.strictObject({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^flow-[a-f0-9]{24}$/u),
    // Missing access belongs to an older local instance. Preserve its identity
    // and history instead of silently switching it to shared visitor sessions.
    input: WorkflowCreateSchema.extend({ access: z.enum(['local', 'lan']).default('local') }),
    databasePassword: z.string().regex(/^[a-f0-9]{48}$/u),
    encryptionKey: z.string().regex(/^[a-f0-9]{64}$/u),
    runtimeKind: z.enum(['bundled', 'separate']).optional(),
});
/** 每账号的实例目录；兼容读取旧单实例，凭据仍由系统安全存储保护。 */
export class WorkflowRuntimeStore {
    directory;
    encryption;
    async remove(account, id) {
        const records = await this.list(account);
        const record = records.find((item) => item.id === id);
        if (!record)
            return;
        // 保留恢复数据所需的加密元信息，不再出现在活动实例目录。
        await mkdir(join(this.directory, 'removed'), { recursive: true });
        await writeFile(join(this.directory, 'removed', `${id}.bin`), this.encryption.encryptString(JSON.stringify(record)));
        const target = join(this.directory, `${this.id(account)}.bin`);
        await writeFile(`${target}.tmp`, this.encryption.encryptString(JSON.stringify({
            schemaVersion: 2,
            owner: this.id(account),
            records: records.filter((item) => item.id !== id),
        })));
        await rename(`${target}.tmp`, target);
    }
    constructor(directory, encryption) {
        this.directory = directory;
        this.encryption = encryption;
    }
    id(account) {
        return `flow-${createHash('sha256').update(account).digest('hex').slice(0, 24)}`;
    }
    async read(account) {
        return (await this.list(account))[0] ?? null;
    }
    async list(account) {
        if (!this.encryption.isEncryptionAvailable())
            throw new Error('Credential storage unavailable');
        try {
            const bytes = await readFile(join(this.directory, `${this.id(account)}.bin`));
            const value = JSON.parse(this.encryption.decryptString(bytes));
            const catalog = z
                .strictObject({
                schemaVersion: z.literal(2),
                owner: z.string(),
                records: z.array(recordSchema),
            })
                .safeParse(value);
            if (catalog.success) {
                if (catalog.data.owner !== this.id(account))
                    throw new Error('Account mismatch');
                return catalog.data.records;
            }
            const record = recordSchema.parse(value);
            if (record.id !== this.id(account))
                throw new Error('Account mismatch');
            return [record];
        }
        catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
                return [];
            throw error;
        }
    }
    async save(account, input) {
        const records = await this.list(account);
        const existing = records.find((record) => record.input.requestId === input.requestId);
        if (existing)
            return existing;
        const record = recordSchema.parse({
            schemaVersion: 1,
            id: `flow-${randomBytes(12).toString('hex')}`,
            input,
            runtimeKind: 'bundled',
            databasePassword: randomBytes(24).toString('hex'),
            encryptionKey: randomBytes(32).toString('hex'),
        });
        await mkdir(this.directory, { recursive: true });
        const target = join(this.directory, `${this.id(account)}.bin`);
        await writeFile(`${target}.tmp`, this.encryption.encryptString(JSON.stringify({
            schemaVersion: 2,
            owner: this.id(account),
            records: [...records, record],
        })), {});
        await rename(`${target}.tmp`, target);
        return record;
    }
}
