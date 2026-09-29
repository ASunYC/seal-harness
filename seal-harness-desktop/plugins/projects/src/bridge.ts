import { ProjectWorkspaceErrorSchema } from '../stratex/shared/protocol/project-workspace.js';
import { IPC } from '../stratex/shared/ipc/channels.js';
import { PROJECT_FILE_MAX_BYTES, PROJECT_COLLAB_REFERENCE_CODES, ProjectEventSchema } from '../stratex/shared/protocol/project-collab.js';
import { PROJECT_NOTIFICATION_COPY } from '../stratex/shared/protocol/project-notifications.js';
import { decideProjectNotification } from '../stratex/main/services/collab/projectNotificationRules.js';
import { z } from 'zod';
import { ProjectSessionListRequestSchema, ProjectSessionCreateRequestSchema, ProjectSessionOpenRequestSchema, ProjectSessionListResultSchema, ProjectSessionResultSchema, ProjectAgentChangedSchema } from '../stratex/shared/protocol/project-sessions.js';
import { createProjectCollabPreloadApi } from '../stratex/preload/projectCollabApi.js';
import { createProjectDataSourcePreloadApi } from '../stratex/preload/projectDataSourceApi.js';
import { createProjectDictionaryPreloadApi } from '../stratex/preload/projectDictionaryApi.js';
import { createProjectWorkspacePreloadApi } from '../stratex/preload/projectWorkspaceApi.js';
import { createProjectSpecAssistPreloadApi } from '../stratex/preload/projectSpecAssistApi.js';

export type { ProjectApi } from '../stratex/shared/ipc/api.js';
export interface ProjectBridgeTransport {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  subscribe(channel: string, listener: (payload: unknown) => void): () => void;
}

export function createProjectBridge(transport: ProjectBridgeTransport) {
  const browser = typeof document !== 'undefined' ? browserTransport(transport) : null;
  const { invoke, subscribe } = browser ?? transport;
  const api = {
    dispose: () => browser?.dispose(),
    listProjectLocalWorkspaces: async (input: { collabProjectId: string }) => z.union([z.object({ ok: z.literal(true), workspaces: z.array(z.object({ localProjectId: z.string().uuid(), displayName: z.string() })) }), z.object({ ok: z.literal(false), error: ProjectWorkspaceErrorSchema })]).parse(await invoke('project:workspace-list-local', input)),
    listProjectSessions: async (input: z.infer<typeof ProjectSessionListRequestSchema>) => ProjectSessionListResultSchema.parse(await invoke('project:session-list', input)),
    createProjectSession: async (input: z.infer<typeof ProjectSessionCreateRequestSchema>) => ProjectSessionResultSchema.parse(await invoke('project:session-create', input)),
    openProjectSession: async (input: z.infer<typeof ProjectSessionOpenRequestSchema>) => ProjectSessionResultSchema.parse(await invoke('project:session-open', input)),
    onProjectAgentChanged: (listener: (event: z.infer<typeof ProjectAgentChangedSchema>) => void) => subscribe('project:agent-changed', payload => {
      const event = ProjectAgentChangedSchema.safeParse(payload);
      if (event.success) listener(event.data);
    }),
    ...createProjectCollabPreloadApi(invoke, subscribe),
    ...createProjectDataSourcePreloadApi(invoke),
    ...createProjectDictionaryPreloadApi(invoke),
    ...createProjectWorkspacePreloadApi(invoke),
    ...createProjectSpecAssistPreloadApi(invoke),
  };
  return Object.freeze(api);
}

/** 浏览器负责选档、实际下载及通知；业务请求仍复用原 preload 的 schema。 */
function browserTransport(transport: ProjectBridgeTransport) {
  const local = new Map<string, Set<(payload: unknown) => void>>();
  const uploads = new Map<string, { xhr: XMLHttpRequest; receiving: boolean }>();
  const pickers = new Set<() => void>();
  const notifications = new Set<Notification>();
  let subject: string | null = null, enabled = true, generation = 0;
  const emit = (channel: string, payload: unknown) => local.get(channel)?.forEach(listener => listener(payload));
  const clear = () => {
    generation++;
    for (const upload of uploads.values()) upload.xhr.abort();
    for (const cancel of pickers) cancel();
    for (const notification of notifications) notification.close();
    notifications.clear(); subject = null;
  };
  const refresh = async () => {
    clear();
    const current = generation;
    const api = createProjectCollabPreloadApi(transport.invoke, transport.subscribe);
    try {
      const [availability, settings] = await Promise.all([api.readProjectCollabAvailability(), api.readProjectNotificationSettings()]);
      if (generation === current) { subject = availability.mySubject; enabled = settings.desktopNotifications; }
    } catch { /* 账号过渡期间由下一帧重新读取。 */ }
  };
  const offAccount = transport.subscribe('project:account-changed', () => { void refresh(); });
  void refresh();
  const offEvents = transport.subscribe(IPC.PROJECT_EVENT, payload => {
    if (!enabled || !subject || typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.hasFocus()) return;
    const event = ProjectEventSchema.safeParse(payload);
    if (!event.success) return;
    const decision = decideProjectNotification(event.data, subject);
    if (!decision) return;
    const copy = PROJECT_NOTIFICATION_COPY[decision.reason];
    const notification = new Notification(copy.title, { body: copy.body });
    notifications.add(notification);
    notification.onclose = () => { notifications.delete(notification); };
    notification.onclick = () => { window.focus(); emit(IPC.PROJECT_NOTIFICATION_NAVIGATE, { projectId: decision.projectId }); notification.close(); };
  });
  const chooseFile = () => new Promise<File | null>(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.hidden = true; document.body.append(input);
    const cancel = () => finish(null);
    const finish = (file: File | null) => { pickers.delete(cancel); input.remove(); resolve(file); };
    pickers.add(cancel);
    input.onchange = () => finish(input.files?.[0] ?? null);
    input.addEventListener('cancel', cancel, { once: true });
    input.click();
  });
  const open = (url: string, download?: string) => {
    const anchor = document.createElement('a'); anchor.href = url;
    if (download !== undefined) anchor.download = download;
    else { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
    document.body.append(anchor); anchor.click(); anchor.remove();
  };
  const invoke: ProjectBridgeTransport['invoke'] = async (channel, payload) => {
    if (channel === IPC.PROJECT_FILE_UPLOAD_CANCEL || channel === IPC.PROJECT_ASSET_VERSION_UPLOAD_CANCEL) {
      const request = z.object({ operationId: z.string() }).parse(payload);
      const pending = uploads.get(request.operationId);
      if (pending?.receiving) pending.xhr.abort();
    }
    if (channel === IPC.PROJECT_FILE_UPLOAD || channel === IPC.PROJECT_ASSET_VERSION_UPLOAD) {
      const request = z.object({ operationId: z.string() }).parse(payload);
      const file = await chooseFile();
      if (!file) return { ok: true, cancelled: true };
      if (file.size > PROJECT_FILE_MAX_BYTES) return { ok: false, code: 'tooLarge', message: '文件超过 1 GiB 大小上限。', referenceCode: PROJECT_COLLAB_REFERENCE_CODES.tooLarge, quota: null, ...(channel === IPC.PROJECT_ASSET_VERSION_UPLOAD ? { resume: null } : {}) };
      return new Promise<unknown>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const pending = { xhr, receiving: true };
        uploads.set(request.operationId, pending);
        xhr.upload.onload = () => { pending.receiving = false; };
        xhr.open('POST', `api/seal-harness-projects/upload?channel=${encodeURIComponent(channel)}`);
        xhr.setRequestHeader('content-type', 'application/octet-stream');
        xhr.setRequestHeader('x-project-filename', encodeURIComponent(file.name));
        xhr.setRequestHeader('x-project-request', encodeURIComponent(JSON.stringify(payload)));
        xhr.upload.onprogress = event => emit(IPC.PROJECT_FILE_UPLOAD_PROGRESS, { operationId: request.operationId, name: file.name, size: file.size, progress: event.loaded, phase: 'uploading', error: null });
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) { reject(new Error('文件上传未完成，请重试。')); return; }
          try { resolve(JSON.parse(xhr.responseText)); } catch (error) { reject(error); }
        };
        xhr.onerror = () => reject(new Error('文件上传连接中断，请重试。'));
        xhr.onabort = () => resolve({ ok: true, cancelled: true });
        xhr.onloadend = () => { uploads.delete(request.operationId); };
        xhr.send(file);
      });
    }
    if (channel === IPC.PROJECT_NOTIFICATION_SETTINGS_WRITE && typeof Notification !== 'undefined') {
      const settings = z.object({ desktopNotifications: z.boolean() }).parse(payload);
      if (settings.desktopNotifications && Notification.permission === 'default') await Notification.requestPermission();
      enabled = settings.desktopNotifications;
    }
    const result = await transport.invoke(channel, payload);
    if (result && typeof result === 'object' && 'ok' in result && result.ok === true) {
      if (channel === IPC.PROJECT_FILE_DOWNLOAD && 'downloadUrl' in result && typeof result.downloadUrl === 'string') {
        open(result.downloadUrl, 'savedPath' in result && typeof result.savedPath === 'string' ? result.savedPath : '');
      }
      if (channel === IPC.PROJECT_EVIDENCE_LINK_OPEN && 'url' in result && typeof result.url === 'string') open(result.url);
    }
    return result;
  };
  return {
    invoke,
    subscribe(channel: string, listener: (payload: unknown) => void) {
      let listeners = local.get(channel);
      if (!listeners) { listeners = new Set(); local.set(channel, listeners); }
      listeners.add(listener);
      const off = transport.subscribe(channel, listener);
      return () => { listeners.delete(listener); off(); };
    },
    dispose() { clear(); offEvents(); offAccount(); local.clear(); },
  };
}
