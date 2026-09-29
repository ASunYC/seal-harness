import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { IPC } from '../../stratex/shared/ipc/channels.js';
import { PROJECT_FILE_MAX_BYTES, ProjectFileDownloadResultSchema, ProjectFileUploadRequestSchema } from '../../stratex/shared/protocol/project-collab.js';
import { ProjectAssetVersionUploadRequestSchema } from '../../stratex/shared/protocol/project-collab-assets.js';
import type { ProjectAccount, ProjectService } from './service.js';

/** 原 handler 只取本次浏览器上传产生的文件；RPC 不接受任意本机路径。 */
export class ProjectFiles {
  private readonly uploadPath = new AsyncLocalStorage<string>();
  private readonly downloads = new Map<string, { path: string; account: ProjectAccount }>();
  private readonly uploads = new Map<string, string>();
  constructor(private readonly projects: ProjectService, private readonly directory: string) {}
  pickUploadFile = async () => this.uploadPath.getStore() ?? null;
  downloadsDirectory = () => this.directory;

  async upload(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const channel = url.searchParams.get('channel');
    const schema = channel === IPC.PROJECT_FILE_UPLOAD ? ProjectFileUploadRequestSchema
      : channel === IPC.PROJECT_ASSET_VERSION_UPLOAD ? ProjectAssetVersionUploadRequestSchema : null;
    if (!schema || !request.body) return new Response('Invalid upload', { status: 400 });
    const payload = schema.parse(JSON.parse(decodeURIComponent(request.headers.get('x-project-request') ?? '')));
    const account = this.projects.getAccount();
    if (!account) return new Response('Login required', { status: 401 });
    const signal = AbortSignal.any([request.signal, this.projects.signal]);
    const declaredSize = Number(request.headers.get('content-length'));
    if (declaredSize > PROJECT_FILE_MAX_BYTES) return new Response('File too large', { status: 413 });
    const name = basename(decodeURIComponent(request.headers.get('x-project-filename') ?? 'file').replaceAll('\\', '/')).replace(/[\x00-\x1f]/gu, '') || 'file';
    const folder = await mkdtemp(join(this.directory, 'upload-'));
    const path = join(folder, name === '.' || name === '..' ? 'file' : name);
    let retained = false;
    const file = await open(path, 'wx');
    const reader = request.body.getReader();
    const stop = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', stop, { once: true });
    try {
      let bytes = 0;
      for (;;) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > PROJECT_FILE_MAX_BYTES) return new Response('File too large', { status: 413 });
        await file.writeFile(chunk.value);
      }
      await file.close();
      const result = await this.uploadPath.run(path, () => this.projects.invoke(channel!, payload, signal));
      if (result && typeof result === 'object' && 'resume' in result && result.resume) {
        this.uploads.set(payload.operationId, folder); retained = true;
      }
      return Response.json(result);
    } finally {
      signal.removeEventListener('abort', stop);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      await file.close();
      if (!retained) await rm(folder, { recursive: true, force: true });
    }
  }

  /** 远端下载沿原客户端有界落盘，再交浏览器以流方式保存。 */
  async result(channel: string, payload: unknown, result: unknown): Promise<unknown> {
    if (channel === IPC.PROJECT_FILE_DOWNLOAD) {
      const outcome = ProjectFileDownloadResultSchema.parse(result);
      if (!outcome.ok) return outcome;
      const account = this.projects.getAccount();
      if (!account) { await rm(outcome.savedPath, { force: true }); throw new Error('Account changed'); }
      const receipt = randomUUID();
      this.downloads.set(receipt, { path: outcome.savedPath, account });
      return { ok: true, savedPath: basename(outcome.savedPath), downloadUrl: `api/seal-harness-projects/download?receipt=${receipt}` };
    }
    if (channel === IPC.PROJECT_ASSET_VERSION_UPLOAD_RESUME || channel === IPC.PROJECT_ASSET_VERSION_UPLOAD_DISCARD) {
      const operation = z.object({ operationId: z.string() }).parse(payload);
      const resumable = result && typeof result === 'object' && 'resume' in result && result.resume;
      if (!resumable) {
        const folder = this.uploads.get(operation.operationId);
        this.uploads.delete(operation.operationId);
        if (folder) await rm(folder, { recursive: true, force: true });
      }
    }
    return result;
  }

  async download(request: Request): Promise<Response> {
    const receipt = new URL(request.url).searchParams.get('receipt') ?? '';
    const entry = this.downloads.get(receipt), account = this.projects.getAccount();
    if (!entry || !account || entry.account.accountKey !== account.accountKey || entry.account.authEpoch !== account.authEpoch) return new Response('Download expired', { status: 404 });
    this.downloads.delete(receipt);
    const size = (await stat(entry.path)).size;
    const source = createReadStream(entry.path, { signal: AbortSignal.any([request.signal, this.projects.signal]) });
    const iterator = source[Symbol.asyncIterator]();
    const cleanup = async () => { source.destroy(); await rm(entry.path, { force: true }); };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await iterator.next();
          if (chunk.done) { controller.close(); await cleanup(); }
          else controller.enqueue(chunk.value);
        } catch (error) { controller.error(error); await cleanup(); }
      },
      async cancel() { await cleanup(); },
    });
    return new Response(body, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(size),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename(entry.path))}` } });
  }
  async clear() {
    const files = [...this.downloads.values()].map(entry => entry.path);
    const folders = [...this.uploads.values()];
    this.downloads.clear(); this.uploads.clear();
    await Promise.all([...files.map(path => rm(path, { force: true })), ...folders.map(path => rm(path, { recursive: true, force: true }))]);
  }
  async dispose() { await this.clear(); await rm(this.directory, { recursive: true, force: true }); }
}
