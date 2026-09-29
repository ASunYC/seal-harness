import {
  PROJECT_REF_KIND_ASSET,
  PROJECT_TODO_MAX_TITLE_LENGTH,
  buildProjectRef,
} from '@shared/protocol/project-collab.js';
import type { ProjectFile } from '@shared/protocol/project-collab.js';

/**
 * 「从一份文档开始建需求」的**纯逻辑与文案**（流程文档 §2①②）。
 *
 * ## 这条入口存在的理由
 *
 * 此前要「手工建需求 → 手工关联文档」两步，而第二步没有任何提示，多数人不会做。
 * 结果是一条需求躺在看板上，没人知道它说的是哪份文件里的哪一段。
 *
 * ## 一个落点：不是资产的，先存进项目资产
 *
 * 需求关联一个组员打不开的东西 ＝ 没关联。本机目录里的文件只在这台机器上；
 * 会话里的附件只在那次会话里；项目里的**临时件会到期回收**（回收之后关联指向一个
 * 不存在的东西，比一开始就没关联更难查）。所以三种来源都要先落成**项目资产**
 * （`ProjectFileKind` 的 `asset` 档）再谈关联。
 *
 * ⛔ 不许为了少一步而关联 `temp` 档：它会过期。
 */

export const REQUIREMENT_FROM_DOC_LABEL = '从文档';
export const REQUIREMENT_FROM_DOC_TITLE = '从一份文档开始';

/**
 * 三种来源。`kind` 是**它现在在哪儿**，不是文件类型——决定了「要不要先入库」。
 */
export type RequirementDocSource = 'asset' | 'device' | 'temp';

export interface RequirementDocSourceOption {
  readonly kind: RequirementDocSource;
  readonly label: string;
  /** 为什么这一档要（或不要）先入库——说清代价，别只给个选项名。 */
  readonly hint: string;
}

/**
 * 三档的顺序就是「离项目由近到远」：已经在的排第一，用户多数时候点它就完了。
 *
 * ⚠️「会话里上传的附件」不单列一档，理由是**它没有第四条路**：会话附件本身就是
 * 这台机器上的一个文件（选来的或拖进来的），要让组员打得开只能重新传一份 ⇒ 走
 * `device`；而它若已经被存进过项目、只是还挂在临时件档上 ⇒ 走 `temp`。
 * ⛔ 别摆一个「从会话附件导入」的按钮：客户端今天没有这条通道（`project:file-upload`
 * 请求里既没有字节也没有路径，是 Main 自己弹选择框读盘），摆出来点了什么也不会发生。
 */
export const REQUIREMENT_DOC_SOURCES: readonly RequirementDocSourceOption[] = [
  {
    kind: 'asset',
    label: '项目资产',
    hint: '已经在项目里，组员都打得开——直接挑一份。',
  },
  {
    kind: 'device',
    label: '本机文件',
    hint: '只在这台机器上，先传进项目存成资产。会话里发过的附件也走这里——它同样只在那次会话里，组员取不到。',
  },
  {
    kind: 'temp',
    label: '项目临时件',
    hint: '临时件会到期回收，选中即先转存为资产再关联——否则关联迟早指向一个没有了的文件。',
  },
];

/** 一份可选的文档（三档统一形态；`needsPromote` ＝选中后要先转存为资产）。 */
export interface RequirementDocCandidate {
  readonly fileId: string;
  readonly filename: string;
  readonly needsPromote: boolean;
}

/** 已经是资产的那些（`device` 档传完也落这里，所以只有这一份判据）。 */
export function requirementDocAssets(
  files: readonly ProjectFile[],
): readonly RequirementDocCandidate[] {
  return files
    .filter((file) => file.kind === 'asset')
    .map((file) => ({ fileId: file.id, filename: file.filename, needsPromote: false }));
}

/** 项目里还不是资产的那些——选中后必须先 `project:file-promote`。 */
export function requirementDocTempFiles(
  files: readonly ProjectFile[],
): readonly RequirementDocCandidate[] {
  return files
    .filter((file) => file.kind === 'temp')
    .map((file) => ({ fileId: file.id, filename: file.filename, needsPromote: true }));
}

/**
 * 文件名 → 预填标题。
 *
 * 去掉扩展名：`需求书v3-终稿.docx` 里的 `.docx` 对一条需求的标题毫无信息量，留着
 * 只会让看板上每一行都拖着一截后缀。**只去最后一节**（`a.tar.gz` → `a.tar`）——
 * 多去一节就开始猜了。没有扩展名、或名字就是一个点开头的（`.gitignore`）时原样返回。
 *
 * 截到协议上界：超长标题服务端必拒，宁可在这里截也不要让用户填完才吃一个 422。
 */
export function requirementTitleFromFilename(filename: string): string {
  const trimmed = filename.trim();
  const dot = trimmed.lastIndexOf('.');
  const base = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const title = base.trim() || trimmed;
  return title.slice(0, PROJECT_TODO_MAX_TITLE_LENGTH);
}

/**
 * 资产 id → 关联 token。组不出来（id 含引用 token 正则不认的字符）时返回 null，
 * 调用方据此**不带关联**——⛔ 宁可少一条关联，也不产出一个服务端必拒的建单请求。
 */
export function requirementDocRef(fileId: string): string | null {
  return buildProjectRef(PROJECT_REF_KIND_ASSET, fileId);
}
