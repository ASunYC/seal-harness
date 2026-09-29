import { isTodoRequirement } from '@shared/protocol/project-collab.js';
import type { ProjectFile, Todo, TodoItemKind } from '@shared/protocol/project-collab.js';

import { splitRefToken } from './project-format';
import { resolveRefLabel } from './project-refs';
import type { ProjectRefSources } from './project-refs';

/**
 * 「让助理拆解」两个快捷入口的**入口判据与请求文案**（流程文档 §2③）。
 *
 * ## 它们是快捷方式，不是主路
 *
 * 主路是项目助理面板里那个常驻会话框——人在那里说什么都行。这两个入口只把「拆这一条」
 * 这句最常说的话省下来，所以它们**复用同一条链路**：构造一段正文，交给同一个会话框
 * 发出去。⛔ 不另写一份拆解逻辑——真正的拆解发生在会话里，助理调受审批的工具面
 * （草案落独立的表，人确认才成单）。这里产出的只是一段**用户消息**。
 *
 * ## 三条纪律
 *
 * - **显式动作**：不点就不拆。⛔ 没有任何自动拆解。
 * - **不绕开审批链**：正文里不含任何「免审批 / 直接建单」的措辞，也没有旁路可绕——
 *   工具面的审批闸在 Main，界面这一侧根本够不着它。
 * - **不许诺草案会成单**：文案说的是「拆成草案交我审阅」，与那道闸的语义一致。
 *
 * ⚠️【白标】文案里那个执行者只有一个称谓：**项目助理**（`TODO_ASSISTANT_ASSIGNEE_LABEL`）。
 * ⛔ 不许写「智能助手」——那是一级模块名（专家目录里那些可挂载的助手）。
 * ⚠️【埋点红线】这段正文是**用户消息**，只走会话链路；⛔ 它与其中的需求标题、文件名
 * 一个字都不进埋点、诊断上报或平台侧。
 */

/** 需求行上那一下点的字。动词落在「拆解」上——它答的是「点了会发生什么」。 */
export const REQUIREMENT_DECOMPOSE_ACTION_LABEL = '助理拆解需求';
export const TASK_DECOMPOSE_ACTION_LABEL = '助理拆解任务';
/** 兼容非按钮调用点；真实行按钮使用上面两个明确标签。 */
export const TODO_DECOMPOSE_ACTION_LABEL = TASK_DECOMPOSE_ACTION_LABEL;

/** 资产上那一下点的字。「据此」＝以这份文档为依据，不是「把这份文档拆开」。 */
export const ASSET_DECOMPOSE_ACTION_LABEL = '据此拆解';

/** 悬浮说明：说清点了之后东西落在哪，免得人以为点完任务就建好了。 */
export const TODO_DECOMPOSE_HINT =
  '在项目会话里请项目助理读当前工作项与关联资料，拆成指定种类的草案交你审阅——确认之后才会成单。';

export const ASSET_DECOMPOSE_HINT =
  '在项目会话里请项目助理读这份资产，拆成草案交你审阅——确认之后才会成单。';

/**
 * 「这一行给不给拆解入口」。
 *
 * 三个条件缺一不可：
 *  - **写得动这个项目**（`canWrite`）。观察者点了必被服务端拒。
 *  - **项目没归档**。归档＝只读，草案是写入。
 *
 * ⚠️ 这是**入口收窄不是权限**：真正的判定在服务端与工具面的审批闸上，这里只负责
 * 不摆一个点了必错的按钮。
 */
export function canDecomposeTodo(
  _todo: Pick<Todo, 'itemKind'>,
  options: { readonly canWrite: boolean; readonly isArchived: boolean },
): boolean {
  if (!options.canWrite || options.isArchived) return false;
  return true;
}

export function canDecomposeRequirement(todo: Pick<Todo, 'itemKind'>): boolean {
  return isTodoRequirement(todo);
}

/** 资产行上那个入口的收窄：写得动、且没归档。资产本身不分层级。 */
export function canDecomposeAsset(
  file: Pick<ProjectFile, 'kind'>,
  options: { readonly canWrite: boolean; readonly isArchived: boolean },
): boolean {
  if (!options.canWrite || options.isArchived) return false;
  // ⛔ 临时件不给：它会到期回收，据它拆出来的任务过几天就没有依据了。
  return file.kind === 'asset';
}

/**
 * 当前工作项 → 一段带显式目标种类的请求正文。
 *
 * 带上**待办 id**（助理要靠它去读那条需求、并把草案挂回同一条需求下——`sourceTodoId`
 * 就是需求行徽标的挂载点），带上**关联材料的名字**（人能读、助理也能按名字去资产
 * 列表里找），⛔ 不带 refs 的原始 token 之外的任何内部字段。
 *
 * `refSources` 用来把 `asset:<id>` 换回文件名。换不出来（资产列表还没取到）就
 * **不写那一条**——⛔ 宁可少说一句，也不要在正文里塞一串用户看不懂的 id。
 */
export function buildTodoDecomposeRequest(
  todo: Todo,
  targetItemKind: TodoItemKind,
  refSources: ProjectRefSources,
): string {
  const materials = todo.refs
    .map((token) => ({
      id: splitRefToken(token).name,
      name: resolveRefLabel(token, refSources).name,
    }))
    // 换不出人话的（解析结果仍等于 token 里那截 id）不进正文。
    .filter((entry) => entry.name.length > 0 && entry.name !== entry.id)
    .map((entry) => entry.name);
  const lines = [
    `请把项目里这条${todo.itemKind === 'requirement' ? '需求' : '任务'}拆成${
      targetItemKind === 'requirement' ? '子需求' : '子任务'
    }草案，交我审阅。`,
    `拆解源：${todo.title}`,
    `拆解源编号：${todo.id}`,
    `目标种类：${targetItemKind === 'requirement' ? '需求' : '任务'}`,
  ];
  if (todo.description.trim().length > 0) lines.push(`拆解源说明：${todo.description.trim()}`);
  if (materials.length > 0) lines.push(`关联资料：${materials.join('、')}`);
  lines.push(`请先读当前拆解源与上述资料，再给出草案；草案挂到当前拆解源下，我确认后才成单。`);
  return lines.join('\n');
}

/** 资产 → 一段请求助理据此拆解的正文（还没有需求，先让它读文档）。 */
export function buildAssetDecomposeRequest(file: Pick<ProjectFile, 'filename'>): string {
  return [
    `请读项目资产「${file.filename}」，把里面要做的事拆成任务草案，交我审阅。`,
    `每条草案说清要做什么、怎么算做完；我确认后才成单。`,
  ].join('\n');
}
