import type { ProjectEvent } from '../../../shared/protocol/project-collab.js';
import {
  PROJECT_NOTIFICATION_COPY,
  type ProjectNotificationReason,
} from '../../../shared/protocol/project-notifications.js';
import { decideProjectNotification } from './projectNotificationRules.js';

/**
 * 项目组桌面系统通知的编排（G-6）。
 *
 * 事件流（`CollabSyncService` 广播的同一批帧）到达时按顺序过五道闸：
 *
 *  1. **值不值得打扰**（`projectNotificationRules`，纯判定）——只认 @提及 与两类待办；
 *  2. **用户开关**——设置里关掉即整条链路静默（连角标都不更新，关就是关干净）；
 *  3. **前台不打扰**——主窗聚焦时用户正看着，应用内未读已经在表达了，
 *     再弹系统通知是自己跟自己抢注意力；
 *  4. **未读角标**——按平台能力选载体（角标 / 任务栏提示），⛔ 不做动画；
 *  5. **系统通知**——`Notification.isSupported()` 为假时只留角标，不报错。
 *
 * ⚠️ 通知文案只从 `PROJECT_NOTIFICATION_COPY` 取固定中性串：**本文件不拼任何文案**，
 *    正文/项目名/人名一律不进系统通知中心（红线 1 的落点）。
 *
 * 所有副作用走注入端口，本类可在无 Electron 环境下完整测试。
 */

export interface ProjectNotificationPorts {
  /** 当前账号在协作服务端的身份主体；null＝身份不明（一律不打扰）。 */
  readonly mySubject: () => string | null;
  /** 用户设置：桌面通知是否开启。 */
  readonly isEnabled: () => boolean;
  /** 系统是否支持通知（Electron `Notification.isSupported()`）。 */
  readonly isSupported: () => boolean;
  /** 主窗是否在前台（聚焦）。 */
  readonly isForeground: () => boolean;
  /** 更新未读角标（0＝清空）。 */
  readonly setUnreadBadge: (count: number) => void;
  /** 弹一条系统通知；`onClick` 由端口负责在用户点击时调用。 */
  readonly present: (notification: PresentedProjectNotification) => void;
}

export interface PresentedProjectNotification {
  readonly reason: ProjectNotificationReason;
  readonly title: string;
  readonly body: string;
  /** 点击通知：聚焦主窗并跳到该项目。 */
  readonly onClick: () => void;
}

export interface ProjectNotificationServiceOptions extends ProjectNotificationPorts {
  /** 点击通知后的导航请求（聚焦主窗 + 通知渲染层跳转）。 */
  readonly activate: (projectId: string) => void;
}

export class ProjectNotificationService {
  private readonly ports: ProjectNotificationServiceOptions;
  private unread = 0;

  constructor(options: ProjectNotificationServiceOptions) {
    this.ports = options;
  }

  /** 事件流入口：`CollabSyncService.publish` 的旁路（广播给渲染层的同一批帧）。 */
  handleEvent(event: ProjectEvent): void {
    try {
      this.dispatch(event);
    } catch {
      // 通知是旁路能力：弹不出来不许拖垮事件流广播。
    }
  }

  /** 主窗获得焦点：未读清零（用户已经看见了）。 */
  clearUnread(): void {
    if (this.unread === 0) return;
    this.unread = 0;
    this.safely(() => this.ports.setUnreadBadge(0));
  }

  /** 换账号/登出：未读归零，旧账号的计数不带进新账号。 */
  reset(): void {
    this.unread = 0;
    this.safely(() => this.ports.setUnreadBadge(0));
  }

  private dispatch(event: ProjectEvent): void {
    const decision = decideProjectNotification(event, this.ports.mySubject());
    if (decision === null) return;
    if (!this.ports.isEnabled()) return;
    // 前台＝用户正看着应用：只由渲染层的应用内未读表达，不弹系统通知也不加角标。
    if (this.ports.isForeground()) return;

    this.unread += 1;
    this.safely(() => this.ports.setUnreadBadge(this.unread));

    if (!this.ports.isSupported()) return;
    const copy = PROJECT_NOTIFICATION_COPY[decision.reason];
    this.safely(() =>
      this.ports.present({
        reason: decision.reason,
        title: copy.title,
        body: copy.body,
        onClick: () => this.safely(() => this.ports.activate(decision.projectId)),
      }),
    );
  }

  private safely(action: () => void): void {
    try {
      action();
    } catch {
      // 窗口销毁/平台不支持等都不该冒泡到事件流。
    }
  }
}
