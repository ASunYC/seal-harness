import { z } from 'zod';
import { TerminalPlatformCreateSchema as AutonomousPlatformCreateSchema } from './terminal-platform.js';
import { WorkflowModelSelectionSchema, WorkflowOptionsSchema } from './workflow-instances.js';
export const AutonomousInstanceNameSchema = z.string().trim().min(1).max(80);
const AutonomousCreateShape = {
    requestId: z.uuid(),
    name: AutonomousInstanceNameSchema,
    port: z.number().int().min(1024).max(65531),
    viewerPort: z.number().int().min(1024).max(65535),
    model: WorkflowModelSelectionSchema.nullable(),
};
export const AutonomousCreateSchema = z
    .strictObject(AutonomousCreateShape)
    .refine((value) => ![value.port, value.port + 1, value.port + 2, value.port + 3].includes(value.viewerPort));
export const AutonomousRemoteInputSchema = z
    .strictObject(AutonomousCreateShape)
    .refine((value) => ![value.port, value.port + 2, value.port + 3].includes(value.viewerPort));
export const AutonomousRemoteHostSchema = z.strictObject({
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
export const AutonomousRemoteCreateSchema = z
    .strictObject({
    ...AutonomousCreateShape,
    ...AutonomousRemoteHostSchema.shape,
})
    .refine((value) => ![value.port, value.port + 2, value.port + 3].includes(value.viewerPort));
export { TerminalPlatformCreateSchema as AutonomousPlatformCreateSchema } from './terminal-platform.js';
export const AutonomousPlatformBaseUrlSchema = z
    .string()
    .trim()
    .min(1)
    .max(2_048)
    .url()
    .superRefine((value, context) => {
    if (!/^https?:\/\//u.test(value)) {
        context.addIssue({ code: 'custom', message: '智枢地址只支持 HTTP(S)' });
    }
    const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/u)[0] ?? '';
    if (authority.includes('@') ||
        value.includes('?') ||
        value.includes('#') ||
        /\s/u.test(value)) {
        context.addIssue({ code: 'custom', message: '智枢地址不能包含凭据、空格、查询串或片段' });
    }
})
    .transform((value) => value.replace(/\/+$/u, ''));
export const AutonomousPlatformSettingsSchema = z.strictObject({
    baseUrl: AutonomousPlatformBaseUrlSchema,
    refreshIntervalMinutes: z.union([z.literal(0), z.number().int().min(1).max(1_440)]),
});
export const DEFAULT_AUTONOMOUS_PLATFORM_SETTINGS = Object.freeze({
    baseUrl: 'https://agent.geovisearth.com',
    refreshIntervalMinutes: 5,
});
export const AutonomousLocalRequestSchema = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('local-catalog') }),
    z.strictObject({ action: z.literal('snapshot') }),
    z.strictObject({ action: z.literal('inspect') }),
    z.strictObject({ action: z.literal('open-package-directory') }),
    z
        .strictObject({
        action: z.literal('check-port'),
        port: z.number().int().min(1024).max(65531),
        viewerPort: z.number().int().min(1024).max(65535),
    })
        .refine((value) => ![value.port, value.port + 1, value.port + 2, value.port + 3].includes(value.viewerPort)),
    z.strictObject({ action: z.literal('create'), input: AutonomousCreateSchema }),
    z.strictObject({
        action: z.literal('rename'),
        id: z.string().regex(/^auto-[a-f0-9]{24}$/u),
        name: AutonomousInstanceNameSchema,
    }),
    z.strictObject({
        action: z.enum(['start', 'stop', 'restart', 'delete', 'open-manage']),
        id: z.string().regex(/^auto-[a-f0-9]{24}$/u),
    }),
]);
export const AutonomousRemoteRequestSchema = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('remote-connect'), input: AutonomousRemoteHostSchema }),
    z.strictObject({ action: z.literal('remote-create'), input: AutonomousRemoteCreateSchema }),
    z.strictObject({ action: z.literal('remote-catalog') }),
    z.strictObject({ action: z.literal('remote-snapshot') }),
    z.strictObject({ action: z.literal('remote-dismiss-failure') }),
    z.strictObject({
        action: z.literal('remote-rename'),
        id: z.string().regex(/^auto-[a-f0-9]{24}$/u),
        name: AutonomousInstanceNameSchema,
    }),
    z.strictObject({
        action: z.enum([
            'remote-start',
            'remote-stop',
            'remote-restart',
            'remote-delete',
            'remote-open-manage',
        ]),
        id: z.string().regex(/^auto-[a-f0-9]{24}$/u),
        password: z.string().min(1).max(1024).optional(),
    }),
]);
export const AutonomousPlatformRequestSchema = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('platform-create'), input: AutonomousPlatformCreateSchema }),
    z.strictObject({ action: z.literal('platform-catalog') }),
    z.strictObject({ action: z.literal('platform-snapshot') }),
    z.strictObject({ action: z.literal('platform-settings-read') }),
    z.strictObject({
        action: z.literal('platform-settings-validate'),
        baseUrl: AutonomousPlatformBaseUrlSchema,
    }),
    z.strictObject({
        action: z.literal('platform-settings-write'),
        input: AutonomousPlatformSettingsSchema,
    }),
    z.strictObject({ action: z.literal('platform-dismiss-failure') }),
    z.strictObject({
        action: z.enum(['platform-start', 'platform-stop', 'platform-restart', 'platform-delete']),
        id: z.uuid(),
    }),
]);
export const AutonomousRequestSchema = z.union([
    AutonomousLocalRequestSchema,
    AutonomousRemoteRequestSchema,
    AutonomousPlatformRequestSchema,
]);
export const AutonomousPackageSchema = z.object({
    state: z.enum(['unchecked', 'checking', 'missing', 'invalid', 'ready', 'unsupported']),
    directory: z.string(),
    version: z.string().nullable(),
    checkedFiles: z.number().int().nonnegative(),
    totalFiles: z.number().int().nonnegative(),
    problem: z.string().nullable(),
    currentFile: z.string().optional(),
    processedBytes: z.number().nonnegative().optional(),
    fileBytes: z.number().nonnegative().optional(),
});
export const AutonomousEnvironmentSchema = z.object({
    state: z.enum([
        'unchecked',
        'ready',
        'dockerMissing',
        'dockerStopped',
        'composeMissing',
        'unsupported',
        'builderUnavailable',
    ]),
});
export const AutonomousInstanceSchema = z.object({
    id: z.string(),
    name: z.string(),
    port: z.number(),
    viewerPort: z.number(),
    status: z.enum([
        'checking',
        'starting',
        'stopping',
        'restarting',
        'running',
        'stopped',
        'unavailable',
        'incomplete',
    ]),
    configuration: z.enum(['unknown', 'provisioning', 'active']),
    adminUrl: z.string(),
    apiUrl: z.string(),
    packageVersion: z.string(),
    target: z.enum(['local', 'remote', 'platform']).optional(),
    host: z.string().nullable().optional(),
    sshPort: z.number().int().nullable().optional(),
    username: z.string().nullable().optional(),
});
export const AutonomousProgressEventSchema = z.object({
    stage: z.string().min(1).max(64),
    state: z.enum(['running', 'succeeded', 'failed']),
    message: z.string().min(1).max(512),
    at: z.number().nonnegative(),
});
export const AutonomousOperationSchema = z.object({
    startedAt: z.number().nonnegative().optional(),
    kind: z.enum(['inspect', 'create', 'start', 'stop', 'restart', 'delete']).optional(),
    target: z.enum(['local', 'remote', 'platform']).optional(),
    id: z.string(),
    instanceId: z.string().nullable(),
    state: z.enum(['running', 'succeeded', 'failed']),
    stage: z.string(),
    error: z.string().nullable(),
    progress: z.array(AutonomousProgressEventSchema).max(64).optional(),
});
export const AutonomousDeploymentRecordSchema = z.object({
    id: z.uuid(),
    instanceId: z.string().regex(/^auto-[a-f0-9]{24}$/u),
    instanceName: z.string().min(1).max(80),
    host: z.ipv4(),
    action: z.enum(['create', 'start', 'stop', 'restart', 'delete']),
    state: z.enum(['succeeded', 'failed']),
    startedAt: z.number().nonnegative(),
    finishedAt: z.number().nonnegative(),
    imageCount: z.number().int().nonnegative(),
    servicePort: z.number().int().min(1024).max(65531).optional(),
    mapPort: z.number().int().min(1024).max(65535).optional(),
    imageDigests: z
        .array(z.string().regex(/^sha256:[a-f0-9]{64}$/u))
        .max(64)
        .optional(),
});
export const AutonomousRemoteCatalogSchema = z.object({
    remoteCatalog: z.object({
        instances: z.array(AutonomousInstanceSchema),
        operation: AutonomousOperationSchema.nullable(),
        deployments: z.array(AutonomousDeploymentRecordSchema).max(50),
    }),
});
export const AutonomousLocalCatalogSchema = z.object({
    localCatalog: z.object({
        instances: z.array(AutonomousInstanceSchema),
        operation: AutonomousOperationSchema.nullable(),
    }),
});
export const AutonomousPlatformCatalogSchema = z.object({
    platformCatalog: z.object({
        instances: z.array(AutonomousInstanceSchema),
        operation: AutonomousOperationSchema.nullable(),
    }),
});
export const AutonomousPlatformSettingsResultSchema = z.object({
    platformSettings: AutonomousPlatformSettingsSchema,
});
export const AutonomousPlatformConnectionResultSchema = z.object({
    platformConnection: z.object({ reachable: z.literal(true) }),
});
export const AutonomousSnapshotSchema = z.object({
    package: AutonomousPackageSchema,
    environment: AutonomousEnvironmentSchema,
    models: WorkflowOptionsSchema.shape.models,
    defaultModel: WorkflowModelSelectionSchema.nullable().optional(),
    modelState: z.enum(['loading', 'ready', 'unavailable']).optional(),
    instances: z.array(AutonomousInstanceSchema),
    operation: AutonomousOperationSchema.nullable(),
    deployments: z.array(AutonomousDeploymentRecordSchema).max(50).optional(),
});
export const AutonomousPortCheckSchema = z.object({
    portCheck: z.object({
        port: z.number().int(),
        viewerPort: z.number().int(),
        available: z.boolean(),
    }),
});
export const AutonomousResultSchema = z.discriminatedUnion('ok', [
    z.object({
        ok: z.literal(true),
        value: z.union([
            AutonomousSnapshotSchema,
            AutonomousPortCheckSchema,
            AutonomousRemoteCatalogSchema,
            AutonomousLocalCatalogSchema,
            AutonomousPlatformCatalogSchema,
            AutonomousPlatformSettingsResultSchema,
            AutonomousPlatformConnectionResultSchema,
        ]),
    }),
    z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
