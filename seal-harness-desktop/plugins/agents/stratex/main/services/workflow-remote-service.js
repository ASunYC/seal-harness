import { randomBytes, randomUUID } from 'node:crypto';
import { WorkflowRemoteRequestSchema } from '../../shared/protocol/workflow-instances.js';
import { AUTONOMOUS_REMOTE_ERROR_MESSAGES } from './autonomous-remote-errors.js';
export class WorkflowRemoteService {
    options;
    busy = false;
    progressWrites = Promise.resolve();
    statusCache = new Map();
    constructor(options) {
        this.options = options;
    }
    async request(raw) {
        const actor = this.actor();
        const request = WorkflowRemoteRequestSchema.parse(raw);
        if (request.action === 'remote-snapshot' || request.action === 'remote-catalog')
            return this.snapshot(actor);
        if (request.action === 'remote-connect') {
            await this.options.runtime.check(request.input);
            return this.snapshot(actor);
        }
        if (request.action === 'remote-dismiss-failure') {
            await this.options.store.update(actor, (catalog) => {
                if (catalog.operation?.state !== 'failed' || catalog.operation.instanceId)
                    throw new Error('operationCannotBeDismissed');
                return { ...catalog, operation: null };
            });
            return this.snapshot(actor);
        }
        if (this.busy)
            throw new Error('operationInProgress');
        this.busy = true;
        try {
            if (request.action === 'remote-create')
                await this.create(actor, request.input);
            else
                await this.lifecycle(actor, request);
            return this.snapshot(actor);
        }
        finally {
            this.busy = false;
        }
    }
    async create(actor, input) {
        const startedAt = Date.now();
        const operationId = randomUUID();
        let instanceId = null;
        await this.setOperation(actor, {
            id: operationId,
            instanceId: null,
            kind: 'create',
            target: 'remote',
            state: 'running',
            stage: '正在准备发布',
            error: null,
            startedAt,
            progress: [],
        });
        try {
            await this.options.runtime.check(input);
            const catalog = await this.options.store.read(actor);
            const existing = catalog.records.find((item) => item.input.requestId === input.requestId);
            instanceId = existing?.id ?? `flow-${randomBytes(12).toString('hex')}`;
            const credentialRef = await this.options.store.saveCredential(actor, input.password, existing?.credentialRef);
            const now = Date.now();
            const localInput = {
                requestId: input.requestId,
                name: input.name,
                model: input.model,
                ...(input.administrator ? { administrator: input.administrator } : {}),
                port: input.port,
                access: 'lan',
            };
            const record = existing ?? {
                schemaVersion: 1,
                id: instanceId,
                input: localInput,
                host: input.host,
                sshPort: input.sshPort,
                username: input.username,
                credentialRef,
                remoteDirectory: `/opt/stratex/workflow/${instanceId}`,
                deploymentVersion: 'pending',
                images: [
                    {
                        role: 'runtime',
                        reference: 'pending',
                        digest: `sha256:${'0'.repeat(64)}`,
                    },
                ],
                installed: false,
                createdAt: now,
                updatedAt: now,
            };
            await this.options.store.update(actor, (current) => ({
                ...current,
                records: [...current.records.filter((item) => item.id !== record.id), record],
                operation: { ...current.operation, instanceId: record.id },
            }));
            const model = await this.options.resolveModel(input.model);
            assertRemoteModel(model);
            const result = await this.options.runtime.deploy(input, record.id, model, (event) => void this.progress(actor, event), existing ? 'recover' : 'deploy');
            await this.progressWrites;
            await this.options.store.update(actor, (current) => ({
                ...current,
                records: current.records.map((item) => item.id === record.id
                    ? {
                        ...item,
                        input: localInput,
                        host: input.host,
                        sshPort: input.sshPort,
                        username: input.username,
                        credentialRef,
                        deploymentVersion: result.version,
                        images: result.images,
                        installed: true,
                        updatedAt: Date.now(),
                    }
                    : item),
                operation: current.operation
                    ? {
                        ...current.operation,
                        state: 'succeeded',
                        stage: '流程型智能体发布完成',
                        error: null,
                    }
                    : null,
                history: appendHistory(current.history, {
                    id: randomUUID(),
                    instanceId: record.id,
                    instanceName: input.name,
                    host: input.host,
                    action: 'create',
                    state: 'succeeded',
                    startedAt,
                    finishedAt: Date.now(),
                    imageCount: 1,
                    servicePort: input.port,
                    imageDigests: result.images.map((image) => image.digest),
                }),
            }));
            this.statusCache.set(record.id, { status: 'running', checkedAt: Date.now() });
        }
        catch (error) {
            await this.progressWrites;
            await this.fail(actor, publicMessage(error), instanceId);
            throw error;
        }
    }
    async lifecycle(actor, request) {
        const catalog = await this.options.store.read(actor);
        const record = catalog.records.find((item) => item.id === request.id);
        if (!record)
            throw new Error('instanceUnavailable');
        if (request.action === 'remote-open') {
            const path = request.target === 'chat'
                ? '/chat'
                : request.target === 'api'
                    ? '/api/v1/instance'
                    : '/admin/';
            await this.options.openExternal(`http://${record.host}:${record.input.port}${path}`);
            return;
        }
        const password = request.password ?? (await this.options.store.resolveCredential(actor, record.credentialRef));
        if (!password)
            throw new Error('credentialUnavailable');
        const action = request.action.replace('remote-', '');
        const runtimeAction = action === 'delete' ? 'remove' : action;
        const startedAt = Date.now();
        await this.setOperation(actor, {
            id: randomUUID(),
            instanceId: record.id,
            kind: action,
            target: 'remote',
            state: 'running',
            stage: actionLabel(action),
            error: null,
            startedAt,
            progress: [],
        });
        try {
            let recovered = null;
            if (action === 'start' && !record.installed) {
                const model = await this.options.resolveModel(record.input.model);
                assertRemoteModel(model);
                recovered = await this.options.runtime.deploy({
                    ...record.input,
                    host: record.host,
                    sshPort: record.sshPort,
                    username: record.username,
                    password,
                }, record.id, model, (event) => void this.progress(actor, event), 'recover');
            }
            else {
                await this.options.runtime.action(record, password, runtimeAction, (event) => void this.progress(actor, event));
            }
            await this.progressWrites;
            await this.options.store.update(actor, (current) => ({
                ...current,
                records: action === 'delete'
                    ? current.records.filter((item) => item.id !== record.id)
                    : current.records.map((item) => item.id === record.id
                        ? {
                            ...item,
                            installed: true,
                            ...(recovered
                                ? {
                                    deploymentVersion: recovered.version,
                                    images: recovered.images,
                                }
                                : {}),
                            updatedAt: Date.now(),
                        }
                        : item),
                operation: current.operation
                    ? { ...current.operation, state: 'succeeded', stage: '操作已完成', error: null }
                    : null,
                history: appendHistory(current.history, {
                    id: randomUUID(),
                    instanceId: record.id,
                    instanceName: record.input.name,
                    host: record.host,
                    action,
                    state: 'succeeded',
                    startedAt,
                    finishedAt: Date.now(),
                    imageCount: 1,
                    servicePort: record.input.port,
                    imageDigests: record.images.map((image) => image.digest),
                }),
            }));
            if (action === 'delete') {
                await this.options.store.removeCredential(actor, record.credentialRef);
                this.statusCache.delete(record.id);
            }
            else {
                this.statusCache.set(record.id, {
                    status: action === 'stop' ? 'stopped' : 'running',
                    checkedAt: Date.now(),
                });
            }
        }
        catch (error) {
            await this.progressWrites;
            await this.fail(actor, publicMessage(error), record.id);
            throw error;
        }
    }
    async snapshot(actor) {
        const catalog = await this.options.store.read(actor);
        const now = Date.now();
        const instances = await Promise.all(catalog.records.map(async (record) => {
            let status = record.installed ? 'unavailable' : 'incomplete';
            const cached = this.statusCache.get(record.id);
            if (record.installed && cached && now - cached.checkedAt < 5000)
                status = statusFromRuntime(cached.status);
            else if (record.installed) {
                const password = await this.options.store.resolveCredential(actor, record.credentialRef);
                if (password) {
                    try {
                        const current = await this.options.runtime.action(record, password, 'status');
                        this.statusCache.set(record.id, { status: current, checkedAt: Date.now() });
                        status = statusFromRuntime(current);
                    }
                    catch {
                        status = 'unavailable';
                    }
                }
            }
            if (catalog.operation?.state === 'running' && catalog.operation.instanceId === record.id) {
                status =
                    catalog.operation.kind === 'stop'
                        ? 'stopping'
                        : catalog.operation.kind === 'restart'
                            ? 'restarting'
                            : catalog.operation.kind === 'create'
                                ? 'starting'
                                : 'starting';
            }
            const base = `http://${record.host}:${record.input.port}`;
            return {
                id: record.id,
                name: record.input.name,
                status,
                serviceUrl: `${base}/chat`,
                adminUrl: `${base}/admin/`,
                apiUrl: `${base}/api/v1/instance`,
                activeVersionId: null,
                port: record.input.port,
                access: 'lan',
                shareUrls: [base],
                target: 'remote',
                host: record.host,
                sshPort: record.sshPort,
                username: record.username,
                packageVersion: record.deploymentVersion,
            };
        }));
        return { instances, operation: catalog.operation, deployments: catalog.history };
    }
    async setOperation(actor, operation) {
        await this.options.store.update(actor, (catalog) => ({ ...catalog, operation }));
    }
    async progress(actor, event) {
        this.progressWrites = this.progressWrites
            .catch(() => undefined)
            .then(() => this.options.store.update(actor, (catalog) => {
            if (!catalog.operation || catalog.operation.state !== 'running')
                return catalog;
            const progress = { ...event, at: Date.now() };
            return {
                ...catalog,
                operation: {
                    ...catalog.operation,
                    stage: event.message,
                    progress: [...(catalog.operation.progress ?? []), progress].slice(-64),
                },
            };
        }));
        await this.progressWrites;
    }
    async fail(actor, message, instanceId) {
        await this.options.store.update(actor, (catalog) => ({
            ...catalog,
            operation: catalog.operation
                ? {
                    ...catalog.operation,
                    instanceId,
                    state: 'failed',
                    stage: message,
                    error: message,
                }
                : null,
        }));
    }
    actor() {
        const actor = this.options.accountKey();
        if (!actor)
            throw new Error('authenticationRequired');
        return actor;
    }
}
function statusFromRuntime(status) {
    return status === 'running' ? 'ready' : status;
}
function actionLabel(action) {
    return {
        start: '正在启动实例',
        stop: '正在停止实例',
        restart: '正在重启实例',
        delete: '正在删除实例',
    }[action];
}
function appendHistory(history, item) {
    return [...history, item].slice(-50);
}
function publicMessage(error) {
    const code = error instanceof Error ? error.message : 'requestFailed';
    return WORKFLOW_REMOTE_ERROR_MESSAGES[code] ?? '固定主机操作未完成，请检查连接信息后重试。';
}
export const WORKFLOW_REMOTE_ERROR_MESSAGES = {
    ...AUTONOMOUS_REMOTE_ERROR_MESSAGES,
    authenticationRequired: '请登录后管理流程型智能体。',
    remoteHostUnsupported: '固定主机需要 Linux x86_64 系统。',
    runtimePackInvalid: '流程运行组件版本信息不完整，请重新安装工作台。',
    modelUnavailable: '所选模型无法从固定主机访问，请检查模型连接、API Key 和服务地址。',
    operationInProgress: '当前正在执行固定主机操作，请等待完成后重试。',
    instanceUnavailable: '未找到当前账号的固定主机实例记录。',
    credentialUnavailable: '固定主机登录凭据不可用，请重新发布实例。',
    operationCannotBeDismissed: '只有未关联实例的失败记录可以直接清除。',
};
function assertRemoteModel(model) {
    try {
        new URL(model.baseUrl);
    }
    catch {
        throw new Error('modelUnavailable');
    }
}
