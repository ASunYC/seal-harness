import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from '../../../../../stratex/shared/protocol/project-collab.js';
import { PROJECT_NOTIFICATION_COPY } from '../../../../../stratex/shared/protocol/project-notifications.js';
import { decideProjectNotification } from '../../../../../stratex/main/services/collab/projectNotificationRules.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ME = 'subject-me';
const OTHER = 'subject-other';

/** 服务端负载在契约里是不透明 JSON；测试直接给对象字面量并按帧类型收口。 */
function todoEvent(payload: Record<string, unknown>): ProjectEvent {
  return { kind: 'todo.changed', projectId: PROJECT_ID, payload } as ProjectEvent;
}

function chatEvent(payload: Record<string, unknown>): ProjectEvent {
  return { kind: 'chat.message', projectId: PROJECT_ID, payload } as ProjectEvent;
}

describe('decideProjectNotification', () => {
  it('身份不明（未登录/换账号窗口期）一律不打扰', () => {
    expect(decideProjectNotification(chatEvent({ mentions: [ME] }), null)).toBeNull();
    expect(decideProjectNotification(chatEvent({ mentions: [ME] }), '')).toBeNull();
  });

  it('连接状态帧不是打扰源', () => {
    const event: ProjectEvent = { kind: 'connection', payload: { state: 'degraded' } };
    expect(decideProjectNotification(event, ME)).toBeNull();
  });

  // -- ① @ 提及 ------------------------------------------------------------

  it.each(['chat.message', 'feed.created', 'feed.commented'] as const)(
    '%s 里 @ 了我 → mention',
    (kind) => {
      const event = {
        kind,
        projectId: PROJECT_ID,
        payload: { author_subject: OTHER, mentions: [OTHER, ME] },
      } as ProjectEvent;
      expect(decideProjectNotification(event, ME)).toEqual({
        reason: 'mention',
        projectId: PROJECT_ID,
      });
    },
  );

  it('@ 的是别人 / 没有 mentions 字段 → 不打扰', () => {
    expect(
      decideProjectNotification(chatEvent({ author_subject: OTHER, mentions: [OTHER] }), ME),
    ).toBeNull();
    // 载体没有 mentions（如评论：暂无 refs 写入面）：判不出提及就不弹，不做兜底猜测。
    expect(decideProjectNotification(chatEvent({ author_subject: OTHER }), ME)).toBeNull();
  });

  it('自己 @ 自己不弹（不给自己发通知）', () => {
    expect(
      decideProjectNotification(chatEvent({ author_subject: ME, mentions: [ME] }), ME),
    ).toBeNull();
  });

  it('其余域事件不弹（文件/项目/成员变更不打扰）', () => {
    for (const kind of ['file.changed', 'project.changed', 'member.changed'] as const) {
      const event = {
        kind,
        projectId: PROJECT_ID,
        payload: { subject: ME, mentions: [ME] },
      } as ProjectEvent;
      expect(decideProjectNotification(event, ME)).toBeNull();
    }
  });

  // -- ②-a 待办指派/流转到我 -----------------------------------------------

  it('新建即派给我 → assigned', () => {
    const event = todoEvent({
      reason: 'created',
      actor_subject: OTHER,
      creator_subject: OTHER,
      assignee_subject: ME,
      status: 'notStarted',
    });
    expect(decideProjectNotification(event, ME)).toEqual({
      reason: 'assigned',
      projectId: PROJECT_ID,
    });
  });

  it('更新把处理人换成我（原本无人认领）→ assigned', () => {
    const event = todoEvent({
      reason: 'updated',
      actor_subject: OTHER,
      creator_subject: OTHER,
      assignee_subject: ME,
      previous_assignee_subject: null,
      status: 'notStarted',
      previous_status: 'notStarted',
    });
    expect(decideProjectNotification(event, ME)?.reason).toBe('assigned');
  });

  it('本来就在我名下、这次改的是别的字段 → 不重复打扰', () => {
    const event = todoEvent({
      reason: 'updated',
      actor_subject: OTHER,
      creator_subject: OTHER,
      assignee_subject: ME,
      previous_assignee_subject: ME,
      status: 'inProgress',
      previous_status: 'notStarted',
    });
    expect(decideProjectNotification(event, ME)).toBeNull();
  });

  it('更新事件缺前值（判不出这次改的是不是处理人）→ 不弹', () => {
    const event = todoEvent({
      reason: 'updated',
      actor_subject: OTHER,
      creator_subject: OTHER,
      assignee_subject: ME,
      status: 'inProgress',
    });
    expect(decideProjectNotification(event, ME)).toBeNull();
  });

  it('我自己把单派给自己 → 不弹（actor 是我）', () => {
    const event = todoEvent({
      reason: 'updated',
      actor_subject: ME,
      creator_subject: ME,
      assignee_subject: ME,
      previous_assignee_subject: OTHER,
      status: 'notStarted',
      previous_status: 'notStarted',
    });
    expect(decideProjectNotification(event, ME)).toBeNull();
  });

  it('派给别人的单不弹', () => {
    const event = todoEvent({
      reason: 'updated',
      actor_subject: OTHER,
      creator_subject: OTHER,
      assignee_subject: OTHER,
      previous_assignee_subject: null,
      status: 'notStarted',
      previous_status: 'notStarted',
    });
    expect(decideProjectNotification(event, ME)).toBeNull();
  });

  // -- ②-b 我派的单进入待验收 ----------------------------------------------

  it('我派的单被他人置为待验收 → reviewRequested', () => {
    const event = todoEvent({
      reason: 'updated',
      actor_subject: OTHER,
      creator_subject: ME,
      assignee_subject: OTHER,
      previous_assignee_subject: OTHER,
      status: 'inReview',
      previous_status: 'inProgress',
    });
    expect(decideProjectNotification(event, ME)).toEqual({
      reason: 'reviewRequested',
      projectId: PROJECT_ID,
    });
  });

  it('别人派的单进入待验收不关我事', () => {
    const event = todoEvent({
      reason: 'updated',
      actor_subject: OTHER,
      creator_subject: OTHER,
      assignee_subject: OTHER,
      previous_assignee_subject: OTHER,
      status: 'inReview',
      previous_status: 'inProgress',
    });
    expect(decideProjectNotification(event, ME)).toBeNull();
  });

  it('已经在待验收上的其他改动不重复弹（状态没变进来）', () => {
    const event = todoEvent({
      reason: 'updated',
      actor_subject: OTHER,
      creator_subject: ME,
      assignee_subject: OTHER,
      previous_assignee_subject: OTHER,
      status: 'inReview',
      previous_status: 'inReview',
    });
    expect(decideProjectNotification(event, ME)).toBeNull();
  });

  it('done / inProgress 都不是待验收（只认待验收状态集合）', () => {
    for (const status of ['done', 'inProgress', 'cancelled']) {
      const event = todoEvent({
        reason: 'updated',
        actor_subject: OTHER,
        creator_subject: ME,
        assignee_subject: OTHER,
        previous_assignee_subject: OTHER,
        status,
        previous_status: 'notStarted',
      });
      expect(decideProjectNotification(event, ME)).toBeNull();
    }
  });

  it('指派优先于验收：同一条事件既转给我又进待验收时回 assigned（只弹一条）', () => {
    const event = todoEvent({
      reason: 'updated',
      actor_subject: OTHER,
      creator_subject: ME,
      assignee_subject: ME,
      previous_assignee_subject: OTHER,
      status: 'inReview',
      previous_status: 'inProgress',
    });
    expect(decideProjectNotification(event, ME)?.reason).toBe('assigned');
  });

  // -- 删除事件不新增广播面（reason:'deleted' 与既有 changed 分支合流，受众不变）------

  it('删除事件即便看起来「派到我名下」也不弹（reason:deleted 早返回）', () => {
    // 负向锚点：删除负载哪怕带上 assignee_subject=我，也不得被误判成 assigned。
    // ⛔ 去掉 decideTodo 里 `reason==='deleted'` 那道早返回，这条会变红（回落到 assigned）。
    const event = todoEvent({
      reason: 'deleted',
      actor_subject: OTHER,
      creator_subject: ME,
      assignee_subject: ME,
      previous_assignee_subject: null,
      ids: ['todo-root'],
    });
    expect(decideProjectNotification(event, ME)).toBeNull();
  });

  it('删除自己名下条目、携整棵子树 ids → 仍不弹（删除本身不是打扰源）', () => {
    const event = todoEvent({
      reason: 'deleted',
      actor_subject: OTHER,
      creator_subject: ME,
      ids: ['todo-root', 'todo-child'],
    });
    expect(decideProjectNotification(event, ME)).toBeNull();
  });

  // -- 坏负载 ---------------------------------------------------------------

  it('负载不是对象 / 字段类型不对 → 静默不弹（负载是不可信输入）', () => {
    expect(decideProjectNotification(todoEvent({}), ME)).toBeNull();
    for (const payload of [null, 'text', 42, []] as unknown[]) {
      const event = { kind: 'todo.changed', projectId: PROJECT_ID, payload } as ProjectEvent;
      expect(decideProjectNotification(event, ME)).toBeNull();
    }
    const badMentions = {
      kind: 'chat.message',
      projectId: PROJECT_ID,
      payload: { mentions: 'me' },
    };
    expect(decideProjectNotification(badMentions as ProjectEvent, ME)).toBeNull();
  });
});

describe('③ 拆解草案落下来了', () => {
  function draftEvent(payload: Record<string, unknown>): ProjectEvent {
    return { kind: 'todo.draft', projectId: PROJECT_ID, payload } as ProjectEvent;
  }

  it('别人从我建的需求拆出草案 ⇒ 提醒我审阅', () => {
    expect(
      decideProjectNotification(
        draftEvent({
          batch_id: 'b-1',
          source_todo_id: 't-1',
          draft_count: 12,
          actor_subject: OTHER,
        }),
        ME,
      ),
    ).toEqual({ reason: 'draftsReady', projectId: PROJECT_ID });
  });

  it('我自己让助理拆的不打扰我', () => {
    // 屏幕上正在流式打印，再弹一条是纯噪音；我那份「有几条待审」由需求行徽标承载。
    expect(
      decideProjectNotification(
        draftEvent({ batch_id: 'b-1', draft_count: 12, actor_subject: ME }),
        ME,
      ),
    ).toBeNull();
  });

  it('一条草案都没有时不打扰', () => {
    expect(
      decideProjectNotification(draftEvent({ draft_count: 0, actor_subject: OTHER }), ME),
    ).toBeNull();
  });

  /*
   * ⛔ 通知文案里**不许出现草案标题**——草案是半成品，而系统通知会出现在锁屏上。
   *
   * 判据压在**渲染出来的那两个字符串**上，而不是「payload 里没有 title 键」：
   * 后者只证明这一版负载长什么样，前者才证明「就算负载里混进了标题，也印不出来」。
   */
  it('渲染出来的文案不含草案标题、需求 id 与人名', () => {
    const decision = decideProjectNotification(
      draftEvent({
        batch_id: 'b-1',
        source_todo_id: 't-1',
        draft_count: 12,
        actor_subject: OTHER,
        // 负载里就算混进了正文，文案也不该沾上它。
        title: '绝密草案标题',
      }),
      ME,
    );
    expect(decision).not.toBeNull();
    const copy = PROJECT_NOTIFICATION_COPY[decision!.reason];
    const rendered = `${copy.title}${copy.body}`;
    expect(rendered).not.toContain('绝密草案标题');
    expect(rendered).not.toContain(PROJECT_ID);
    expect(rendered).not.toContain(OTHER);
    expect(rendered).not.toContain('t-1');
    // 正向的一半：它确实说了「有草案等你审阅」这件事。
    expect(rendered).toContain('拆解草案');
  });
});
