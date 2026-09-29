import { z } from 'zod';

import {
  PROJECT_FILE_MAX_BYTES,
  ProjectCollabErrorCodeSchema,
  ProjectCollabReferenceCodeSchema,
  ProjectCollabServerCodeSchema,
  ProjectFileQuotaSchema,
  TodoSourceSchema,
} from './project-collab.js';

/**
 * 资产版本关系与**不可变引用**的客户端契约。
 *
 * 本文件只描述服务端迁移 `0020_file_asset_versions.sql` 建出来的两张表在客户端一侧的
 * 形状：
 *  - `file_assets`         资产血统（稳定身份 + 当前版本指针 + 软删标记）
 *  - `file_asset_versions` append-only 版本行（一版一行，永不改写）
 *
 * ⭐ 存在的理由只有一条：**引用方存的是版本 id，不是文件 id**。报告附件与测试轮次
 *    附件冻结下来的那一份材料，必须在资产被传了新版本之后仍然解析到它当时那一版。
 *    这是「附件快照不随最新版本改变」的前提，不是风格偏好。
 *
 * ⛔ **本文件刻意还没有** IPC Request/Result 契约：新增渲染层通道要改
 *    `src/shared/ipc/channels.ts` 与 preload 桥，两者都不在本任务范围内。在这里先写出
 *    一份没有通道、没有实现、没有用例的接口，只会得到一份被人当成真相源的假契约
 *    （`project-planning.ts` 同一条纪律）。本轮的消费者是 Main 的线协议映射层与
 *    HTTP 客户端，它们要的就是下面这两个实体形状。
 *
 * 字段命名口径与 `project-collab.ts` 逐条一致：服务端 HTTP 与 DDL 是 `snake_case`，
 * 客户端契约是 `camelCase`，投影发生在 `src/main/services/collab/collabWireMapping.ts`。
 *
 * ⚠️ 三条红线由 schema 结构性承载（与 `project-collab.ts` 同一份纪律）：
 *  1. 【账号】没有 accountKey 或任何账号字段；`strictObject` 让「多带一个字段」连
 *     表达都表达不出来。
 *  2. 【埋点红线】没有任何助手会话正文；也**没有服务端落盘路径**——`storageRelPath`
 *     只在服务端进程内的内部投影里存在，一个字都不进客户端契约。
 *  3. 【白标】标识符与注释不含内核品牌词根。
 */

const entityIdSchema = z.string().uuid();
const projectIdSchema = z.string().uuid();
const subjectSchema = z.string().min(1).max(256);
const displayNameSchema = z.string().max(256);
const timestampSchema = z.string().max(64);

/**
 * 一个**冻结版本**。引用方存下来的那个 id 就是这里的 `id`。
 *
 * ⚠️ `contentSha256` / `bytes` / `filename` / `mime` / `source` 是**登记时刻的冻结副本**，
 * 不是「那份字节现在的样子」。资产被传了新版本、甚至原文件被改了名，这一行也不变。
 *
 * ⛔ `id` 与 `fileId` / `assetId` **刻意不相等，也不由内容派生**：
 *  · 用 `fileId` 当版本键 ⇒ 一次上传只能是一个版本，且「把 fileId 当 versionId 传」
 *    这类 bug 会在部分数据上静默可用；
 *  · 用内容哈希（更不用说 MD5）当版本键 ⇒ 两版字节相同就撞成同一版，而那是常态
 *    （同一份文件重新上传一次是合法的一版）；
 *  · 用「最新内容」当键 ⇒ 引用了一个会动的东西，等于没有冻结。
 */
export const ProjectAssetVersionSchema = z.strictObject({
  id: entityIdSchema,
  assetId: entityIdSchema,
  /**
   * 链内序号，从 1 起、逐版 +1。
   *
   * ⛔ **不设上界**（没有 `.max()`）。它是服务端计数：给它加客户端上界，版本数超过那个
   * 数之后 `mapArray` 会因为一行解析失败而**整条链返回 null**，表现是「列表空白」，
   * 看不出是哪一行越界——`childTotal` 加 `.max(500)` 那次事故就是这个形状。
   */
  versionNo: z.number().int().safe().positive(),
  /** 这一版的字节所在的文件行；下载仍走既有 `project:file-download` 那条路。 */
  fileId: entityIdSchema,
  /** 内容指纹的冻结副本。⚠️ 它是**指纹**不是键（见本 schema 的头部说明）。 */
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/u, 'invalid sha256'),
  bytes: z.number().int().safe().nonnegative().max(PROJECT_FILE_MAX_BYTES),
  filename: z.string().max(512),
  mime: z.string().min(1).max(128),
  /** 来源声明（与 `Todo.source` / `ProjectFile.source` 同一套取值、同一条纪律）。 */
  source: TodoSourceSchema,
  authorSubject: subjectSchema,
  authorDisplayName: displayNameSchema,
  createdAt: timestampSchema,
  /**
   * ⭐ 非空 ＝ 这一版的**字节已被删除**（资产元数据仍在，下载会失败）。
   *
   * 它是「删除要有明确反馈」那条判据在客户端一侧的落点：呈现层据此把这一版标成
   * 「内容已删除」并禁掉下载，⛔ 而不是给一个静默的空结果或一句通用的「打开失败」。
   */
  contentDeletedAt: timestampSchema.nullable(),
});

/**
 * 资产血统：版本链的稳定身份。
 *
 * `currentVersionId` 是**指针**，不是「编号最大的那一版」：它可以指向链上任意一版，
 * 表达的是一次产品决定。⛔ 呈现层不要自己按 `versionNo` 取最大值来算「当前版本」——
 * 那会在回滚当前版本之后与服务端给出两个不同的答案。
 *
 * `deletedAt` 非空 ＝ 资产已删除：目录不再列它，但**版本链与冻结引用照旧可读**。
 */
export const ProjectFileAssetSchema = z.strictObject({
  id: entityIdSchema,
  projectId: projectIdSchema,
  currentVersionId: entityIdSchema.nullable(),
  /**
   * 这条链现在有几版。
   *
   * ⛔ **不设上界**，理由与 `versionNo` 逐字相同：服务端计数一律不设客户端上界。
   */
  versionCount: z.number().int().safe().nonnegative(),
  createdBySubject: subjectSchema,
  createdAt: timestampSchema,
  deletedAt: timestampSchema.nullable(),
});

/** 目录行 ＝ 血统 + 它当前那一版（血统还没有版本时为 null）。 */
export const ProjectAssetCatalogueEntrySchema = ProjectFileAssetSchema.extend({
  currentVersion: ProjectAssetVersionSchema.nullable(),
});

/**
 * 一条完整版本链。
 *
 * ⛔ `versions` **没有 `.max()`**——这与 `ProjectFileListResultSchema` 给 `files` 设
 * `PROJECT_FILE_MAX_ENTRIES` 的取舍相反，是有意的：那里的上界挡的是「服务端哪天回了
 * 全量」，代价是一页列表取不回来（可接受，重取即可）；这里一旦越界，**冻结的引用就
 * 解析不出来**，等于把一份已经提交的报告的附件弄丢。版本数只增不减、且由用户行为
 * 驱动，任何常量都会在某一天被跨过。
 */
export const ProjectAssetVersionChainSchema = z.strictObject({
  asset: ProjectFileAssetSchema,
  versions: z.array(ProjectAssetVersionSchema),
});

/** 单个冻结引用解析结果：那一版 + 它所属血统的当前状态（含 `deletedAt`）。 */
export const ProjectAssetVersionResolutionSchema = z.strictObject({
  asset: ProjectFileAssetSchema,
  version: ProjectAssetVersionSchema,
});

export type ProjectAssetVersion = z.infer<typeof ProjectAssetVersionSchema>;
export type ProjectFileAsset = z.infer<typeof ProjectFileAssetSchema>;
export type ProjectAssetCatalogueEntry = z.infer<typeof ProjectAssetCatalogueEntrySchema>;
export type ProjectAssetVersionChain = z.infer<typeof ProjectAssetVersionChainSchema>;
export type ProjectAssetVersionResolution = z.infer<typeof ProjectAssetVersionResolutionSchema>;

/**
 * 这一版的字节还能不能下载。
 *
 * 判据只有一个键（`contentDeletedAt`），单独成函数是为了让呈现层**不各自写一份
 * `!== null`**：同一个判定有两个落点，迟早有一个漏掉「已删除也让点下载」。
 */
export function isAssetVersionContentAvailable(
  version: Pick<ProjectAssetVersion, 'contentDeletedAt'>,
): boolean {
  return version.contentDeletedAt === null;
}

/* ════════════════════════════════════════════════════════════════════════════
 * RPT-02：预览 / 上传失败恢复 / 关联选择
 *
 * 本段是上面那些实体形状的**通道契约**（Request / Result）与三个判定函数。
 * 头注里「刻意还没有 IPC 契约」那一条到此解除：`src/shared/ipc/channels.ts`、
 * `src/main/ipc/accessPolicy.ts`、`src/shared/ipc/api.ts` 与 preload 桥在同一轮
 * 一并补齐（四个注册面被 `accessPolicy.test.ts` 的全等断言绑在一起），所以这里
 * 写出来的不再是一份没有通道的假契约。
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 失败信封的共同形状：与协作面逐字同一套（`projectCollabErrorShape` 在
 * `project-collab.ts` 里未导出，所以按同样的三键 + 可选 serverCode 重新声明，
 * **三个取值闭集仍是那一份**）。同一个页面里不该出现两族参考编号。
 */
const projectAssetErrorShape = {
  code: ProjectCollabErrorCodeSchema,
  message: z.string().max(2_048),
  referenceCode: ProjectCollabReferenceCodeSchema,
  serverCode: ProjectCollabServerCodeSchema.optional(),
} as const;

const assetFailureSchema = z.strictObject({ ok: z.literal(false), ...projectAssetErrorShape });

/* ── 目录 / 版本链 / 冻结引用解析（RPT-01 那条链的通道侧）────────────────── */

export const ProjectAssetListRequestSchema = z.strictObject({ projectId: projectIdSchema });

/**
 * 资产目录（只含未删血统，每条带当前版本）。
 *
 * ⛔ `assets` **没有 `.max()`**——与 `ProjectFileListResultSchema` 给 `files` 设
 * `PROJECT_FILE_MAX_ENTRIES` 的取舍相反，理由与版本链那一条逐字相同：资产条数只随
 * 用户行为单调增长，任何常量都会在某一天被跨过，而越界的表现是**整页资产取不回来**
 * （`mapArray` 一条坏全批坏），看不出是哪一行越界。
 */
export const ProjectAssetListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    assets: z.array(ProjectAssetCatalogueEntrySchema),
  }),
  assetFailureSchema,
]);

export const ProjectAssetVersionChainRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  assetId: entityIdSchema,
});

/** 完整版本链（新版在前，服务端定序；客户端不重排）。⛔ `versions` 同样不设上界。 */
export const ProjectAssetVersionChainResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    asset: ProjectFileAssetSchema,
    versions: z.array(ProjectAssetVersionSchema),
  }),
  assetFailureSchema,
]);

/** ⭐ 解析冻结引用：入参只有版本 id（报告附件存下来的就是它）。 */
export const ProjectAssetVersionResolveRequestSchema = z.strictObject({
  versionId: entityIdSchema,
});

export const ProjectAssetVersionResolveResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    asset: ProjectFileAssetSchema,
    version: ProjectAssetVersionSchema,
  }),
  assetFailureSchema,
]);

/** 把一行**既有上传**登记成版本；`assetId` 缺席 ＝ 新建血统。 */
export const ProjectAssetVersionRegisterRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  fileId: entityIdSchema,
  assetId: entityIdSchema.optional(),
});

/**
 * 登记结果。`reused` ＝ 这一次没有新落库，而是**收敛到已经存在的那一版**
 * （服务端 `UNIQUE(file_id)` 挡住了第二次登记，我们据此把 409 判成成功）。
 *
 * ⚠️ 它不是「可选的提示」：调用方据此决定要不要说「已添加过」，而不是重复记一笔。
 */
export const ProjectAssetVersionRegisterResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    asset: ProjectFileAssetSchema,
    version: ProjectAssetVersionSchema,
    reused: z.boolean(),
  }),
  assetFailureSchema,
]);

export const ProjectAssetDeleteRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  assetId: entityIdSchema,
});

/** 血统软删（版本链保留）。幂等：已删的再删一次仍是成功。 */
export const ProjectAssetDeleteResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), id: entityIdSchema }),
  assetFailureSchema,
]);

/* ── 上传一版并登记（两段一次调用）+ 失败续传 ──────────────────────────── */

/**
 * 传一个新版本：**请求里既没有字节也没有本机路径**（仓库纪律「路径绝不跨 IPC」）。
 * 渲染层只表达「哪个项目、续到哪条血统」，Main 弹系统选择框自取路径、读盘直发。
 *
 * `assetId` 缺席 ＝ 新建一条血统；给了 ＝ 追加为该血统的下一版（界面上的「替换」
 * 语义就是这一条：旧版本一个字不改，引用方各自指向自己冻结的那一版）。
 */
export const ProjectAssetVersionUploadRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  operationId: z.string().uuid(),
  assetId: entityIdSchema.optional(),
});

/** 续传 / 放弃一次失败的上传：只持有不透明操作号（路径始终留在 Main）。 */
export const ProjectAssetVersionUploadResumeRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
});

export const ProjectAssetUploadAttemptDiscardRequestSchema = z.strictObject({
  operationId: z.string().uuid(),
});

export const ProjectAssetUploadAttemptDiscardResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  assetFailureSchema,
]);

/**
 * 续传阶段闭集——**断点只有一个，就在两段之间**：
 *  - `upload`   字节还没传成功（服务端那侧什么都没落）⇒ 续传＝重传字节；
 *  - `register` 字节已经落了一行 `files`、但还没被登记成版本 ⇒ 续传＝**只补登记**。
 *
 * ⛔ 没有「重传一次也无所谓」这一档：`register` 阶段重传会再落一行 `files`，
 *    配额按字节重复计一次，而库层 `UNIQUE(file_id)` 只保证一行 files 只属一个版本，
 *    **挡不住**「同一份材料被上传两次」。
 */
export const ProjectAssetUploadResumeStageSchema = z.enum(['upload', 'register']);

/**
 * 可续传描述：失败体里给出「这次失败还剩什么可以接着做」。
 *
 * ⛔ 结构性没有 `filePath`：路径只活在 Main 的续传记录里，渲染层拿到的只有不透明
 *    操作号 + 文件名（给人看的那一行）。`bytes` 在字节数还没量出来时为 null。
 */
export const ProjectAssetUploadResumeSchema = z.strictObject({
  operationId: z.string().uuid(),
  stage: ProjectAssetUploadResumeStageSchema,
  filename: z.string().min(1).max(512),
  bytes: z.number().int().safe().nonnegative().max(PROJECT_FILE_MAX_BYTES).nullable(),
  assetId: entityIdSchema.nullable(),
});

/**
 * 上传一版的结果三分支：完成 / 用户在系统选择框里取消 / 失败。
 *
 * ⭐ 失败分支**必须**同时给出 `quota` 与 `resume` 两个键（可为 null）：
 *  - `quota` 仅 `quotaExceeded` 时非空（形态照既有上传那一条）；
 *  - `resume` 非空 ＝ 还有断点可续。⛔ 让它可缺席就等于把「能不能续」交给调用方猜，
 *    而猜错的两个方向都很贵：猜能续 ⇒ 点了没反应；猜不能续 ⇒ 已经传上去的字节被
 *    重传一次（配额白付一份）。
 */
export const ProjectAssetVersionUploadResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    asset: ProjectFileAssetSchema,
    version: ProjectAssetVersionSchema,
    reused: z.boolean(),
  }),
  z.strictObject({ ok: z.literal(true), cancelled: z.literal(true) }),
  z.strictObject({
    ok: z.literal(false),
    ...projectAssetErrorShape,
    quota: ProjectFileQuotaSchema.nullable(),
    resume: ProjectAssetUploadResumeSchema.nullable(),
  }),
]);

/* ── 预览（真实取字节 → 文本层解析，或明确的下载降级）────────────────────── */

/** 预览可解析的格式闭集（与 Main 的文档解析栈同一份取值，扩展名判定见下方函数）。 */
export const ProjectAssetPreviewFormatSchema = z.enum([
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'txt',
  'md',
  'csv',
  'json',
  'html',
]);

/**
 * 预览取字节的上限。超过它**不取字节**，直接给下载降级。
 *
 * 为什么要有一个比上传上限（1 GiB）小得多的数：预览要把字节读进 Main 内存再解析，
 * 而「看一眼」不值得为一份 800 MiB 的文件付那个代价。⚠️ 它是**降级阈值**不是错误阈值
 * ——超限的结果是「给下载」，不是「预览失败」。
 */
export const PROJECT_ASSET_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;

/**
 * 降级理由闭集。每一条都要能对应**一句给人看的话**（下方 `projectAssetPreviewFallbackText`
 * 是那张表），组件层因此不需要任何默认文案（D7.17）。
 */
export const ProjectAssetPreviewFallbackReasonSchema = z.enum([
  /** 这一版的字节已被删除：元数据还在，下载也给不了。 */
  'contentDeleted',
  /** 零字节（解析栈也会拒）：说清是空文件，而不是「打不开」。 */
  'emptyContent',
  /** 扩展名不在可解析闭集（.doc / .ppt / .xls / 压缩包 / 图片 / 可执行文件…）。 */
  'unsupportedFormat',
  /** 声明类型或文件头与扩展名不符（改名的文件、伪装的二进制）。 */
  'formatMismatch',
  /** 超过预览取字节上限。 */
  'oversize',
  /** 取到了字节但解析不出文本（加密、损坏、超时、结构异常）。 */
  'parseFailed',
]);

const previewLocatorSchema = z.strictObject({
  page: z.number().int().positive().optional(),
  slide: z.number().int().positive().optional(),
  sheet: z.number().int().positive().optional(),
  block: z.number().int().positive().optional(),
  startLine: z.number().int().positive().optional(),
  maxLines: z.number().int().positive().optional(),
  startChar: z.number().int().positive().optional(),
});

export const ProjectAssetPreviewLocatorKeySchema = z.enum([
  'page',
  'slide',
  'sheet',
  'block',
  'startLine',
  'maxLines',
  'startChar',
]);

/**
 * 预览一个**冻结版本**：入参是版本 id + 可选定位键。
 *
 * ⛔ 没有「取不到就回落到当前版本」的开关：那等于把冻结悄悄取消掉，报告里那份附件
 *    会在资产被传了新版之后显示成另一份材料。
 */
export const ProjectAssetVersionPreviewRequestSchema = previewLocatorSchema.extend({
  versionId: entityIdSchema,
});

/**
 * 预览内容（文本层）。
 *
 * ⛔ `content` **不设 `.max()`**：产出上界由 Main 的解析预算（`maxOutputChars`）在
 *    生产侧保证，契约侧再设一道只会把「预览有点长」变成一句「网络暂时不可用」
 *    （结果 schema 解析失败会被通道包装成瞬时失败）。
 * ⛔ `locatorCoverage` 的计数同样不设上界：那是解析器数出来的页数/块数。
 */
const assetPreviewTextSchema = z.strictObject({
  kind: z.literal('text'),
  format: ProjectAssetPreviewFormatSchema,
  content: z.string(),
  /** 这一段是哪一片（如 `page 2` / `block 1`），原样来自解析栈。 */
  selectedRange: z.string().max(256),
  /** 每种定位单元有多少个（如 `{page: 12}`）。 */
  locatorCoverage: z.record(z.string().max(32), z.number().int().safe().nonnegative()),
  /** 因预算截断 ⇒ true，并给出接着读的下一片。⛔ 没有「静默截断」这一档。 */
  truncated: z.boolean(),
  nextSelector: previewLocatorSchema.nullable(),
  /** 对该格式没有意义、已被剔除的定位键（原样回报，调用方据此收窄下次请求）。 */
  ignoredSelectors: z.array(ProjectAssetPreviewLocatorKeySchema),
});

/** 降级：不给正文，**给理由**。⛔ 不夹带 content（strictObject 让它连表达都表达不出来）。 */
const assetPreviewFallbackSchema = z.strictObject({
  kind: z.literal('fallback'),
  reason: ProjectAssetPreviewFallbackReasonSchema,
});

/**
 * 预览结果。成功侧**恒有** `preview`，且只有「文本」与「降级」两态：
 * ⛔ 没有第三态，所以呈现层写不出「既没有正文也没有理由」的空白面板。
 */
export const ProjectAssetVersionPreviewResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    asset: ProjectFileAssetSchema,
    version: ProjectAssetVersionSchema,
    preview: z.discriminatedUnion('kind', [assetPreviewTextSchema, assetPreviewFallbackSchema]),
  }),
  assetFailureSchema,
]);

/* ── 关联选择（选已有资产 / 替换）──────────────────────────────────────── */

/**
 * 一条目录行在「选已有资产」列表里的状态闭集。
 *
 * 四档各自对应一种用户可见的说法，⛔ 不塌缩成一句「不可用」：已添加是本次挑选的
 * 状态，其余三档是候选本身的状态，用户要做的下一步完全不同。
 */
export const ProjectAssetAttachmentSelectabilitySchema = z.enum([
  'selectable',
  'alreadySelected',
  'assetDeleted',
  'noVersion',
  'contentDeleted',
]);

export type ProjectAssetListRequest = z.infer<typeof ProjectAssetListRequestSchema>;
export type ProjectAssetListResult = z.infer<typeof ProjectAssetListResultSchema>;
export type ProjectAssetVersionChainRequest = z.infer<typeof ProjectAssetVersionChainRequestSchema>;
export type ProjectAssetVersionChainResult = z.infer<typeof ProjectAssetVersionChainResultSchema>;
export type ProjectAssetVersionResolveRequest = z.infer<
  typeof ProjectAssetVersionResolveRequestSchema
>;
export type ProjectAssetVersionResolveResult = z.infer<
  typeof ProjectAssetVersionResolveResultSchema
>;
export type ProjectAssetVersionRegisterRequest = z.infer<
  typeof ProjectAssetVersionRegisterRequestSchema
>;
export type ProjectAssetVersionRegisterResult = z.infer<
  typeof ProjectAssetVersionRegisterResultSchema
>;
export type ProjectAssetDeleteRequest = z.infer<typeof ProjectAssetDeleteRequestSchema>;
export type ProjectAssetDeleteResult = z.infer<typeof ProjectAssetDeleteResultSchema>;
export type ProjectAssetVersionUploadRequest = z.infer<
  typeof ProjectAssetVersionUploadRequestSchema
>;
export type ProjectAssetVersionUploadResult = z.infer<typeof ProjectAssetVersionUploadResultSchema>;
export type ProjectAssetVersionUploadResumeRequest = z.infer<
  typeof ProjectAssetVersionUploadResumeRequestSchema
>;
export type ProjectAssetUploadAttemptDiscardRequest = z.infer<
  typeof ProjectAssetUploadAttemptDiscardRequestSchema
>;
export type ProjectAssetUploadAttemptDiscardResult = z.infer<
  typeof ProjectAssetUploadAttemptDiscardResultSchema
>;
export type ProjectAssetUploadResumeStage = z.infer<typeof ProjectAssetUploadResumeStageSchema>;
export type ProjectAssetUploadResume = z.infer<typeof ProjectAssetUploadResumeSchema>;
export type ProjectAssetPreviewFormat = z.infer<typeof ProjectAssetPreviewFormatSchema>;
export type ProjectAssetPreviewFallbackReason = z.infer<
  typeof ProjectAssetPreviewFallbackReasonSchema
>;
export type ProjectAssetPreviewLocatorKey = z.infer<typeof ProjectAssetPreviewLocatorKeySchema>;
export type ProjectAssetVersionPreviewRequest = z.infer<
  typeof ProjectAssetVersionPreviewRequestSchema
>;
export type ProjectAssetVersionPreviewResult = z.infer<
  typeof ProjectAssetVersionPreviewResultSchema
>;
export type ProjectAssetAttachmentSelectability = z.infer<
  typeof ProjectAssetAttachmentSelectabilitySchema
>;

/**
 * 可解析格式的扩展名闭集（渲染层据此**先**收窄入口，不必为一个 .doc 走一趟网络）。
 *
 * ⚠️ 真正的判定在 Main 的解析栈（它还要查文件头魔数），这里只是同一份取值的客户端
 * 副本。两份不一致会让界面说「能预览」而实际降级——`projectAssetPreviewService` 的
 * 用例把两侧逐条对齐成机器判定（包含一组已知的**反例**扩展名）。
 */
export const PROJECT_ASSET_PREVIEWABLE_EXTENSIONS: readonly string[] = Object.freeze([
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.html',
  '.htm',
]);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  // 没有点、以点开头（.gitignore 这类无扩展名文件）一律视为没有扩展名。
  return dot > 0 ? filename.slice(dot).toLowerCase() : '';
}

/**
 * 这一版能不能走文本预览；不能就给出**降级理由**（`null` ＝ 可以尝试）。
 *
 * ⚠️ 返回 `null` 不等于「一定能预览」：文件头魔数、加密与损坏只有真的解析过才知道，
 * 那一侧落在 `parseFailed` / `formatMismatch`。这个函数只负责**不发起注定失败的请求**。
 *
 * 判定序是有意的（从「更该告诉用户的事」排到「更泛的事」）：
 *  1. 字节已删 —— 连下载都给不了，其余判定都不重要了；
 *  2. 零字节 —— 说清是空文件；
 *  3. 格式不支持 —— 对一份 40 MiB 的 .doc，说「格式不支持」比说「太大」有用（它小也预览不了）；
 *  4. 超上限。
 */
export function assetPreviewFallbackReasonFor(
  version: Pick<ProjectAssetVersion, 'filename' | 'bytes' | 'contentDeletedAt'>,
  options: { readonly maxBytes?: number } = {},
): ProjectAssetPreviewFallbackReason | null {
  if (!isAssetVersionContentAvailable(version)) return 'contentDeleted';
  if (version.bytes <= 0) return 'emptyContent';
  if (!PROJECT_ASSET_PREVIEWABLE_EXTENSIONS.includes(extensionOf(version.filename))) {
    return 'unsupportedFormat';
  }
  if (version.bytes > (options.maxBytes ?? PROJECT_ASSET_PREVIEW_MAX_BYTES)) return 'oversize';
  return null;
}

/**
 * 降级之后还能不能给下载。
 *
 * 只有「字节已删」是 false：那一版的内容在服务端已经不在了，给一个注定失败的下载
 * 按钮比不给更糟（RPT-01 把这件事做成了 `contentDeletedAt` 这一个键）。
 */
export function isAssetPreviewDownloadable(reason: ProjectAssetPreviewFallbackReason): boolean {
  return reason !== 'contentDeleted';
}

/**
 * 降级理由 → 固定文案（**这就是 D7.17 说的那张表**）。
 *
 * 组件层因此零默认文案、零 fallback 句、零 `error.message` 透传：闭集里每一条都在这里
 * 有一句，加了新理由而不补句子会让契约用例转红。
 */
export function projectAssetPreviewFallbackText(reason: ProjectAssetPreviewFallbackReason): string {
  switch (reason) {
    case 'contentDeleted':
      return '这一版的文件内容已被删除，只保留了版本记录，无法预览或下载。';
    case 'emptyContent':
      return '这一版是空文件（0 字节），没有可预览的内容。';
    case 'unsupportedFormat':
      return '这种文件类型不支持在应用内预览，可下载后用本机软件打开。';
    case 'formatMismatch':
      return '文件的实际类型与扩展名不一致，已停止解析；可下载后用本机软件核对。';
    case 'oversize':
      return '文件超过预览大小上限，未在应用内解析；可直接下载查看。';
    case 'parseFailed':
      return '这份文件没能解析出可读文本（可能已加密、损坏或结构特殊），可下载后打开。';
  }
}

/**
 * 资产域**服务端业务码** → 报错条文案（就地覆盖通用文案）。
 *
 * 与 `projectOpenInvitationErrorText` 同一条纪律：文案收口在共享层，渲染层不再手抄
 * 一份中文。认不出的码与缺席一律返回 `null`，调用方退回按 `code` 取的通用句。
 */
export function projectAssetServerCodeText(serverCode: string | null | undefined): string | null {
  switch (serverCode) {
    case 'file_already_versioned':
      return '这次上传已经是某个资产的一个版本了，不会重复登记。';
    case 'asset_deleted':
      return '该资产已删除，不能再追加新版本；可先从回收站恢复，或新建一条资产。';
    case 'asset_not_found':
      return '该资产不存在或当前不可见。';
    case 'asset_version_not_found':
      return '该资产版本不存在，可能已被清理。';
    default:
      return null;
  }
}

/**
 * 一条目录行在「选已有资产 / 替换」列表里的状态。
 *
 * `replacingVersionId` ＝ 正在被替换的那一件：**必须**把它排除在「已添加」之外，
 * 否则「替换成它自己」永远点不动（原型 `:1438` 的替换分支也是这么判的：只对其余
 * 已选项查重）。
 */
export function assetAttachmentSelectability(
  entry: Pick<ProjectFileAsset, 'deletedAt'> & {
    readonly currentVersion: Pick<ProjectAssetVersion, 'id' | 'contentDeletedAt'> | null;
  },
  options: {
    readonly selectedVersionIds: readonly string[];
    readonly replacingVersionId?: string | null;
  },
): ProjectAssetAttachmentSelectability {
  const current = entry.currentVersion;
  if (current !== null) {
    const alreadySelected = options.selectedVersionIds.some(
      (versionId) => versionId === current.id && versionId !== options.replacingVersionId,
    );
    if (alreadySelected) return 'alreadySelected';
  }
  if (entry.deletedAt !== null) return 'assetDeleted';
  if (current === null) return 'noVersion';
  if (!isAssetVersionContentAvailable(current)) return 'contentDeleted';
  return 'selectable';
}

/* ════════════════════════════════════════════════════════════════════════════
 * RPT-08：回收站与历史版本恢复（RPT-06/07 三个服务端端点的通道侧）
 *
 * 通道清单与共同纪律见 ADR-0037。本段三条要点：
 *  1. 回收站出参与目录**逐字同形**（服务端同一份投影，只是 `deletedAt` 非空）。
 *     ⛔ 客户端不另断言 `deletedAt !== null`：读侧不得严于写侧（ADR-0035 决策 6 同一条），
 *     多一道断言只会在服务端某次合法变更之后让整个回收站解析失败。
 *  2. 两条恢复的失败体**透传** `serverCode`：同一个 403/404/409 底下是几种要用户做不同事的
 *     原因（不是本人 / 已在回收站 / 指纹不符 / 字节缺失 / 配额已满），塌缩成一句「请求被拒」
 *     就是没有反馈。
 *  3. 权限只在服务端判：回收站恢复＝本人或拥有者（管理者不在此列，负责人 2026-09-13
 *     定「恢复与删除同权」）；历史版本恢复＝可编辑成员。客户端只收窄入口。
 * ══════════════════════════════════════════════════════════════════════════ */

export const ProjectAssetTrashListRequestSchema = z.strictObject({ projectId: projectIdSchema });

/** 资产回收站（只含已删血统，最近删的在前；服务端定序，客户端不重排）。⛔ 不设上界，理由同目录。 */
export const ProjectAssetTrashListResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    assets: z.array(ProjectAssetCatalogueEntrySchema),
  }),
  assetFailureSchema,
]);

export const ProjectAssetRestoreRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  assetId: entityIdSchema,
});

/** 回收站恢复：成功回恢复后的**目录行**（未删资产幂等成功，回的仍是那一行）。 */
export const ProjectAssetRestoreResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), asset: ProjectAssetCatalogueEntrySchema }),
  assetFailureSchema,
]);

export const ProjectAssetVersionRestoreRequestSchema = z.strictObject({
  projectId: projectIdSchema,
  versionId: entityIdSchema,
});

/**
 * 历史版本恢复为链上**新的一版**：成功回血统（指针已挪到新版）+ 新版本行。
 *
 * ⭐ 失败分支**必须**带 `quota` 键（可为 null）：仅配额已满时非空，形态照上传那一条——
 *    触顶要说得出上限与已用量，而不是一句「恢复失败」。
 */
export const ProjectAssetVersionRestoreResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    asset: ProjectFileAssetSchema,
    version: ProjectAssetVersionSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    ...projectAssetErrorShape,
    quota: ProjectFileQuotaSchema.nullable(),
  }),
]);

export type ProjectAssetTrashListRequest = z.infer<typeof ProjectAssetTrashListRequestSchema>;
export type ProjectAssetTrashListResult = z.infer<typeof ProjectAssetTrashListResultSchema>;
export type ProjectAssetRestoreRequest = z.infer<typeof ProjectAssetRestoreRequestSchema>;
export type ProjectAssetRestoreResult = z.infer<typeof ProjectAssetRestoreResultSchema>;
export type ProjectAssetVersionRestoreRequest = z.infer<
  typeof ProjectAssetVersionRestoreRequestSchema
>;
export type ProjectAssetVersionRestoreResult = z.infer<
  typeof ProjectAssetVersionRestoreResultSchema
>;

/** 两类恢复动作：权限口径不同，同一个业务码的说法也不同（见下方文案表）。 */
export type ProjectAssetRecoveryOperation = 'restoreAsset' | 'restoreVersion';

/**
 * 恢复类动作的**服务端业务码** → 报错条文案（就地覆盖通用文案）。
 *
 * 与 `projectAssetServerCodeText` 同一条纪律：文案收口在共享层，渲染层不再手抄中文；
 * 认不出的码与缺席一律返回 `null`，调用方退回按 `code` 取的通用句。
 * 按动作分两张表而不是一张：`forbidden` 在回收站恢复里是「不是本人也不是拥有者」，在历史
 * 版本恢复里是「没有编辑权限」；`asset_deleted` 只在后者出现，且要把人引回回收站。
 */
export function projectAssetRecoveryErrorText(
  operation: ProjectAssetRecoveryOperation,
  serverCode: string | null | undefined,
): string | null {
  switch (serverCode) {
    case 'not_a_member':
      return '你不是该项目成员，无法执行恢复。';
    case 'project_archived':
      return '项目已归档，恢复项目后才能恢复资产。';
    case 'project_not_found':
      return '该项目不存在或当前不可见。';
    default:
      break;
  }
  return operation === 'restoreAsset'
    ? assetRestoreErrorText(serverCode)
    : assetVersionRestoreErrorText(serverCode);
}

function assetRestoreErrorText(serverCode: string | null | undefined): string | null {
  switch (serverCode) {
    case 'forbidden':
      return '只有资产创建者本人或项目拥有者可以恢复这份资产。';
    case 'asset_not_found':
      return '该资产不存在，或已不在回收站中。';
    default:
      return null;
  }
}

function assetVersionRestoreErrorText(serverCode: string | null | undefined): string | null {
  switch (serverCode) {
    case 'forbidden':
      return '没有恢复历史版本的权限，需要项目编辑权限。';
    case 'asset_deleted':
      return '该资产已移入回收站，请先从回收站恢复，再恢复历史版本。';
    case 'asset_version_not_found':
      return '该历史版本不存在或当前不可见。';
    case 'asset_version_content_deleted':
      return '这一版的文件内容已被删除，无法恢复。';
    case 'asset_version_content_mismatch':
      return '这一版的文件内容与登记时的指纹不一致，已停止恢复。';
    case 'file_not_found':
      return '这一版的文件在服务器上已找不到，无法恢复。';
    case 'file_too_large':
      return '这一版的文件超出大小上限，无法恢复。';
    case 'project_file_quota_exceeded':
      return '项目存储已达容量上限，无法恢复为新版本；请先清理不再需要的文件。';
    default:
      return null;
  }
}
