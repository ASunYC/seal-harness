import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC } from '../../../../stratex/shared/ipc/channels.js';
import { registerProjectDataSourceHandlers } from '../../../../stratex/main/ipc/projectDataSourceHandlers.js';

/**
 * 外部数据源 IPC：三道闸、失败码到文案的落地、以及**票据不跨 IPC 回程**。
 *
 * 形态照 `projectCollabHandlers.test.ts`：对象字面量替身 + 手搓 registrar。
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_SOURCE_ID = '55555555-5555-4555-8555-555555555555';
const TICKET = 'glpat-personal-ticket-abcdef';

const SOURCE = {
  id: SOURCE_ID,
  kind: 'gitlab' as const,
  baseUrl: 'http://code.internal',
  repoPath: 'group/repo',
  gitRef: null,
  enabled: true,
  includeDocuments: true,
  includeProcessDocs: false,
  lastSyncedAt: null,
  lastSyncStatus: null,
  lastSyncDetail: null,
  createdBySubject: 'u-1',
  createdAt: '2026-08-29T00:00:00Z',
  updatedAt: '2026-08-29T00:00:00Z',
};

const SUMMARY = {
  todosCreated: 1,
  todosUpdated: 0,
  todosUnchanged: 0,
  documentsCreated: 0,
  documentsUpdated: 0,
  documentsUnchanged: 0,
  orphaned: 2,
  detail: '摘要',
  diagnostics: ['文档 a/prd.md：900000 字节超过单份上限 262144，已跳过'],
  diagnosticsTotal: 3,
};

function createHarness(overrides?: {
  readonly ticketStore?: unknown;
  readonly loggedIn?: boolean;
  readonly dependencies?: 'absent';
}) {
  const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
  const client = {
    listDataSources: vi.fn(async () => ({ ok: true as const, value: [SOURCE] })),
    createDataSource: vi.fn(async () => ({ ok: true as const, value: SOURCE })),
    updateDataSource: vi.fn(async () => ({ ok: true as const, value: SOURCE })),
    deleteDataSource: vi.fn(async () => ({ ok: true as const, value: SOURCE_ID })),
    syncDataSource: vi.fn(async () => ({ ok: true as const, value: SUMMARY })),
    listExternalLinks: vi.fn(async () => ({ ok: true as const, value: [] })),
  };
  const ticketStore = (overrides?.ticketStore ?? {
    save: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    resolve: vi.fn(async () => ({ ticket: TICKET, scheme: 'privateToken' as const })),
    listDataSourceIds: vi.fn(async () => [SOURCE_ID, OTHER_SOURCE_ID]),
  }) as {
    save: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    resolve: ReturnType<typeof vi.fn>;
    listDataSourceIds: ReturnType<typeof vi.fn>;
  };

  registerProjectDataSourceHandlers(
    { handle: (channel, listener) => handlers.set(channel, listener) },
    {
      dependencies:
        overrides?.dependencies === 'absent'
          ? null
          : {
              client,
              accessToken: async () => 'platform-token',
              ticketStore: ticketStore as never,
            },
      authorize: () => overrides?.loggedIn !== false,
      activeAccount: () =>
        overrides?.loggedIn === false ? null : { accountKey: 'acct-1', authEpoch: 3 },
    },
  );

  const invoke = async (channel: string, input: unknown): Promise<Record<string, unknown>> => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`missing handler: ${channel}`);
    return (await handler({}, input)) as Record<string, unknown>;
  };
  return { client, ticketStore, invoke };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('三道闸', () => {
  it('未登录一律 authRequired，且不碰客户端', async () => {
    const harness = createHarness({ loggedIn: false });
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_LIST, { projectId: PROJECT_ID });
    expect(result).toMatchObject({ ok: false, code: 'authRequired' });
    expect(harness.client.listDataSources).not.toHaveBeenCalled();
  });

  it('未装配一律 unavailable（fail-safe，不报错也不泄露）', async () => {
    const harness = createHarness({ dependencies: 'absent' });
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_SYNC, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
    });
    expect(result).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('入参不合法回 invalidRequest（strictObject 拒夹带票据的同步请求）', async () => {
    const harness = createHarness();
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_SYNC, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      accessToken: TICKET,
    });
    expect(result).toMatchObject({ ok: false, code: 'invalidRequest' });
    expect(harness.client.syncDataSource).not.toHaveBeenCalled();
  });
});

describe('失败码到人话', () => {
  it('白名单未开：专门文案 + 专门编号，不是通用错误', async () => {
    const harness = createHarness();
    harness.client.createDataSource.mockResolvedValueOnce({
      ok: false,
      code: 'externalSourcesDisabled',
    } as never);
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_CREATE, {
      projectId: PROJECT_ID,
      baseUrl: 'http://code.internal',
      repoPath: 'group/repo',
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'externalSourcesDisabled',
      referenceCode: 'STRX-DSRC-011',
    });
    expect(String(result.message)).toContain('本部署尚未开放外部数据源');
    // 成对：它**不是**那句通用的网络话，也不是「请求被服务端拒绝」。
    expect(String(result.message)).not.toContain('网络暂时不可用');
    expect(String(result.message)).not.toContain('请求被服务端拒绝');
  });

  it('分支上没有任务目录：给出可读原因而不是「同步失败」', async () => {
    const harness = createHarness();
    harness.client.syncDataSource.mockResolvedValueOnce({
      ok: false,
      code: 'taskDirectoryMissing',
    } as never);
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_SYNC, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
    });
    expect(result).toMatchObject({ ok: false, code: 'taskDirectoryMissing' });
    expect(String(result.message)).toContain('没有可导入的任务目录');
  });

  it('角色不足回 forbidden，且文案说清是谁能配', async () => {
    const harness = createHarness();
    harness.client.createDataSource.mockResolvedValueOnce({
      ok: false,
      code: 'forbidden',
    } as never);
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_CREATE, {
      projectId: PROJECT_ID,
      baseUrl: 'http://code.internal',
      repoPath: 'group/repo',
    });
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect(String(result.message)).toContain('只有项目拥有者');
  });
});

describe('同步：票据的取用与流向', () => {
  it('票据从本机库取出、只交给客户端，回执里没有它', async () => {
    const harness = createHarness();
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_SYNC, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
    });

    // 正向：确实取了本账号这一枚，并交到了发请求的那一层。
    expect(harness.ticketStore.resolve).toHaveBeenCalledWith({
      accountKey: 'acct-1',
      dataSourceId: SOURCE_ID,
    });
    expect(harness.client.syncDataSource).toHaveBeenCalledWith('platform-token', {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      ticket: TICKET,
      ticketScheme: 'privateToken',
    });
    // 负向：跨 IPC 回渲染层的整包里一个字节都没有它。
    expect(JSON.stringify(result)).not.toContain(TICKET);
    expect(result).toMatchObject({ ok: true, dataSourceId: SOURCE_ID });
  });

  it('没存过票据 → ticketMissing（与「本机加密库坏了」分得开）', async () => {
    const harness = createHarness();
    harness.ticketStore.resolve.mockResolvedValueOnce(null);
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_SYNC, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
    });
    expect(result).toMatchObject({ ok: false, code: 'ticketMissing' });
    expect(harness.client.syncDataSource).not.toHaveBeenCalled();
  });

  it('本机加密库不可用 → ticketStoreUnavailable，不是 ticketMissing', async () => {
    const harness = createHarness();
    harness.ticketStore.resolve.mockRejectedValueOnce(new Error('cipher down'));
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_SYNC, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
    });
    expect(result).toMatchObject({ ok: false, code: 'ticketStoreUnavailable' });
  });

  it('回执如实带回诊断条目与总数（超限跳过的那几条要传得到界面）', async () => {
    const harness = createHarness();
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_SYNC, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
    });
    expect(result).toMatchObject({ ok: true, summary: SUMMARY });
  });
});

describe('票据的存与撤', () => {
  it('保存只回布尔量，⛔ 出参里没有票据', async () => {
    const harness = createHarness();
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_TICKET_SAVE, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      ticket: TICKET,
      scheme: 'bearer',
    });

    expect(harness.ticketStore.save).toHaveBeenCalledWith({
      accountKey: 'acct-1',
      dataSourceId: SOURCE_ID,
      ticket: TICKET,
      scheme: 'bearer',
    });
    expect(result).toEqual({ ok: true, dataSourceId: SOURCE_ID, ticketed: true });
    expect(JSON.stringify(result)).not.toContain(TICKET);
  });

  it('断开数据源时顺带清掉本机票据；清理失败不改变删除结果', async () => {
    const harness = createHarness();
    harness.ticketStore.remove.mockRejectedValueOnce(new Error('disk busy'));
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_DELETE, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
    });
    expect(harness.ticketStore.remove).toHaveBeenCalled();
    expect(result).toEqual({ ok: true, dataSourceId: SOURCE_ID });
  });
});

describe('列表', () => {
  it('只报本项目里确实存在的那几个已授权 id', async () => {
    const harness = createHarness();
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_LIST, { projectId: PROJECT_ID });
    // 本机存了两枚票据，但本项目只有一个数据源——另一个不能顺出去。
    expect(result).toMatchObject({ ok: true, ticketedDataSourceIds: [SOURCE_ID] });
    expect(JSON.stringify(result)).not.toContain(OTHER_SOURCE_ID);
  });

  it('票据库读不出来时退化成「都没存过」，不拖垮列表', async () => {
    const harness = createHarness();
    harness.ticketStore.listDataSourceIds.mockRejectedValueOnce(new Error('cipher down'));
    const result = await harness.invoke(IPC.PROJECT_DATA_SOURCE_LIST, { projectId: PROJECT_ID });
    expect(result).toMatchObject({ ok: true, ticketedDataSourceIds: [] });
  });
});
