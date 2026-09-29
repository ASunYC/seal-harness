import { projectApi } from '../../../../src/ui/runtime';
import type {
  ProjectNotificationNavigate,
  ProjectNotificationSettingsUpdate,
} from '@shared/protocol/project-notifications.js';

/**
 * 项目组桌面系统通知（G-6）的渲染层出入口。
 *
 * 与 `projectCollab` sdk 分文件：那条是「跟服务端说话」，这条是「跟本机说话」——
 * 开关只落本地偏好，导航订阅只接主进程的点击回传，两者都不经协作服务端。
 */
export const projectNotificationsApi = Object.freeze({
  readSettings: () => projectApi().readProjectNotificationSettings(),
  writeSettings: (input: ProjectNotificationSettingsUpdate) =>
    projectApi().writeProjectNotificationSettings(input),
  /** 订阅「用户点了系统通知」；返回退订函数。 */
  onNavigate: (listener: (request: ProjectNotificationNavigate) => void) =>
    projectApi().onProjectNotificationNavigate(listener),
});
