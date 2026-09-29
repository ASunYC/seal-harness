import { basename } from 'node:path';

import type {
  ProjectFile,
  ProjectFileQuota,
  ProjectFileUploadProgress,
} from '../../../shared/protocol/project-collab.js';
import type {
  ProjectAssetUploadResume,
  ProjectAssetUploadResumeStage,
  ProjectAssetVersionResolution,
} from '../../../shared/protocol/project-collab-assets.js';
import type { CollabClientFailureCode, CollabClientOutcome } from './collabClient.js';

/**
 * 传一个资产版本：**上传字节 → 把那一行登记成版本**两段，外加失败之后的续传。
 *
 * ⭐ 为什么要有这个编排器（而不是让渲染层调两次）：两段之间有一个**断点**，跨过它之后
 *    重试的代价完全不同——
 *      · 第一段失败：服务端那侧什么都没落（上传中断由服务端 400 `upload_interrupted`
 *        并删掉半成品），续传 ＝ 重传字节；
 *      · 第一段成功、第二段失败：字节已经是一行 `files`、配额**已经按字节计过一次**，
 *        续传只能是**补登记**。这时重传字节会再落一行 files、再计一次配额，而库层
 *        `UNIQUE(file_id)` 只保证「一行 files 只属一个版本」，**挡不住**同一份材料被
 *        上传两次。让渲染层去记这件事等于把这条判据放在最容易丢状态的那一层。
 *
 * ⭐ 重复落库靠**服务端的唯一约束 + 一次收敛**杜绝，不靠客户端自觉：补登记若其实上一次
 *    已经成功（响应丢在路上），服务端回 409 `file_already_versioned` 并带上 `version_id`，
 *    这里据此把重试**判成成功**（`reused: true`）。⛔ 不是「忽略这个错误」——版本 id 是从
 *    服务端读回来的，读不到就仍然报失败。
 *
 * ⚠️ 取消只在**第一段**有效。字节传完、登记在飞之后，版本行是 append-only 的：没有
 *    「撤回这一版」这种操作，声称取消成功就是假话。⇒ 越过断点后取消不改变结果，
 *    结果照实报（完成就是完成）。
 *
 * 【红线】本机路径只活在本模块的续传记录里：出参（含续传描述）结构性不含 `filePath`。
 * 【账号】续传/放弃要求**同一账号**（换账号后上一段的文件名都不该再露出去）；取消只认
 *    不透明操作号——与既有上传取消同一条理由：换账号之后同一个窗口仍必须能终止旧上传。
 */

/** 客户端网络面的结构性子集（测试可用对象字面量替身）。 */
export interface ProjectAssetUploadClientPort {
  uploadFile(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly filePath: string;
      readonly kind: 'asset';
      readonly signal?: AbortSignal;
      readonly onProgress?: (uploadedBytes: number, totalBytes: number) => void;
    },
  ): Promise<CollabClientOutcome<ProjectFile>>;
  registerAssetVersion(
    accessToken: string,
    input: {
      readonly projectId: string;
      readonly fileId: string;
      readonly assetId?: string | undefined;
    },
  ): Promise<CollabClientOutcome<ProjectAssetVersionResolution>>;
  getAssetVersion(
    accessToken: string,
    input: { readonly versionId: string },
  ): Promise<CollabClientOutcome<ProjectAssetVersionResolution>>;
}

export interface ProjectAssetUploadFlowDependencies {
  readonly client: ProjectAssetUploadClientPort;
  /** 主进程弹系统选择框取路径；`null` ＝ 用户在选择框里取消。 */
  readonly pickFile: () => Promise<string | null>;
}

/** 每次调用的上下文：账号归属 + 进度回推（回推由 IPC 层负责发给发起窗口）。 */
export interface ProjectAssetUploadContext {
  /** 账号归属键（`accountKey` + `authEpoch`，由 IPC 层拼）。 */
  readonly ownerKey: string;
  /** 绑定发起窗口与账号纪元；每段副作用前后复核，不能只拒绝最终响应。 */
  readonly isCurrent: () => boolean;
  readonly onProgress?: (snapshot: ProjectFileUploadProgress) => void;
}

export type ProjectAssetUploadOutcome =
  | {
      readonly ok: true;
      readonly asset: ProjectAssetVersionResolution['asset'];
      readonly version: ProjectAssetVersionResolution['version'];
      readonly reused: boolean;
    }
  | { readonly ok: true; readonly cancelled: true }
  | {
      readonly ok: false;
      readonly code: CollabClientFailureCode | 'authRequired';
      readonly quota: ProjectFileQuota | null;
      readonly resume: ProjectAssetUploadResume | null;
    };

interface UploadAttempt {
  readonly operationId: string;
  readonly ownerKey: string;
  readonly isCurrent: () => boolean;
  readonly projectId: string;
  readonly assetId: string | null;
  readonly filePath: string;
  filename: string;
  bytes: number | null;
  stage: ProjectAssetUploadResumeStage;
  fileId: string | null;
  controller: AbortController | null;
  /** 正在跑第一/第二段：防止同一件被并发续传两次（那会重传字节）。 */
  running: boolean;
}

/**
 * 第一段失败后**不留断点**的失败码闭集。
 *
 * 两条都是对同一个本机文件的**确定性**结论：>1 GiB 的文件重试一次还是 >1 GiB，
 * 读不出来的文件重试一次还是读不出来。留一个点了必然重现的「重试」按钮比不留更坏。
 * ⛔ 第二段（补登记）没有这个闭集：那时字节已经落了，丢掉断点等于悄悄留下一份
 *    已经计过配额、却没有任何入口能接着处理的孤儿上传。
 */
const UPLOAD_STAGE_NON_RESUMABLE: ReadonlySet<CollabClientFailureCode> = new Set([
  'invalidRequest',
  'tooLarge',
]);

export class ProjectAssetUploadFlow {
  private readonly attempts = new Map<string, UploadAttempt>();

  constructor(private readonly dependencies: ProjectAssetUploadFlowDependencies) {}

  /** 待续的失败上传件数（诊断与用例用；⛔ 不作为业务判据）。 */
  pendingCount(): number {
    return this.attempts.size;
  }

  /** 清理已失效发起上下文的断点；只丢本地引用，不删除服务端字节。 */
  invalidateStaleAttempts(): void {
    for (const attempt of this.attempts.values()) {
      if (!attempt.isCurrent()) this.forgetAttempt(attempt);
    }
  }

  /**
   * 开一次新上传：弹选择框 → 传字节 → 登记版本。
   *
   * `assetId` 缺席 ＝ 新建血统；给了 ＝ 追加为该血统的下一版（界面上的「替换」）。
   * 同一个 `operationId` 已在册 ⇒ `invalidRequest`：那是重复提交（双击），而不是新动作。
   */
  async begin(
    accessToken: string,
    request: {
      readonly projectId: string;
      readonly operationId: string;
      readonly assetId?: string | undefined;
    },
    context: ProjectAssetUploadContext,
  ): Promise<ProjectAssetUploadOutcome> {
    if (!context.isCurrent()) return failure('authRequired', null, null);
    if (this.attempts.has(request.operationId)) return failure('invalidRequest', null, null);
    const filePath = await this.dependencies.pickFile();
    if (!context.isCurrent()) return failure('authRequired', null, null);
    if (this.attempts.has(request.operationId)) return failure('invalidRequest', null, null);
    // 用户在系统选择框里取消：成功分支、不留断点（还没有任何东西发生）。
    if (filePath === null) return { ok: true, cancelled: true };
    const attempt: UploadAttempt = {
      operationId: request.operationId,
      ownerKey: context.ownerKey,
      isCurrent: context.isCurrent,
      projectId: request.projectId,
      assetId: request.assetId ?? null,
      filePath,
      filename: basename(filePath),
      bytes: null,
      stage: 'upload',
      fileId: null,
      controller: null,
      running: false,
    };
    this.attempts.set(attempt.operationId, attempt);
    return this.run(accessToken, attempt, context);
  }

  /**
   * 续传一次失败的上传：从记下来的那一段接着做（⛔ 不重新弹选择框、不重新问路径）。
   *
   * 找不到 / 不是本账号的 ⇒ `invalidRequest`（⛔ 不说「那是别人的」，也不泄露文件名）。
   * 正在跑的那一件再续一次 ⇒ 同样 `invalidRequest`：并发续传会把字节传两遍。
   */
  async resume(
    accessToken: string,
    request: { readonly operationId: string },
    context: ProjectAssetUploadContext,
  ): Promise<ProjectAssetUploadOutcome> {
    const attempt = this.attempts.get(request.operationId);
    if (!context.isCurrent()) {
      if (attempt?.ownerKey === context.ownerKey) this.forgetAttempt(attempt);
      return failure('authRequired', null, null);
    }
    if (!attempt || attempt.ownerKey !== context.ownerKey || attempt.running) {
      return failure('invalidRequest', null, null);
    }
    return this.run(accessToken, attempt, context);
  }

  /**
   * 放弃一次失败的上传（忘掉断点）。
   *
   * ⚠️ 它只丢掉**客户端这一侧**的记录：若字节已经上传成功（`register` 段），那一行
   * `files` 仍在服务端、配额也仍然算着。⛔ 这里不顺手去删它——删文件是另一条有独立
   * 权限判定的路（本人或 owner），由用户在文件列表里显式做。
   */
  discard(
    request: { readonly operationId: string },
    context: Pick<ProjectAssetUploadContext, 'ownerKey'>,
  ): boolean {
    const attempt = this.attempts.get(request.operationId);
    if (!attempt || attempt.ownerKey !== context.ownerKey) return false;
    attempt.controller?.abort();
    this.attempts.delete(request.operationId);
    return true;
  }

  /**
   * 取消一次在途上传。**只在第一段有效**（越过断点后无事可撤，见类注释）。
   *
   * 归属只认不透明 `operationId`：换账号之后同一个窗口仍必须能终止旧上传
   * （与既有 `project:file-upload-cancel` 逐字同一条理由）。
   */
  cancel(request: { readonly operationId: string }): boolean {
    const controller = this.attempts.get(request.operationId)?.controller ?? null;
    if (controller === null) return false;
    controller.abort();
    return true;
  }

  private async run(
    accessToken: string,
    attempt: UploadAttempt,
    context: ProjectAssetUploadContext,
  ): Promise<ProjectAssetUploadOutcome> {
    attempt.running = true;
    try {
      if (!this.isCurrentAttempt(attempt, context)) return failure('authRequired', null, null);
      if (attempt.stage === 'upload') {
        const uploaded = await this.uploadBytes(accessToken, attempt, context);
        if (uploaded !== null) return uploaded;
      }
      return await this.registerVersion(accessToken, attempt, context);
    } finally {
      // 只清理本次尝试；同 operationId 后来建的新尝试不能被旧 finally 删除。
      if (!context.isCurrent()) this.forgetAttempt(attempt);
      attempt.running = false;
    }
  }

  /** 第一段。返回 `null` ＝ 字节已就位，继续走第二段。 */
  private async uploadBytes(
    accessToken: string,
    attempt: UploadAttempt,
    context: ProjectAssetUploadContext,
  ): Promise<ProjectAssetUploadOutcome | null> {
    if (!this.isCurrentAttempt(attempt, context)) return failure('authRequired', null, null);
    const controller = new AbortController();
    attempt.controller = controller;
    try {
      const uploaded = await this.dependencies.client.uploadFile(accessToken, {
        projectId: attempt.projectId,
        filePath: attempt.filePath,
        kind: 'asset',
        signal: controller.signal,
        onProgress: (uploadedBytes, totalBytes) => {
          if (!this.isCurrentAttempt(attempt, context)) return;
          attempt.bytes = totalBytes;
          emit(context, {
            operationId: attempt.operationId,
            name: attempt.filename,
            size: totalBytes,
            progress: uploadedBytes,
            phase: uploadedBytes >= totalBytes ? 'finalizing' : 'uploading',
            error: null,
          });
        },
      });
      if (!this.isCurrentAttempt(attempt, context)) return failure('authRequired', null, null);
      if (controller.signal.aborted) {
        this.attempts.delete(attempt.operationId);
        emitPhase(context, attempt, 'cancelled', null);
        return { ok: true, cancelled: true };
      }
      if (!uploaded.ok) {
        emitPhase(context, attempt, 'failed', uploaded.code);
        // 确定性失败（文件本身过大/读不出来）不留断点：留一个点了必错的重试更坏。
        if (UPLOAD_STAGE_NON_RESUMABLE.has(uploaded.code)) {
          this.attempts.delete(attempt.operationId);
          return failure(uploaded.code, uploaded.quota ?? null, null);
        }
        return failure(uploaded.code, uploaded.quota ?? null, resumeOf(attempt));
      }
      // ⭐ 断点在这里：字节已落、配额已计。从此刻起续传只补登记，绝不重传。
      attempt.fileId = uploaded.value.id;
      attempt.filename = uploaded.value.filename;
      attempt.bytes = uploaded.value.bytes;
      attempt.stage = 'register';
      return null;
    } finally {
      attempt.controller = null;
    }
  }

  /** 第二段：把那一行 files 登记成版本；409 `file_already_versioned` 收敛成成功。 */
  private async registerVersion(
    accessToken: string,
    attempt: UploadAttempt,
    context: ProjectAssetUploadContext,
  ): Promise<ProjectAssetUploadOutcome> {
    if (!this.isCurrentAttempt(attempt, context)) return failure('authRequired', null, null);
    const fileId = attempt.fileId;
    // 不可能为 null（第一段成功才会走到这里）；防御性地报一次，⛔ 不用 `!` 假装。
    if (fileId === null) return failure('transient', null, resumeOf(attempt));
    emitPhase(context, attempt, 'finalizing', null);
    const registered = await this.dependencies.client.registerAssetVersion(accessToken, {
      projectId: attempt.projectId,
      fileId,
      ...(attempt.assetId === null ? {} : { assetId: attempt.assetId }),
    });
    if (!this.isCurrentAttempt(attempt, context)) return failure('authRequired', null, null);
    if (registered.ok) {
      this.attempts.delete(attempt.operationId);
      emitPhase(context, attempt, 'completed', null);
      return { ok: true, ...registered.value, reused: false };
    }
    const existingVersionId = registered.existingVersionId;
    if (existingVersionId !== undefined) {
      // 上一次其实已经登记成功（响应丢了）：把那一版读回来，**不新落一笔**。
      const resolved = await this.dependencies.client.getAssetVersion(accessToken, {
        versionId: existingVersionId,
      });
      if (!this.isCurrentAttempt(attempt, context)) return failure('authRequired', null, null);
      if (resolved.ok) {
        this.attempts.delete(attempt.operationId);
        emitPhase(context, attempt, 'completed', null);
        return { ok: true, ...resolved.value, reused: true };
      }
      // 读不回来就仍然报失败：⛔ 不凭一个 id 编一份出参出来。断点留着，续传仍只补登记。
      emitPhase(context, attempt, 'failed', resolved.code);
      return failure(resolved.code, null, resumeOf(attempt));
    }
    emitPhase(context, attempt, 'failed', registered.code);
    return failure(registered.code, registered.quota ?? null, resumeOf(attempt));
  }

  private isCurrentAttempt(attempt: UploadAttempt, context: ProjectAssetUploadContext): boolean {
    if (
      attempt.isCurrent() &&
      context.isCurrent() &&
      this.attempts.get(attempt.operationId) === attempt
    )
      return true;
    this.forgetAttempt(attempt);
    return false;
  }

  private forgetAttempt(attempt: UploadAttempt): void {
    attempt.controller?.abort();
    if (this.attempts.get(attempt.operationId) === attempt) {
      this.attempts.delete(attempt.operationId);
    }
  }
}

function failure(
  code: CollabClientFailureCode | 'authRequired',
  quota: ProjectFileQuota | null,
  resume: ProjectAssetUploadResume | null,
): ProjectAssetUploadOutcome {
  return { ok: false, code, quota, resume };
}

/** 续传描述：⛔ 结构性不含本机路径（那一份只留在本模块的记录里）。 */
function resumeOf(attempt: UploadAttempt): ProjectAssetUploadResume {
  return {
    operationId: attempt.operationId,
    stage: attempt.stage,
    filename: attempt.filename,
    bytes: attempt.bytes,
    assetId: attempt.assetId,
  };
}

function emit(context: ProjectAssetUploadContext, snapshot: ProjectFileUploadProgress): void {
  if (context.isCurrent()) context.onProgress?.(snapshot);
}

/**
 * 非 `uploading` 的几个相位快照。
 *
 * ⚠️ 字节数还没量出来（第一段连 content-length 都没走到）时**一帧都不发**：进度契约
 * 要求 `size` 为正且 `progress ≤ size`，编一个 0 或 1 进去只会让那一帧过不了校验、
 * 或者让界面画出一个假的规模。
 */
function emitPhase(
  context: ProjectAssetUploadContext,
  attempt: UploadAttempt,
  phase: 'finalizing' | 'completed' | 'cancelled' | 'failed',
  error: CollabClientFailureCode | null,
): void {
  if (attempt.bytes === null || attempt.bytes <= 0) return;
  emit(context, {
    operationId: attempt.operationId,
    name: attempt.filename,
    size: attempt.bytes,
    // 走到这几个相位时字节已经传完（或这一件已经作废），进度即全量。
    progress: attempt.bytes,
    phase,
    error,
  });
}
