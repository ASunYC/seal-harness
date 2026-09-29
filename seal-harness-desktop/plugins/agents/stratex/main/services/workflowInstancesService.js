import { z } from 'zod';
import { networkInterfaces } from 'node:os';
import { createServer } from 'node:net';
import { WorkflowInstanceSchema, WorkflowLocalRequestSchema, } from '../../shared/protocol/workflow-instances.js';
import { WorkflowCliError } from './workflowCli.js';
const errors = {
    authenticationRequired: '请登录后使用本机流程。',
    artifactUnavailable: '本机运行组件缺失或校验失败，请修复应用安装。',
    timeout: '本机操作超时，请刷新状态后重试。',
    invalidResponse: '本机运行组件返回的数据不兼容。',
    requestFailed: '本机操作未完成，请检查运行环境后重试。',
    modelUnavailable: '所选模型不可用，请检查模型配置和本机使用授权。',
    runtimeUnavailable: '本机容器服务未启动或受控运行资源未安装。',
    networkPoolExhausted: 'Docker 网络地址池已用尽，无法创建实例。请清理不再使用的 Docker 网络后重试；已有实例不受影响。',
    runtimeNotCreated: '请先创建本机流程运行环境。',
    portUnavailable: '本机端口已被占用，请选择其他端口。',
    configurationConflict: '端口已分配给另一个智能体，请选择其他端口。',
    operationInProgress: '本机运行环境正在执行操作，请稍候。',
};
export async function probePort(port) {
    // Docker Desktop may reserve a published port through an IPv6 wildcard listener while
    // Windows still permits an IPv4 listener on the same number. Probe loopback, wildcard and
    // concrete addresses for both families so the conflict is reported before compose starts.
    const hosts = new Set(['127.0.0.1', '0.0.0.0', '::1', '::']);
    for (const items of Object.values(networkInterfaces())) {
        for (const item of items ?? []) {
            if (!item.internal && (item.family === 'IPv4' || item.family === 'IPv6')) {
                hosts.add(item.address);
            }
        }
    }
    for (const host of hosts) {
        const state = await new Promise((resolve) => {
            const server = createServer();
            const finish = (value) => {
                server.removeAllListeners();
                if (server.listening)
                    server.close(() => resolve(value));
                else
                    resolve(value);
            };
            server.once('error', (error) => {
                finish(error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT'
                    ? 'unsupported'
                    : 'occupied');
            });
            server.listen({ host, port }, () => finish('available'));
        });
        if (state === 'occupied')
            return false;
    }
    return true;
}
function errorMessage(code) {
    return errors[code] ?? '本机操作未完成。';
}
/** 工作台仅管理本机生命周期；执行与版本存储由独立运行环境负责。 */
export class WorkflowInstancesService {
    options;
    listeners = new Set();
    busy = false;
    constructor(options) {
        this.options = options;
    }
    observe(_id, listener) {
        const actor = this.options.accountKey();
        if (!actor)
            return () => { };
        const entry = { actor, listener };
        this.listeners.add(entry);
        return () => {
            this.listeners.delete(entry);
        };
    }
    async execute(input, actor) {
        const assertActive = () => {
            if (this.options.accountKey() !== actor)
                throw new WorkflowCliError('authenticationRequired');
        };
        const call = async (action, body = {}) => {
            assertActive();
            const value = await this.options.cli.execute([action], body);
            assertActive();
            return value;
        };
        if (input.action === 'options') {
            const availability = z
                .object({
                available: z.boolean(),
                packAvailable: z.boolean().optional(),
                dockerInstalled: z.boolean().optional(),
                runtimeReason: z
                    .enum(['runtimeUnavailable', 'networkPoolExhausted', 'portUnavailable'])
                    .optional(),
            })
                .parse(await call('doctor'));
            return { ...availability, models: [] };
        }
        if (input.action === 'models') {
            const models = await this.options.models();
            assertActive();
            return { models };
        }
        if (input.action === 'resource-options') {
            if (!this.options.resources)
                throw new WorkflowCliError('runtimeUnavailable');
            const value = await this.options.resources.list();
            assertActive();
            return value;
        }
        if (input.action === 'prepare')
            return call('prepare');
        if (input.action === 'observe' || input.action === 'unobserve')
            throw new WorkflowCliError('requestFailed');
        const records = await this.options.storage.list(actor);
        if (input.action === 'check-port') {
            const occupiedByInstance = records.some((item) => item.input.port === input.port);
            const available = !occupiedByInstance && (await (this.options.isPortAvailable ?? probePort)(input.port));
            assertActive();
            return { available };
        }
        const localAddresses = Object.entries(networkInterfaces())
            .sort(([a], [b]) => Number(/vEthernet|WSL|Docker|Virtual|VMware/iu.test(a)) -
            Number(/vEthernet|WSL|Docker|Virtual|VMware/iu.test(b)))
            .flatMap(([, items]) => items ?? [])
            .filter((item) => item.family === 'IPv4' &&
            !item.internal &&
            /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(item.address))
            .map((item) => item.address);
        const publish = (port) => [...new Set(localAddresses)].map((address) => `http://${address}:${port}`);
        const describe = async (item) => {
            const instance = WorkflowInstanceSchema.parse(await call('status', {
                id: item.id,
                name: item.input.name,
                port: item.input.port,
                runtimeKind: item.runtimeKind,
            }));
            return {
                ...instance,
                port: item.input.port,
                access: item.input.access,
                shareUrls: item.input.access === 'lan' ? publish(item.input.port) : [],
            };
        };
        if (input.action === 'list') {
            const instances = await Promise.all(records.map(async (item) => {
                try {
                    return await describe(item);
                }
                catch (error) {
                    return {
                        id: item.id,
                        name: item.input.name,
                        port: item.input.port,
                        access: item.input.access,
                        status: 'unavailable',
                        statusReason: error instanceof WorkflowCliError
                            ? errorMessage(error.code)
                            : '无法读取本机流程服务状态，请检查 Docker Desktop 和运行环境。',
                        shareUrls: [],
                    };
                }
            }));
            assertActive();
            return { instances };
        }
        let record = 'id' in input ? records.find((item) => item.id === input.id) : records[0];
        assertActive();
        if (input.action === 'create' || input.action === 'preflight') {
            record = records.find((item) => item.input.requestId === input.input.requestId);
            if (records.some((item) => item.id !== record?.id && item.input.port === input.input.port))
                throw new WorkflowCliError('configurationConflict');
            if (!record && !(await (this.options.isPortAvailable ?? probePort)(input.input.port)))
                throw new WorkflowCliError('portUnavailable');
            const model = await this.options.resolveModel(input.input.model);
            assertActive();
            await call('preflight', { port: input.input.port, ...(record ? { id: record.id } : {}) });
            if (input.action === 'preflight')
                return { ready: true };
            record = await this.options.storage.save(actor, input.input);
            const instance = WorkflowInstanceSchema.parse(await call('start', { ...record, model, lanOrigins: publish(record.input.port) }));
            return {
                ...instance,
                port: record.input.port,
                access: record.input.access,
                shareUrls: record.input.access === 'lan' ? publish(record.input.port) : [],
            };
        }
        if (!record) {
            if (input.action === 'status')
                return { instance: null };
            throw new WorkflowCliError('runtimeNotCreated');
        }
        if ('id' in input && input.id !== record.id)
            throw new WorkflowCliError('runtimeNotCreated');
        if (input.action === 'delete') {
            await call('delete', { id: record.id });
            assertActive();
            await this.options.storage.remove(actor, record.id);
            return { deleted: true };
        }
        if (input.action === 'install-resources') {
            if (!this.options.resources)
                throw new WorkflowCliError('runtimeUnavailable');
            const bundle = await this.options.resources.export(input.resources);
            assertActive();
            return call('install-resources', {
                id: record.id,
                name: record.input.name,
                port: record.input.port,
                bundle,
            });
        }
        if (input.action === 'start' || input.action === 'restart') {
            const model = await this.options.resolveModel(record.input.model);
            assertActive();
            const instance = WorkflowInstanceSchema.parse(await call(input.action, { ...record, model, lanOrigins: publish(record.input.port) }));
            return {
                ...instance,
                port: record.input.port,
                access: record.input.access,
                shareUrls: record.input.access === 'lan' ? publish(record.input.port) : [],
            };
        }
        const instance = WorkflowInstanceSchema.parse(await call(input.action === 'stop' ? 'stop' : 'status', {
            id: record.id,
            name: record.input.name,
            port: record.input.port,
            runtimeKind: record.runtimeKind,
        }));
        if (input.action === 'open') {
            if (instance.status !== 'ready')
                throw new WorkflowCliError('runtimeUnavailable');
            const path = input.target === 'admin'
                ? '/admin/'
                : input.target === 'chat'
                    ? '/chat'
                    : '/api/v1/instance';
            // 打开地址由已加密的本机端口构造，绝不信任子进程提供的任意 URL。
            await this.options.openExternal(`http://127.0.0.1:${record.input.port}${path}`);
            return { opened: true };
        }
        return input.action === 'status' ? { instance } : instance;
    }
    async request(raw) {
        const parsed = WorkflowLocalRequestSchema.safeParse(raw);
        if (!parsed.success)
            return {
                ok: false,
                error: { code: 'requestFailed', message: errorMessage('requestFailed') },
            };
        const input = parsed.data;
        const mutation = ![
            'status',
            'list',
            'options',
            'models',
            'resource-options',
            'check-port',
            'open',
        ].includes(input.action);
        if (mutation && this.busy)
            return {
                ok: false,
                error: { code: 'operationInProgress', message: errors.operationInProgress ?? '' },
            };
        if (mutation)
            this.busy = true;
        try {
            const actor = this.options.accountKey();
            if (!actor)
                throw new WorkflowCliError('authenticationRequired');
            const value = await this.execute(input, actor);
            const parsed = WorkflowInstanceSchema.safeParse(value);
            if (parsed.success)
                for (const entry of this.listeners) {
                    if (entry.actor === actor && this.options.accountKey() === actor)
                        entry.listener({ instance: parsed.data });
                }
            return { ok: true, value };
        }
        catch (error) {
            const code = error instanceof WorkflowCliError && Object.hasOwn(errors, error.code)
                ? error.code
                : 'requestFailed';
            return { ok: false, error: { code, message: errorMessage(code) } };
        }
        finally {
            if (mutation)
                this.busy = false;
        }
    }
}
