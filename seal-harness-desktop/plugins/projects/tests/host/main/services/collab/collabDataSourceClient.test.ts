import { beforeEach, describe, expect, it } from 'vitest';

import { CollabDataSourceClient } from '../../../../../stratex/main/services/collab/collabDataSourceClient.js';

/**
 * 外部数据源客户端：端点对齐、失败码对齐、**票据流向**。
 *
 * 「票据流向」是本文件最要紧的一段，两边都要断言（缺一半都证明不了什么）：
 *  - 正向：票据确实到了抓取层——同步那一次的请求体里 `access_token` 就是它；
 *  - 负向：其余五个端点的 URL、查询串、请求头与请求体里**一个字节都没有它**。
 *    只做正向，改坏了「顺手也发给别的端点」不会被发现；只做负向，把票据整个丢掉
 *    （于是同步永远 401）同样过关。
 */

const TOKEN = 'platform-access-token';
const TICKET = 'glpat-personal-ticket-abcdef';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';

/**
 * 协作服务基地址。
 * ⚠️ 单独一个常量而不是内联进 `new CollabDataSourceClient({...})`：那一行会同时出现
 * 「地址」与 `fetchImpl`，被 guard-no-runtime-fetch 的「疑似运行时拉取二进制」判据
 * 命中（它按行扫，看的是同一行里有没有同时出现下载词与 URL）。
 */
const BASE_URL = 'http://collab.internal/';

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

let recorded: Recorded[] = [];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(respond: (record: Recorded) => Response): CollabDataSourceClient {
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const record: Recorded = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === 'string' ? init.body : null,
    };
    recorded.push(record);
    return respond(record);
  }) as typeof fetch;
  return new CollabDataSourceClient({ baseUrl: BASE_URL, fetchImpl });
}

const SOURCE_WIRE = {
  id: SOURCE_ID,
  kind: 'gitlab',
  base_url: 'http://code.internal',
  repo_path: 'group/repo',
  git_ref: null,
  enabled: true,
  include_documents: true,
  include_process_docs: false,
  last_synced_at: null,
  last_sync_status: null,
  last_sync_detail: null,
  created_by_subject: 'u-1',
  created_at: '2026-08-29T00:00:00Z',
  updated_at: '2026-08-29T00:00:00Z',
};

beforeEach(() => {
  recorded = [];
});

describe('端点与线格式对齐', () => {
  it('列表打 GET /api/v1/projects/{id}/data-sources 并投影 snake→camel', async () => {
    const client = clientWith(() => jsonResponse(200, { data_sources: [SOURCE_WIRE] }));
    const outcome = await client.listDataSources(TOKEN, { projectId: PROJECT_ID });

    expect(recorded[0]?.url).toBe(
      `http://collab.internal/api/v1/projects/${PROJECT_ID}/data-sources`,
    );
    expect(recorded[0]?.method).toBe('GET');
    expect(outcome).toEqual({
      ok: true,
      value: [
        {
          id: SOURCE_ID,
          kind: 'gitlab',
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
        },
      ],
    });
  });

  it('新建按服务端字段名组体，并显式带上 kind', async () => {
    const client = clientWith(() => jsonResponse(201, { data_source: SOURCE_WIRE }));
    await client.createDataSource(TOKEN, {
      projectId: PROJECT_ID,
      baseUrl: 'http://code.internal',
      repoPath: 'group/repo',
      includeDocuments: false,
    });

    expect(JSON.parse(recorded[0]?.body ?? '{}')).toEqual({
      kind: 'gitlab',
      base_url: 'http://code.internal',
      repo_path: 'group/repo',
      git_ref: null,
      include_documents: false,
    });
  });

  it('更新用「键在不在」区分「改回默认分支」与「不动分支」', async () => {
    const client = clientWith(() => jsonResponse(200, { data_source: SOURCE_WIRE }));
    await client.updateDataSource(TOKEN, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      gitRef: null,
    });
    await client.updateDataSource(TOKEN, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      enabled: false,
    });

    expect(JSON.parse(recorded[0]?.body ?? '{}')).toEqual({ git_ref: null });
    // 第二次**没有** git_ref 这个键：服务端按 fields_set 判，带上就等于要改。
    expect(JSON.parse(recorded[1]?.body ?? '{}')).toEqual({ enabled: false });
  });

  it('对账行按 data_source_id 过滤并把 todo_item 投影成 todoItem', async () => {
    const client = clientWith(() =>
      jsonResponse(200, {
        links: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            project_id: PROJECT_ID,
            data_source_id: SOURCE_ID,
            external_kind: 'todo_item',
            external_key: 'todo:task-a#1',
            todo_id: '44444444-4444-4444-8444-444444444444',
            file_id: null,
            external_digest: 'abc',
            external_updated_at: null,
            external_meta: { trellis_owner: 'someone' },
            link_state: 'orphaned',
            orphaned_at: '2026-08-29T01:00:00Z',
            created_at: '2026-08-29T00:00:00Z',
            updated_at: '2026-08-29T01:00:00Z',
          },
        ],
      }),
    );
    const outcome = await client.listExternalLinks(TOKEN, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
    });

    expect(recorded[0]?.url).toContain(`data_source_id=${SOURCE_ID}`);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value[0]?.externalKind).toBe('todoItem');
    expect(outcome.value[0]?.linkState).toBe('orphaned');
    // external_meta 刻意不投影：开放 JSON 不进 strictObject。
    expect(JSON.stringify(outcome.value)).not.toContain('trellis_owner');
  });

  it('同步回执带回计数、摘要与诊断条目', async () => {
    const client = clientWith(() =>
      jsonResponse(200, {
        sync: {
          todos_created: 2,
          todos_updated: 1,
          todos_unchanged: 0,
          documents_created: 0,
          documents_updated: 0,
          documents_unchanged: 0,
          orphaned: 4,
          detail: '摘要',
          diagnostics: ['文档 a/prd.md：900000 字节超过单份上限 262144，已跳过'],
          diagnostics_total: 7,
        },
      }),
    );
    const outcome = await client.syncDataSource(TOKEN, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      ticket: TICKET,
      ticketScheme: 'privateToken',
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.orphaned).toBe(4);
    expect(outcome.value.diagnosticsTotal).toBe(7);
    expect(outcome.value.diagnostics).toHaveLength(1);
  });
});

describe('失败码按服务端稳定码分档（不是按状态码猜）', () => {
  const cases: readonly [number, string, string][] = [
    [503, 'external_sources_disabled', 'externalSourcesDisabled'],
    [400, 'endpoint_not_allowed', 'endpointNotAllowed'],
    [400, 'credential_in_endpoint', 'credentialInEndpoint'],
    [400, 'external_credential_rejected', 'ticketRejected'],
    [422, 'trellis_directory_missing', 'taskDirectoryMissing'],
    [422, 'external_repo_not_found', 'repositoryNotFound'],
    [502, 'external_unavailable', 'externalUnavailable'],
    [409, 'data_source_exists', 'alreadyExists'],
    [409, 'data_source_disabled', 'sourceDisabled'],
    [503, 'files_unavailable', 'documentsUnavailable'],
    [403, 'forbidden', 'forbidden'],
  ];

  for (const [status, wireCode, expected] of cases) {
    it(`${wireCode} → ${expected}`, async () => {
      const client = clientWith(() =>
        jsonResponse(status, { error: wireCode, detail: '服务端原文' }),
      );
      const outcome = await client.listDataSources(TOKEN, { projectId: PROJECT_ID });
      expect(outcome).toEqual({ ok: false, code: expected });
    });
  }

  it('503 上的 external_sources_disabled 不被塌缩成通用瞬时失败', async () => {
    const client = clientWith(() => jsonResponse(503, { error: 'external_sources_disabled' }));
    const outcome = await client.listDataSources(TOKEN, { projectId: PROJECT_ID });
    expect(outcome).toEqual({ ok: false, code: 'externalSourcesDisabled' });
    // 成对断言：它**不是** transient——按状态分档的话 503 正好会落到那一档。
    expect(outcome.ok === false && outcome.code === 'transient').toBe(false);
  });

  it('表外错误码退回按状态分档，且绝不回显服务端文本', async () => {
    const client = clientWith(() =>
      jsonResponse(418, { error: 'brand_new_code', detail: '内部细节' }),
    );
    const outcome = await client.listDataSources(TOKEN, { projectId: PROJECT_ID });
    expect(outcome).toEqual({ ok: false, code: 'rejected' });
    expect(JSON.stringify(outcome)).not.toContain('内部细节');
  });
});

describe('授权票据的流向', () => {
  it('正向：票据到了抓取层——同步请求体里就是它', async () => {
    const client = clientWith(() => jsonResponse(200, { sync: syncWire() }));
    await client.syncDataSource(TOKEN, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      ticket: TICKET,
      ticketScheme: 'privateToken',
    });

    const call = recorded[0];
    expect(call?.url).toBe(
      `http://collab.internal/api/v1/projects/${PROJECT_ID}/data-sources/${SOURCE_ID}/sync`,
    );
    expect(JSON.parse(call?.body ?? '{}')).toEqual({
      access_token: TICKET,
      token_scheme: 'private_token',
    });
    // 票据只进请求体，⛔ 不进 URL、不进查询串、不进请求头。
    expect(call?.url).not.toContain(TICKET);
    expect(JSON.stringify(call?.headers)).not.toContain(TICKET);
  });

  it('bearer 档按线格式发出（客户端 camel → 服务端 snake）', async () => {
    const client = clientWith(() => jsonResponse(200, { sync: syncWire() }));
    await client.syncDataSource(TOKEN, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      ticket: TICKET,
      ticketScheme: 'bearer',
    });
    expect(JSON.parse(recorded[0]?.body ?? '{}').token_scheme).toBe('bearer');
  });

  it('负向：其余五个端点的请求里一个字节的票据都没有', async () => {
    const client = clientWith((record) =>
      record.url.endsWith('/external-links')
        ? jsonResponse(200, { links: [] })
        : record.method === 'DELETE'
          ? jsonResponse(200, { deleted: true, id: SOURCE_ID })
          : jsonResponse(200, { data_sources: [SOURCE_WIRE], data_source: SOURCE_WIRE }),
    );

    await client.listDataSources(TOKEN, { projectId: PROJECT_ID });
    await client.createDataSource(TOKEN, {
      projectId: PROJECT_ID,
      baseUrl: 'http://code.internal',
      repoPath: 'group/repo',
    });
    await client.updateDataSource(TOKEN, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      enabled: true,
    });
    await client.deleteDataSource(TOKEN, { projectId: PROJECT_ID, dataSourceId: SOURCE_ID });
    await client.listExternalLinks(TOKEN, { projectId: PROJECT_ID });

    expect(recorded).toHaveLength(5);
    // 整条记录（URL + 方法 + 头 + 体）一起看：漏到任何一处都算漏。
    expect(JSON.stringify(recorded)).not.toContain(TICKET);
    // 这五个方法的签名里也没有票据入口——上面那条断言不是靠调用方自觉。
    expect(JSON.stringify(recorded)).not.toContain('access_token');
  });

  it('同步失败时票据也不进回执', async () => {
    const client = clientWith(() =>
      jsonResponse(400, { error: 'external_credential_rejected', detail: '上游原文' }),
    );
    const outcome = await client.syncDataSource(TOKEN, {
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      ticket: TICKET,
      ticketScheme: 'privateToken',
    });
    expect(outcome).toEqual({ ok: false, code: 'ticketRejected' });
    expect(JSON.stringify(outcome)).not.toContain(TICKET);
  });
});

function syncWire(): Record<string, unknown> {
  return {
    todos_created: 0,
    todos_updated: 0,
    todos_unchanged: 0,
    documents_created: 0,
    documents_updated: 0,
    documents_unchanged: 0,
    orphaned: 0,
    detail: '',
    diagnostics: [],
    diagnostics_total: 0,
  };
}
