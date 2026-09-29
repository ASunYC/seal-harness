import { describe, expect, it, vi } from 'vitest';

import type { ProjectEvent } from '../../../../../stratex/shared/protocol/project-collab.js';
import {
  ProjectNotificationService,
  type PresentedProjectNotification,
} from '../../../../../stratex/main/services/collab/projectNotificationService.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ME = 'subject-me';
const OTHER = 'subject-other';

/** 一条「待办派给我」的事件——本文件里唯一需要打扰的输入。 */
function assignedToMe(): ProjectEvent {
  return {
    kind: 'todo.changed',
    projectId: PROJECT_ID,
    payload: {
      reason: 'created',
      actor_subject: OTHER,
      creator_subject: OTHER,
      assignee_subject: ME,
      status: 'notStarted',
    },
  };
}

function noise(): ProjectEvent {
  return {
    kind: 'file.changed',
    projectId: PROJECT_ID,
    payload: { file_id: 'f1', reason: 'uploaded' },
  };
}

interface Harness {
  readonly service: ProjectNotificationService;
  readonly presented: PresentedProjectNotification[];
  readonly badges: number[];
  readonly activated: string[];
  readonly state: { enabled: boolean; supported: boolean; foreground: boolean; me: string | null };
}

function harness(overrides: Partial<Harness['state']> = {}): Harness {
  const presented: PresentedProjectNotification[] = [];
  const badges: number[] = [];
  const activated: string[] = [];
  const state = {
    enabled: true,
    supported: true,
    foreground: false,
    me: ME as string | null,
    ...overrides,
  };
  const service = new ProjectNotificationService({
    mySubject: () => state.me,
    isEnabled: () => state.enabled,
    isSupported: () => state.supported,
    isForeground: () => state.foreground,
    setUnreadBadge: (count) => badges.push(count),
    present: (notification) => presented.push(notification),
    activate: (projectId) => activated.push(projectId),
  });
  return { service, presented, badges, activated, state };
}

describe('ProjectNotificationService', () => {
  it('值得打扰的事件：加未读角标 + 弹一条固定中性文案', () => {
    const h = harness();
    h.service.handleEvent(assignedToMe());
    expect(h.badges).toEqual([1]);
    expect(h.presented).toHaveLength(1);
    expect(h.presented[0]!.reason).toBe('assigned');
    expect(h.presented[0]!.title).toBe('项目组');
    expect(h.presented[0]!.body).toBe('有待办指派给你');
  });

  it('通知正文不含任何用户内容（红线：正文不进系统通知中心）', () => {
    const h = harness();
    h.service.handleEvent({
      kind: 'todo.changed',
      projectId: PROJECT_ID,
      payload: {
        reason: 'created',
        actor_subject: OTHER,
        creator_subject: OTHER,
        assignee_subject: ME,
        status: 'notStarted',
        // 就算服务端哪天误把正文塞进负载，也绝不能出现在通知里。
        title: '绝密标题',
      },
    });
    const rendered = `${h.presented[0]!.title}${h.presented[0]!.body}`;
    expect(rendered).not.toContain('绝密标题');
    expect(rendered).not.toContain(PROJECT_ID);
    expect(rendered).not.toContain(OTHER);
  });

  it('不值得打扰的事件：既不弹也不加角标', () => {
    const h = harness();
    h.service.handleEvent(noise());
    h.service.handleEvent({ kind: 'connection', payload: { state: 'online' } });
    expect(h.badges).toEqual([]);
    expect(h.presented).toEqual([]);
  });

  it('前台时只更新应用内未读：不弹、不加角标', () => {
    const h = harness({ foreground: true });
    h.service.handleEvent(assignedToMe());
    expect(h.presented).toEqual([]);
    expect(h.badges).toEqual([]);
  });

  it('用户关掉开关：整条链路静默（连角标都不动）', () => {
    const h = harness({ enabled: false });
    h.service.handleEvent(assignedToMe());
    expect(h.presented).toEqual([]);
    expect(h.badges).toEqual([]);
  });

  it('系统不支持通知：角标照常更新，只是不弹窗', () => {
    const h = harness({ supported: false });
    h.service.handleEvent(assignedToMe());
    expect(h.badges).toEqual([1]);
    expect(h.presented).toEqual([]);
  });

  it('未读累加；主窗获得焦点后归零（幂等，重复清不刷角标）', () => {
    const h = harness();
    h.service.handleEvent(assignedToMe());
    h.service.handleEvent(assignedToMe());
    expect(h.badges).toEqual([1, 2]);
    h.service.clearUnread();
    h.service.clearUnread();
    expect(h.badges).toEqual([1, 2, 0]);
  });

  it('reset（换账号/登出）：未读归零，旧账号计数不带进新账号', () => {
    const h = harness();
    h.service.handleEvent(assignedToMe());
    h.service.reset();
    expect(h.badges).toEqual([1, 0]);
    h.state.me = 'subject-next-account';
    // 新账号下同一条事件不再关我事 ⇒ 不弹；角标也不该从 1 续。
    h.service.handleEvent(assignedToMe());
    expect(h.badges).toEqual([1, 0]);
    expect(h.presented).toHaveLength(1);
  });

  it('点击通知 → 请求跳到对应项目', () => {
    const h = harness();
    h.service.handleEvent(assignedToMe());
    h.presented[0]!.onClick();
    expect(h.activated).toEqual([PROJECT_ID]);
  });

  it('端口抛错不冒泡（弹不出来不许拖垮事件流广播）', () => {
    const service = new ProjectNotificationService({
      mySubject: () => ME,
      isEnabled: () => true,
      isSupported: () => true,
      isForeground: () => false,
      setUnreadBadge: () => {
        throw new Error('badge unsupported');
      },
      present: () => {
        throw new Error('window destroyed');
      },
      activate: () => undefined,
    });
    expect(() => service.handleEvent(assignedToMe())).not.toThrow();
    expect(() => service.clearUnread()).not.toThrow();
  });

  it('判定端口自身抛错也被兜住', () => {
    const activate = vi.fn();
    const service = new ProjectNotificationService({
      mySubject: () => {
        throw new Error('auth in flight');
      },
      isEnabled: () => true,
      isSupported: () => true,
      isForeground: () => false,
      setUnreadBadge: () => undefined,
      present: () => undefined,
      activate,
    });
    expect(() => service.handleEvent(assignedToMe())).not.toThrow();
    expect(activate).not.toHaveBeenCalled();
  });
});
