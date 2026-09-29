import { expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection';
import LocalCredentials from '@deepseek-ai/dsh-credentials-local';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as projects from '../../src/index.js';
import type { ProjectIdentity } from '../../src/host/service.js';

// 保留一个真实 Host/Connection 装配检查；远端服务用 HTTP 夹具，不冒充线上验收。
test('项目 Host 经真实 Connection 读项目、传文件、下载并释放注册', async () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const fileId = '22222222-2222-4222-8222-222222222222';
  const home = await mkdtemp(join(tmpdir(), 'project-host-'));
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  let uploaded = '';
  const requests: string[] = [];
  const remote = createServer(async (request, response) => {
    requests.push(request.url ?? '');
    if (request.url?.startsWith('/root/api/v1/stream')) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(': ready\n\n'); return;
    }
    if (request.url?.startsWith('/root/api/v1/projects') && request.method === 'GET') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ projects: [{ id: projectId, name: 'Fixture', my_role: 'owner', member_count: 1, unread_count: 0, created_at: '2026-09-23T00:00:00Z' }] })); return;
    }
    if (request.url?.startsWith(`/root/api/v1/projects/${projectId}/files?`) && request.method === 'POST') {
      for await (const chunk of request) uploaded += chunk.toString();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ file: { id: fileId, project_id: projectId, filename: 'note.txt', bytes: 4, mime: 'text/plain', sha256: 'a'.repeat(64), kind: 'asset', uploader_subject: 'alice', created_at: '2026-09-23T00:00:00Z' } })); return;
    }
    if (request.url === `/root/api/v1/files/${fileId}`) {
      response.writeHead(200, { 'content-length': '4', 'content-disposition': 'attachment; filename="note.txt"' }); response.end('note'); return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve));
  const address = remote.address();
  if (!address || typeof address === 'string') throw new Error('HTTP fixture did not start');
  const baseUrl = `http://127.0.0.1:${address.port}/root`;
  const ctx = new Context();
  let session: ReturnType<ProjectIdentity['getSession']> = null;
  const subscribers = new Set<() => void>();
  const identity: ProjectIdentity = { getSession: () => session, refreshSession: async () => {}, getAccessToken: async () => 'fixture', subscribe: listener => { subscribers.add(listener); return () => { subscribers.delete(listener); }; } };
  ctx.provide('sealHarnessIdentity', identity);
  ctx.provide('sealHarnessServices', { getConfig: () => ({ identityBaseUrl: baseUrl, collaborationBaseUrl: baseUrl, storeBaseUrl: baseUrl, mcpCenterBaseUrl: baseUrl }) });
  ctx.provide('webServer', { register: () => () => {} });
  try {
    await ctx.plugin(LocalCredentials, { dshHome: home, watch: false }).await();
    const connection = new HostConnectionService(ctx, [], { isAuthenticated: () => true });
    // 官方 ApiGateway 已拥有共享 /api interceptor，项目仅注册自己的精确 Fetch 路由。
    connection.rpc.intercept('/api', endpoint => endpoint === 'fixture/official', async () => ({ ok: true, value: 'official' }));
    const plugin = ctx.plugin(projects);
    await plugin.await();
    const api = connection.createSharedFetchHandler('/api');
    const invoke = async (channel: string, payload: unknown) => {
      const response = await api.fetch(new Request('http://localhost/api/seal-harness-projects/invoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'seal-harness-projects/invoke', payload: { channel, payload } }) }));
      return (await response.json()).result;
    };
    const events = await api.fetch(new Request('http://localhost/api/seal-harness-projects/events'));
    const reader = events.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    expect(initial).toContain('project:account-changed');
    expect(initial).toContain('\"accountId\":null');
    expect(initial).toContain('\"epoch\":0');
    session = { accountId: 'fixture', epoch: 1, accessToken: 'fixture', subject: 'alice' };
    subscribers.forEach(listener => listener());
    const connectionFrame = new TextDecoder().decode((await reader.read()).value);
    const accountFrame = new TextDecoder().decode((await reader.read()).value);
    expect(connectionFrame + accountFrame).toContain('\"accountId\":\"fixture\"');
    await reader.cancel();
    const listed = await invoke('project:list', {});
    expect(listed.value.projects[0].name).toBe('Fixture');
    const upload = await api.fetch(new Request('http://localhost/api/seal-harness-projects/upload?channel=project:file-upload', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-project-filename': 'note.txt', 'x-project-request': encodeURIComponent(JSON.stringify({ projectId, kind: 'asset', operationId: '33333333-3333-4333-8333-333333333333' })) }, body: 'note' }));
    const uploadResult = await upload.json();
    expect(uploadResult.ok, JSON.stringify(uploadResult)).toBe(true);
    expect(uploaded).toBe('note');
    const prepared = await invoke('project:file-download', { fileId });
    expect(prepared.value.savedPath).toBe('note.txt');
    const download = await api.fetch(new Request(`http://localhost/${prepared.value.downloadUrl}`));
    expect(await download.text()).toBe('note');
    expect(requests.some(url => url.startsWith('/root/api/v1/projects'))).toBe(true);
    await plugin.dispose();
    expect((await api.fetch(new Request('http://localhost/api/seal-harness-projects/events'))).status).toBe(404);
    const official = await api.fetch(new Request('http://localhost/api/fixture/official', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'official-test', method: 'fixture/official', payload: {} }) }));
    expect((await official.json()).result).toEqual({ ok: true, value: 'official' });
  } finally {
    await ctx.fiber.dispose();
    remote.closeAllConnections(); await new Promise<void>(resolve => remote.close(() => resolve()));
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
    await rm(home, { recursive: true, force: true });
  }
});
