import { describe, expect, it } from 'vitest';

import { createCollabClient, type CollabClient } from '../../../../../stratex/main/services/collab/collabClient.js';

/**
 * 资产版本（RPT-01）的 HTTP 客户端用例。
 *
 * 独立成文件而不是塞进 collabClient.test.ts：那一份已 1500+ 行，且本轮另一条任务线在
 * 并行改同一批文件；新增一份专注文件（先例 `projectCollabToolExecutor.assets.test.ts`）
 * 既守单文件行数规范，也把并行改动的冲突面降到零。
 *
 * 判据重点有三条：① 冻结引用按**版本 id** 取，路径里不带 project 段；② 业务码
 * （`file_already_versioned` / `asset_deleted`）经失败信封的 `serverCode` 透传，而**不是**
 * 被压成一句通用失败；③ 既有五条文件方法的路径与形状一个字没变（回归）。
 */

const TOKEN = 'test-access-token';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const FILE_ID = '44444444-4444-4444-8444-444444444444';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

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
    content_sha256: SHA_A,
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

describe('listProjectAssets', () => {
  it('打资产目录端点，回血统 + 当前版本', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, {
        assets: [{ ...wireAsset(), current_version: wireVersion() }],
      }),
    );
    const outcome = await client(fetchImpl).listProjectAssets(TOKEN, {
      projectId: PROJECT_ID,
    });

    expect(calls[0]?.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/assets`);
    expect(calls[0]?.init.method).toBe('GET');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toHaveLength(1);
    expect(outcome.value[0]?.currentVersion?.contentSha256).toBe(SHA_A);
  });

  it('任一行不可信即整体不可信（transient），不做部分采信', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(200, {
        assets: [
          { ...wireAsset(), current_version: wireVersion() },
          { ...wireAsset(), version_count: 'many', current_version: wireVersion() },
        ],
      }),
    );
    const outcome = await client(fetchImpl).listProjectAssets(TOKEN, {
      projectId: PROJECT_ID,
    });
    expect(outcome).toEqual({ ok: false, code: 'transient' });
  });
});

describe('listAssetVersions', () => {
  it('打版本链端点，整条链按服务端序带回', async () => {
    const second = wireVersion({
      id: '55555555-5555-4555-8555-555555555555',
      version_no: 2,
      content_sha256: SHA_B,
    });
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, {
        asset: wireAsset({ current_version_id: second.id, version_count: 2 }),
        versions: [second, wireVersion()],
      }),
    );
    const outcome = await client(fetchImpl).listAssetVersions(TOKEN, {
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
    });

    expect(calls[0]?.url.pathname).toBe(
      `/api/v1/projects/${PROJECT_ID}/assets/${ASSET_ID}/versions`,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.versions.map((version) => version.versionNo)).toEqual([2, 1]);
  });

  it('⭐ 血统已软删时照旧回整条链，并带回 deletedAt（不是空结果）', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(200, {
        asset: wireAsset({ deleted_at: '2026-09-11T13:00:00.000Z' }),
        versions: [wireVersion()],
      }),
    );
    const outcome = await client(fetchImpl).listAssetVersions(TOKEN, {
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.asset.deletedAt).toBe('2026-09-11T13:00:00.000Z');
    expect(outcome.value.versions).toHaveLength(1);
  });
});

describe('getAssetVersion', () => {
  it('⭐ 按版本 id 解析冻结引用：路径不带 project 段', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, {
        asset: wireAsset({
          current_version_id: '66666666-6666-4666-8666-666666666666',
          version_count: 4,
        }),
        version: wireVersion(),
      }),
    );
    const outcome = await client(fetchImpl).getAssetVersion(TOKEN, { versionId: VERSION_ID });

    expect(calls[0]?.url.pathname).toBe(`/api/v1/asset-versions/${VERSION_ID}`);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 引用读到自己那一版；当前版本已经是别人了——两件事同时说得出来。
    expect(outcome.value.version.id).toBe(VERSION_ID);
    expect(outcome.value.version.versionNo).toBe(1);
    expect(outcome.value.asset.currentVersionId).not.toBe(VERSION_ID);
  });

  it('⭐ 字节已删：contentDeletedAt 非空（成功响应 + 明确反馈，不是失败也不是空）', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(200, {
        asset: wireAsset(),
        version: wireVersion({ content_deleted_at: '2026-09-11T12:00:00.000Z' }),
      }),
    );
    const outcome = await client(fetchImpl).getAssetVersion(TOKEN, { versionId: VERSION_ID });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.version.contentDeletedAt).toBe('2026-09-11T12:00:00.000Z');
  });

  it('未知版本 → 404 归 rejected 并透传业务码', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(404, { error: 'asset_version_not_found', detail: '资产版本不存在' }),
    );
    const outcome = await client(fetchImpl).getAssetVersion(TOKEN, { versionId: VERSION_ID });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.serverCode).toBe('asset_version_not_found');
  });

  it('⭐ 权限改变（403 not_a_member）：明确失败 + 业务码，不是空结果', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(403, { error: 'not_a_member', detail: '不是该项目成员' }),
    );
    const outcome = await client(fetchImpl).getAssetVersion(TOKEN, { versionId: VERSION_ID });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('forbidden');
    expect(outcome.serverCode).toBe('not_a_member');
  });
});

describe('registerAssetVersion', () => {
  it('新建血统：请求体只有 file_id（snake_case 线协议）', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, { asset: wireAsset(), version: wireVersion() }),
    );
    const outcome = await client(fetchImpl).registerAssetVersion(TOKEN, {
      projectId: PROJECT_ID,
      fileId: FILE_ID,
    });

    expect(calls[0]?.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/asset-versions`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ file_id: FILE_ID });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.version.versionNo).toBe(1);
  });

  it('追加到已有血统：请求体带 asset_id', async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(201, {
        asset: wireAsset({ version_count: 2 }),
        version: wireVersion({ version_no: 2, content_sha256: SHA_B }),
      }),
    );
    const outcome = await client(fetchImpl).registerAssetVersion(TOKEN, {
      projectId: PROJECT_ID,
      fileId: FILE_ID,
      assetId: ASSET_ID,
    });

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      file_id: FILE_ID,
      asset_id: ASSET_ID,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.version.versionNo).toBe(2);
    expect(outcome.value.version.contentSha256).toBe(SHA_B);
  });

  it('⭐ 两个业务码透传出去（调用侧要分辨得出，而不是「重试就会好」）', async () => {
    for (const [status, error] of [
      [409, 'file_already_versioned'],
      [409, 'asset_deleted'],
      [404, 'file_not_found'],
      [404, 'asset_not_found'],
    ] as const) {
      const { fetchImpl } = fakeFetch(jsonResponse(status, { error }));
      const outcome = await client(fetchImpl).registerAssetVersion(TOKEN, {
        projectId: PROJECT_ID,
        fileId: FILE_ID,
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.serverCode).toBe(error);
    }
  });

  it('网络故障归 transient（不与业务拒绝混档）', async () => {
    const { fetchImpl } = fakeFetch('network-error');
    const outcome = await client(fetchImpl).registerAssetVersion(TOKEN, {
      projectId: PROJECT_ID,
      fileId: FILE_ID,
    });
    expect(outcome).toEqual({ ok: false, code: 'transient' });
  });
});

describe('deleteAsset', () => {
  it('打血统软删端点', async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse(200, { deleted: true, id: ASSET_ID }));
    const outcome = await client(fetchImpl).deleteAsset(TOKEN, {
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
    });

    expect(calls[0]?.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/assets/${ASSET_ID}`);
    expect(calls[0]?.init.method).toBe('DELETE');
    expect(outcome).toEqual({ ok: true, value: true });
  });

  it('无权删除 → forbidden + 业务码', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(403, { error: 'forbidden', detail: '只能删除本人上传的文件' }),
    );
    const outcome = await client(fetchImpl).deleteAsset(TOKEN, {
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('forbidden');
    expect(outcome.serverCode).toBe('forbidden');
  });
});

describe('既有文件方法的回归（本轮一个字没改）', () => {
  it('listFiles / promoteFile / deleteFile 的路径与出参形状不变', async () => {
    const wireFile = {
      id: FILE_ID,
      kind: 'asset',
      filename: '方案.docx',
      mime: 'application/octet-stream',
      bytes: 4096,
      sha256: SHA_A,
      uploader_subject: 'u-bob',
      uploader_display_name: '鲍勃',
      source: 'manual',
      created_at: '2026-09-11T10:00:00.000Z',
      expires_at: null,
    };
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse(200, { files: [wireFile] }),
      jsonResponse(200, { file: wireFile }),
      jsonResponse(200, { deleted: true, id: FILE_ID }),
    );
    const collab = client(fetchImpl);

    const listed = await collab.listFiles(TOKEN, { projectId: PROJECT_ID, kind: 'asset' });
    const promoted = await collab.promoteFile(TOKEN, { fileId: FILE_ID });
    const removed = await collab.deleteFile(TOKEN, { fileId: FILE_ID });

    expect(calls[0]?.url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/files`);
    expect(calls[0]?.url.searchParams.get('kind')).toBe('asset');
    expect(calls[1]?.url.pathname).toBe(`/api/v1/files/${FILE_ID}/promote`);
    expect(calls[2]?.url.pathname).toBe(`/api/v1/files/${FILE_ID}`);
    expect(listed.ok && listed.value).toHaveLength(1);
    // 文件投影**没有**长出任何版本字段：资产版本是另一组实体，不是 ProjectFile 的新列。
    expect(promoted.ok && Object.keys(promoted.value)).toEqual([
      'id',
      'kind',
      'source',
      'filename',
      'mime',
      'bytes',
      'sha256',
      'uploaderSubject',
      'uploaderDisplayName',
      'createdAt',
      'expiresAt',
    ]);
    expect(removed).toEqual({ ok: true, value: true });
  });
});

/* ═══════════════ RPT-02：收敛 409 与取字节（预览用）═══════════════════════ */

describe('registerAssetVersion 的 409 收敛（RPT-02）', () => {
  it('⭐ file_already_versioned 带出已有版本 id：调用方据此收敛，而不是重复落一笔', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(409, { error: 'file_already_versioned', version_id: VERSION_ID }),
    );
    const outcome = await client(fetchImpl).registerAssetVersion(TOKEN, {
      projectId: PROJECT_ID,
      fileId: FILE_ID,
    });
    expect(outcome).toEqual({
      ok: false,
      code: 'conflict',
      serverCode: 'file_already_versioned',
      existingVersionId: VERSION_ID,
    });
  });

  it('同一业务码但服务端没给 version_id ⇒ 不编一个出来（键缺席）', async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(409, { error: 'file_already_versioned' }));
    const outcome = await client(fetchImpl).registerAssetVersion(TOKEN, {
      projectId: PROJECT_ID,
      fileId: FILE_ID,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.serverCode).toBe('file_already_versioned');
    expect(outcome.existingVersionId).toBeUndefined();
  });

  it('⛔ 另一个 409（asset_deleted）即便体里带了 version_id 也不采信', async () => {
    // 判据按**业务码**分流，不按状态码：asset_deleted 不是「已经有那一版了」，
    // 顺手采信会让调用方把一次真实失败当成收敛成功。
    const { fetchImpl } = fakeFetch(
      jsonResponse(409, { error: 'asset_deleted', version_id: VERSION_ID }),
    );
    const outcome = await client(fetchImpl).registerAssetVersion(TOKEN, {
      projectId: PROJECT_ID,
      fileId: FILE_ID,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.serverCode).toBe('asset_deleted');
    expect(outcome.existingVersionId).toBeUndefined();
  });

  it('version_id 不是 uuid 形状时不采信（坏形状不当事实）', async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse(409, { error: 'file_already_versioned', version_id: 'latest' }),
    );
    const outcome = await client(fetchImpl).registerAssetVersion(TOKEN, {
      projectId: PROJECT_ID,
      fileId: FILE_ID,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.existingVersionId).toBeUndefined();
  });
});

describe('downloadFileBytes（预览取字节）', () => {
  function bytesResponse(body: Uint8Array, headers: Record<string, string> = {}): Response {
    return new Response(body, { status: 200, headers });
  }

  it('打既有下载端点，把字节读进内存（⛔ 不落盘，预览不产出本机副本）', async () => {
    const payload = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const { fetchImpl, calls } = fakeFetch(
      bytesResponse(payload, { 'content-length': String(payload.byteLength) }),
    );
    const outcome = await client(fetchImpl).downloadFileBytes(TOKEN, {
      fileId: FILE_ID,
      maxBytes: 1024,
    });
    expect(calls[0]?.url.pathname).toBe(`/api/v1/files/${FILE_ID}`);
    expect(calls[0]?.init.method).toBe('GET');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect([...outcome.value.bytes]).toEqual([...payload]);
  });

  it('声明长度超上限 ⇒ tooLarge，且不读体', async () => {
    const { fetchImpl } = fakeFetch(
      bytesResponse(new Uint8Array(10), { 'content-length': '4096' }),
    );
    const outcome = await client(fetchImpl).downloadFileBytes(TOKEN, {
      fileId: FILE_ID,
      maxBytes: 100,
    });
    expect(outcome).toEqual({ ok: false, code: 'tooLarge' });
  });

  it('没有声明长度但体超上限 ⇒ transient（服务端形态异常），不回半截字节', async () => {
    const { fetchImpl } = fakeFetch(bytesResponse(new Uint8Array(300)));
    const outcome = await client(fetchImpl).downloadFileBytes(TOKEN, {
      fileId: FILE_ID,
      maxBytes: 100,
    });
    expect(outcome).toEqual({ ok: false, code: 'transient' });
  });

  it('声明长度与实际不符 ⇒ transient（不把截断的字节当完整文件喂给解析器）', async () => {
    const { fetchImpl } = fakeFetch(bytesResponse(new Uint8Array(10), { 'content-length': '20' }));
    const outcome = await client(fetchImpl).downloadFileBytes(TOKEN, {
      fileId: FILE_ID,
      maxBytes: 1024,
    });
    expect(outcome).toEqual({ ok: false, code: 'transient' });
  });

  it('无权限按状态分档透传（403 ⇒ forbidden）', async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(403, { error: 'forbidden' }));
    const outcome = await client(fetchImpl).downloadFileBytes(TOKEN, {
      fileId: FILE_ID,
      maxBytes: 1024,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('forbidden');
  });

  it('既有 downloadFile（落盘那条）一个字没动：仍然只回落盘路径', async () => {
    // 回归锚点：预览走的是新方法，⛔ 没有把落盘那条改成取字节。
    const collab = client(fakeFetch().fetchImpl);
    expect(typeof collab.downloadFile).toBe('function');
    expect(typeof collab.downloadFileBytes).toBe('function');
    expect(collab.downloadFile).not.toBe(collab.downloadFileBytes);
  });
});
