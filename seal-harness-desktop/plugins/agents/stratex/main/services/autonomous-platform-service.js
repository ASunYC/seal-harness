import { createHash, randomUUID } from 'node:crypto';
import { TerminalPlatformRequestSchema } from '../../shared/protocol/terminal-platform.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { AutonomousPlatformClient, AutonomousPlatformError, platformErrorMessage, } from './autonomous-platform-client.js';
const TASK_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;
const MAX_TASK_POLL_FAILURES = 3;
export class AutonomousPlatformService {
    options;
    client;
    now;
    sleep;
    pollIntervalMs;
    instances = [];
    operation = null;
    busy = false;
    activeActor = null;
    activeOwnerId = null;
    generation = 0;
    refreshPromise = null;
    constructor(options) {
        this.options = options;
        this.client = options.client ?? new AutonomousPlatformClient(options);
        this.now = options.now ?? Date.now;
        this.sleep =
            options.sleep ??
                ((milliseconds) => sleep(milliseconds, undefined, { signal: options.signal }));
        this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    }
    async request(raw) {
        this.actor();
        const request = TerminalPlatformRequestSchema.parse(raw);
        if (request.action === 'platform-catalog') {
            await this.refreshInstances();
            return this.projection();
        }
        if (request.action === 'platform-snapshot')
            return this.projection();
        if (request.action === 'platform-dismiss-failure') {
            if (this.operation?.state !== 'failed' || this.operation.instanceId !== null) {
                throw new Error('platformOperationCannotBeDismissed');
            }
            this.operation = null;
            return this.projection();
        }
        if (request.action === 'platform-create') {
            this.begin('create', null, (generation) => this.create(request.input, generation));
            return this.projection();
        }
        const kind = request.action.replace('platform-', '');
        this.begin(kind, request.id, (generation) => this.lifecycle(request.id, kind, generation));
        return this.projection();
    }
    actor() {
        const actor = this.options.accountKey();
        const ownerId = this.options.ownerId();
        if (!actor || !ownerId)
            throw new Error('platformAuthenticationRequired');
        if (actor !== this.activeActor || ownerId !== this.activeOwnerId) {
            this.activeActor = actor;
            this.activeOwnerId = ownerId;
            this.generation += 1;
            this.instances = [];
            this.operation = null;
            this.busy = false;
            this.refreshPromise = null;
        }
        return actor;
    }
    projection() {
        return { instances: [...this.instances], operation: this.operation };
    }
    begin(kind, instanceId, work) {
        if (this.busy || this.operation?.state === 'running')
            throw new Error('platformOperationInProgress');
        const startedAt = this.now();
        this.busy = true;
        const generation = this.generation;
        this.operation = {
            id: randomUUID(),
            instanceId,
            kind,
            target: 'platform',
            state: 'running',
            stage: kind === 'create'
                ? '正在向智枢提交云端发布请求…'
                : `正在向智枢提交${actionLabel(kind)}请求…`,
            error: null,
            startedAt,
            progress: [
                { stage: 'request', state: 'succeeded', message: '操作请求已提交', at: startedAt },
                {
                    stage: kind === 'create' ? 'platform-submit' : 'platform-action',
                    state: 'running',
                    message: kind === 'create' ? '正在提交智枢发布任务' : `正在执行${actionLabel(kind)}操作`,
                    at: startedAt,
                },
            ],
        };
        void work(generation)
            .then(() => this.finishSuccess(kind, generation))
            .catch((error) => this.finishFailure(error, generation))
            .finally(() => {
            if (generation === this.generation)
                this.busy = false;
        });
    }
    async create(input, generation) {
        const accepted = await this.client.create(input);
        this.assertCurrent(generation);
        this.setInstanceId(accepted.instanceId, generation);
        this.completeStage('platform-submit', '智枢已受理发布任务', generation);
        await this.monitorTask(accepted.task, generation);
        const deployed = await this.client.instance(accepted.instanceId);
        this.assertCurrent(generation);
        this.upsert(deployed, generation);
    }
    async monitorTask(initial, generation) {
        const deadline = this.now() + TASK_TIMEOUT_MS;
        let task = initial;
        let failedPolls = 0;
        for (;;) {
            this.assertCurrent(generation);
            this.applyTaskProgress(task, generation);
            if (task.status === 'completed')
                return;
            if (task.status === 'failed') {
                throw new AutonomousPlatformError('platformRequestRejected', task.error ?? '智枢发布任务执行失败，请检查平台资源和部署服务后重试。');
            }
            if (this.now() >= deadline)
                throw new AutonomousPlatformError('platformTimeout');
            await this.sleep(this.pollIntervalMs);
            try {
                task = await this.client.task(task.id);
                failedPolls = 0;
            }
            catch (error) {
                if (!retryablePollError(error) || ++failedPolls > MAX_TASK_POLL_FAILURES)
                    throw error;
                this.updateProgress('platform-status-retry', `智枢任务状态暂时无法读取，正在自动重试（${failedPolls}/${MAX_TASK_POLL_FAILURES}）`, generation);
            }
        }
    }
    async lifecycle(id, action, generation) {
        if (this.options.mode === 'planner') {
            const existing = await this.client.instance(id);
            this.assertCurrent(generation);
            this.assertOwnedKind(existing);
        }
        const next = action === 'delete' ? await this.client.remove(id) : await this.client.action(id, action);
        this.assertCurrent(generation);
        if (action === 'delete' || next.status === 'removed') {
            this.instances = this.instances.filter((item) => item.id !== id);
            return;
        }
        this.upsert(next, generation);
    }
    async refreshInstances() {
        if (this.refreshPromise)
            return this.refreshPromise;
        const generation = this.generation;
        // 只在完整成功后替换目录；失败会向上返回以便界面提示，同时保留最后一次可信快照。
        const refresh = this.client
            .list()
            .then((values) => {
            this.assertCurrent(generation);
            this.instances = values
                .filter((item) => item.ownerId === this.activeOwnerId &&
                item.status !== 'removed' &&
                item.kind === this.instanceKind)
                .map(projectInstance);
        })
            .finally(() => {
            if (this.refreshPromise === refresh)
                this.refreshPromise = null;
        });
        this.refreshPromise = refresh;
        return refresh;
    }
    setInstanceId(instanceId, generation) {
        if (generation !== this.generation || !this.operation || this.operation.state !== 'running')
            return;
        this.operation = { ...this.operation, instanceId };
    }
    applyTaskProgress(task, generation) {
        if (generation !== this.generation || !this.operation || this.operation.state !== 'running')
            return;
        const stage = platformStage(task.stage);
        const message = `${task.stage}（${Math.round(task.percent)}%）`;
        const progress = completePriorPlatformStages(this.operation.progress ?? [], stage, this.now());
        this.operation = {
            ...this.operation,
            instanceId: task.instanceId ?? this.operation.instanceId,
            stage: message,
            progress: mergeProgress(progress, { stage, state: 'running', message, at: this.now() }),
        };
    }
    completeStage(stage, message, generation) {
        if (generation !== this.generation || !this.operation || this.operation.state !== 'running')
            return;
        this.operation = {
            ...this.operation,
            stage: message,
            progress: mergeProgress(this.operation.progress ?? [], {
                stage,
                state: 'succeeded',
                message,
                at: this.now(),
            }),
        };
    }
    updateProgress(stage, message, generation) {
        if (generation !== this.generation || !this.operation || this.operation.state !== 'running')
            return;
        this.operation = {
            ...this.operation,
            stage: message,
            progress: mergeProgress(this.operation.progress ?? [], {
                stage,
                state: 'running',
                message,
                at: this.now(),
            }),
        };
    }
    finishSuccess(kind, generation) {
        if (generation !== this.generation || !this.operation || this.operation.state !== 'running')
            return;
        const at = this.now();
        const progress = (this.operation.progress ?? []).map((event) => event.state === 'running' ? { ...event, state: 'succeeded', at } : event);
        const message = kind === 'create' ? '智枢发布完成' : `${actionLabel(kind)}完成`;
        this.operation = {
            ...this.operation,
            state: 'succeeded',
            stage: message,
            error: null,
            progress: mergeProgress(progress, {
                stage: 'complete',
                state: 'succeeded',
                message,
                at,
            }),
        };
    }
    finishFailure(error, generation) {
        if (generation !== this.generation || !this.operation || this.operation.state !== 'running')
            return;
        const message = failureMessage(error);
        const at = this.now();
        const progress = (this.operation.progress ?? []).map((event) => event.state === 'running' ? { ...event, state: 'failed', message, at } : event);
        this.operation = {
            ...this.operation,
            state: 'failed',
            stage: '智枢操作未完成',
            error: message,
            progress,
        };
    }
    upsert(value, generation) {
        if (generation !== this.generation)
            return;
        this.assertOwnedKind(value);
        const projected = projectInstance(value);
        this.instances = [...this.instances.filter((item) => item.id !== projected.id), projected];
    }
    get instanceKind() {
        return this.options.mode === 'planner' ? 'workflow' : 'reasoning';
    }
    assertOwnedKind(value) {
        if (value.ownerId !== this.activeOwnerId || value.kind !== this.instanceKind) {
            throw new AutonomousPlatformError('platformInvalidResponse');
        }
    }
    assertCurrent(generation) {
        if (generation !== this.generation)
            throw new Error('platformSessionChanged');
    }
}
function projectInstance(value) {
    const endpoint = value.endpoint;
    const rest = endpoint ? new URL(endpoint.restUrl) : null;
    const socket = endpoint?.wsUrl ? new URL(endpoint.wsUrl) : null;
    return {
        id: value.id,
        name: value.name,
        port: urlPort(rest),
        viewerPort: urlPort(socket) || urlPort(rest),
        status: projectStatus(value.status, endpoint !== null),
        configuration: value.status === 'running'
            ? 'active'
            : value.status === 'pending' || value.status === 'deploying'
                ? 'provisioning'
                : 'unknown',
        adminUrl: endpoint?.manageUrl ?? '',
        apiUrl: endpoint?.restUrl ?? '',
        packageVersion: '智枢托管',
        target: 'platform',
        host: rest?.hostname ?? null,
        sshPort: null,
        username: null,
    };
}
function projectStatus(status, hasEndpoint) {
    if (status === 'running' && !hasEndpoint)
        return 'unavailable';
    return {
        pending: 'starting',
        deploying: 'starting',
        running: 'running',
        stopped: 'stopped',
        failed: 'incomplete',
        removed: 'unavailable',
        unknown: 'unavailable',
    }[status];
}
function urlPort(url) {
    if (!url)
        return 0;
    if (url.port)
        return Number(url.port);
    return url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80;
}
function actionLabel(kind) {
    return {
        inspect: '检查',
        create: '发布',
        start: '启动',
        stop: '停止',
        restart: '重启',
        delete: '删除',
    }[kind];
}
function platformStage(value) {
    const normalized = value
        .trim()
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 45);
    const identity = normalized || createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
    return `platform-${identity}`;
}
function completePriorPlatformStages(progress, currentStage, at) {
    return progress.map((event) => event.stage.startsWith('platform-') && event.stage !== currentStage && event.state === 'running'
        ? { ...event, state: 'succeeded', at }
        : event);
}
function mergeProgress(progress, event) {
    return [...progress.filter((item) => item.stage !== event.stage), event].slice(-64);
}
function failureMessage(error) {
    if (error instanceof AutonomousPlatformError)
        return error.message;
    return platformErrorMessage('platformUnavailable');
}
function retryablePollError(error) {
    return (error instanceof AutonomousPlatformError &&
        ['platformTimeout', 'platformUnavailable', 'platformRateLimited'].includes(error.code));
}
