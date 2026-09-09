function pad2(value) { return String(value).padStart(2, "0"); }

export function startOfLocalDay(time) {
  const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime();
}

export function msUntilNextLocalMidnight(time) {
  const next = new Date(time); next.setHours(24, 0, 0, 0); return Math.max(next.getTime() - time, 1);
}

export function formatMessageClock(time, locale, now = Date.now()) {
  const date = new Date(time); const today = new Date(now);
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()) return clock;
  const year = date.getFullYear(); const month = date.getMonth() + 1; const day = date.getDate();
  const calendar = locale === "zh-CN"
    ? (year === today.getFullYear() ? `${month}月${day}日` : `${year}年${month}月${day}日`)
    : (year === today.getFullYear() ? `${month}/${day}` : `${year}-${month}-${day}`);
  return `${calendar} ${clock}`;
}
