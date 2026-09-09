export const HISTORY_PAGE_MESSAGES = 50;
export const HISTORY_JUMP_MESSAGES = 200;

export function refreshedHistorySize(loadedMessages) {
  return Math.max(HISTORY_PAGE_MESSAGES, Number.isSafeInteger(loadedMessages) && loadedMessages > 0 ? loadedMessages : 0);
}
