import { describe, expect, it, vi } from 'vitest';

import { IPC } from '../../../../stratex/shared/ipc/channels.js';
import {
  PROJECT_COLLAB_REFERENCE_CODES,
  type ProjectFileUploadProgress,
} from '../../../../stratex/shared/protocol/project-collab.js';
import {
  ProjectAssetVersionPreviewResultSchema,
  ProjectAssetVersionRestoreResultSchema,
  ProjectAssetVersionUploadResultSchema,
} from '../../../../stratex/shared/protocol/project-collab-assets.js';
import {
  registerProjectAssetHandlers,
  type ProjectAssetClientPort,
  type ProjectAssetIpcDependencies,
} from '../../../../stratex/main/ipc/projectCollabHandlersAssets.js';

/**
 * 资产版本域十三条通道的判据。
 *
 * 五条重点：① 十三条都挂上且都在访问策略里（只挂通道不加策略会被
 * `accessPolicy.test.ts` 的全等断言拦下，这里再从正面钉一遍）；② 失败体的文案与参考
 * 编号只从**本层那张表**取，⛔ 服务端文本一个字不回显（D7.17）；③ 登记撞
 * `file_already_versioned` 时收敛成成功而不是重复落一笔；④ await 期间换账号一律
 * `authRequired`；⑤ 两条恢复（RPT-08）透传业务码——`asset_deleted` / 指纹不符 / 字节缺失 /
 * 配额已满不塌缩成一句通用失败。
 */

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const FILE_ID = '44444444-4444-4444-8444-444444444444';
const OPERATION_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_VERSION_ID = '66666666-6666-4666-8666-666666666666';

const asset = {
  id: ASSET_ID,
  projectId: PROJECT_ID,
  currentVersionId: VERSION_ID,
  versionCount: 1,
  createdBySubject: 'user-alice',
  createdAt: '2026-09-12T08:00:00.000Z',
  deletedAt: null,
} as const;

const version = {
  id: VERSION_ID,
  assetId: ASSET_ID,
  versionNo: 1,
  fileId: FILE_ID,
  contentSha256: 'a'.repeat(64),
  bytes: 2048,
  filename: '项目协作周报.pptx',
  mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  source: 'manual' as const,
  authorSubject: 'user-alice',
  authorDisplayName: '张三',
  createdAt: '2026-09-12T08:00:00.000Z',
  contentDeletedAt: null,
} as const;

const projectFile = {
  id: FILE_ID,
  kind: 'asset' as const,
  source: 'manual' as const,
  filename: '项目协作周报.pptx',
  mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  bytes: 2048,
  sha256: 'a'.repeat(64),
  uploaderSubject: 'user-alice',
  uploaderDisplayName: '张三',
  createdAt: '2026-09-12T08:00:00.000Z',
  expiresAt: null,
} as const;

type Handler = (event: unknown, input: unknown) => Promise<unknown>;

function fakeClient(overrides: Partial<ProjectAssetClientPort> = {}): ProjectAssetClientPort {
  const base = {
    listProjectAssets: vi.fn(async () => ({
      ok: true as const,
      value: [{ ...asset, currentVersion: version }],
    })),
    listAssetVersions: vi.fn(async () => ({
      ok: true as const,
      value: { asset, versions: [version] },
    })),
    getAssetVersion: vi.fn(async () => ({ ok: true as const, value: { asset, version } })),
    registerAssetVersion: vi.fn(async () => ({ ok: true as const, value: { asset, version } })),
    deleteAsset: vi.fn(async () => ({ ok: true as const, value: true as const })),
    uploadFile: vi.fn(async () => ({ ok: true as const, value: projectFile })),
    downloadFileBytes: vi.fn(async () => ({
      ok: true as const,
      value: { bytes: new Uint8Array([0x50, 0x4b, 3, 4]) },
    })),
    listDeletedProjectAssets: vi.fn(async () => ({
      ok: true as const,
      value: [{ ...asset, deletedAt: '2026-09-12T09:00:00.000Z', currentVersion: version }],
    })),
    restoreAsset: vi.fn(async () => ({
      ok: true as const,
      value: { ...asset, currentVersion: version },
    })),
    restoreAssetVersion: vi.fn(async () => ({
      ok: true as const,
      value: {
        asset: { ...asset, currentVersionId: OTHER_VERSION_ID, versionCount: 2 },
        version: { ...version, id: OTHER_VERSION_ID, versionNo: 2 },
      },
    })),
  } as unknown as ProjectAssetClientPort;
  return { ...base, ...overrides };
}

interface HarnessOptions {
  readonly client?: ProjectAssetClientPort;
  readonly dependencies?: ProjectAssetIpcDependencies | null;
  readonly authorize?: (event: unknown) => boolean;
  readonly activeAccount?: () => { accountKey: string; authEpoch: number } | null;
  readonly accessToken?: () => Promise<string | null>;
  readonly pickUploadFile?: () => Promise<string | null>;
}

function harness(options: HarnessOptions = {}): {
  readonly handlers: Map<string, Handler>;
  readonly client: ProjectAssetClientPort;
  readonly progress: ProjectFileUploadProgress[];
} {
  const handlers = new Map<string, Handler>();
  const client = options.client ?? fakeClient();
  const progress: ProjectFileUploadProgress[] = [];
  const deps: ProjectAssetIpcDependencies = {
    client,
    accessToken: options.accessToken ?? (async () => 'token'),
    pickUploadFile: options.pickUploadFile ?? (async () => 'C:\\input\\周报.pptx'),
  };
  registerProjectAssetHandlers(
    { handle: (channel, listener) => handlers.set(channel, listener) },
    {
      dependencies: options.dependencies === undefined ? deps : options.dependencies,
      authorize: options.authorize ?? (() => true),
      activeAccount: options.activeAccount ?? (() => ({ accountKey: 'acc-1', authEpoch: 1 })),
      sendProgress: (_event, snapshot) => progress.push(snapshot),
    },
  );
  return { handlers, client, progress };
}

function handlerOf(handlers: Map<string, Handler>, channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`handler missing for ${channel}`);
  return handler;
}

const ASSET_CHANNELS = [
  IPC.PROJECT_ASSET_LIST,
  IPC.PROJECT_ASSET_VERSION_LIST,
  IPC.PROJECT_ASSET_VERSION_RESOLVE,
  IPC.PROJECT_ASSET_VERSION_REGISTER,
  IPC.PROJECT_ASSET_DELETE,
  IPC.PROJECT_ASSET_VERSION_UPLOAD,
  IPC.PROJECT_ASSET_VERSION_UPLOAD_CANCEL,
  IPC.PROJECT_ASSET_VERSION_UPLOAD_RESUME,
  IPC.PROJECT_ASSET_VERSION_UPLOAD_DISCARD,
  IPC.PROJECT_ASSET_VERSION_PREVIEW,
  IPC.PROJECT_ASSET_TRASH_LIST,
  IPC.PROJECT_ASSET_RESTORE,
  IPC.PROJECT_ASSET_VERSION_RESTORE,
] as const;

describe('注册面', () => {
  it('资产通道完整注册', () => {
    const { handlers } = harness();
    expect(handlers.size).toBe(ASSET_CHANNELS.length);
    for (const channel of ASSET_CHANNELS) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  it('进度不是可 invoke 的请求通道（只由主进程推送）', () => {
    const { handlers } = harness();
    expect(handlers.has(IPC.PROJECT_FILE_UPLOAD_PROGRESS)).toBe(false);
  });
});

describe('三道闸：未授权 / 未装配 / 坏入参', () => {
  it('未授权或无在场账号 ⇒ authRequired（不触网）', async () => {
    const { handlers, client } = harness({ authorize: () => false });
    for (const channel of ASSET_CHANNELS) {
      const result = (await handlerOf(handlers, channel)({}, {})) as Record<string, unknown>;
      expect(result.ok).toBe(false);
      expect(result.code).toBe('authRequired');
      expect(result.referenceCode).toBe(PROJECT_COLLAB_REFERENCE_CODES.authRequired);
    }
    expect(client.listProjectAssets).not.toHaveBeenCalled();
  });

  it('未装配 ⇒ unavailable（fail-safe，不报错不泄露）', async () => {
    const { handlers } = harness({ dependencies: null });
    for (const channel of ASSET_CHANNELS) {
      const result = (await handlerOf(handlers, channel)({}, {})) as Record<string, unknown>;
      expect(result).toMatchObject({ ok: false, code: 'unavailable' });
    }
  });

  it('入参不合 strictObject ⇒ invalidRequest（不触网）', async () => {
    const { handlers, client } = harness();
    const bad: ReadonlyArray<readonly [string, unknown]> = [
      [IPC.PROJECT_ASSET_LIST, { projectId: 'not-a-uuid' }],
      [IPC.PROJECT_ASSET_VERSION_LIST, { projectId: PROJECT_ID }],
      [IPC.PROJECT_ASSET_VERSION_RESOLVE, { versionId: VERSION_ID, fallbackToCurrent: true }],
      [IPC.PROJECT_ASSET_VERSION_REGISTER, { projectId: PROJECT_ID }],
      [IPC.PROJECT_ASSET_DELETE, { assetId: ASSET_ID }],
      [IPC.PROJECT_ASSET_VERSION_UPLOAD, { projectId: PROJECT_ID, filePath: 'C:/a.docx' }],
      [IPC.PROJECT_ASSET_VERSION_PREVIEW, { versionId: VERSION_ID, page: 0 }],
      [IPC.PROJECT_ASSET_TRASH_LIST, { projectId: PROJECT_ID, accountKey: 'leak' }],
      [IPC.PROJECT_ASSET_RESTORE, { assetId: ASSET_ID }],
      [IPC.PROJECT_ASSET_VERSION_RESTORE, { projectId: PROJECT_ID, versionId: 'not-a-uuid' }],
    ];
    for (const [channel, input] of bad) {
      const result = (await handlerOf(handlers, channel)({}, input)) as Record<string, unknown>;
      expect(result).toMatchObject({ ok: false, code: 'invalidRequest' });
    }
    expect(client.listProjectAssets).not.toHaveBeenCalled();
    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(client.listDeletedProjectAssets).not.toHaveBeenCalled();
    expect(client.restoreAsset).not.toHaveBeenCalled();
    expect(client.restoreAssetVersion).not.toHaveBeenCalled();
  });

  it('取不到令牌 ⇒ credentialRejected', async () => {
    const { handlers } = harness({ accessToken: async () => null });
    const result = (await handlerOf(handlers, IPC.PROJECT_ASSET_LIST)(
      {},
      { projectId: PROJECT_ID },
    )) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: false, code: 'credentialRejected' });
  });
});

describe('读路径', () => {
  it('目录：整页带回，每条含当前版本', async () => {
    const { handlers } = harness();
    const result = (await handlerOf(handlers, IPC.PROJECT_ASSET_LIST)(
      {},
      { projectId: PROJECT_ID },
    )) as { ok: boolean; assets: unknown[] };
    expect(result.ok).toBe(true);
    expect(result.assets).toHaveLength(1);
  });

  it('版本链：服务端序原样带回（客户端不重排）', async () => {
    const second = { ...version, id: OTHER_VERSION_ID, versionNo: 2 };
    const { handlers } = harness({
      client: fakeClient({
        listAssetVersions: vi.fn(async () => ({
          ok: true as const,
          value: { asset, versions: [second, version] },
        })),
      } as Partial<ProjectAssetClientPort>),
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_LIST)(
      {},
      { projectId: PROJECT_ID, assetId: ASSET_ID },
    )) as { ok: boolean; versions: Array<{ id: string }> };
    expect(result.versions.map((item) => item.id)).toEqual([OTHER_VERSION_ID, VERSION_ID]);
  });

  it('冻结引用：按版本 id 解析，服务端 404 ⇒ rejected + 固定文案（⛔ 不回落当前版本）', async () => {
    const { handlers, client } = harness({
      client: fakeClient({
        getAssetVersion: vi.fn(async () => ({
          ok: false as const,
          code: 'rejected' as const,
          serverCode: 'asset_version_not_found',
        })),
      } as Partial<ProjectAssetClientPort>),
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_RESOLVE)(
      {},
      { versionId: VERSION_ID },
    )) as Record<string, unknown>;
    expect(result).toEqual({
      ok: false,
      code: 'rejected',
      message: '请求被服务端拒绝。',
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.rejected,
    });
    expect(client.listAssetVersions).not.toHaveBeenCalled();
  });
});

describe('登记与删除', () => {
  it('登记成功 ⇒ reused:false', async () => {
    const { handlers } = harness();
    const result = (await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_REGISTER)(
      {},
      { projectId: PROJECT_ID, fileId: FILE_ID },
    )) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: true, reused: false });
  });

  it('⭐ 撞 file_already_versioned ⇒ 读回那一版判成成功（reused:true），⛔ 不重复落一笔', async () => {
    const resolved = { ...version, id: OTHER_VERSION_ID, versionNo: 2 };
    const { handlers, client } = harness({
      client: fakeClient({
        registerAssetVersion: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'file_already_versioned',
          existingVersionId: OTHER_VERSION_ID,
        })),
        getAssetVersion: vi.fn(async () => ({
          ok: true as const,
          value: { asset, version: resolved },
        })),
      } as Partial<ProjectAssetClientPort>),
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_REGISTER)(
      {},
      { projectId: PROJECT_ID, fileId: FILE_ID },
    )) as { ok: boolean; reused: boolean; version: { id: string } };
    expect(result).toMatchObject({ ok: true, reused: true });
    expect(result.version.id).toBe(OTHER_VERSION_ID);
    expect(client.getAssetVersion).toHaveBeenCalledTimes(1);
  });

  it('另一个 409（asset_deleted）透传业务码，⛔ 不当成收敛成功', async () => {
    const { handlers } = harness({
      client: fakeClient({
        registerAssetVersion: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'asset_deleted',
        })),
      } as Partial<ProjectAssetClientPort>),
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_REGISTER)(
      {},
      { projectId: PROJECT_ID, fileId: FILE_ID, assetId: ASSET_ID },
    )) as Record<string, unknown>;
    expect(result).toMatchObject({
      ok: false,
      code: 'conflict',
      serverCode: 'asset_deleted',
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.conflict,
    });
  });

  it('删除幂等回 id；无权限 403 ⇒ forbidden + 固定文案', async () => {
    const ok = harness();
    expect(
      await handlerOf(ok.handlers, IPC.PROJECT_ASSET_DELETE)(
        {},
        { projectId: PROJECT_ID, assetId: ASSET_ID },
      ),
    ).toEqual({ ok: true, id: ASSET_ID });

    const denied = harness({
      client: fakeClient({
        deleteAsset: vi.fn(async () => ({ ok: false as const, code: 'forbidden' as const })),
      } as Partial<ProjectAssetClientPort>),
    });
    expect(
      await handlerOf(denied.handlers, IPC.PROJECT_ASSET_DELETE)(
        {},
        { projectId: PROJECT_ID, assetId: ASSET_ID },
      ),
    ).toEqual({
      ok: false,
      code: 'forbidden',
      message: '没有执行该操作的权限。',
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.forbidden,
    });
  });
});

describe('上传 / 取消 / 续传 / 放弃', () => {
  it('上传走完两段，并把进度帧推给发起窗口（相位含 completed）', async () => {
    const { handlers, progress } = harness();
    const result = await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD)(
      {},
      { projectId: PROJECT_ID, operationId: OPERATION_ID },
    );
    expect(ProjectAssetVersionUploadResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ ok: true, reused: false });
    expect(progress.map((frame) => frame.phase)).toContain('completed');
    expect(progress.every((frame) => frame.operationId === OPERATION_ID)).toBe(true);
  });

  it('用户在选择框里取消 ⇒ {ok:true, cancelled:true}，一帧进度都不发', async () => {
    const { handlers, progress } = harness({ pickUploadFile: async () => null });
    expect(
      await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD)(
        {},
        { projectId: PROJECT_ID, operationId: OPERATION_ID },
      ),
    ).toEqual({ ok: true, cancelled: true });
    expect(progress).toEqual([]);
  });

  it('⭐ 失败体同时给 quota 与 resume 两个键（配额触顶时两个数原样带回）', async () => {
    const quota = { limitBytes: 1024, usedBytes: 1024 };
    const { handlers } = harness({
      client: fakeClient({
        uploadFile: vi.fn(async () => ({
          ok: false as const,
          code: 'quotaExceeded' as const,
          quota,
        })),
      } as Partial<ProjectAssetClientPort>),
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD)(
      {},
      { projectId: PROJECT_ID, operationId: OPERATION_ID },
    )) as Record<string, unknown>;
    expect(ProjectAssetVersionUploadResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      code: 'quotaExceeded',
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.quotaExceeded,
      quota,
      resume: { operationId: OPERATION_ID, stage: 'upload' },
    });
  });

  it('⭐ 第二段失败后续传只补登记：上传端点一次都不再调（不重复计费）', async () => {
    const registerAssetVersion = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, code: 'transient' as const })
      .mockResolvedValueOnce({ ok: true as const, value: { asset, version } });
    const client = fakeClient({ registerAssetVersion } as Partial<ProjectAssetClientPort>);
    const { handlers } = harness({ client });

    const failed = (await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD)(
      {},
      { projectId: PROJECT_ID, operationId: OPERATION_ID },
    )) as Record<string, unknown>;
    expect(failed).toMatchObject({ ok: false, resume: { stage: 'register' } });

    const resumed = await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD_RESUME)(
      {},
      { operationId: OPERATION_ID },
    );
    expect(resumed).toMatchObject({ ok: true, reused: false });
    expect(client.uploadFile).toHaveBeenCalledTimes(1);
    expect(registerAssetVersion).toHaveBeenCalledTimes(2);
  });

  it('取消与放弃都幂等回成功（没有可撤的东西不算错误）', async () => {
    const { handlers } = harness();
    expect(
      await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD_CANCEL)(
        {},
        { operationId: OPERATION_ID },
      ),
    ).toEqual({ ok: true });
    expect(
      await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD_DISCARD)(
        {},
        { operationId: OPERATION_ID },
      ),
    ).toEqual({ ok: true });
  });

  it('续传一个不存在的操作号 ⇒ invalidRequest（不泄露「那是别人的」）', async () => {
    const { handlers } = harness();
    expect(
      await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD_RESUME)(
        {},
        { operationId: OPERATION_ID },
      ),
    ).toMatchObject({ ok: false, code: 'invalidRequest', resume: null });
  });
});

describe('预览', () => {
  it('文本层预览：走真实解析栈（假 pptx 字节 ⇒ 明说理由的降级，不是空白）', async () => {
    const { handlers } = harness();
    const result = (await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_PREVIEW)(
      {},
      { versionId: VERSION_ID },
    )) as { ok: boolean; preview: { kind: string; reason?: string } };
    expect(ProjectAssetVersionPreviewResultSchema.safeParse(result).success).toBe(true);
    expect(result.ok).toBe(true);
    // 夹具的 4 字节 PK 头不是合法 pptx 包 ⇒ 解析失败，但**有理由**。
    expect(result.preview.kind).toBe('fallback');
    expect(typeof result.preview.reason).toBe('string');
  });

  it('字节已删 ⇒ contentDeleted 降级，且不取字节', async () => {
    const { handlers, client } = harness({
      client: fakeClient({
        getAssetVersion: vi.fn(async () => ({
          ok: true as const,
          value: {
            asset,
            version: { ...version, contentDeletedAt: '2026-09-12T09:00:00.000Z' },
          },
        })),
      } as Partial<ProjectAssetClientPort>),
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_PREVIEW)(
      {},
      { versionId: VERSION_ID },
    )) as { ok: boolean; preview: unknown };
    expect(result.preview).toEqual({ kind: 'fallback', reason: 'contentDeleted' });
    expect(client.downloadFileBytes).not.toHaveBeenCalled();
  });

  it('取字节 403 ⇒ forbidden + 固定文案（不是降级）', async () => {
    const { handlers } = harness({
      client: fakeClient({
        downloadFileBytes: vi.fn(async () => ({ ok: false as const, code: 'forbidden' as const })),
      } as Partial<ProjectAssetClientPort>),
    });
    expect(
      await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_PREVIEW)({}, { versionId: VERSION_ID }),
    ).toEqual({
      ok: false,
      code: 'forbidden',
      message: '没有执行该操作的权限。',
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.forbidden,
    });
  });
});

describe('回收站与历史版本恢复（RPT-08）', () => {
  it('回收站：整页带回（服务端序），入参只有项目 id', async () => {
    const { handlers, client } = harness();
    const result = (await handlerOf(handlers, IPC.PROJECT_ASSET_TRASH_LIST)(
      {},
      { projectId: PROJECT_ID },
    )) as { ok: boolean; assets: Array<{ deletedAt: string | null }> };
    expect(result.ok).toBe(true);
    expect(result.assets[0]?.deletedAt).toBe('2026-09-12T09:00:00.000Z');
    expect(client.listDeletedProjectAssets).toHaveBeenCalledWith('token', {
      projectId: PROJECT_ID,
    });
  });

  it('回收站恢复成功 ⇒ 回恢复后的目录行', async () => {
    const { handlers } = harness();
    expect(
      await handlerOf(handlers, IPC.PROJECT_ASSET_RESTORE)(
        {},
        { projectId: PROJECT_ID, assetId: ASSET_ID },
      ),
    ).toMatchObject({ ok: true, asset: { id: ASSET_ID, deletedAt: null } });
  });

  it('⭐ 回收站恢复 403 / 404 透传业务码 + 固定文案 + 参考编号（不假成功、不塌缩）', async () => {
    const cases = [
      { code: 'forbidden' as const, serverCode: 'forbidden' },
      { code: 'rejected' as const, serverCode: 'asset_not_found' },
    ];
    for (const failure of cases) {
      const { handlers } = harness({
        client: fakeClient({
          restoreAsset: vi.fn(async () => ({ ok: false as const, ...failure })),
        } as Partial<ProjectAssetClientPort>),
      });
      expect(
        await handlerOf(handlers, IPC.PROJECT_ASSET_RESTORE)(
          {},
          { projectId: PROJECT_ID, assetId: ASSET_ID },
        ),
      ).toEqual({
        ok: false,
        code: failure.code,
        message: failure.code === 'forbidden' ? '没有执行该操作的权限。' : '请求被服务端拒绝。',
        referenceCode: PROJECT_COLLAB_REFERENCE_CODES[failure.code],
        serverCode: failure.serverCode,
      });
    }
  });

  it('历史版本恢复成功 ⇒ 血统（指针已挪到新版）+ 新版本', async () => {
    const { handlers, client } = harness();
    const result = await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_RESTORE)(
      {},
      { projectId: PROJECT_ID, versionId: VERSION_ID },
    );
    expect(ProjectAssetVersionRestoreResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      asset: { currentVersionId: OTHER_VERSION_ID },
      version: { id: OTHER_VERSION_ID, versionNo: 2 },
    });
    expect(client.restoreAssetVersion).toHaveBeenCalledWith('token', {
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
    });
  });

  it('⭐ 409 asset_deleted 透传业务码，⛔ 不吞成通用失败（失败体恒带 quota 键）', async () => {
    const { handlers } = harness({
      client: fakeClient({
        restoreAssetVersion: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'asset_deleted',
        })),
      } as Partial<ProjectAssetClientPort>),
    });
    expect(
      await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_RESTORE)(
        {},
        { projectId: PROJECT_ID, versionId: VERSION_ID },
      ),
    ).toEqual({
      ok: false,
      code: 'conflict',
      message: '资产版本已被他人更新，请刷新后重试。',
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.conflict,
      serverCode: 'asset_deleted',
      quota: null,
    });
  });

  it('配额已满：上限与已用量原样带回；字节缺失与指纹不符各带自己的业务码', async () => {
    const quota = { limitBytes: 4096, usedBytes: 4000 };
    const cases = [
      {
        outcome: {
          ok: false as const,
          code: 'quotaExceeded' as const,
          serverCode: 'project_file_quota_exceeded',
          quota,
        },
        expected: { code: 'quotaExceeded', serverCode: 'project_file_quota_exceeded', quota },
      },
      {
        outcome: { ok: false as const, code: 'rejected' as const, serverCode: 'file_not_found' },
        expected: { code: 'rejected', serverCode: 'file_not_found', quota: null },
      },
      {
        outcome: {
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'asset_version_content_mismatch',
        },
        expected: { code: 'conflict', serverCode: 'asset_version_content_mismatch', quota: null },
      },
    ];
    for (const { outcome, expected } of cases) {
      const { handlers } = harness({
        client: fakeClient({
          restoreAssetVersion: vi.fn(async () => outcome),
        } as Partial<ProjectAssetClientPort>),
      });
      const result = await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_RESTORE)(
        {},
        { projectId: PROJECT_ID, versionId: VERSION_ID },
      );
      expect(ProjectAssetVersionRestoreResultSchema.safeParse(result).success).toBe(true);
      expect(result).toMatchObject({ ok: false, ...expected });
    }
  });

  it('await 期间换账号 ⇒ authRequired（不把上个账号的恢复结果发给下个账号）', async () => {
    let epoch = 1;
    const { handlers } = harness({
      activeAccount: () => ({ accountKey: 'acc-1', authEpoch: epoch }),
      client: fakeClient({
        restoreAssetVersion: vi.fn(async () => {
          epoch = 2;
          return {
            ok: true as const,
            value: { asset, version: { ...version, id: OTHER_VERSION_ID, versionNo: 2 } },
          };
        }),
      } as Partial<ProjectAssetClientPort>),
    });
    expect(
      await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_RESTORE)(
        {},
        { projectId: PROJECT_ID, versionId: VERSION_ID },
      ),
    ).toMatchObject({ ok: false, code: 'authRequired', quota: null });
  });
});

describe('换账号与服务端文本', () => {
  it('原窗口撤权后，同账号另一窗口不能续传旧的仅登记断点', async () => {
    const originalEvent = {};
    const nextEvent = {};
    let originalAuthorized = true;
    const { handlers, client } = harness({
      authorize: (event) => event !== originalEvent || originalAuthorized,
      client: fakeClient({
        registerAssetVersion: vi.fn(async () => ({
          ok: false as const,
          code: 'transient' as const,
        })),
      }),
    });
    await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD)(originalEvent, {
      projectId: PROJECT_ID,
      operationId: OPERATION_ID,
    });
    originalAuthorized = false;
    expect(
      await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD_RESUME)(nextEvent, {
        operationId: OPERATION_ID,
      }),
    ).toMatchObject({ ok: false, resume: null });
    expect(client.registerAssetVersion).toHaveBeenCalledTimes(1);
    expect(client.uploadFile).toHaveBeenCalledTimes(1);
  });

  it('续传取令牌期间失效会清旧断点，不继续仅登记阶段', async () => {
    let epoch = 1;
    let tokenPending = false;
    const token = deferred<string | null>();
    const { handlers, client } = harness({
      activeAccount: () => ({ accountKey: 'acc-1', authEpoch: epoch }),
      accessToken: () => (tokenPending ? token.promise : Promise.resolve('token')),
      client: fakeClient({
        registerAssetVersion: vi.fn(async () => ({
          ok: false as const,
          code: 'transient' as const,
        })),
      }),
    });
    const upload = handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD);
    expect(await upload({}, { projectId: PROJECT_ID, operationId: OPERATION_ID })).toMatchObject({
      ok: false,
      resume: { stage: 'register' },
    });
    tokenPending = true;
    const pending = handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD_RESUME)(
      {},
      { operationId: OPERATION_ID },
    );
    epoch = 2;
    token.resolve('old-token');
    expect(await pending).toMatchObject({ ok: false, code: 'authRequired', resume: null });
    expect(client.registerAssetVersion).toHaveBeenCalledTimes(1);
    // 同一不透明操作号可被新账号重新使用，证明旧断点确已清理。
    tokenPending = false;
    await upload({}, { projectId: PROJECT_ID, operationId: OPERATION_ID });
    expect(client.uploadFile).toHaveBeenCalledTimes(2);
  });

  it('登记返回 existingVersionId 时换账号，不再解析旧版本', async () => {
    let epoch = 1;
    const { handlers, client } = harness({
      activeAccount: () => ({ accountKey: 'acc-1', authEpoch: epoch }),
      client: fakeClient({
        registerAssetVersion: vi.fn(async () => {
          epoch = 2;
          return { ok: false as const, code: 'conflict' as const, existingVersionId: VERSION_ID };
        }),
      }),
    });
    const result = await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_REGISTER)(
      {},
      {
        projectId: PROJECT_ID,
        fileId: FILE_ID,
      },
    );
    expect(result).toMatchObject({ ok: false, code: 'authRequired' });
    expect(client.getAssetVersion).not.toHaveBeenCalled();
  });

  it('预览版本解析期间撤权，不继续读取文件字节', async () => {
    let authorized = true;
    const { handlers, client } = harness({
      authorize: () => authorized,
      client: fakeClient({
        getAssetVersion: vi.fn(async () => {
          authorized = false;
          return { ok: true as const, value: { asset, version } };
        }),
      }),
    });
    const result = await handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_PREVIEW)(
      {},
      { versionId: VERSION_ID },
    );
    expect(result).toMatchObject({ ok: false, code: 'authRequired' });
    expect(client.downloadFileBytes).not.toHaveBeenCalled();
  });

  it('令牌等待期间换账号后，不得打开选择器或写入旧账号资产', async () => {
    const token = deferred<string | null>();
    let epoch = 1;
    const pickUploadFile = vi.fn(async () => 'C:\\input\\周报.pptx');
    const { handlers, client } = harness({
      activeAccount: () => ({ accountKey: 'acc-1', authEpoch: epoch }),
      accessToken: () => token.promise,
      pickUploadFile,
    });
    const pending = handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD)(
      {},
      { projectId: PROJECT_ID, operationId: OPERATION_ID },
    );
    epoch = 2;
    token.resolve('old-account-token');
    expect(await pending).toMatchObject({ ok: false, code: 'authRequired' });
    expect(pickUploadFile).not.toHaveBeenCalled();
    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(client.registerAssetVersion).not.toHaveBeenCalled();
  });

  it('选档等待期间换账号后，不得上传选中的旧账号文件', async () => {
    const picked = deferred<string | null>();
    const pickerEntered = deferred<void>();
    let epoch = 1;
    const { handlers, client, progress } = harness({
      activeAccount: () => ({ accountKey: 'acc-1', authEpoch: epoch }),
      pickUploadFile: () => {
        pickerEntered.resolve();
        return picked.promise;
      },
    });
    const pending = handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD)(
      {},
      { projectId: PROJECT_ID, operationId: OPERATION_ID },
    );
    await pickerEntered.promise;
    epoch = 2;
    picked.resolve('C:\\input\\周报.pptx');
    expect(await pending).toMatchObject({ ok: false, code: 'authRequired' });
    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(client.registerAssetVersion).not.toHaveBeenCalled();
    expect(progress).toEqual([]);
  });

  it('字节上传等待期间撤权后，不得登记新版本或向窗口推送旧进度', async () => {
    const uploaded = deferred<Awaited<ReturnType<ProjectAssetClientPort['uploadFile']>>>();
    const uploadEntered = deferred<void>();
    let authorized = true;
    const uploadFile: ProjectAssetClientPort['uploadFile'] = vi.fn((_token, input) => {
      uploadEntered.resolve();
      return uploaded.promise.then((result) => {
        input.onProgress?.(2048, 2048);
        return result;
      });
    });
    const { handlers, client, progress } = harness({
      authorize: () => authorized,
      client: fakeClient({ uploadFile }),
    });
    const pending = handlerOf(handlers, IPC.PROJECT_ASSET_VERSION_UPLOAD)(
      {},
      { projectId: PROJECT_ID, operationId: OPERATION_ID },
    );
    await uploadEntered.promise;
    authorized = false;
    uploaded.resolve({ ok: true, value: projectFile });
    expect(await pending).toMatchObject({ ok: false, code: 'authRequired' });
    expect(client.registerAssetVersion).not.toHaveBeenCalled();
    expect(progress).toEqual([]);
  });

  it('await 期间换账号 ⇒ authRequired，不把上个账号的资产发给下个账号', async () => {
    let epoch = 1;
    const { handlers } = harness({
      activeAccount: () => ({ accountKey: 'acc-1', authEpoch: epoch }),
      client: fakeClient({
        listProjectAssets: vi.fn(async () => {
          epoch = 2;
          return { ok: true as const, value: [{ ...asset, currentVersion: version }] };
        }),
      } as Partial<ProjectAssetClientPort>),
    });
    expect(
      await handlerOf(handlers, IPC.PROJECT_ASSET_LIST)({}, { projectId: PROJECT_ID }),
    ).toMatchObject({ ok: false, code: 'authRequired' });
  });

  it('⭐ 服务端自由文案一个字都不回显：失败体只含本层表里的句子 + 参考编号', async () => {
    const { handlers } = harness({
      client: fakeClient({
        listProjectAssets: vi.fn(async () => ({
          ok: false as const,
          code: 'rejected' as const,
          // 网络面只挑业务码，这里再钉一遍：即便上游塞了别的东西也进不了出参。
          serverCode: 'asset_not_found',
        })),
      } as Partial<ProjectAssetClientPort>),
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_ASSET_LIST)(
      {},
      { projectId: PROJECT_ID },
    )) as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(['code', 'message', 'ok', 'referenceCode']);
    expect(result.message).toBe('请求被服务端拒绝。');
  });

  it('意外异常收敛成 transient（不跨 IPC 泄露堆栈）', async () => {
    const { handlers } = harness({
      client: fakeClient({
        listProjectAssets: vi.fn(async () => {
          throw new Error('boom: internal detail');
        }),
      } as Partial<ProjectAssetClientPort>),
    });
    const result = (await handlerOf(handlers, IPC.PROJECT_ASSET_LIST)(
      {},
      { projectId: PROJECT_ID },
    )) as Record<string, unknown>;
    expect(result).toEqual({
      ok: false,
      code: 'transient',
      message: '网络暂时不可用，请稍后重试。',
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.transient,
    });
  });
});
