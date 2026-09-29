import { z } from 'zod';
import { BoundedJsonResponseError, discardResponseBody, readBoundedJsonResponse, } from './boundedJsonResponse.js';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 10 * 60_000;
const LIST_PAGE_SIZE = 100;
const MAX_LIST_PAGES = 100;
const httpUrl = z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));
const socketUrl = z.url().refine((value) => ['ws:', 'wss:'].includes(new URL(value).protocol));
const TerminalInstanceSchema = z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(['reasoning', 'workflow']).default('reasoning'),
    ownerId: z.string().trim().min(1).max(128),
    status: z.enum(['pending', 'deploying', 'running', 'stopped', 'failed', 'removed', 'unknown']),
    endpoint: z
        .object({ restUrl: httpUrl, wsUrl: socketUrl.nullable(), manageUrl: httpUrl })
        .nullable(),
    lastError: z.string().max(512).nullable(),
    updatedAt: z.string(),
});
const TerminalTaskSchema = z.object({
    id: z.uuid(),
    instanceId: z.uuid().nullable(),
    status: z.enum(['pending', 'running', 'completed', 'failed']),
    stage: z.string().trim().min(1).max(256),
    percent: z.number().min(0).max(100),
    error: z.string().max(512).nullable(),
    updatedAt: z.string(),
});
const ListResponseSchema = z.object({
    instances: z.array(TerminalInstanceSchema).max(100),
    total: z.number().int().nonnegative(),
});
const InstanceResponseSchema = z.object({ instance: TerminalInstanceSchema });
const TaskResponseSchema = z.object({ task: TerminalTaskSchema });
const CreateResponseSchema = TaskResponseSchema.extend({
    instanceId: z.uuid(),
    taskUrl: z.string().startsWith('/api/v1/terminal-instances/tasks/'),
    instanceUrl: z.string().startsWith('/api/v1/terminal-instances/'),
});
const PlatformErrorResponseSchema = z.object({
    code: z.string().regex(/^TERMINAL_[A-Z0-9_]{1,80}$/u),
    error: z.string().trim().min(1).max(512).optional(),
    message: z.string().trim().min(1).max(512).optional(),
});
export class AutonomousPlatformError extends Error {
    code;
    constructor(code, message = platformErrorMessage(code)) {
        super(message);
        this.code = code;
        this.name = 'AutonomousPlatformError';
    }
}
export class AutonomousPlatformClient {
    options;
    fetchImpl;
    timeoutMs;
    constructor(options) {
        this.options = options;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }
    async list() {
        const instances = [];
        const seen = new Set();
        let offset = 0;
        let expectedTotal = null;
        for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
            const payload = await this.request(`api/v1/terminal-instances?offset=${offset}&limit=${LIST_PAGE_SIZE}`, { method: 'GET' });
            const response = parseResponse(ListResponseSchema, payload);
            if (expectedTotal !== null && response.total !== expectedTotal) {
                throw new AutonomousPlatformError('platformInvalidResponse');
            }
            expectedTotal = response.total;
            for (const instance of response.instances) {
                if (seen.has(instance.id))
                    throw new AutonomousPlatformError('platformInvalidResponse');
                seen.add(instance.id);
                instances.push(instance);
            }
            if (instances.length >= response.total)
                return instances;
            if (response.instances.length === 0) {
                throw new AutonomousPlatformError('platformInvalidResponse');
            }
            offset += response.instances.length;
        }
        throw new AutonomousPlatformError('platformInvalidResponse');
    }
    async probe(baseUrl) {
        const payload = await this.request('api/v1/terminal-instances?offset=0&limit=1', { method: 'GET' }, baseUrl);
        parseResponse(ListResponseSchema, payload);
    }
    async create(input) {
        const payload = await this.request('api/v1/terminal-instances', {
            method: 'POST',
            body: {
                mode: this.options.mode ?? 'react',
                name: input.name,
                // 平台 planner 严格契约当前不接受 react 专用幂等字段。
                ...(this.options.mode === 'planner' ? {} : { idempotencyKey: input.requestId }),
            },
        });
        return parseResponse(CreateResponseSchema, payload);
    }
    async task(id) {
        const payload = await this.request(`api/v1/terminal-instances/tasks/${encodeURIComponent(id)}`, { method: 'GET' });
        return parseResponse(TaskResponseSchema, payload).task;
    }
    async instance(id) {
        const payload = await this.request(`api/v1/terminal-instances/${encodeURIComponent(id)}`, {
            method: 'GET',
        });
        return parseResponse(InstanceResponseSchema, payload).instance;
    }
    async action(id, action) {
        const payload = await this.request(`api/v1/terminal-instances/${encodeURIComponent(id)}/actions`, { method: 'POST', body: { action }, timeoutMs: ACTION_TIMEOUT_MS });
        return parseResponse(InstanceResponseSchema, payload).instance;
    }
    async remove(id) {
        const payload = await this.request(`api/v1/terminal-instances/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            timeoutMs: ACTION_TIMEOUT_MS,
        });
        return parseResponse(InstanceResponseSchema, payload).instance;
    }
    async request(path, init, baseUrlOverride) {
        const baseUrl = await this.resolveBaseUrl(baseUrlOverride);
        const token = await this.readToken(false);
        const first = await this.send(baseUrl, path, init, token);
        if (![401, 403].includes(first.status))
            return this.accept(first);
        await discardResponseBody(first);
        const refreshed = await this.readToken(true);
        const retry = await this.send(baseUrl, path, init, refreshed);
        return this.accept(retry);
    }
    async resolveBaseUrl(override) {
        let value;
        try {
            value =
                override ??
                    (typeof this.options.baseUrl === 'function'
                        ? await this.options.baseUrl()
                        : this.options.baseUrl);
        }
        catch {
            value = null;
        }
        const parsed = parseBaseUrl(value);
        if (!parsed)
            throw new AutonomousPlatformError('platformNotConfigured');
        return parsed;
    }
    async readToken(refresh) {
        let token;
        try {
            token = refresh
                ? await (this.options.refreshAccessToken?.() ?? Promise.resolve(null))
                : await this.options.accessToken();
        }
        catch {
            token = null;
        }
        if (!token?.trim())
            throw new AutonomousPlatformError('platformAuthenticationRequired');
        return token;
    }
    async send(baseUrl, path, init, token) {
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, init.timeoutMs ?? this.timeoutMs);
        try {
            return await this.fetchImpl(new URL(path, baseUrl), {
                method: init.method,
                headers: {
                    accept: 'application/json',
                    authorization: `Bearer ${token}`,
                    ...(init.body ? { 'content-type': 'application/json' } : {}),
                },
                ...(init.body ? { body: JSON.stringify(init.body) } : {}),
                signal: this.options.signal ? AbortSignal.any([controller.signal, this.options.signal]) : controller.signal,
            });
        }
        catch (error) {
            if (timedOut || isAbortError(error))
                throw new AutonomousPlatformError('platformTimeout');
            throw new AutonomousPlatformError('platformUnavailable');
        }
        finally {
            clearTimeout(timer);
        }
    }
    async accept(response) {
        try {
            if (!response.ok) {
                const code = codeForStatus(response.status);
                const payload = await readBoundedJsonResponse(response, MAX_RESPONSE_BYTES).catch(() => null);
                throw new AutonomousPlatformError(code, upstreamErrorMessage(payload, code));
            }
            return await readBoundedJsonResponse(response, MAX_RESPONSE_BYTES);
        }
        catch (error) {
            if (error instanceof AutonomousPlatformError)
                throw error;
            if (error instanceof BoundedJsonResponseError || error instanceof z.ZodError) {
                throw new AutonomousPlatformError('platformInvalidResponse');
            }
            throw new AutonomousPlatformError('platformInvalidResponse');
        }
        finally {
            await discardResponseBody(response);
        }
    }
}
export function platformErrorMessage(code) {
    return {
        platformNotConfigured: '当前版本未配置智枢服务地址。',
        platformAuthenticationRequired: '智枢登录状态已失效，请重新登录后再试。',
        platformInvalidInput: '发布信息不符合智枢要求，请检查后重试。',
        platformConflict: '智枢中已有任务正在处理，请稍后刷新状态。',
        platformRateLimited: '智枢请求过于频繁，请稍后重试。',
        platformUnavailable: '智枢暂时无法完成云端发布，请稍后重试。',
        platformTimeout: '智枢响应超时，任务可能仍在处理中，请刷新状态。',
        platformInvalidResponse: '智枢返回了无法识别的数据，请稍后重试。',
        platformRequestRejected: '智枢拒绝了本次操作，请检查实例状态后重试。',
    }[code];
}
function codeForStatus(status) {
    if (status === 400)
        return 'platformInvalidInput';
    if (status === 401 || status === 403)
        return 'platformAuthenticationRequired';
    if (status === 409)
        return 'platformConflict';
    if (status === 429)
        return 'platformRateLimited';
    if (status >= 500)
        return 'platformUnavailable';
    return 'platformRequestRejected';
}
function upstreamErrorMessage(payload, fallback) {
    const parsed = PlatformErrorResponseSchema.safeParse(payload);
    if (!parsed.success)
        return platformErrorMessage(fallback);
    const detail = parsed.data.error ?? parsed.data.message;
    return detail ? `${detail}（错误代码：${parsed.data.code}）` : platformErrorMessage(fallback);
}
function parseBaseUrl(value) {
    if (!value?.trim())
        return null;
    try {
        const parsed = new URL(value.endsWith('/') ? value : `${value}/`);
        if (!['http:', 'https:'].includes(parsed.protocol))
            return null;
        if (parsed.username || parsed.password || parsed.search || parsed.hash)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function isAbortError(error) {
    return error instanceof Error && error.name === 'AbortError';
}
function parseResponse(schema, payload) {
    const parsed = schema.safeParse(payload);
    if (!parsed.success)
        throw new AutonomousPlatformError('platformInvalidResponse');
    return parsed.data;
}
