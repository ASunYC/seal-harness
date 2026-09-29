import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { IPC } from '../../../../stratex/shared/ipc/channels.js';
import { PROJECT_COLLAB_REFERENCE_CODES } from '../../../../stratex/shared/protocol/project-collab.js';
import type {
  ProjectIterationListItem,
  ProjectIterationRequirement,
  ProjectIterationRequirementLink,
  ProjectMilestoneListItem,
} from '../../../../stratex/shared/protocol/project-planning.js';
import {
  isSafePlanningEvidenceLinkUrl,
  openablePlanningEvidenceLink,
  ProjectEvidenceLinkOpenRequestSchema,
  type ProjectIterationLifecycleEvent,
  type ProjectMilestoneLifecycleEvent,
} from '../../../../stratex/shared/protocol/project-planning-lifecycle.js';
import {
  registerProjectPlanningHandlers,
  type ProjectPlanningClientPort,
  type ProjectPlanningIpcDependencies,
} from '../../../../stratex/main/ipc/projectCollabHandlersPlanning.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const MILESTONE_ID = '22222222-2222-4222-8222-222222222222';
const ITERATION_ID = '33333333-3333-4333-8333-333333333333';

const MILESTONE: ProjectMilestoneListItem = {
  id: MILESTONE_ID,
  name: '成员邀请与权限管理',
  objectiveMd: '',
  ownerSubject: null,
  status: 'open',
  startAt: null,
  dueAt: null,
  archivedAt: null,
  version: 1,
  creatorSubject: 'u-alice',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  iterationSummary: { total: 0, open: 0, completed: 0 },
  visibleRequirementCount: 0,
};

const REQUIREMENT_ID = '44444444-4444-4444-8444-444444444444';
const LINK_ID = '55555555-5555-4555-8555-555555555555';

/**
 * 一条关联需求的授权摘要。
 *
 * ⚠️ 标题是**用户亲笔**：它进 REST 投影（列表第二列要显示），⛔ 但绝不进事件面。
 */
const LINKED_REQUIREMENT: ProjectIterationRequirement = {
  requirementId: REQUIREMENT_ID,
  title: '邀请码可撤销',
  status: 'notStarted',
  linkState: 'active',
  linkedAt: '2026-09-02T00:00:00Z',
  unlinkedAt: null,
};

const LINK: ProjectIterationRequirementLink = {
  id: LINK_ID,
  iterationId: ITERATION_ID,
  requirementId: REQUIREMENT_ID,
  state: 'active',
  linkedAt: '2026-09-02T00:00:00Z',
  unlinkedAt: null,
  linkedBySubject: 'u-bob',
  version: 1,
};

/**
 * 一轮迭代的**列表行**形状（本体 + 关联需求的授权摘要）。
 *
 * ⭐ 列表 / 新建 / 修改 / 关联 / 移出五条出参**全部**用这一份形状：单条与列表逐字同形，
 *    否则渲染层把改完那一条拼回列表时关联摘要会消失。
 */
const ITERATION: ProjectIterationListItem = {
  id: ITERATION_ID,
  milestoneId: MILESTONE_ID,
  name: '第一轮',
  criteriaMd: '',
  ownerSubject: 'u-bob',
  priority: 'medium',
  status: 'open',
  dueAt: null,
  archivedAt: null,
  version: 1,
  creatorSubject: 'u-alice',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  linkedRequirements: [LINKED_REQUIREMENT],
  linkedRequirementsHasMore: false,
};

const LINK_WRITE = {
  changed: true,
  link: LINK,
  iteration: ITERATION,
  requirementId: REQUIREMENT_ID,
  previousIterationId: null,
} as const;

const EVENT_ID = '66666666-6666-4666-8666-666666666666';

/**
 * 阶段记录一行。⚠️ `reason` / `evidenceRefs` 是用户亲笔正文：只经 REST 读回，⛔ 不进事件面。
 */
const ITERATION_EVENT: ProjectIterationLifecycleEvent = {
  id: EVENT_ID,
  iterationId: ITERATION_ID,
  fromStatus: 'open',
  toStatus: 'completed',
  actorSubject: 'u-alice',
  reason: '三条验收用例全部通过',
  evidenceRefs: [`todo:${REQUIREMENT_ID}`],
  occurredAt: '2026-09-05T08:00:00Z',
};

const MILESTONE_EVENT: ProjectMilestoneLifecycleEvent = {
  id: EVENT_ID,
  milestoneId: MILESTONE_ID,
  fromStatus: 'completed',
  toStatus: 'open',
  actorSubject: 'u-alice',
  reason: '客户追加一轮验收',
  evidenceRefs: [],
  occurredAt: '2026-09-06T08:00:00Z',
};

type Handler = (event: unknown, input: unknown) => Promise<unknown>;

function fakePlanning(
  overrides: Partial<ProjectPlanningClientPort> = {},
): ProjectPlanningClientPort {
  return {
    listMilestones: vi.fn(async () => ({
      ok: true as const,
      value: { items: [MILESTONE], total: 1, page: 1, pageSize: 20 },
    })),
    createMilestone: vi.fn(async () => ({ ok: true as const, value: MILESTONE })),
    updateMilestone: vi.fn(async () => ({ ok: true as const, value: MILESTONE })),
    listIterations: vi.fn(async () => ({
      ok: true as const,
      value: {
        items: [ITERATION],
        total: 1,
        page: 1,
        pageSize: 20,
        groupCounts: { mine: 1, open: 1, completed: 0 },
      },
    })),
    createIteration: vi.fn(async () => ({ ok: true as const, value: ITERATION })),
    updateIteration: vi.fn(async () => ({ ok: true as const, value: ITERATION })),
    listIterationRequirements: vi.fn(async () => ({
      ok: true as const,
      value: { items: [LINKED_REQUIREMENT], total: 1, page: 1, pageSize: 20 },
    })),
    linkIterationRequirement: vi.fn(async () => ({ ok: true as const, value: LINK_WRITE })),
    unlinkIterationRequirement: vi.fn(async () => ({
      ok: true as const,
      value: {
        ...LINK_WRITE,
        link: { ...LINK, state: 'closed' as const, unlinkedAt: '2026-09-03T00:00:00Z' },
      },
    })),
    saveIterationSchedule: vi.fn(async () => ({
      ok: true as const,
      value: {
        changed: true,
        iterations: [{ ...ITERATION, dueAt: '2026-09-25T00:00:00Z', version: 2 }],
      },
    })),
    saveRequirementSchedule: vi.fn(async () => ({
      ok: true as const,
      value: {
        changed: true,
        iterations: [ITERATION],
        moves: [
          { requirementId: REQUIREMENT_ID, iterationId: ITERATION_ID, previousIterationId: null },
        ],
      },
    })),
    listRequirementPlacements: vi.fn(async () => ({
      ok: true as const,
      value: {
        items: [
          {
            requirementId: REQUIREMENT_ID,
            title: '邀请码可撤销',
            status: 'notStarted' as const,
            version: 1,
            placement: null,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 100,
        unscheduledTotal: 1,
      },
    })),
    completeMilestone: vi.fn(async () => ({
      ok: true as const,
      value: { ...MILESTONE, status: 'completed' as const, version: 2 },
    })),
    reopenMilestone: vi.fn(async () => ({ ok: true as const, value: MILESTONE })),
    completeIteration: vi.fn(async () => ({
      ok: true as const,
      value: { ...ITERATION, status: 'completed' as const, version: 2 },
    })),
    reopenIteration: vi.fn(async () => ({ ok: true as const, value: ITERATION })),
    listMilestoneEvents: vi.fn(async () => ({
      ok: true as const,
      value: { items: [MILESTONE_EVENT], total: 1, page: 1, pageSize: 100 },
    })),
    listIterationEvents: vi.fn(async () => ({
      ok: true as const,
      value: { items: [ITERATION_EVENT], total: 1, page: 1, pageSize: 100 },
    })),
    ...overrides,
  };
}

interface HarnessOptions {
  readonly planning?: ProjectPlanningClientPort;
  readonly dependencies?: ProjectPlanningIpcDependencies | null;
  readonly authorize?: (event: unknown) => boolean;
  readonly activeAccount?: () => { accountKey: string; authEpoch: number } | null;
  readonly accessToken?: () => Promise<string | null>;
  readonly openExternalLink?: (url: string) => Promise<void>;
}

function harness(options: HarnessOptions = {}): {
  readonly handlers: Map<string, Handler>;
  readonly planning: ProjectPlanningClientPort;
} {
  const handlers = new Map<string, Handler>();
  const planning = options.planning ?? fakePlanning();
  const deps: ProjectPlanningIpcDependencies = {
    planning,
    accessToken: options.accessToken ?? (async () => 'token'),
    openExternalLink: options.openExternalLink ?? (async () => undefined),
  };
  registerProjectPlanningHandlers(
    { handle: (channel, listener) => handlers.set(channel, listener) },
    {
      dependencies: options.dependencies === undefined ? deps : options.dependencies,
      authorize: options.authorize ?? (() => true),
      activeAccount: options.activeAccount ?? (() => ({ accountKey: 'acc-1', authEpoch: 1 })),
    },
  );
  return { handlers, planning };
}

function handlerOf(handlers: Map<string, Handler>, channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`handler missing for ${channel}`);
  return handler;
}

const CHANNELS = [
  IPC.PROJECT_MILESTONE_LIST,
  IPC.PROJECT_MILESTONE_CREATE,
  IPC.PROJECT_MILESTONE_UPDATE,
  IPC.PROJECT_ITERATION_LIST,
  IPC.PROJECT_ITERATION_CREATE,
  IPC.PROJECT_ITERATION_UPDATE,
] as const;

describe('规划域 IPC 六条通道', () => {
  it('六条全部注册', () => {
    const { handlers } = harness();
    for (const channel of CHANNELS) expect(handlers.has(channel)).toBe(true);
  });

  it('列表通道原样透传服务端聚合（⛔ 不在这里重算，也不相加分组当总数）', async () => {
    const { handlers } = harness();
    await expect(
      handlerOf(handlers, IPC.PROJECT_MILESTONE_LIST)({}, { projectId: PROJECT_ID }),
    ).resolves.toEqual({ ok: true, items: [MILESTONE], total: 1, page: 1, pageSize: 20 });
    const rounds = await handlerOf(handlers, IPC.PROJECT_ITERATION_LIST)(
      {},
      { projectId: PROJECT_ID },
    );
    expect(rounds).toEqual({
      ok: true,
      items: [ITERATION],
      total: 1,
      page: 1,
      pageSize: 20,
      groupCounts: { mine: 1, open: 1, completed: 0 },
    });
  });

  it('目标列表：计划时间段原样交给规划客户端；倒挂在入站判 invalidRequest（CORE-08，ADR-0042）', async () => {
    const { handlers, planning } = harness();
    const window = { planFrom: '2026-09-01T00:00:00.000Z', planTo: '2026-10-01T00:00:00.000Z' };

    await handlerOf(handlers, IPC.PROJECT_MILESTONE_LIST)({}, { projectId: PROJECT_ID, ...window });
    expect(planning.listMilestones).toHaveBeenCalledWith('token', {
      projectId: PROJECT_ID,
      ...window,
    });

    await expect(
      handlerOf(handlers, IPC.PROJECT_MILESTONE_LIST)(
        {},
        { projectId: PROJECT_ID, planFrom: window.planTo, planTo: window.planFrom },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'invalidRequest' });
    expect(planning.listMilestones).toHaveBeenCalledTimes(1);
  });

  it('⭐ clientRequestId 原样透传（本层不重新生成——重新生成等于把幂等关掉）', async () => {
    const planning = fakePlanning();
    const { handlers } = harness({ planning });
    await handlerOf(handlers, IPC.PROJECT_MILESTONE_CREATE)(
      {},
      { projectId: PROJECT_ID, clientRequestId: 'req-from-ui', name: '成员邀请与权限管理' },
    );
    expect(planning.createMilestone).toHaveBeenCalledWith('token', {
      projectId: PROJECT_ID,
      clientRequestId: 'req-from-ui',
      name: '成员邀请与权限管理',
    });
  });

  it('缺 clientRequestId 的写请求一律 invalidRequest（幂等键必填）', async () => {
    const planning = fakePlanning();
    const { handlers } = harness({ planning });
    const result = await handlerOf(handlers, IPC.PROJECT_MILESTONE_CREATE)(
      {},
      { projectId: PROJECT_ID, name: '成员邀请与权限管理' },
    );
    expect(result).toMatchObject({ ok: false, code: 'invalidRequest' });
    expect(planning.createMilestone).not.toHaveBeenCalled();
  });

  it('⛔ 请求里塞账号字段过不了桥（strictObject），也到不了网络层', async () => {
    const planning = fakePlanning();
    const { handlers } = harness({ planning });
    for (const forbidden of ['accountKey', 'prompt', 'ownerDisplayName']) {
      const result = await handlerOf(handlers, IPC.PROJECT_MILESTONE_CREATE)(
        {},
        {
          projectId: PROJECT_ID,
          clientRequestId: 'req-1',
          name: '成员邀请与权限管理',
          [forbidden]: 'x',
        },
      );
      expect(result).toMatchObject({ ok: false, code: 'invalidRequest' });
    }
    expect(planning.createMilestone).not.toHaveBeenCalled();
  });

  it('⛔ 轮次 PATCH 带 milestoneId 过不了桥（首期不支持跨目标移动，契约层不表达它）', async () => {
    const planning = fakePlanning();
    const { handlers } = harness({ planning });
    const result = await handlerOf(handlers, IPC.PROJECT_ITERATION_UPDATE)(
      {},
      {
        projectId: PROJECT_ID,
        iterationId: ITERATION_ID,
        expectedVersion: 1,
        clientRequestId: 'req-move',
        milestoneId: MILESTONE_ID,
      },
    );
    expect(result).toMatchObject({ ok: false, code: 'invalidRequest', currentVersion: null });
    expect(planning.updateIteration).not.toHaveBeenCalled();
  });

  it('PATCH 一项都不带也是 invalidRequest（至少带一项变更）', async () => {
    const { handlers } = harness();
    await expect(
      handlerOf(handlers, IPC.PROJECT_ITERATION_UPDATE)(
        {},
        {
          projectId: PROJECT_ID,
          iterationId: ITERATION_ID,
          expectedVersion: 1,
          clientRequestId: 'req-noop',
        },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'invalidRequest' });
  });
});

describe('规划域 IPC 失败与门禁', () => {
  it('409 带回 currentVersion；其它失败码的 currentVersion 恒为 null', async () => {
    const conflicting = fakePlanning({
      updateMilestone: vi.fn(async () => ({
        ok: false as const,
        code: 'conflict' as const,
        currentVersion: 9,
      })),
    });
    const { handlers } = harness({ planning: conflicting });
    await expect(
      handlerOf(handlers, IPC.PROJECT_MILESTONE_UPDATE)(
        {},
        {
          projectId: PROJECT_ID,
          milestoneId: MILESTONE_ID,
          expectedVersion: 3,
          clientRequestId: 'req-1',
          name: '改名',
        },
      ),
    ).resolves.toEqual({
      ok: false,
      code: 'conflict',
      message: expect.any(String),
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.conflict,
      currentVersion: 9,
    });

    const forbidden = fakePlanning({
      updateMilestone: vi.fn(async () => ({ ok: false as const, code: 'forbidden' as const })),
    });
    const denied = harness({ planning: forbidden });
    await expect(
      handlerOf(denied.handlers, IPC.PROJECT_MILESTONE_UPDATE)(
        {},
        {
          projectId: PROJECT_ID,
          milestoneId: MILESTONE_ID,
          expectedVersion: 3,
          clientRequestId: 'req-2',
          name: '改名',
        },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'forbidden', currentVersion: null });
  });

  it('⭐ serverCode 原样透传：三种 409 与本期不可改字段能在渲染层分开', async () => {
    for (const serverCode of [
      'idempotency_conflict',
      'idempotency_retry',
      'milestone_archived',
      'iteration_milestone_immutable',
    ]) {
      const planning = fakePlanning({
        createIteration: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode,
        })),
      });
      const { handlers } = harness({ planning });
      await expect(
        handlerOf(handlers, IPC.PROJECT_ITERATION_CREATE)(
          {},
          { projectId: PROJECT_ID, clientRequestId: 'req-3', name: '一轮' },
        ),
      ).resolves.toMatchObject({ ok: false, code: 'conflict', serverCode });
    }
  });

  it('未登录 / 未授权 / 未装配各有明确失败码，且一律不打网络', async () => {
    const planning = fakePlanning();
    const unauthorized = harness({ planning, authorize: () => false });
    await expect(
      handlerOf(unauthorized.handlers, IPC.PROJECT_MILESTONE_LIST)({}, { projectId: PROJECT_ID }),
    ).resolves.toMatchObject({ ok: false, code: 'authRequired' });

    const noAccount = harness({ planning, activeAccount: () => null });
    await expect(
      handlerOf(noAccount.handlers, IPC.PROJECT_MILESTONE_LIST)({}, { projectId: PROJECT_ID }),
    ).resolves.toMatchObject({ ok: false, code: 'authRequired' });

    const unassembled = harness({ dependencies: null });
    await expect(
      handlerOf(unassembled.handlers, IPC.PROJECT_MILESTONE_LIST)({}, { projectId: PROJECT_ID }),
    ).resolves.toMatchObject({ ok: false, code: 'unavailable' });

    expect(planning.listMilestones).not.toHaveBeenCalled();
  });

  it('拿不到令牌 ⇒ credentialRejected（不打网络）', async () => {
    const planning = fakePlanning();
    const { handlers } = harness({ planning, accessToken: async () => null });
    await expect(
      handlerOf(handlers, IPC.PROJECT_ITERATION_LIST)({}, { projectId: PROJECT_ID }),
    ).resolves.toMatchObject({ ok: false, code: 'credentialRejected' });
    expect(planning.listIterations).not.toHaveBeenCalled();
  });

  it('⭐ 在途换账号：结果一律 denied，不把上一个账号的数据发给下一个账号', async () => {
    let epoch = 1;
    const planning = fakePlanning({
      listMilestones: vi.fn(async () => {
        // 请求在飞的时候用户换了号。
        epoch = 2;
        return {
          ok: true as const,
          value: { items: [MILESTONE], total: 1, page: 1, pageSize: 20 },
        };
      }),
    });
    const { handlers } = harness({
      planning,
      activeAccount: () => ({ accountKey: 'acc-1', authEpoch: epoch }),
    });
    await expect(
      handlerOf(handlers, IPC.PROJECT_MILESTONE_LIST)({}, { projectId: PROJECT_ID }),
    ).resolves.toMatchObject({ ok: false, code: 'authRequired' });
  });

  it('客户端抛异常收敛为 transient（异常消息不跨 IPC）', async () => {
    const planning = fakePlanning({
      createMilestone: vi.fn(async () => {
        throw new Error('内部细节：token=abc');
      }),
    });
    const { handlers } = harness({ planning });
    const result = (await handlerOf(handlers, IPC.PROJECT_MILESTONE_CREATE)(
      {},
      { projectId: PROJECT_ID, clientRequestId: 'req-4', name: '成员邀请与权限管理' },
    )) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: false, code: 'transient' });
    expect(JSON.stringify(result)).not.toContain('token=abc');
  });

  it('⛔ 本层不做角色判定：editor 的越权请求照样发出去，由服务端拒', async () => {
    // 判定挪到这里会得到两份会各自演化的权限表，而只有服务端那份拦得住绕过界面的调用。
    const planning = fakePlanning({
      createMilestone: vi.fn(async () => ({
        ok: false as const,
        code: 'forbidden' as const,
        serverCode: 'forbidden',
      })),
    });
    const { handlers } = harness({ planning });
    await expect(
      handlerOf(handlers, IPC.PROJECT_MILESTONE_CREATE)(
        {},
        { projectId: PROJECT_ID, clientRequestId: 'req-5', name: '成员想建目标' },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'forbidden' });
    expect(planning.createMilestone).toHaveBeenCalledOnce();
  });
});

describe('迭代排期整批保存通道（MIL-06）', () => {
  const REQUEST = {
    projectId: PROJECT_ID,
    milestoneId: MILESTONE_ID,
    clientRequestId: 'req-schedule-1',
    items: [{ iterationId: ITERATION_ID, dueAt: '2026-09-25', expectedVersion: 1 }],
  } as const;

  it('注册并原样透传整批请求与成功出参（⛔ 不拆成逐条改单）', async () => {
    const { handlers, planning } = harness();
    const result = await handlerOf(handlers, IPC.PROJECT_ITERATION_SCHEDULE_SAVE)({}, REQUEST);
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(planning.saveIterationSchedule).toHaveBeenCalledWith('token', REQUEST);
    expect(planning.updateIteration).not.toHaveBeenCalled();
  });

  it('版本冲突：serverCode 与全部冲突条目原样透传，其它失败 conflicts 为空数组', async () => {
    const conflicts = [{ iterationId: ITERATION_ID, currentVersion: 3 }];
    const conflicted = harness({
      planning: fakePlanning({
        saveIterationSchedule: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'version_conflict',
          conflicts,
        })),
      }),
    });
    await expect(
      handlerOf(conflicted.handlers, IPC.PROJECT_ITERATION_SCHEDULE_SAVE)({}, REQUEST),
    ).resolves.toEqual({
      ok: false,
      code: 'conflict',
      message: '内容已被他人更新，请刷新后重试。',
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.conflict,
      serverCode: 'version_conflict',
      conflicts,
    });

    const retry = harness({
      planning: fakePlanning({
        saveIterationSchedule: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'idempotency_retry',
        })),
      }),
    });
    await expect(
      handlerOf(retry.handlers, IPC.PROJECT_ITERATION_SCHEDULE_SAVE)({}, REQUEST),
    ).resolves.toMatchObject({ ok: false, serverCode: 'idempotency_retry', conflicts: [] });
  });

  it('入参不合法（带时分 / 同一轮两次 / 非真实日期）在本层就拒，不发请求', async () => {
    const { handlers, planning } = harness();
    for (const items of [
      [{ iterationId: ITERATION_ID, dueAt: '2026-09-25T08:00:00Z', expectedVersion: 1 }],
      [
        { iterationId: ITERATION_ID, dueAt: '2026-09-25', expectedVersion: 1 },
        { iterationId: ITERATION_ID, dueAt: '2026-09-26', expectedVersion: 1 },
      ],
      [{ iterationId: ITERATION_ID, dueAt: '2026-02-30', expectedVersion: 1 }],
    ]) {
      await expect(
        handlerOf(handlers, IPC.PROJECT_ITERATION_SCHEDULE_SAVE)({}, { ...REQUEST, items }),
      ).resolves.toMatchObject({ ok: false, code: 'invalidRequest', conflicts: [] });
    }
    expect(planning.saveIterationSchedule).not.toHaveBeenCalled();
  });
});

describe('安排需求整批保存与需求排期现状通道（MIL-09，ADR-0038）', () => {
  const REQUEST = {
    projectId: PROJECT_ID,
    milestoneId: MILESTONE_ID,
    clientRequestId: 'req-arrange-1',
    items: [
      {
        requirementId: REQUIREMENT_ID,
        iterationId: ITERATION_ID,
        expectedRequirementVersion: 1,
        expectedIterationId: null,
      },
    ],
  } as const;

  it('注册并原样透传整批请求与成功出参（⛔ 不拆成逐条关联 / 移出）', async () => {
    const { handlers, planning } = harness();
    const result = await handlerOf(handlers, IPC.PROJECT_REQUIREMENT_SCHEDULE_SAVE)({}, REQUEST);
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      moves: [{ requirementId: REQUIREMENT_ID }],
    });
    expect(planning.saveRequirementSchedule).toHaveBeenCalledWith('token', REQUEST);
    expect(planning.linkIterationRequirement).not.toHaveBeenCalled();
    expect(planning.unlinkIterationRequirement).not.toHaveBeenCalled();
  });

  it('冲突：serverCode 与全部冲突条目原样透传；其它失败 conflicts 为空数组', async () => {
    const conflicts = [
      { requirementId: REQUIREMENT_ID, currentVersion: 2, currentIterationId: ITERATION_ID },
    ];
    const conflicted = harness({
      planning: fakePlanning({
        saveRequirementSchedule: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'version_conflict',
          conflicts,
        })),
      }),
    });
    await expect(
      handlerOf(conflicted.handlers, IPC.PROJECT_REQUIREMENT_SCHEDULE_SAVE)({}, REQUEST),
    ).resolves.toMatchObject({
      ok: false,
      code: 'conflict',
      serverCode: 'version_conflict',
      conflicts,
    });

    const archived = harness({
      planning: fakePlanning({
        saveRequirementSchedule: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'milestone_archived',
        })),
      }),
    });
    await expect(
      handlerOf(archived.handlers, IPC.PROJECT_REQUIREMENT_SCHEDULE_SAVE)({}, REQUEST),
    ).resolves.toMatchObject({ ok: false, serverCode: 'milestone_archived', conflicts: [] });
  });

  it('入参不合法（同一需求两次 / 缺「不排」的显式 null）在本层就拒，不发请求', async () => {
    const { handlers, planning } = harness();
    const item = REQUEST.items[0];
    const missingCurrent: Record<string, unknown> = { ...item };
    delete missingCurrent.expectedIterationId;
    for (const items of [[item, item], [missingCurrent]]) {
      await expect(
        handlerOf(handlers, IPC.PROJECT_REQUIREMENT_SCHEDULE_SAVE)({}, { ...REQUEST, items }),
      ).resolves.toMatchObject({ ok: false, code: 'invalidRequest', conflicts: [] });
    }
    expect(planning.saveRequirementSchedule).not.toHaveBeenCalled();
  });

  it('需求排期现状：原样透传未排条数（⛔ 不在这一层重算）', async () => {
    const { handlers, planning } = harness();
    const request = { projectId: PROJECT_ID, pageSize: 100 };
    await expect(
      handlerOf(handlers, IPC.PROJECT_REQUIREMENT_PLACEMENT_LIST)({}, request),
    ).resolves.toMatchObject({ ok: true, total: 1, unscheduledTotal: 1 });
    expect(planning.listRequirementPlacements).toHaveBeenCalledWith('token', request);
  });

  it('整组候选完整性经过IPC仍完整透传', async () => {
    const planning = fakePlanning({
      listRequirementPlacements: vi.fn(async () => ({
        ok: true as const,
        value: {
          items: [
            {
              requirementId: REQUIREMENT_ID,
              title: 'root',
              status: 'notStarted' as const,
              version: 1,
              placement: null,
              parentId: null,
              ancestorPath: [],
              hasParent: false,
              pathComplete: true,
              hasVisibleChildren: false,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 100,
          unscheduledTotal: 1,
          selectionScope: 'group' as const,
          groupRootId: REQUIREMENT_ID,
          groupComplete: true,
        },
      })),
    });
    const { handlers } = harness({ planning });
    await expect(
      handlerOf(handlers, IPC.PROJECT_REQUIREMENT_PLACEMENT_LIST)(
        {},
        {
          projectId: PROJECT_ID,
          groupRootId: REQUIREMENT_ID,
          pageSize: 20,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      selectionScope: 'group',
      groupRootId: REQUIREMENT_ID,
      groupComplete: true,
    });
  });

  it('服务端强制的周期 / 负责人码随失败信封透传（MIL-10）；失败信封里没有条数键（ADR-0040）', async () => {
    const guarded = harness({
      planning: fakePlanning({
        updateMilestone: vi.fn(async () => ({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'milestone_period_excludes_iterations',
        })),
        updateIteration: vi.fn(async () => ({
          ok: false as const,
          code: 'rejected' as const,
          serverCode: 'owner_not_member',
        })),
      }),
    });
    const milestone = await handlerOf(guarded.handlers, IPC.PROJECT_MILESTONE_UPDATE)(
      {},
      {
        projectId: PROJECT_ID,
        milestoneId: MILESTONE_ID,
        expectedVersion: 1,
        clientRequestId: 'req-period',
        dueAt: '2026-10-25T00:00:00.000Z',
      },
    );
    expect(milestone).toMatchObject({
      ok: false,
      code: 'conflict',
      serverCode: 'milestone_period_excludes_iterations',
      currentVersion: null,
    });
    expect(milestone).not.toHaveProperty('activeRequirementCount');
    await expect(
      handlerOf(guarded.handlers, IPC.PROJECT_ITERATION_UPDATE)(
        {},
        {
          projectId: PROJECT_ID,
          iterationId: ITERATION_ID,
          expectedVersion: 1,
          clientRequestId: 'req-owner',
          ownerSubject: 'u-left',
        },
      ),
    ).resolves.toMatchObject({ ok: false, serverCode: 'owner_not_member' });
  });
});

const LIFECYCLE_CHANNELS = [
  IPC.PROJECT_MILESTONE_COMPLETE,
  IPC.PROJECT_MILESTONE_REOPEN,
  IPC.PROJECT_ITERATION_COMPLETE,
  IPC.PROJECT_ITERATION_REOPEN,
  IPC.PROJECT_MILESTONE_EVENTS,
  IPC.PROJECT_ITERATION_EVENTS,
] as const;

const COMPLETE_ITERATION = {
  projectId: PROJECT_ID,
  iterationId: ITERATION_ID,
  expectedVersion: 1,
  clientRequestId: 'req-life-1',
  reason: '三条验收用例全部通过',
  evidenceRefs: [`todo:${REQUIREMENT_ID}`],
} as const;

describe('规划域生命周期六条通道（MIL-07）', () => {
  it('六条全部注册，写动作按请求原样交给客户端（请求号不在这一层重生成）', async () => {
    const planning = fakePlanning();
    const { handlers } = harness({ planning });
    for (const channel of LIFECYCLE_CHANNELS) expect(handlers.has(channel)).toBe(true);

    await expect(
      handlerOf(handlers, IPC.PROJECT_ITERATION_COMPLETE)({}, COMPLETE_ITERATION),
    ).resolves.toEqual({
      ok: true,
      iteration: { ...ITERATION, status: 'completed', version: 2 },
    });
    // ⭐ 幂等键原样透传：在这里重生成等于每次重试都是新请求。
    expect(planning.completeIteration).toHaveBeenCalledWith('token', COMPLETE_ITERATION);
  });

  it('完成与重开各走各的客户端方法（目标 / 轮次不串、动作不反）', async () => {
    const planning = fakePlanning();
    const { handlers } = harness({ planning });
    const reopenMilestone = {
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
      expectedVersion: 4,
      clientRequestId: 'req-life-2',
      reason: '客户追加一轮验收',
      evidenceRefs: [],
    };
    await expect(
      handlerOf(handlers, IPC.PROJECT_MILESTONE_REOPEN)({}, reopenMilestone),
    ).resolves.toMatchObject({ ok: true, milestone: { id: MILESTONE_ID } });
    expect(planning.reopenMilestone).toHaveBeenCalledWith('token', reopenMilestone);
    expect(planning.completeMilestone).not.toHaveBeenCalled();

    await handlerOf(handlers, IPC.PROJECT_ITERATION_REOPEN)(
      {},
      { ...COMPLETE_ITERATION, clientRequestId: 'req-life-3', evidenceRefs: [] },
    );
    expect(planning.reopenIteration).toHaveBeenCalledTimes(1);
    expect(planning.completeIteration).not.toHaveBeenCalled();
  });

  it('⭐ 失败透传：422 必填码与 409 业务码带 serverCode，版本冲突另带 currentVersion', async () => {
    const planning = fakePlanning({
      completeIteration: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false as const,
          code: 'rejected' as const,
          serverCode: 'completion_evidence_required',
        })
        .mockResolvedValueOnce({ ok: false as const, code: 'conflict' as const, currentVersion: 7 })
        .mockResolvedValueOnce({
          ok: false as const,
          code: 'conflict' as const,
          serverCode: 'iteration_already_completed',
        }),
    });
    const { handlers } = harness({ planning });
    const complete = handlerOf(handlers, IPC.PROJECT_ITERATION_COMPLETE);

    await expect(complete({}, COMPLETE_ITERATION)).resolves.toEqual({
      ok: false,
      code: 'rejected',
      message: '请求被服务端拒绝。',
      referenceCode: PROJECT_COLLAB_REFERENCE_CODES.rejected,
      serverCode: 'completion_evidence_required',
      currentVersion: null,
    });
    await expect(complete({}, COMPLETE_ITERATION)).resolves.toMatchObject({
      ok: false,
      code: 'conflict',
      currentVersion: 7,
    });
    await expect(complete({}, COMPLETE_ITERATION)).resolves.toMatchObject({
      ok: false,
      code: 'conflict',
      serverCode: 'iteration_already_completed',
      currentVersion: null,
    });
  });

  it('非法入参（带账号字段 / 证据塞正文 / 缺幂等键）⇒ invalidRequest，且不打网络', async () => {
    const planning = fakePlanning();
    const { handlers } = harness({ planning });
    const complete = handlerOf(handlers, IPC.PROJECT_ITERATION_COMPLETE);
    for (const input of [
      { ...COMPLETE_ITERATION, accountKey: 'acc-1' },
      { ...COMPLETE_ITERATION, evidenceRefs: ['这是一段正文不是引用'] },
      { ...COMPLETE_ITERATION, clientRequestId: '' },
    ]) {
      await expect(complete({}, input)).resolves.toMatchObject({
        ok: false,
        code: 'invalidRequest',
        currentVersion: null,
      });
    }
    expect(planning.completeIteration).not.toHaveBeenCalled();
  });

  it('阶段记录原样透传服务端投影；读失败只带 serverCode，不带版本号', async () => {
    const planning = fakePlanning({
      listMilestoneEvents: vi.fn(async () => ({
        ok: false as const,
        code: 'rejected' as const,
        serverCode: 'milestone_not_found',
      })),
    });
    const { handlers } = harness({ planning });

    await expect(
      handlerOf(handlers, IPC.PROJECT_ITERATION_EVENTS)(
        {},
        { projectId: PROJECT_ID, iterationId: ITERATION_ID, pageSize: 100 },
      ),
    ).resolves.toEqual({ ok: true, items: [ITERATION_EVENT], total: 1, page: 1, pageSize: 100 });
    expect(planning.listIterationEvents).toHaveBeenCalledWith('token', {
      projectId: PROJECT_ID,
      iterationId: ITERATION_ID,
      pageSize: 100,
    });

    const failed = (await handlerOf(handlers, IPC.PROJECT_MILESTONE_EVENTS)(
      {},
      { projectId: PROJECT_ID, milestoneId: MILESTONE_ID },
    )) as Record<string, unknown>;
    expect(failed).toMatchObject({
      ok: false,
      code: 'rejected',
      serverCode: 'milestone_not_found',
    });
    expect(failed).not.toHaveProperty('currentVersion');
  });

  it('在途换账号：生命周期写结果同样作废为 authRequired', async () => {
    let epoch = 1;
    const planning = fakePlanning({
      completeIteration: vi.fn(async () => {
        epoch = 2;
        return { ok: true as const, value: { ...ITERATION, status: 'completed' as const } };
      }),
    });
    const { handlers } = harness({
      planning,
      activeAccount: () => ({ accountKey: 'acc-1', authEpoch: epoch }),
    });
    await expect(
      handlerOf(handlers, IPC.PROJECT_ITERATION_COMPLETE)({}, COMPLETE_ITERATION),
    ).resolves.toMatchObject({ ok: false, code: 'authRequired' });
  });
});

describe('打开证据引用里的外部链接（ADR-0036）', () => {
  it('合规的 http / https 地址按解析器规范化后交给系统浏览器', async () => {
    const openExternalLink = vi.fn<(url: string) => Promise<void>>(async () => undefined);
    const { handlers } = harness({ openExternalLink });
    const open = handlerOf(handlers, IPC.PROJECT_EVIDENCE_LINK_OPEN);

    await expect(open({}, { url: 'https://example.com/report?id=7#p2' })).resolves.toEqual({
      ok: true,
    });
    await expect(open({}, { url: 'HTTP://Example.ORG/acceptance' })).resolves.toEqual({ ok: true });
    expect(openExternalLink.mock.calls).toEqual([
      ['https://example.com/report?id=7#p2'],
      ['http://example.org/acceptance'],
    ]);
  });

  it('⭐ 文法过得了、却根本不是地址（解析器解不了）⇒ invalidRequest，一次都不打开', async () => {
    const openExternalLink = vi.fn<(url: string) => Promise<void>>(async () => undefined);
    const open = handlerOf(harness({ openExternalLink }).handlers, IPC.PROJECT_EVIDENCE_LINK_OPEN);

    for (const url of ['https://[:::]/', 'https://[1:2:3:4:5:6:7:8:9]/report']) {
      // 前提：这两条过得了共享文法——拦下它们的只能是处理器里的解析器那一半。
      expect(isSafePlanningEvidenceLinkUrl(url), url).toBe(true);
      await expect(open({}, { url }), url).resolves.toMatchObject({
        ok: false,
        code: 'invalidRequest',
      });
    }
    expect(openExternalLink).not.toHaveBeenCalled();
  });

  it('⭐ 主进程二次校验：形状合法、地址不合规（脚本 / 本地文件 / 带账号密码 / 无协议）⇒ invalidRequest，一次都不打开', async () => {
    const openExternalLink = vi.fn<(url: string) => Promise<void>>(async () => undefined);
    const { handlers } = harness({ openExternalLink });
    const open = handlerOf(handlers, IPC.PROJECT_EVIDENCE_LINK_OPEN);

    for (const url of [
      'javascript:alert(1)',
      // 带 `://` 的脚本地址只有协议闸拦得住：⛔ 变异锚点「去掉处理器里的二次校验」让这一条转红。
      'javascript://example.com/%0Aalert(1)',
      'file:///C:/temp/report.docx',
      'https://user:secret@example.com/',
      'https://user@example.com/',
      'example.com/report',
      'ftp://example.com/report',
    ]) {
      // 前提：这些都过得了请求 schema（它只收形状）——拦下它们的只能是处理器里的二次校验。
      expect(ProjectEvidenceLinkOpenRequestSchema.safeParse({ url }).success).toBe(true);
      await expect(open({}, { url })).resolves.toMatchObject({
        ok: false,
        code: 'invalidRequest',
      });
    }
    expect(openExternalLink).not.toHaveBeenCalled();
  });

  // 不可见字符按码点构造，源码里不写字符本身也不写转义。
  it.each([
    ['主机段里的变体选择符 U+FE0F', `https://exa${String.fromCodePoint(0xfe0f)}mple.com/report`],
    ['主机段里的软连字符 U+00AD', `https://exa${String.fromCodePoint(0x00ad)}mple.com/report`],
    ['路径里的阿拉伯字母标记 U+061C', `https://example.com/re${String.fromCodePoint(0x061c)}port`],
    ['路径里的标签字符 U+E0041', `https://example.com/re${String.fromCodePoint(0xe0041)}port`],
  ])(
    '⛔ 乙档判定判原始输入（ADR-0041）：%s 文法与解析器都放行、规范化后看不出来 ⇒ invalidRequest，一次都不打开',
    async (_label, url) => {
      // 前提：这条原始串过得了请求 schema 与文法层 + 解析器（规范化后字符已被吞掉或编码）——拦下它的只能是
      // 叠在前面的乙档判定。它护的是 IPC 边界：界面芯片送来的是已规范化的 href，不经这一条（ADR-0041 后果）。
      // 变异锚点（2026-09-14 实测）：去掉处理器里的 isPermittedExternalLink 一行，四条都转红。
      expect(ProjectEvidenceLinkOpenRequestSchema.safeParse({ url }).success).toBe(true);
      expect(openablePlanningEvidenceLink(url, (raw) => new URL(raw))).not.toBeNull();
      const openExternalLink = vi.fn<(url: string) => Promise<void>>(async () => undefined);
      const open = handlerOf(
        harness({ openExternalLink }).handlers,
        IPC.PROJECT_EVIDENCE_LINK_OPEN,
      );

      const result = (await open({}, { url })) as Record<string, unknown>;

      expect(result).toMatchObject({ ok: false, code: 'invalidRequest' });
      expect(openExternalLink).not.toHaveBeenCalled();
    },
  );

  it('⭐ 与服务端同一份文法：共用向量逐条送进打开通道，收的原样交出、拒的一次都不打开', async () => {
    const VectorsSchema = z.object({
      accept: z.array(z.string()).min(5),
      reject: z.array(z.object({ why: z.string(), url: z.string() })).min(20),
    });
    const vectors = VectorsSchema.parse(
      JSON.parse(
        await readFile(
          new URL(
            '../../fixtures/evidence_link_vectors.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
    );
    const openExternalLink = vi.fn<(url: string) => Promise<void>>(async () => undefined);
    const open = handlerOf(harness({ openExternalLink }).handlers, IPC.PROJECT_EVIDENCE_LINK_OPEN);

    for (const url of vectors.accept) {
      await expect(open({}, { url }), url).resolves.toEqual({ ok: true });
    }
    expect(openExternalLink.mock.calls.map(([url]) => url)).toEqual(
      vectors.accept.map((url) => new URL(url).href),
    );

    openExternalLink.mockClear();
    for (const { why, url } of vectors.reject) {
      await expect(open({}, { url }), `${why}: ${JSON.stringify(url)}`).resolves.toMatchObject({
        ok: false,
        code: 'invalidRequest',
      });
    }
    expect(openExternalLink).not.toHaveBeenCalled();
  });

  it('系统浏览器打不开 ⇒ transient；未登录 ⇒ authRequired，且都不回显地址', async () => {
    const broken = harness({
      openExternalLink: vi.fn(async () => {
        throw new Error('no handler for https://example.com/secret-path');
      }),
    });
    const failed = (await handlerOf(broken.handlers, IPC.PROJECT_EVIDENCE_LINK_OPEN)(
      {},
      { url: 'https://example.com/secret-path' },
    )) as Record<string, unknown>;
    expect(failed).toMatchObject({ ok: false, code: 'transient' });
    expect(JSON.stringify(failed)).not.toContain('secret-path');

    const openExternalLink = vi.fn<(url: string) => Promise<void>>(async () => undefined);
    const signedOut = harness({ openExternalLink, activeAccount: () => null });
    await expect(
      handlerOf(signedOut.handlers, IPC.PROJECT_EVIDENCE_LINK_OPEN)(
        {},
        { url: 'https://example.com/report' },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'authRequired' });
    expect(openExternalLink).not.toHaveBeenCalled();
  });
});
