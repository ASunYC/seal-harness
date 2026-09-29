import { describe, expect, it } from 'vitest';

import type { ProjectFileUploadProgress } from '../../../../../stratex/shared/protocol/project-collab.js';
import {
  ProjectAssetVersionUploadResultSchema,
  type ProjectAssetVersionResolution,
} from '../../../../../stratex/shared/protocol/project-collab-assets.js';
import type { CollabClientOutcome } from '../../../../../stratex/main/services/collab/collabClient.js';
import {
  ProjectAssetUploadFlow,
  type ProjectAssetUploadClientPort,
  type ProjectAssetUploadContext,
} from '../../../../../stratex/main/services/collab/projectAssetUploadFlow.js';

/**
 * 上传一个资产版本 + 失败续传的判据。
 *
 * 四条重点：
 *  ① **断点只有一个**：字节传完之后续传只补登记，⛔ 绝不重传（重传＝配额白付一份、
 *     同一份材料在服务端存两遍）；
 *  ② 409 `file_already_versioned` 收敛成成功且 `reused: true`（响应丢在路上的那一次
 *     重试不该让用户以为失败、再传一遍）；
 *  ③ 失败不可假成功：读不回那一版就仍然报失败；
 *  ④ 确定性失败（文件过大/读不出）**不留**续传断点，其余一律留。
 */

const TOKEN = 'test-access-token';
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
const OTHER_VERSION_ID = '77777777-7777-4777-8777-777777777777';
const FILE_ID = '44444444-4444-4444-8444-444444444444';
const OPERATION_ID = '55555555-5555-4555-8555-555555555555';
const OWNER = 'account-a#3';

const asset = {
  id: ASSET_ID,
  projectId: PROJECT_ID,
  currentVersionId: VERSION_ID,
  versionCount: 1,
  createdBySubject: 'u-bob',
  createdAt: '2026-09-12T10:00:00.000Z',
  deletedAt: null,
} as const;

const version = {
  id: VERSION_ID,
  assetId: ASSET_ID,
  versionNo: 1,
  fileId: FILE_ID,
  contentSha256: 'a'.repeat(64),
  bytes: 2048,
  filename: '本周工作总结.docx',
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  source: 'manual' as const,
  authorSubject: 'u-bob',
  authorDisplayName: '鲍勃',
  createdAt: '2026-09-12T10:00:00.000Z',
  contentDeletedAt: null,
} as const;

const projectFile = {
  id: FILE_ID,
  kind: 'asset' as const,
  source: 'manual' as const,
  filename: '本周工作总结.docx',
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  bytes: 2048,
  sha256: 'a'.repeat(64),
  uploaderSubject: 'u-bob',
  uploaderDisplayName: '鲍勃',
  createdAt: '2026-09-12T10:00:00.000Z',
  expiresAt: null,
} as const;

type UploadCall = { readonly projectId: string; readonly filePath: string };
type RegisterCall = { readonly fileId: string; readonly assetId?: string | undefined };

interface Harness {
  readonly flow: ProjectAssetUploadFlow;
  readonly uploadCalls: UploadCall[];
  readonly registerCalls: RegisterCall[];
  readonly resolveCalls: string[];
  readonly progress: ProjectFileUploadProgress[];
  readonly context: ProjectAssetUploadContext;
  pickedPaths: string[];
}

function harness(options: {
  readonly pick?: Array<string | null>;
  readonly upload?: Array<CollabClientOutcome<typeof projectFile>>;
  readonly register?: Array<CollabClientOutcome<ProjectAssetVersionResolution>>;
  readonly resolve?: Array<CollabClientOutcome<ProjectAssetVersionResolution>>;
  readonly abortDuringUpload?: boolean;
  readonly onRegister?: () => void;
  readonly onResolve?: () => void;
}): Harness {
  const uploadCalls: UploadCall[] = [];
  const registerCalls: RegisterCall[] = [];
  const resolveCalls: string[] = [];
  const progress: ProjectFileUploadProgress[] = [];
  const pickQueue = [...(options.pick ?? ['C:/tmp/本周工作总结.docx'])];
  const uploadQueue = [...(options.upload ?? [{ ok: true, value: projectFile }])];
  const registerQueue = [...(options.register ?? [{ ok: true, value: { asset, version } }])];
  const resolveQueue = [...(options.resolve ?? [])];
  const pickedPaths: string[] = [];

  const client: ProjectAssetUploadClientPort = {
    uploadFile: async (_token, input) => {
      uploadCalls.push({ projectId: input.projectId, filePath: input.filePath });
      // 先报一帧进度（真实客户端在流式发送时逐块回调），再按脚本给结果。
      input.onProgress?.(1024, 2048);
      if (options.abortDuringUpload) {
        // 模拟「字节还在传时用户点了取消」：控制器由被测对象持有，这里替它触发。
        flow.cancel({ operationId: OPERATION_ID });
      }
      const next = uploadQueue.shift();
      if (!next) throw new Error('unexpected extra uploadFile');
      return next;
    },
    registerAssetVersion: async (_token, input) => {
      registerCalls.push({ fileId: input.fileId, assetId: input.assetId });
      const next = registerQueue.shift();
      if (!next) throw new Error('unexpected extra registerAssetVersion');
      options.onRegister?.();
      return next;
    },
    getAssetVersion: async (_token, input) => {
      resolveCalls.push(input.versionId);
      const next = resolveQueue.shift();
      if (!next) throw new Error('unexpected extra getAssetVersion');
      options.onResolve?.();
      return next;
    },
  };

  const flow = new ProjectAssetUploadFlow({
    client,
    pickFile: async () => {
      const next = pickQueue.shift() ?? null;
      if (next !== null) pickedPaths.push(next);
      return next;
    },
  });

  return {
    flow,
    uploadCalls,
    registerCalls,
    resolveCalls,
    progress,
    pickedPaths,
    context: {
      ownerKey: OWNER,
      isCurrent: () => true,
      onProgress: (snapshot) => progress.push(snapshot),
    },
  };
}

const beginRequest = (assetId?: string) => ({
  projectId: PROJECT_ID,
  operationId: OPERATION_ID,
  ...(assetId === undefined ? {} : { assetId }),
});

describe('begin：两段一次走完', () => {
  it('传字节 → 登记版本，回血统与版本（reused=false），并留下 completed 进度帧', async () => {
    const h = harness({});
    const outcome = await h.flow.begin(TOKEN, beginRequest(), h.context);

    expect(outcome).toEqual({ ok: true, asset, version, reused: false });
    expect(h.uploadCalls).toEqual([
      { projectId: PROJECT_ID, filePath: 'C:/tmp/本周工作总结.docx' },
    ]);
    expect(h.registerCalls).toEqual([{ fileId: FILE_ID, assetId: undefined }]);
    expect(h.progress.map((frame) => frame.phase)).toEqual([
      'uploading',
      'finalizing',
      'completed',
    ]);
    // 成功后不留断点。
    expect(h.flow.pendingCount()).toBe(0);
    expect(ProjectAssetVersionUploadResultSchema.safeParse(outcome).success).toBe(true);
  });

  it('给了 assetId ＝ 追加为该血统的下一版（界面上的「替换」走这条）', async () => {
    const h = harness({});
    await h.flow.begin(TOKEN, beginRequest(ASSET_ID), h.context);
    expect(h.registerCalls).toEqual([{ fileId: FILE_ID, assetId: ASSET_ID }]);
  });

  it('用户在系统选择框里取消：成功分支、不发一帧进度、不留断点', async () => {
    const h = harness({ pick: [null] });
    const outcome = await h.flow.begin(TOKEN, beginRequest(), h.context);
    expect(outcome).toEqual({ ok: true, cancelled: true });
    expect(h.uploadCalls).toEqual([]);
    expect(h.progress).toEqual([]);
    expect(h.flow.pendingCount()).toBe(0);
  });

  it('同一个 operationId 重复提交（双击）⇒ invalidRequest，且不会再弹一次选择框', async () => {
    const h = harness({
      upload: [{ ok: false, code: 'transient' }],
    });
    const first = await h.flow.begin(TOKEN, beginRequest(), h.context);
    expect(first.ok).toBe(false);
    const second = await h.flow.begin(TOKEN, beginRequest(), h.context);
    expect(second).toEqual({ ok: false, code: 'invalidRequest', quota: null, resume: null });
    expect(h.pickedPaths).toHaveLength(1);
  });
});

describe('第一段失败：断点留在「重传字节」', () => {
  it('瞬时失败留断点（stage=upload），续传时**再传一次字节**且不重新弹选择框', async () => {
    const h = harness({
      upload: [
        { ok: false, code: 'transient' },
        { ok: true, value: projectFile },
      ],
    });
    const failed = await h.flow.begin(TOKEN, beginRequest(), h.context);
    expect(failed).toMatchObject({
      ok: false,
      code: 'transient',
      resume: { operationId: OPERATION_ID, stage: 'upload', filename: '本周工作总结.docx' },
    });
    expect(h.flow.pendingCount()).toBe(1);

    const resumed = await h.flow.resume(TOKEN, { operationId: OPERATION_ID }, h.context);
    expect(resumed).toEqual({ ok: true, asset, version, reused: false });
    expect(h.uploadCalls).toHaveLength(2);
    expect(h.pickedPaths).toHaveLength(1);
    expect(h.flow.pendingCount()).toBe(0);
  });

  it('配额触顶：两个数原样带回，断点仍留着（删掉几个随手件即可续）', async () => {
    const quota = { limitBytes: 2_147_483_648, usedBytes: 2_147_483_648 };
    const h = harness({ upload: [{ ok: false, code: 'quotaExceeded', quota }] });
    const outcome = await h.flow.begin(TOKEN, beginRequest(), h.context);
    expect(outcome).toMatchObject({ ok: false, code: 'quotaExceeded', quota });
    expect(outcome.ok === false && outcome.resume?.stage).toBe('upload');
  });

  it('无权限（服务端 403，editor+ 强判）⇒ forbidden，断点留着（授权后可续，不必重选文件）', async () => {
    const h = harness({ upload: [{ ok: false, code: 'forbidden' }] });
    const outcome = await h.flow.begin(TOKEN, beginRequest(), h.context);
    expect(outcome).toMatchObject({
      ok: false,
      code: 'forbidden',
      quota: null,
      resume: { operationId: OPERATION_ID, stage: 'upload' },
    });
    // ⛔ 客户端这一层不自判角色：403 是服务端给的，我们只如实分档 + 留断点。
    expect(h.flow.pendingCount()).toBe(1);
  });

  it('⭐ 确定性失败（tooLarge / invalidRequest）不留断点：⛔ 不摆点了必错的重试', async () => {
    for (const code of ['tooLarge', 'invalidRequest'] as const) {
      const h = harness({ upload: [{ ok: false, code }] });
      const outcome = await h.flow.begin(TOKEN, beginRequest(), h.context);
      expect(outcome).toEqual({ ok: false, code, quota: null, resume: null });
      expect(h.flow.pendingCount()).toBe(0);
    }
  });

  it('字节传输途中取消 ⇒ 取消分支、不进第二段、不留断点', async () => {
    const h = harness({ abortDuringUpload: true, upload: [{ ok: false, code: 'transient' }] });
    const outcome = await h.flow.begin(TOKEN, beginRequest(), h.context);
    expect(outcome).toEqual({ ok: true, cancelled: true });
    expect(h.registerCalls).toEqual([]);
    expect(h.flow.pendingCount()).toBe(0);
    expect(h.progress.at(-1)?.phase).toBe('cancelled');
  });
});

describe('第二段失败：断点在「只补登记」——⛔ 绝不重传字节', () => {
  async function stalledAtRegister(
    register: Array<CollabClientOutcome<ProjectAssetVersionResolution>>,
    resolve: Array<CollabClientOutcome<ProjectAssetVersionResolution>> = [],
  ) {
    const h = harness({
      upload: [{ ok: true, value: projectFile }],
      register: [{ ok: false, code: 'transient' }, ...register],
      resolve,
    });
    const failed = await h.flow.begin(TOKEN, beginRequest(), h.context);
    return { h, failed };
  }

  it('⭐ 续传只打登记端点，上传端点一次都不再调（配额不会被计第二次）', async () => {
    const { h, failed } = await stalledAtRegister([{ ok: true, value: { asset, version } }]);
    expect(failed).toMatchObject({
      ok: false,
      code: 'transient',
      resume: { stage: 'register', bytes: 2048, assetId: null },
    });

    const resumed = await h.flow.resume(TOKEN, { operationId: OPERATION_ID }, h.context);
    expect(resumed).toEqual({ ok: true, asset, version, reused: false });
    // 上传只发生过一次——这就是「不重复计费」的判据本体。
    expect(h.uploadCalls).toHaveLength(1);
    expect(h.registerCalls).toHaveLength(2);
    expect(h.flow.pendingCount()).toBe(0);
  });

  it('⭐ 409 file_already_versioned ⇒ 读回那一版并判成成功（reused=true），不新落一笔', async () => {
    const { h, failed } = await stalledAtRegister(
      [
        {
          ok: false,
          code: 'conflict',
          serverCode: 'file_already_versioned',
          existingVersionId: OTHER_VERSION_ID,
        },
      ],
      [{ ok: true, value: { asset, version: { ...version, id: OTHER_VERSION_ID } } }],
    );
    expect(failed.ok).toBe(false);

    const resumed = await h.flow.resume(TOKEN, { operationId: OPERATION_ID }, h.context);
    expect(resumed).toMatchObject({ ok: true, reused: true });
    expect(resumed.ok === true && 'version' in resumed && resumed.version.id).toBe(
      OTHER_VERSION_ID,
    );
    expect(h.resolveCalls).toEqual([OTHER_VERSION_ID]);
    expect(h.uploadCalls).toHaveLength(1);
    expect(h.flow.pendingCount()).toBe(0);
  });

  it('⛔ 收敛读不回来就仍然报失败（不凭一个 id 编出参），断点保留在补登记', async () => {
    const { h } = await stalledAtRegister(
      [
        {
          ok: false,
          code: 'conflict',
          serverCode: 'file_already_versioned',
          existingVersionId: OTHER_VERSION_ID,
        },
      ],
      [{ ok: false, code: 'transient' }],
    );
    const resumed = await h.flow.resume(TOKEN, { operationId: OPERATION_ID }, h.context);
    expect(resumed).toMatchObject({ ok: false, code: 'transient', resume: { stage: 'register' } });
    expect(h.flow.pendingCount()).toBe(1);
  });

  it('血统已删（asset_deleted）也留断点：字节已在，界面给「放弃」而不是悄悄丢掉', async () => {
    const { h } = await stalledAtRegister([
      { ok: false, code: 'conflict', serverCode: 'asset_deleted' },
    ]);
    const resumed = await h.flow.resume(TOKEN, { operationId: OPERATION_ID }, h.context);
    expect(resumed).toMatchObject({
      ok: false,
      code: 'conflict',
      resume: { stage: 'register' },
    });
    expect(h.flow.pendingCount()).toBe(1);
  });

  it('⚠️ 越过断点后取消不改变结果：照实报完成（版本行 append-only，撤不回来）', async () => {
    const h = harness({});
    const outcome = await h.flow.begin(TOKEN, beginRequest(), h.context);
    // 登记已经完成，此时再取消：没有在途控制器可撤。
    expect(h.flow.cancel({ operationId: OPERATION_ID })).toBe(false);
    expect(outcome).toMatchObject({ ok: true, reused: false });
  });
});

describe('续传与放弃的归属', () => {
  it('仅登记续传失效后不再解析 existingVersionId，断点清空', async () => {
    let current = true;
    let calls = 0;
    const h = harness({
      register: [
        { ok: false, code: 'transient' },
        { ok: false, code: 'conflict', existingVersionId: VERSION_ID },
      ],
      onRegister: () => {
        if (++calls === 2) current = false;
      },
    });
    const context = { ...h.context, isCurrent: () => current };
    expect(await h.flow.begin(TOKEN, beginRequest(), context)).toMatchObject({
      ok: false,
      resume: { stage: 'register' },
    });
    expect(await h.flow.resume(TOKEN, { operationId: OPERATION_ID }, context)).toMatchObject({
      ok: false,
      code: 'authRequired',
      resume: null,
    });
    expect(h.uploadCalls).toHaveLength(1);
    expect(h.resolveCalls).toEqual([]);
    expect(h.flow.pendingCount()).toBe(0);
    expect(h.progress.some((frame) => frame.phase === 'completed')).toBe(false);
  });

  it('幂等版本解析等待后失效，不产生成功进度且丢本地断点', async () => {
    let current = true;
    const h = harness({
      register: [{ ok: false, code: 'conflict', existingVersionId: VERSION_ID }],
      resolve: [{ ok: true, value: { asset, version } }],
      onResolve: () => {
        current = false;
      },
    });
    expect(
      await h.flow.begin(TOKEN, beginRequest(), { ...h.context, isCurrent: () => current }),
    ).toMatchObject({
      ok: false,
      code: 'authRequired',
      resume: null,
    });
    expect(h.flow.pendingCount()).toBe(0);
    expect(h.progress.some((frame) => frame.phase === 'completed')).toBe(false);
  });

  it('旧请求迟到与 finally 不删除同操作号的新断点', async () => {
    const oldUpload = deferred<CollabClientOutcome<typeof projectFile>>();
    const entered = deferred<void>();
    let oldCurrent = true;
    let uploads = 0;
    let registers = 0;
    const flow = new ProjectAssetUploadFlow({
      pickFile: async () => 'C:/tmp/fixture.docx',
      client: {
        uploadFile: async () => {
          uploads += 1;
          if (uploads === 1) {
            entered.resolve();
            return oldUpload.promise;
          }
          return { ok: false, code: 'transient' };
        },
        registerAssetVersion: async () => {
          registers += 1;
          return { ok: true, value: { asset, version } };
        },
        getAssetVersion: async () => ({ ok: true, value: { asset, version } }),
      },
    });
    const old = flow.begin(TOKEN, beginRequest(), { ownerKey: OWNER, isCurrent: () => oldCurrent });
    await entered.promise;
    oldCurrent = false;
    flow.invalidateStaleAttempts();
    const newContext = { ownerKey: 'account-b#4', isCurrent: () => true };
    expect(await flow.begin(TOKEN, beginRequest(), newContext)).toMatchObject({
      ok: false,
      resume: { stage: 'upload' },
    });
    oldUpload.resolve({ ok: true, value: projectFile });
    expect(await old).toMatchObject({ ok: false, code: 'authRequired' });
    expect(flow.pendingCount()).toBe(1);
    expect(await flow.resume(TOKEN, { operationId: OPERATION_ID }, newContext)).toMatchObject({
      ok: false,
      resume: { stage: 'upload' },
    });
    expect(uploads).toBe(3);
    expect(registers).toBe(0);
  });

  it('换账号后不能续传别人的断点（也不泄露文件名）', async () => {
    const h = harness({ upload: [{ ok: false, code: 'transient' }] });
    await h.flow.begin(TOKEN, beginRequest(), h.context);
    const other = await h.flow.resume(
      TOKEN,
      { operationId: OPERATION_ID },
      { ownerKey: 'account-b#1', isCurrent: () => true },
    );
    expect(other).toEqual({ ok: false, code: 'invalidRequest', quota: null, resume: null });
    expect(h.flow.pendingCount()).toBe(1);
  });

  it('不存在的操作号（含已完成的那一件）续传 ⇒ invalidRequest', async () => {
    const h = harness({});
    await h.flow.begin(TOKEN, beginRequest(), h.context);
    expect(await h.flow.resume(TOKEN, { operationId: OPERATION_ID }, h.context)).toEqual({
      ok: false,
      code: 'invalidRequest',
      quota: null,
      resume: null,
    });
  });

  it('放弃：本账号可放弃（记录消失），别人不行', async () => {
    const h = harness({ upload: [{ ok: false, code: 'transient' }] });
    await h.flow.begin(TOKEN, beginRequest(), h.context);
    expect(h.flow.discard({ operationId: OPERATION_ID }, { ownerKey: 'account-b#1' })).toBe(false);
    expect(h.flow.pendingCount()).toBe(1);
    expect(h.flow.discard({ operationId: OPERATION_ID }, h.context)).toBe(true);
    expect(h.flow.pendingCount()).toBe(0);
  });

  it('取消只认不透明操作号（换账号后同一窗口仍必须能终止在途上传）', async () => {
    // 在途才有控制器：这里用「第一段失败并留断点」的那一件证明反面——
    // 不在途时取消恒 false，不会误报「已取消」。
    const h = harness({ upload: [{ ok: false, code: 'transient' }] });
    await h.flow.begin(TOKEN, beginRequest(), h.context);
    expect(h.flow.cancel({ operationId: OPERATION_ID })).toBe(false);
    expect(h.flow.cancel({ operationId: '99999999-9999-4999-8999-999999999999' })).toBe(false);
  });
});
