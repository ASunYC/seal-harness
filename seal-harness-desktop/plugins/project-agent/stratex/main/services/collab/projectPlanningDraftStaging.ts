import { randomUUID } from 'node:crypto';

import {
  PROJECT_PLANNING_DRAFTS_PER_ACCOUNT,
  PROJECT_PLANNING_DRAFTS_PER_SESSION,
  ProjectPlanningDraftSchema,
  type ProjectPlanningDraft,
  type ProjectPlanningDraftDiscardOutcome,
} from '../../../../../projects/stratex/shared/protocol/project-planning-draft.js';

/**
 * 项目助理**规划草案**的暂存区（mil-11，ADR-0045，Main-only，只在内存）。
 *
 * `project_draft_milestone` / `project_draft_iteration` 校验通过后把草案放在这里；渲染层看到工具完成信号，
 * 凭会话编号经 `project:planning-draft-list` 取回来做审阅卡。用户在审阅弹层确认时，提交的是**表单当前值**，
 * 走手工新建的那两条通道；成功或忽略后经 `project:planning-draft-discard` 清掉这一份。
 *
 * 三条纪律：
 *  - **按账号×会话分格**：读与清都要同时给出账号与会话，另一个账号拿同一个会话编号什么也读不到。
 *    （IPC 层另外核「这个会话属于当前账号」，这里的分格是第二道。）
 *  - **到上限只拒绝、不淘汰**：每会话 {@link PROJECT_PLANNING_DRAFTS_PER_SESSION} 份、每账号
 *    {@link PROJECT_PLANNING_DRAFTS_PER_ACCOUNT} 份。满了新草案暂存失败并如实告诉模型，⛔ 不挤掉用户还没审的草案。
 *  - **只有两种清空**：会话被删除（scope=session）、换号或登出（scope=all）。二者记 `cleared`。
 *    应用重启后内存里的草案全部消失——这是接受的残余风险（ADR-0045），不写盘。
 *
 * 日志只记封闭集合（动作、种类、处置结果、份数、范围），⛔ 不记名称、目标说明、完成标准、负责人、所属里程碑。
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 暂存前的草案内容：编号与时刻由暂存区铸造，调用方给不了。 */
export type ProjectPlanningDraftContent = DistributiveOmit<
  ProjectPlanningDraft,
  'draftId' | 'createdAt'
>;

export interface ProjectPlanningDraftOwner {
  readonly accountKey: string;
  readonly sessionId: string;
}

export type ProjectPlanningDraftStageResult =
  | {
      readonly ok: true;
      readonly draft: ProjectPlanningDraft;
      readonly pendingInSession: number;
    }
  | { readonly ok: false; readonly reason: 'sessionFull' | 'accountFull' | 'invalid' };

export type ProjectPlanningDraftRemoveResult =
  | { readonly ok: true; readonly draft: ProjectPlanningDraft }
  | { readonly ok: false; readonly reason: 'draftNotFound' };

/**
 * 暂存区日志记录。结构上只装得下元数据：
 *  - `action`：stage / refuse / discard / clear；
 *  - `outcome`：staged / session_full / account_full / invalid / confirmed / dismissed / cleared；
 *  - `count`：暂存、拒绝、清除一份之后该会话剩余的待审阅份数；清空时是清掉的份数；
 *  - `scope`：只有 clear 有值（session＝会话被删除，all＝换号或登出）。
 */
export interface ProjectPlanningDraftLogRecord {
  readonly action: 'stage' | 'refuse' | 'discard' | 'clear';
  readonly accountKey: string | null;
  readonly sessionId: string | null;
  readonly kind: ProjectPlanningDraft['kind'] | null;
  readonly outcome:
    | 'staged'
    | 'session_full'
    | 'account_full'
    | 'invalid'
    | ProjectPlanningDraftDiscardOutcome
    | 'cleared';
  readonly count: number;
  readonly scope: 'session' | 'all' | null;
}

export interface ProjectPlanningDraftStagingOptions {
  /** 草案编号铸造器（缺省随机 UUID）；测试注入确定值。 */
  readonly newDraftId?: () => string;
  readonly now?: () => Date;
  readonly log?: (record: ProjectPlanningDraftLogRecord) => void;
}

export class ProjectPlanningDraftStaging {
  /** accountKey → sessionId → 该会话待审阅草案（按暂存先后）。数组只整体替换，不就地改。 */
  private byAccount = new Map<string, ReadonlyMap<string, readonly ProjectPlanningDraft[]>>();
  private readonly newDraftId: () => string;
  private readonly now: () => Date;
  private readonly log: (record: ProjectPlanningDraftLogRecord) => void;

  constructor(options: ProjectPlanningDraftStagingOptions = {}) {
    this.newDraftId = options.newDraftId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => undefined);
  }

  stage(
    owner: ProjectPlanningDraftOwner,
    content: ProjectPlanningDraftContent,
  ): ProjectPlanningDraftStageResult {
    const sessions = this.byAccount.get(owner.accountKey) ?? new Map();
    const inSession = sessions.get(owner.sessionId) ?? [];
    const inAccount = [...sessions.values()].reduce((total, drafts) => total + drafts.length, 0);
    if (inSession.length >= PROJECT_PLANNING_DRAFTS_PER_SESSION) {
      this.record(owner, content.kind, 'refuse', 'session_full', inSession.length);
      return { ok: false, reason: 'sessionFull' };
    }
    if (inAccount >= PROJECT_PLANNING_DRAFTS_PER_ACCOUNT) {
      this.record(owner, content.kind, 'refuse', 'account_full', inSession.length);
      return { ok: false, reason: 'accountFull' };
    }
    const parsed = ProjectPlanningDraftSchema.safeParse({
      ...content,
      draftId: this.newDraftId(),
      createdAt: this.now().toISOString(),
    });
    if (!parsed.success) {
      this.record(owner, content.kind, 'refuse', 'invalid', inSession.length);
      return { ok: false, reason: 'invalid' };
    }
    const nextInSession = [...inSession, parsed.data];
    this.replaceSession(owner, nextInSession);
    this.record(owner, parsed.data.kind, 'stage', 'staged', nextInSession.length);
    return { ok: true, draft: parsed.data, pendingInSession: nextInSession.length };
  }

  /** 该账号该会话里待审阅的草案（副本）。 */
  listForSession(accountKey: string, sessionId: string): readonly ProjectPlanningDraft[] {
    return [...(this.byAccount.get(accountKey)?.get(sessionId) ?? [])];
  }

  /** 清除一份：只认「这个账号的这个会话里的这个编号」，别处的同编号一律当不存在。 */
  discard(
    owner: ProjectPlanningDraftOwner,
    draftId: string,
    outcome: ProjectPlanningDraftDiscardOutcome,
  ): ProjectPlanningDraftRemoveResult {
    const inSession = this.byAccount.get(owner.accountKey)?.get(owner.sessionId) ?? [];
    const target = inSession.find((draft) => draft.draftId === draftId);
    if (!target) return { ok: false, reason: 'draftNotFound' };
    const remaining = inSession.filter((draft) => draft.draftId !== draftId);
    this.replaceSession(owner, remaining);
    this.record(owner, target.kind, 'discard', outcome, remaining.length);
    return { ok: true, draft: target };
  }

  /** 会话被删除：清掉该会话全部草案。返回清掉的份数。 */
  clearSession(accountKey: string, sessionId: string): number {
    const removed = this.byAccount.get(accountKey)?.get(sessionId)?.length ?? 0;
    if (removed === 0) return 0;
    this.replaceSession({ accountKey, sessionId }, []);
    this.log({
      action: 'clear',
      accountKey,
      sessionId,
      kind: null,
      outcome: 'cleared',
      count: removed,
      scope: 'session',
    });
    return removed;
  }

  /** 换号或登出：全部清空。返回清掉的份数。 */
  clearAll(): number {
    const removed = [...this.byAccount.values()].reduce(
      (total, sessions) =>
        total + [...sessions.values()].reduce((sum, drafts) => sum + drafts.length, 0),
      0,
    );
    this.byAccount = new Map();
    if (removed > 0) {
      this.log({
        action: 'clear',
        accountKey: null,
        sessionId: null,
        kind: null,
        outcome: 'cleared',
        count: removed,
        scope: 'all',
      });
    }
    return removed;
  }

  private replaceSession(
    owner: ProjectPlanningDraftOwner,
    drafts: readonly ProjectPlanningDraft[],
  ): void {
    const sessions = new Map(this.byAccount.get(owner.accountKey) ?? []);
    if (drafts.length === 0) sessions.delete(owner.sessionId);
    else sessions.set(owner.sessionId, drafts);
    const accounts = new Map(this.byAccount);
    if (sessions.size === 0) accounts.delete(owner.accountKey);
    else accounts.set(owner.accountKey, sessions);
    this.byAccount = accounts;
  }

  private record(
    owner: ProjectPlanningDraftOwner,
    kind: ProjectPlanningDraft['kind'],
    action: 'stage' | 'refuse' | 'discard',
    outcome: ProjectPlanningDraftLogRecord['outcome'],
    count: number,
  ): void {
    this.log({
      action,
      accountKey: owner.accountKey,
      sessionId: owner.sessionId,
      kind,
      outcome,
      count,
      scope: null,
    });
  }
}
