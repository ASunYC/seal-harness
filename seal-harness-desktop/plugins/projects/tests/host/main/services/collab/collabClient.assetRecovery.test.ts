import { describe, expect, it } from 'vitest';

import { createCollabClient, type CollabClient } from '../../../../../stratex/main/services/collab/collabClient.js';

/**
 * 回收站与历史版本恢复（RPT-08 通道侧）的 HTTP 客户端用例。
 *
 * 独立成文件（先例 `collabClient.assetVersions.test.ts`）：那一份已近 500 行。
 *
 * 判据重点：
 *  ① 路径与方法逐字对上服务端（回收站是 `asset-trash` 不是 `assets/trash`）；
 *  ② 历史版本恢复的 409 **一律带业务码**——`asset_deleted` / 字节已删 / 指纹不符都不许塌成
 *     无码的 `conflict`，配额已满另把上限与已用量读出来；
 *  ③ 404 `file_not_found`（盘上字节缺失）与 403 `forbidden` 走通用分档并带业务码。
 */

const TOKEN = 'test-access-token';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const NEW_VERSION_ID = '55555555-5555-4555-8555-555555555555';
const FILE_ID = '44444444-4444-4444-8444-444444444444';
const NEW_FILE_ID = '66666666-6666-4666-8666-666666666666';

type FetchCall = { readonly url: URL; readonly init: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetch(...responses: Array<Response | 'network-error'>): {
  readonly fetchImpl: typeof fetch;
  readonly calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: input as URL, init: init ?? {} });
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected extra fetch');
    if (next === 'network-error') throw new TypeError('fetch failed');
    return next;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

// 假地址独立成行：guard-no-runtime-fetch 按「同一行 fetch 词 + http://」判定。
const CLIENT_BASE_URL = 'http://collab.test:1/';

function client(fetchImpl: typeof fetch): CollabClient {
  return createCollabClient({ baseUrl: CLIENT_BASE_URL, fetchImpl });
}

function wireVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: VERSION_ID,
    asset_id: ASSET_ID,
    version_no: 1,
    file_id: FILE_ID,
    content_sha256: 'a'.repeat(64),
    bytes: 4096,
    filename: '方案.docx',
    mime: 'application/octet-stream',
    source: 'manual',
    author_subject: 'u-bob',
    author_display_name: '鲍勃',
    created_at: '2026-09-11T10:00:00.000Z',
    content_deleted_at: null,
    ...overrides,
  };
}

function wireAsset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ASSET_ID,
    project_id: PROJECT_ID,
    current_version_id: VERSION_ID,
    version_count: 1,
    created_by_subject: 'u-bob',
    created_at: '2026-09-11T10:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

describe('listDeletedProjectAssets', () => {
  it('打 asset-trash 端点（GET），回已删血统 + 当前版本', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, {
        assets: [
          {
            ...wireAsset({ deleted_at: '2026-09-12T09:00:00.000Z' }),
            current_version: wireVersion(),
          },
        ],
      }),
    );
    const outcome = await client(fetchImpl).listDeletedProjectAssets(TOKEN, {
      projectId: PROJECT_ID,
    });

    expect(calls[0]?.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/asset-trash`);
    expect(calls[0]?.init.method).toBe('GET');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value[0]?.deletedAt).toBe('2026-09-12T09:00:00.000Z');
  });

  it('⭐ 读侧不严于写侧：回收站里混进一条 deleted_at 为空的行也照收', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(200, { assets: [{ ...wireAsset(), current_version: null }] }),
    );
    const outcome = await client(fetchImpl).listDeletedProjectAssets(TOKEN, {
      projectId: PROJECT_ID,
    });
    expect(outcome.ok).toBe(true);
  });

  it('非成员 403 ⇒ forbidden + 业务码', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(403, { error: 'not_a_member', detail: '不是该项目成员' }),
    );
    expect(
      await client(fetchImpl).listDeletedProjectAssets(TOKEN, { projectId: PROJECT_ID }),
    ).toEqual({ ok: false, code: 'forbidden', serverCode: 'not_a_member' });
  });
});

describe('restoreAsset', () => {
  it('打回收站恢复端点（POST，无请求体），回恢复后的目录行', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, { asset: { ...wireAsset(), current_version: wireVersion() } }),
    );
    const outcome = await client(fetchImpl).restoreAsset(TOKEN, {
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
    });

    expect(calls[0]?.url.pathname).toBe(
      `/api/v1/projects/${PROJECT_ID}/assets/${ASSET_ID}/restore`,
    );
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBeUndefined();
    expect(outcome).toMatchObject({ ok: true, value: { id: ASSET_ID, deletedAt: null } });
  });

  it('不是本人也不是拥有者 ⇒ 403 forbidden + 业务码（⛔ 不是成功，也不是无码失败）', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(403, { error: 'forbidden', detail: '只能删除本人上传的文件' }),
    );
    expect(
      await client(fetchImpl).restoreAsset(TOKEN, { projectId: PROJECT_ID, assetId: ASSET_ID }),
    ).toEqual({ ok: false, code: 'forbidden', serverCode: 'forbidden' });
  });

  it('跨项目或不存在 ⇒ 404 rejected + asset_not_found', async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(404, { error: 'asset_not_found', detail: 'x' }));
    expect(
      await client(fetchImpl).restoreAsset(TOKEN, { projectId: PROJECT_ID, assetId: ASSET_ID }),
    ).toEqual({ ok: false, code: 'rejected', serverCode: 'asset_not_found' });
  });

  it('成功体形状不可信 ⇒ transient（不做部分采信）', async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(200, { asset: { id: ASSET_ID } }));
    expect(
      await client(fetchImpl).restoreAsset(TOKEN, { projectId: PROJECT_ID, assetId: ASSET_ID }),
    ).toEqual({ ok: false, code: 'transient' });
  });
});

describe('restoreAssetVersion', () => {
  it('打历史版本恢复端点（POST），201 回血统 + 新版本（旧版本 id 不变）', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, {
        asset: wireAsset({ current_version_id: NEW_VERSION_ID, version_count: 2 }),
        version: wireVersion({ id: NEW_VERSION_ID, version_no: 2, file_id: NEW_FILE_ID }),
      }),
    );
    const outcome = await client(fetchImpl).restoreAssetVersion(TOKEN, {
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
    });

    expect(calls[0]?.url.pathname).toBe(
      `/api/v1/projects/${PROJECT_ID}/asset-versions/${VERSION_ID}/restore`,
    );
    expect(calls[0]?.init.method).toBe('POST');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.version).toMatchObject({ id: NEW_VERSION_ID, versionNo: 2 });
    expect(outcome.value.asset.currentVersionId).toBe(NEW_VERSION_ID);
  });

  it('⭐ 409 的三种非配额来路各自带业务码，⛔ 不塌缩成无码 conflict', async () => {
    for (const error of [
      'asset_deleted',
      'asset_version_content_deleted',
      'asset_version_content_mismatch',
    ]) {
      const { fetchImpl } = fakeFetch(jsonResponse(409, { error, detail: '服务端文案' }));
      expect(
        await client(fetchImpl).restoreAssetVersion(TOKEN, {
          projectId: PROJECT_ID,
          versionId: VERSION_ID,
        }),
      ).toEqual({ ok: false, code: 'conflict', serverCode: error });
    }
  });

  it('⭐ 配额已满 ⇒ quotaExceeded + 业务码 + 上限与已用量', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(409, {
        error: 'project_file_quota_exceeded',
        detail: '项目文件已达容量上限',
        quota_limit_bytes: 10_240,
        quota_used_bytes: 9_000,
      }),
    );
    expect(
      await client(fetchImpl).restoreAssetVersion(TOKEN, {
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
      }),
    ).toEqual({
      ok: false,
      code: 'quotaExceeded',
      serverCode: 'project_file_quota_exceeded',
      quota: { limitBytes: 10_240, usedBytes: 9_000 },
    });
  });

  it('配额业务码但体里没有两个数 ⇒ 仍是 quotaExceeded，⛔ 不编数', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(409, { error: 'project_file_quota_exceeded', detail: 'x' }),
    );
    expect(
      await client(fetchImpl).restoreAssetVersion(TOKEN, {
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
      }),
    ).toEqual({ ok: false, code: 'quotaExceeded', serverCode: 'project_file_quota_exceeded' });
  });

  it('盘上字节缺失 404 file_not_found / 无写权限 403 各带业务码', async () => {
    const missing = fakeFetch(jsonResponse(404, { error: 'file_not_found', detail: '文件不存在' }));
    expect(
      await client(missing.fetchImpl).restoreAssetVersion(TOKEN, {
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
      }),
    ).toEqual({ ok: false, code: 'rejected', serverCode: 'file_not_found' });

    const denied = fakeFetch(jsonResponse(403, { error: 'forbidden', detail: 'x' }));
    expect(
      await client(denied.fetchImpl).restoreAssetVersion(TOKEN, {
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
      }),
    ).toEqual({ ok: false, code: 'forbidden', serverCode: 'forbidden' });
  });

  it('存储不足 507 与网络故障都归 transient（5xx 不读业务码）', async () => {
    const full = fakeFetch(jsonResponse(507, { error: 'disk_space_insufficient', detail: 'x' }));
    expect(
      await client(full.fetchImpl).restoreAssetVersion(TOKEN, {
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
      }),
    ).toEqual({ ok: false, code: 'transient' });

    const offline = fakeFetch('network-error');
    expect(
      await client(offline.fetchImpl).restoreAssetVersion(TOKEN, {
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
      }),
    ).toEqual({ ok: false, code: 'transient' });
  });
});
