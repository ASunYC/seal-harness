/**
 * 「项目管理」三入口的唯一收口（UX-14）：成员与权限 / 消息与提醒 / 项目设置。
 *
 * 同一组入口挂在两处：右栏「项目管理」分区（`ProjectConfigAside`）与页头「⋯」菜单
 * （`ProjectManageMenu`）。右栏在两种情形下看不见——项目助理分栏打开（进入项目默认打开，
 * 负责人 2026-09-14 拍板）与项目页窄于 900px——页头菜单就是那时的入口。两处从这一张表
 * 渲染，⛔ 别各写一份：哪天一处加了入口、另一处没加，功能就又「找不到」了。
 *
 * 两处都只发意图（`ProjectManageAction`），弹层与跳转归项目页：打开的是同一个弹层实例。
 */

export type ProjectManageAction = 'members' | 'notifications' | 'settings';

export interface ProjectManageItem {
  readonly id: ProjectManageAction;
  readonly label: string;
  /** `AppIcon` 既有映射键；右栏分区是纯文字钮，只有页头菜单画图标。 */
  readonly icon: string;
}

export const PROJECT_MANAGE_ITEMS: readonly ProjectManageItem[] = [
  { id: 'members', label: '成员与权限', icon: 'users' },
  { id: 'notifications', label: '消息与提醒', icon: 'bell' },
  { id: 'settings', label: '项目设置', icon: 'settings' },
];
