/** 只承接由当前草稿基线发起的协助人写入；外部新版不能自动重置草稿的乐观锁。 */
export function advanceTodoCollaborationDraftVersion(
  current: number,
  change: { previousVersion: number; version: number },
): number {
  return change.previousVersion === current && change.version > current ? change.version : current;
}
