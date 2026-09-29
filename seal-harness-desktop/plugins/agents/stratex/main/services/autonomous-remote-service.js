import { randomBytes, randomUUID } from 'node:crypto';
import { AutonomousRemoteRequestSchema } from '../../shared/protocol/autonomous-instances.js';
import { autonomousRemoteFailureMessage } from './autonomous-remote-errors.js';
export class AutonomousRemoteService {
    options;
    busy = false;
    activeCompletion = null;
    progressWrites = Promise.resolve();
    statusCache = new Map();
    statusRefreshes = new Map();
    constructor(options) {
        this.options = options;
    }
    async request(raw) {
        const actor = this.actor();
        const parsed = AutonomousRemoteRequestSchema.parse(raw);
        const request = parsed;
        if (request.action === 'remote-snapshot' || request.action === 'remote-catalog')
            return this.snapshot(actor);
        if (request.action === 'remote-connect') {
            await this.options.runtime.check(request.input);
            return this.snapshot(actor);
        }
        if (request.action === 'remote-dismiss-failure') {
            await this.options.store.update(actor, (catalog) => {
                const operation = catalog.operation;
                if (!operation || operation.state !== 'failed' || operation.instanceId !== null)
                    throw new Error('operationCannotBeDismissed');
                return { ...catalog, operation: null };
            });
            return this.snapshot(actor);
        }
        if (request.action === 'remote-create') {
            await this.begin(actor, null, 'create', () => this.create(actor, request.input));
            return this.snapshot(actor);
        }
        const catalog = await this.options.store.read(actor);
        const record = catalog.records.find((item) => item.id === request.id);
        if (!record)
            throw new Error('instanceUnavailable');
        if (request.action === 'remote-rename') {
            if (this.busy || catalog.operation?.state === 'running')
                throw new Error('operationInProgress');
            await this.options.store.update(actor, (current) => ({
                ...current,
                records: current.records.map((item) => item.id === record.id
                    ? {
                        ...item,
                        input: { ...item.input, name: request.name },
                        updatedAt: Date.now(),
                    }
                    : item),
            }));
            return this.snapshot(actor);
        }
        if (request.action === 'remote-open-manage') {
            const password = request.password ??
                (await this.options.store.resolveCredential(actor, record.credentialRef));
            if (!password)
                throw new Error('credentialUnavailable');
            if ((await this.options.runtime.action(record, password, 'status')) !== 'running') {
                throw new Error('instanceUnavailable');
            }
            this.statusCache.set(this.statusKey(actor, record.id), {
                status: 'running',
                checkedAt: Date.now(),
            });
            return this.snapshot(actor);
        }
        const action = request.action.replace('remote-', '');
        const operationKind = action === 'start' && !record.installed ? 'create' : action;
        this.statusCache.delete(this.statusKey(actor, record.id));
        await this.begin(actor, record.id, operationKind, async () => {
            const password = request.password ??
                (await this.options.store.resolveCredential(actor, record.credentialRef));
            if (!password)
                throw new Error('credentialUnavailable');
            if (action === 'start' && !record.installed) {
                const resolved = record.input.model
                    ? await this.options.resolveModel(record.input.model)
                    : undefined;
                const remoteInput = {
                    ...record.input,
                    host: record.host,
                    sshPort: record.sshPort,
                    username: record.username,
                    password,
                };
                const deployed = await this.withProgress(actor, (onEvent) => this.options.runtime.deploy(remoteInput, record.id, resolved
                    ? {
                        model: resolved.model,
                        baseUrl: resolved.baseUrl,
                        ...(resolved.protocol ? { protocol: resolved.protocol } : {}),
                        ...(resolved.apiKey ? { apiKey: resolved.apiKey } : {}),
                    }
                    : undefined, onEvent, 'recover'));
                const latest = await this.options.store.read(actor);
                await this.options.store.write(actor, {
                    ...latest,
                    records: latest.records.map((item) => item.id === record.id
                        ? {
                            ...item,
                            installed: true,
                            deploymentVersion: deployed.version,
                            images: deployed.images,
                            updatedAt: Date.now(),
                        }
                        : item),
                });
            }
            else {
                await this.withProgress(actor, (onEvent) => this.options.runtime.action(record, password, action === 'delete' ? 'remove' : action, onEvent));
            }
            if (action === 'delete') {
                await this.options.store.update(actor, (latest) => ({
                    ...latest,
                    records: latest.records.filter((item) => item.id !== record.id),
                    credentials: Object.fromEntries(Object.entries(latest.credentials).filter(([key]) => key !== record.credentialRef)),
                }));
            }
        }, record);
        return this.snapshot(actor);
    }
    async create(actor, input) {
        const existing = (await this.options.store.read(actor)).records.find((item) => item.input.requestId === input.requestId);
        if (existing) {
            await this.options.store.update(actor, (catalog) => ({
                ...catalog,
                operation: catalog.operation
                    ? { ...catalog.operation, instanceId: existing.id }
                    : catalog.operation,
            }));
            if (existing.installed)
                return;
        }
        const model = input.model ? await this.options.resolveModel(input.model) : undefined;
        if (model)
            new URL(model.baseUrl);
        const id = existing?.id ?? `auto-${randomBytes(12).toString('hex')}`;
        const credentialRef = await this.options.store.saveCredential(actor, input.password, existing?.credentialRef);
        const publicInput = {
            requestId: input.requestId,
            name: input.name,
            port: input.port,
            viewerPort: input.viewerPort,
            model: input.model,
        };
        const now = Date.now();
        const record = existing
            ? {
                ...existing,
                input: publicInput,
                host: input.host,
                sshPort: input.sshPort,
                username: input.username,
                credentialRef,
                updatedAt: now,
            }
            : {
                schemaVersion: 1,
                id,
                input: publicInput,
                host: input.host,
                sshPort: input.sshPort,
                username: input.username,
                credentialRef,
                remoteDirectory: `/opt/stratex/autonomous/${id}`,
                deploymentVersion: 'pending',
                images: [],
                installed: false,
                createdAt: now,
                updatedAt: now,
            };
        const catalog = await this.options.store.read(actor);
        await this.options.store.write(actor, {
            ...catalog,
            records: existing
                ? catalog.records.map((item) => (item.id === id ? record : item))
                : [...catalog.records, record],
            operation: catalog.operation ? { ...catalog.operation, instanceId: id } : null,
        });
        const deployed = await this.withProgress(actor, (onEvent) => this.options.runtime.deploy(input, id, model
            ? {
                model: model.model,
                baseUrl: model.baseUrl,
                ...(model.protocol ? { protocol: model.protocol } : {}),
                ...(model.apiKey ? { apiKey: model.apiKey } : {}),
            }
            : undefined, onEvent));
        const latest = await this.options.store.read(actor);
        await this.options.store.write(actor, {
            ...latest,
            records: latest.records.map((item) => item.id === id
                ? {
                    ...item,
                    deploymentVersion: deployed.version,
                    images: deployed.images,
                    installed: true,
                    updatedAt: Date.now(),
                }
                : item),
        });
    }
    async begin(actor, instanceId, kind, work, historyRecord) {
        if (this.busy)
            throw new Error('operationInProgress');
        this.busy = true;
        const operationId = randomUUID();
        try {
            const catalog = await this.options.store.read(actor);
            const startedAt = Date.now();
            await this.options.store.write(actor, {
                ...catalog,
                operation: {
                    id: operationId,
                    instanceId,
                    state: 'running',
                    stage: kind === 'create' ? '正在连接固定主机…' : '正在处理实例…',
                    error: null,
                    kind,
                    target: 'remote',
                    startedAt,
                    progress: [
                        {
                            stage: 'request',
                            state: 'succeeded',
                            message: '操作请求已提交',
                            at: startedAt,
                        },
                        {
                            stage: 'prepare',
                            state: 'running',
                            message: kind === 'create' ? '正在准备远程发布文件' : '正在准备远程操作',
                            at: startedAt,
                        },
                    ],
                },
            });
        }
        catch (error) {
            this.busy = false;
            throw error;
        }
        const completion = work()
            .then(async () => {
            await this.options.store.update(actor, (current) => {
                if (!current.operation)
                    return current;
                const record = current.records.find((item) => item.id === current.operation?.instanceId) ??
                    historyRecord;
                return {
                    ...current,
                    operation: {
                        ...current.operation,
                        state: 'succeeded',
                        stage: {
                            create: '固定主机发布完成',
                            start: '实例已启动',
                            stop: '实例已停止',
                            restart: '实例已重启',
                            delete: '实例已删除',
                        }[kind],
                        error: null,
                        progress: mergeProgress(current.operation.progress, {
                            stage: 'complete',
                            state: 'succeeded',
                            message: {
                                create: '固定主机发布完成',
                                start: '实例已启动',
                                stop: '实例已停止',
                                restart: '实例已重启',
                                delete: '实例和数据已永久删除',
                            }[kind],
                            at: Date.now(),
                        }),
                    },
                    history: appendHistory(current.history, current.operation, record, kind, 'succeeded'),
                };
            });
            const latest = await this.options.store.read(actor);
            const completedId = latest.operation?.instanceId;
            if (completedId) {
                const key = this.statusKey(actor, completedId);
                if (kind === 'delete')
                    this.statusCache.delete(key);
                else
                    this.statusCache.set(key, {
                        status: kind === 'stop' ? 'stopped' : 'running',
                        checkedAt: Date.now(),
                    });
            }
        })
            .catch((error) => this.options.store.update(actor, (current) => {
            if (!current.operation)
                return current;
            const record = current.records.find((item) => item.id === current.operation?.instanceId) ??
                historyRecord;
            const failure = current.operation.error ??
                autonomousRemoteFailureMessage(error) ??
                '固定主机操作未完成，请检查连接和服务器环境后重试。';
            return {
                ...current,
                operation: {
                    ...current.operation,
                    state: 'failed',
                    stage: current.operation.error ? current.operation.stage : '操作未完成',
                    error: failure,
                    progress: failProgress(current.operation.progress, failure),
                },
                history: appendHistory(current.history, current.operation, record, kind, 'failed'),
            };
        }))
            .finally(() => {
            if (this.activeCompletion?.operationId === operationId) {
                this.activeCompletion = null;
                this.busy = false;
            }
        });
        this.activeCompletion = { actor, operationId, promise: completion };
    }
    async progress(actor, event) {
        await this.options.store.update(actor, (current) => current.operation?.state === 'running'
            ? {
                ...current,
                operation: {
                    ...current.operation,
                    stage: event.message,
                    error: event.state === 'failed' ? event.message : current.operation.error,
                    progress: mergeProgress(current.operation.progress, {
                        ...event,
                        at: Date.now(),
                    }),
                },
            }
            : current);
    }
    async withProgress(actor, work) {
        this.progressWrites = Promise.resolve();
        try {
            return await work((event) => {
                this.progressWrites = this.progressWrites
                    .catch(() => undefined)
                    .then(() => this.progress(actor, event));
            });
        }
        finally {
            await this.progressWrites;
        }
    }
    async snapshot(actor) {
        let catalog = await this.options.store.read(actor);
        // Terminal persistence precedes cache cleanup and lock release in the completion chain.
        while (catalog.operation &&
            catalog.operation.state !== 'running' &&
            this.activeCompletion?.actor === actor &&
            this.activeCompletion.operationId === catalog.operation.id) {
            await this.activeCompletion.promise;
            catalog = await this.options.store.read(actor);
        }
        if (!this.busy && catalog.operation?.state === 'running') {
            await this.options.store.update(actor, (current) => {
                if (current.operation?.state !== 'running')
                    return current;
                const record = current.records.find((item) => item.id === current.operation?.instanceId);
                const completedOnHost = current.operation.kind === 'create' &&
                    record?.installed === true &&
                    current.operation.progress?.some((event) => event.stage === 'complete' && event.state === 'succeeded');
                if (completedOnHost) {
                    return {
                        ...current,
                        operation: {
                            ...current.operation,
                            state: 'succeeded',
                            stage: '固定主机发布完成',
                            error: null,
                        },
                        history: appendHistory(current.history, current.operation, record, 'create', 'succeeded'),
                    };
                }
                return {
                    ...current,
                    operation: {
                        ...current.operation,
                        state: 'failed',
                        stage: '上次操作已中断',
                        error: '上次操作已中断，配置和数据已保留，可以安全重试。',
                        progress: failProgress(current.operation.progress, '上次操作已中断，配置和数据已保留，可以安全重试。'),
                    },
                    history: appendHistory(current.history, current.operation, record, current.operation.kind === 'inspect' ? 'create' : (current.operation.kind ?? 'create'), 'failed'),
                };
            });
            catalog = await this.options.store.read(actor);
        }
        const instances = [];
        for (const record of catalog.records) {
            const runningForRecord = catalog.operation?.state === 'running' && catalog.operation.instanceId === record.id;
            let status = runningForRecord
                ? catalog.operation?.kind === 'stop'
                    ? 'stopping'
                    : catalog.operation?.kind === 'restart'
                        ? 'restarting'
                        : 'starting'
                : record.installed
                    ? 'unavailable'
                    : 'incomplete';
            if (!runningForRecord && record.installed) {
                const cached = this.statusCache.get(this.statusKey(actor, record.id));
                const stoppedByOperation = catalog.operation?.state === 'succeeded' &&
                    catalog.operation.instanceId === record.id &&
                    catalog.operation.kind === 'stop';
                const runningByOperation = catalog.operation?.state === 'succeeded' &&
                    catalog.operation.instanceId === record.id &&
                    ['create', 'start', 'restart'].includes(catalog.operation.kind ?? '');
                status =
                    cached?.status ??
                        (stoppedByOperation ? 'stopped' : runningByOperation ? 'running' : 'checking');
                if (!cached && (stoppedByOperation || runningByOperation))
                    this.statusCache.set(this.statusKey(actor, record.id), {
                        status: stoppedByOperation ? 'stopped' : 'running',
                        checkedAt: 0,
                    });
                else
                    this.refreshStatus(actor, record);
            }
            instances.push({
                id: record.id,
                name: record.input.name,
                port: record.input.port,
                viewerPort: record.input.viewerPort,
                status,
                configuration: 'unknown',
                adminUrl: `http://${record.host}:${record.input.port}/manage`,
                apiUrl: `http://${record.host}:${record.input.port}/api/chat/stream`,
                packageVersion: record.deploymentVersion,
                target: 'remote',
                host: record.host,
                sshPort: record.sshPort,
                username: record.username,
            });
        }
        return { instances, operation: catalog.operation, deployments: catalog.history };
    }
    statusKey(actor, id) {
        return `${actor}:${id}`;
    }
    refreshStatus(actor, record) {
        const key = this.statusKey(actor, record.id);
        const cached = this.statusCache.get(key);
        if (cached && Date.now() - cached.checkedAt < 30_000)
            return;
        if (this.statusRefreshes.has(key))
            return;
        const refresh = (async () => {
            let status = 'unavailable';
            try {
                const password = await this.options.store.resolveCredential(actor, record.credentialRef);
                if (password)
                    status = await this.options.runtime.action(record, password, 'status');
            }
            catch {
                status = 'unavailable';
            }
            this.statusCache.set(key, { status, checkedAt: Date.now() });
        })().finally(() => {
            this.statusRefreshes.delete(key);
        });
        this.statusRefreshes.set(key, refresh);
    }
    actor() {
        const actor = this.options.accountKey();
        if (!actor)
            throw new Error('authenticationRequired');
        return actor;
    }
}
function mergeProgress(current, next) {
    const settled = (current ?? []).map((item) => item.state === 'running' &&
        item.stage !== next.stage &&
        next.state !== 'failed' &&
        !(item.stage === 'images' && next.stage.startsWith('image-'))
        ? {
            ...item,
            state: 'succeeded',
            message: item.message.replace(/^正在/u, '已'),
        }
        : item);
    const index = settled.findIndex((item) => item.stage === next.stage);
    if (index < 0)
        return [...settled, next].slice(-64);
    return settled.map((item, itemIndex) => (itemIndex === index ? next : item));
}
function failProgress(current, message) {
    const at = Date.now();
    const events = current ?? [];
    if (events.some((item) => item.state === 'running'))
        return events.map((item) => item.state === 'running' ? { ...item, state: 'failed', message, at } : item);
    return [...events, { stage: 'failed', state: 'failed', message, at }].slice(-64);
}
function appendHistory(history, operation, record, action, state) {
    if (!record)
        return [...history];
    return [
        {
            id: operation.id,
            instanceId: record.id,
            instanceName: record.input.name,
            host: record.host,
            action,
            state,
            startedAt: operation.startedAt ?? Date.now(),
            finishedAt: Date.now(),
            imageCount: record.images.length,
            servicePort: record.input.port,
            mapPort: record.input.viewerPort,
            imageDigests: record.images.map((image) => image.digest),
        },
        ...history.filter((item) => item.id !== operation.id),
    ].slice(0, 50);
}
