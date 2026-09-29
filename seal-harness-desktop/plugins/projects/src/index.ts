import type { Context } from '@deepseek-ai/cordis';
import { clientRequestSchema, type ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection';
import '@deepseek-ai/dsh-credentials';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { z } from 'zod';
import { ProjectService, type ProjectIdentity } from './host/service.js';
import { ProjectFiles } from './host/files.js';
import { projectTickets } from './host/tickets.js';
import { notificationSettings } from './host/notifications.js';
import { startProjectSync, projectEventResponse } from './host/events.js';
import { registerProjectCollabHandlers } from '../stratex/main/ipc/projectCollabHandlers.js';
import { registerProjectDataSourceHandlers } from '../stratex/main/ipc/projectDataSourceHandlers.js';
import { registerProjectDictionaryHandlers } from '../stratex/main/ipc/projectDictionaryHandlers.js';

declare module '@deepseek-ai/cordis' {
  interface Context {
    sealHarnessProjects: ProjectService;
    sealHarnessIdentity: ProjectIdentity;
    sealHarnessServices: { getConfig(): { identityBaseUrl: string; collaborationBaseUrl: string; storeBaseUrl: string; mcpCenterBaseUrl: string } };
  }
}
export const name = 'seal-harness-projects';
export const inject = ['connection', 'credentials', 'sealHarnessIdentity', 'sealHarnessServices'];
export const Config = z.object({}).default({});

export async function apply(ctx: Context) {
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(), 'seal-harness-projects: requests');
  const identity = ctx.sealHarnessIdentity;
  const baseUrl = ctx.sealHarnessServices.getConfig().collaborationBaseUrl;
  const home = resolveDshHome(process.env.DSH_HOME || join(homedir(), '.seal-harness'));
  const temp = join(home, 'projects', 'transfers');
  await mkdir(temp, { recursive: true });
  const projects = new ProjectService(identity, baseUrl);
  ctx.effect(() => () => projects.dispose(), 'seal-harness-projects: service');
  const files = new ProjectFiles(projects, await mkdtemp(join(temp, 'host-')));
  ctx.effect(() => () => { lifetime.abort(); projects.dispose(); return files.dispose(); }, 'seal-harness-projects: transfers');
  ctx.provide('sealHarnessProjects', projects);
  const registrar = { handle: projects.register.bind(projects) };
  const account = { authorize: () => true, activeAccount: () => projects.getAccount() };
  registerProjectCollabHandlers(registrar, {
    ...account, notificationSettings: notificationSettings(home, projects),
    dependencies: { ...projects.clients, accessToken: () => projects.accessToken(),
      pickUploadFile: files.pickUploadFile, downloadsDirectory: files.downloadsDirectory,
      openExternalLink: async url => url,
    },
  });
  registerProjectDataSourceHandlers(registrar, { ...account, dependencies: {
    client: projects.clients.dataSources, accessToken: () => projects.accessToken(), ticketStore: projectTickets(ctx.credentials),
  } });
  registerProjectDictionaryHandlers(registrar, { ...account, dependencies: {
    client: projects.clients.dictionaries, accessToken: () => projects.accessToken(),
  } });
  let previous = projects.getAccount();
  ctx.effect(() => identity.subscribe(() => {
    const next = projects.getAccount();
    if (next?.accountKey !== previous?.accountKey || next?.authEpoch !== previous?.authEpoch) {
      previous = next;
      void files.clear().catch(() => ctx.logger.warn('项目临时文件清理失败'));
    }
  }), 'seal-harness-projects: account transfers');
  if (baseUrl) ctx.effect(() => startProjectSync(projects, identity, baseUrl), 'seal-harness-projects: sync');
  const requestSchema = z.strictObject({ channel: z.string(), payload: z.unknown().optional() });
  ctx.connection.fetch.register({
    path: '/api/seal-harness-projects/invoke', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 });
      let message;
      try { message = clientRequestSchema.parse(await request.json()); }
      catch { return new Response('Invalid RPC request', { status: 400 }); }
      if (message.method !== 'seal-harness-projects/invoke') return new Response('Invalid RPC method', { status: 400 });
      let result: ConnectionRpcResult<unknown>;
      try {
        const { channel, payload } = requestSchema.parse(message.payload);
        const value = await projects.invoke(channel, payload, AbortSignal.any([request.signal, lifetime.signal]));
        result = { ok: true, value: await files.result(channel, payload, value) };
      } catch (error) {
        const code = error instanceof z.ZodError ? 'invalidRequest' : 'operationFailed';
        ctx.logger.warn('项目操作未完成：%s', code);
        result = { ok: false, error: { code, message: '项目操作未完成，请刷新后重试。', details: {} } };
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result });
    },
  });
  ctx.connection.fetch.register({ path: '/api/seal-harness-projects/events', methods: ['GET'], requestBody: 'buffered',
    fetch: async request => projectEventResponse(projects, AbortSignal.any([request.signal, lifetime.signal])) });
  ctx.connection.fetch.register({ path: '/api/seal-harness-projects/upload', methods: ['POST'], requestBody: 'streaming',
    fetch: async request => {
      try { return await files.upload(request); }
      catch (error) { return new Response(error instanceof z.ZodError ? 'Invalid upload' : 'Upload failed', { status: error instanceof z.ZodError ? 400 : 500 }); }
    } });
  ctx.connection.fetch.register({ path: '/api/seal-harness-projects/download', methods: ['GET'], requestBody: 'buffered',
    fetch: request => files.download(request) });
}
