import { z } from 'zod';
import { TerminalPlatformRequestSchema } from './terminal-platform.js';
export { TerminalPlatformRequestSchema as WorkflowPlatformRequestSchema } from './terminal-platform.js';
import { WorkflowResourceSelectionSchema } from './workflow-resources.js';
const id = z.string().trim().min(1).max(160);
export const WorkflowModelSelectionSchema = z.strictObject({ connectionId: id, remoteModelId: id });
export const WorkflowCreateSchema = z.strictObject({
    requestId: z.uuid(),
    name: z.string().trim().min(1).max(80),
    model: z.strictObject({ connectionId: id, remoteModelId: id }),
    administrator: z
        .strictObject({
        username: z.string().regex(/^[a-zA-Z0-9_-]{3,64}$/u),
        password: z.string().min(12).max(200),
    })
        .optional(),
    port: z.number().int().min(1024).max(65535).default(43100),
    access: z.enum(['local', 'lan']).default('lan'),
});
export const WorkflowRemoteHostSchema = z.strictObject({
    host: z.ipv4(),
    sshPort: z.number().int().min(1).max(65535),
    username: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[A-Za-z_][A-Za-z0-9._-]*$/u),
    password: z.string().min(1).max(1024),
});
export const WorkflowRemoteCreateSchema = z.strictObject({
    ...WorkflowCreateSchema.shape,
    ...WorkflowRemoteHostSchema.shape,
});
export const WorkflowLocalRequestSchema = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('resource-options') }),
    z.strictObject({
        action: z.literal('install-resources'),
        id,
        resources: z.array(WorkflowResourceSelectionSchema).min(1).max(32),
    }),
    z.strictObject({ action: z.literal('status') }),
    z.strictObject({ action: z.literal('list') }),
    z.strictObject({ action: z.literal('options') }),
    z.strictObject({ action: z.literal('check-port'), port: z.number().int().min(1024).max(65535) }),
    z.strictObject({ action: z.literal('models') }),
    z.strictObject({ action: z.literal('prepare') }),
    z.strictObject({ action: z.literal('preflight'), input: WorkflowCreateSchema }),
    z.strictObject({ action: z.literal('create'), input: WorkflowCreateSchema }),
    z.strictObject({ action: z.literal('observe'), id }),
    z.strictObject({ action: z.literal('unobserve') }),
    z.strictObject({
        action: z.enum(['start', 'stop', 'restart', 'delete']),
        id,
    }),
    z.strictObject({ action: z.literal('open'), id, target: z.enum(['admin', 'chat', 'api']) }),
]);
export const WorkflowRemoteRequestSchema = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('remote-connect'), input: WorkflowRemoteHostSchema }),
    z.strictObject({ action: z.literal('remote-create'), input: WorkflowRemoteCreateSchema }),
    z.strictObject({ action: z.literal('remote-catalog') }),
    z.strictObject({ action: z.literal('remote-snapshot') }),
    z.strictObject({ action: z.literal('remote-dismiss-failure') }),
    z.strictObject({
        action: z.enum([
            'remote-start',
            'remote-stop',
            'remote-restart',
            'remote-delete',
            'remote-open',
        ]),
        id: z.string().regex(/^flow-[a-f0-9]{24}$/u),
        target: z.enum(['admin', 'chat', 'api']).optional(),
        password: z.string().min(1).max(1024).optional(),
    }),
]);
export const WorkflowRequestSchema = z.union([
    WorkflowLocalRequestSchema,
    WorkflowRemoteRequestSchema,
    TerminalPlatformRequestSchema,
]);
export const WorkflowInstanceSchema = z.object({
    id,
    name: z.string(),
    status: z.enum([
        'checking',
        'ready',
        'starting',
        'stopping',
        'restarting',
        'stopped',
        'unavailable',
        'incomplete',
    ]),
    serviceUrl: z.string().optional(),
    adminUrl: z.string().optional(),
    activeVersionId: z.string().nullable().optional(),
    apiUrl: z.string().optional(),
    port: z.number().optional(),
    access: z.enum(['local', 'lan']).optional(),
    shareUrls: z.array(z.string()).optional(),
    statusReason: z.string().optional(),
    target: z.enum(['local', 'remote', 'platform']).optional(),
    host: z.string().nullable().optional(),
    sshPort: z.number().int().nullable().optional(),
    username: z.string().nullable().optional(),
    packageVersion: z.string().optional(),
});
export const WorkflowProgressEventSchema = z.object({
    stage: z.string().min(1).max(64),
    state: z.enum(['running', 'succeeded', 'failed']),
    message: z.string().min(1).max(512),
    at: z.number().nonnegative(),
});
export const WorkflowOperationSchema = z.object({
    startedAt: z.number().nonnegative().optional(),
    kind: z.enum(['prepare', 'create', 'start', 'stop', 'restart', 'delete']).optional(),
    target: z.enum(['local', 'remote', 'platform']).optional(),
    id: z.string(),
    instanceId: z.string().nullable(),
    state: z.enum(['running', 'succeeded', 'failed']),
    stage: z.string(),
    error: z.string().nullable(),
    progress: z.array(WorkflowProgressEventSchema).max(64).optional(),
});
export const WorkflowDeploymentRecordSchema = z.object({
    id: z.uuid(),
    instanceId: z.string().regex(/^flow-[a-f0-9]{24}$/u),
    instanceName: z.string().min(1).max(80),
    host: z.ipv4(),
    action: z.enum(['create', 'start', 'stop', 'restart', 'delete']),
    state: z.enum(['succeeded', 'failed']),
    startedAt: z.number().nonnegative(),
    finishedAt: z.number().nonnegative(),
    imageCount: z.literal(1),
    servicePort: z.number().int().min(1024).max(65535).optional(),
    imageDigests: z
        .array(z.string().regex(/^sha256:[a-f0-9]{64}$/u))
        .max(1)
        .optional(),
});
export const WorkflowRemoteCatalogSchema = z.object({
    instances: z.array(WorkflowInstanceSchema),
    operation: WorkflowOperationSchema.nullable(),
    deployments: z.array(WorkflowDeploymentRecordSchema).max(50),
});
export const WorkflowResultSchema = z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value: z.unknown() }),
    z.strictObject({
        ok: z.literal(false),
        error: z.strictObject({ code: z.string(), message: z.string() }),
    }),
]);
export const WorkflowOptionsSchema = z.object({
    available: z.boolean(),
    packAvailable: z.boolean().optional(),
    dockerInstalled: z.boolean().optional(),
    runtimeReason: z
        .enum(['runtimeUnavailable', 'networkPoolExhausted', 'portUnavailable'])
        .optional(),
    models: z.array(z.object({
        connectionId: id,
        remoteModelId: id,
        label: z.string(),
    })),
});
export const WorkflowRuntimeEventSchema = z.object({
    instance: WorkflowInstanceSchema.nullable(),
});
export const WorkflowPlatformCatalogSchema = z.object({
    instances: z.array(WorkflowInstanceSchema),
    operation: WorkflowOperationSchema.nullable(),
});
