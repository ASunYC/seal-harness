import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
const { createHistoryWindow } = await import(pathToFileURL(resolve("apps/web/public/history-window.js")).href);
const messages = Array.from({ length: 200 }, (_, i) => ({ id: i, turnId: `turn-${Math.floor(i / 3)}` }));
it("bounds initial mounted messages without splitting the boundary turn", () => {
  const window = createHistoryWindow(messages);
  expect(window.hidden).toBe(138);
  expect(window.visible).toEqual(messages.slice(138));
  expect(window.canTrim).toBe(false);
  window.reveal();
  expect(window.canTrim).toBe(true);
});
it("reveals cached history before older pages and retains every message exactly once", () => {
  const window = createHistoryWindow(messages);
  let mounted = window.visible;
  while (window.hidden) mounted = [...window.reveal(40), ...mounted];
  expect(mounted).toEqual(messages);
  window.prepend([{ id: -1 }]);
  expect(window.messages).toEqual([{ id: -1 }, ...messages]);
  expect(window.hidden).toBe(0);
});
it("can release old mounted content on return to latest without losing stored history", () => {
  const expanded = createHistoryWindow(messages, messages.length);
  expect(expanded.hidden).toBe(0);
  expect(expanded.canTrim).toBe(true);
  const latest = createHistoryWindow(expanded.messages);
  expect(latest.hidden).toBe(138);
  expect(latest.canTrim).toBe(false);
  expect(latest.messages).toEqual(messages);
  expect(createHistoryWindow([]).visible).toEqual([]);
});
