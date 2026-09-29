import { z } from 'zod';

const collabProjectIdSchema = z.string().uuid();
const localProjectIdSchema = z.string().uuid();
const displayNameSchema = z.string().min(1).max(255);
const bindingRefSchema = z.strictObject({
  bindingId: z.string().uuid(),
  revision: z.number().int().positive().max(0xffff_ffff),
});

export const ProjectWorkspaceRequestSchema = z.strictObject({
  collabProjectId: collabProjectIdSchema,
});

/**
 * 协作侧「从最近列表直接点选」请求（A3 控件对等，2026-09-22 放开）：只递交协作项目 id 与
 * 用户点选的**本地项目 id**（设备级 workspace_projects 列表里的一项）。Main 偏好服务据此走
 * 与 select 逐步对齐、只换绑定来源的并行入口——不弹系统选择器，但归属校验/失败回滚/偏好落库不省。
 */
export const ProjectWorkspaceSelectLocalRequestSchema = z.strictObject({
  collabProjectId: collabProjectIdSchema,
  localProjectId: localProjectIdSchema,
});

export const ProjectWorkspaceSnapshotSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('bound'),
    collabProjectId: collabProjectIdSchema,
    localProjectId: localProjectIdSchema,
    displayName: displayNameSchema,
    binding: bindingRefSchema,
  }),
  z.strictObject({
    status: z.literal('unbound'),
    collabProjectId: collabProjectIdSchema,
    localProjectId: z.null(),
    displayName: z.null(),
    binding: z.null(),
  }),
  z.strictObject({
    status: z.literal('unavailable'),
    collabProjectId: collabProjectIdSchema,
    localProjectId: localProjectIdSchema,
    displayName: displayNameSchema,
    binding: z.null(),
  }),
]);

export const ProjectWorkspaceErrorSchema = z.strictObject({
  code: z.enum(['authentication', 'invalidInput', 'unavailable', 'persistenceUnavailable']),
  referenceCode: z.string().min(1).max(64),
});

export const ProjectWorkspaceResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), snapshot: ProjectWorkspaceSnapshotSchema }),
  z.strictObject({ ok: z.literal(false), error: ProjectWorkspaceErrorSchema }),
]);

export type ProjectWorkspaceRequest = z.infer<typeof ProjectWorkspaceRequestSchema>;
export type ProjectWorkspaceSelectLocalRequest = z.infer<
  typeof ProjectWorkspaceSelectLocalRequestSchema
>;
export type ProjectWorkspaceSnapshot = z.infer<typeof ProjectWorkspaceSnapshotSchema>;
export type ProjectWorkspaceResult = z.infer<typeof ProjectWorkspaceResultSchema>;
export type ProjectWorkspaceBindingRef = z.infer<typeof bindingRefSchema>;

/*
 * ── 只读关联目录（CTX-06 展示契约） ────────────────────────────────────────
 *
 * 「关联目录」是本地工作目录之外、供助手**只读**参考的额外目录。它与工作目录是两个
 * 独立轴：工作目录唯一、可写（会话 cwd）；关联目录可多、恒只读，永不进入可写 cwd。
 *
 * 这条契约只描述 Renderer 能看到的**脱敏投影**：`refId` + 展示名 + 可用性 + `access`。
 * ⛔ 本机绝对路径只活在 Main（本仓铁律），此处任何字段都不承载绝对路径。
 *
 * ⚠️ 分工边界：真正的 Main 目录选择 / realpath 校验 / 权限绑定 / 按账号·设备·项目
 *    持久化，以及只读上下文的读工具接线，属 **CTX-07**（依赖本包）。本包落地展示层、
 *    反馈语义与服务侧的纯逻辑（去重 / 离线判定 / 只读标注 / 移除不删磁盘）。
 */
const linkedDirectoryRefIdSchema = z.string().uuid();

export const ProjectLinkedDirectorySchema = z.strictObject({
  refId: linkedDirectoryRefIdSchema,
  displayName: displayNameSchema,
  /** 关联目录恒只读——不进入可写 cwd。CTX-07 读工具据此裁决。 */
  access: z.literal('read'),
  /** 目录在磁盘上是否仍可达；离线由结构化状态表达，⛔ 不塌缩成兜底文案。 */
  availability: z.enum(['available', 'offline']),
});

export const ProjectLinkedDirectoryListSchema = z.array(ProjectLinkedDirectorySchema).max(64);

export const ProjectLinkedDirectoryErrorSchema = z.strictObject({
  code: z.enum([
    'authentication',
    'invalidInput',
    // 目录选择器被取消：绑定/关联清单一个字节都不动。
    'selectionCancelled',
    // 该目录（按 realpath 归一）已在关联清单或就是当前工作目录——重名/重复。
    'duplicate',
    // 选中的目录当前不可达（离线）。⛔ 不复用工作树兜底文案，用这个结构化码分型。
    'offline',
    'unavailable',
    'persistenceUnavailable',
  ]),
  referenceCode: z.string().min(1).max(64),
});

export const ProjectLinkedDirectoriesResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), directories: ProjectLinkedDirectoryListSchema }),
  z.strictObject({ ok: z.literal(false), error: ProjectLinkedDirectoryErrorSchema }),
]);

export const ProjectLinkedDirectoryListRequestSchema = z.strictObject({
  collabProjectId: collabProjectIdSchema,
});
export const ProjectLinkedDirectoryAddRequestSchema = z.strictObject({
  collabProjectId: collabProjectIdSchema,
});
export const ProjectLinkedDirectoryRemoveRequestSchema = z.strictObject({
  collabProjectId: collabProjectIdSchema,
  refId: linkedDirectoryRefIdSchema,
});
export const ProjectLinkedDirectoryRenameRequestSchema = z.strictObject({
  collabProjectId: collabProjectIdSchema,
  refId: linkedDirectoryRefIdSchema,
  displayName: displayNameSchema,
});

/*
 * ── 本地绑定关联目录（轴 local，A3 本地侧）请求 ────────────────────────────────
 * 与协作侧（`ProjectLinkedDirectory*Request`，键 collabProjectId）平行，但键 **本地工作空间
 * 绑定 id**（`bindingId`）。结果复用 `ProjectLinkedDirectoriesResult`（投影恒 access:'read'）。
 * ⚠️ bindingId 必须命中**当前窗口本地绑定**——由 Main 服务端强判（resolveLocalLinkedDirectoryContext），
 *    ⛔ 不靠渲染层传对值。
 */
export const WorkspaceLinkedDirectoryListRequestSchema = z.strictObject({
  bindingId: z.string().uuid(),
});
export const WorkspaceLinkedDirectoryAddRequestSchema = z.strictObject({
  bindingId: z.string().uuid(),
});
export const WorkspaceLinkedDirectoryRemoveRequestSchema = z.strictObject({
  bindingId: z.string().uuid(),
  refId: linkedDirectoryRefIdSchema,
});
export type WorkspaceLinkedDirectoryListRequest = z.infer<
  typeof WorkspaceLinkedDirectoryListRequestSchema
>;
export type WorkspaceLinkedDirectoryAddRequest = z.infer<
  typeof WorkspaceLinkedDirectoryAddRequestSchema
>;
export type WorkspaceLinkedDirectoryRemoveRequest = z.infer<
  typeof WorkspaceLinkedDirectoryRemoveRequestSchema
>;

export type ProjectLinkedDirectory = z.infer<typeof ProjectLinkedDirectorySchema>;
export type ProjectLinkedDirectoriesResult = z.infer<typeof ProjectLinkedDirectoriesResultSchema>;
export type ProjectLinkedDirectoryError = z.infer<typeof ProjectLinkedDirectoryErrorSchema>;
export type ProjectLinkedDirectoryListRequest = z.infer<
  typeof ProjectLinkedDirectoryListRequestSchema
>;
export type ProjectLinkedDirectoryAddRequest = z.infer<
  typeof ProjectLinkedDirectoryAddRequestSchema
>;
export type ProjectLinkedDirectoryRemoveRequest = z.infer<
  typeof ProjectLinkedDirectoryRemoveRequestSchema
>;
export type ProjectLinkedDirectoryRenameRequest = z.infer<
  typeof ProjectLinkedDirectoryRenameRequestSchema
>;

/** Model arguments carry only opaque references and relative paths, never account or disk roots. */
const linkedRelativePathSchema = z
  .string()
  .max(1024)
  .refine(
    (value) =>
      value === '' ||
      (!/^[\\/]/.test(value) &&
        !value.includes(':') &&
        !value.includes('\0') &&
        !value.split(/[\\/]/).some((part) => part === '..')),
  );
export const ProjectLinkedDirectoryListArgumentsSchema = z.strictObject({
  refId: linkedDirectoryRefIdSchema.optional(),
  relativePath: linkedRelativePathSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export const ProjectLinkedDirectorySearchArgumentsSchema = z.strictObject({
  refId: linkedDirectoryRefIdSchema,
  relativePath: linkedRelativePathSchema.optional(),
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(100).optional(),
});
export const ProjectLinkedDirectoryReadArgumentsSchema = z.strictObject({
  refId: linkedDirectoryRefIdSchema,
  relativePath: linkedRelativePathSchema.refine((value) => value.length > 0),
  maxBytes: z.number().int().min(1).max(32768).optional(),
});
export const ProjectLinkedDirectoryReadResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    entries: z
      .array(
        z.strictObject({
          relativePath: linkedRelativePathSchema,
          kind: z.enum(['file', 'directory']),
        }),
      )
      .max(100),
    truncated: z.boolean(),
  }),
  z.strictObject({ ok: z.literal(true), text: z.string().max(32768), truncated: z.boolean() }),
  z.strictObject({ ok: z.literal(false), error: ProjectLinkedDirectoryErrorSchema }),
]);
export type ProjectLinkedDirectoryListArguments = z.infer<
  typeof ProjectLinkedDirectoryListArgumentsSchema
>;
export type ProjectLinkedDirectorySearchArguments = z.infer<
  typeof ProjectLinkedDirectorySearchArgumentsSchema
>;
export type ProjectLinkedDirectoryReadArguments = z.infer<
  typeof ProjectLinkedDirectoryReadArgumentsSchema
>;
export type ProjectLinkedDirectoryReadResult = z.infer<
  typeof ProjectLinkedDirectoryReadResultSchema
>;
