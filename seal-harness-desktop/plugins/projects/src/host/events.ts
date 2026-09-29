import type { ProjectService, ProjectIdentity } from './service.js';
import { IPC } from '../../stratex/shared/ipc/channels.js';
import { CollabStreamClient } from '../../stratex/main/services/collab/collabStreamClient.js';
import { CollabSyncService } from '../../stratex/main/services/collab/collabSyncService.js';

export function startProjectSync(projects: ProjectService, identity: ProjectIdentity, baseUrl: string) {
  let account = projects.getAccount();
  const sync = new CollabSyncService({
    createStream: handlers => {
      const owner = projects.getAccount();
      const current = () => {
        const now = projects.getAccount();
        return owner && now?.accountKey === owner.accountKey && now.authEpoch === owner.authEpoch;
      };
      return new CollabStreamClient({ baseUrl, accessToken: () => projects.accessToken(),
        onFrame: frame => { if (current()) handlers.onFrame(frame); },
        onResync: () => { if (current()) handlers.onResync(); },
        onUp: () => { if (current()) handlers.onUp(); },
        onDown: () => { if (current()) handlers.onDown(); },
      });
    },
    publish: event => projects.emit(IPC.PROJECT_EVENT, event),
  });
  if (account) sync.start();
  const unsubscribe = identity.subscribe(() => {
    const next = projects.getAccount();
    if (next?.accountKey === account?.accountKey && next?.authEpoch === account?.authEpoch) return;
    account = next;
    projects.emit('project:account-changed', next ? { accountId: next.accountKey, epoch: next.authEpoch } : { accountId: null, epoch: 0 });
    if (next) sync.restart(); else sync.stop();
  });
  return () => { unsubscribe(); sync.stop(); };
}

export function projectEventResponse(projects: ProjectService, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let dispose = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (channel: string, payload: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ channel, payload })}\n\n`));
      };
      const unsubscribe = projects.subscribe(send);
      const heartbeat = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n')); }, 25_000);
      heartbeat.unref();
      dispose = () => {
        if (closed) return;
        closed = true; unsubscribe(); clearInterval(heartbeat);
        signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => { if (!closed) { dispose(); controller.close(); } };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort(); else {
        const account = projects.getAccount();
        send('project:account-changed', account ? { accountId: account.accountKey, epoch: account.authEpoch } : { accountId: null, epoch: 0 });
        send(IPC.PROJECT_EVENT, { kind: 'connection', payload: { state: 'degraded' } });
      }
    },
    cancel() { dispose(); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' } });
}
