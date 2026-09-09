import { describe, expect, it } from "vitest";
import { formatScheduleFrequency, formatScheduleRelative, orderScheduleRecords } from "../public/schedule-catalog.js";

const t = (key: string) => ({
  "schedule.frequency.once": "Once", "schedule.frequency.every": "Every {value} {unit}",
  "schedule.unit.day.one": "day", "schedule.unit.day.other": "days", "schedule.unit.hour.one": "hour", "schedule.unit.hour.other": "hours",
  "schedule.unit.minute.one": "minute", "schedule.unit.minute.other": "minutes", "schedule.unit.second.one": "second", "schedule.unit.second.other": "seconds",
  "schedule.relative.now": "Due now", "schedule.relative.future": "in {value} {unit}", "schedule.relative.overdue": "{value} {unit} overdue",
} as Record<string, string>)[key] ?? key;

describe("schedule catalog", () => {
  it("formats exact durable frequencies without rounding", () => {
    expect(formatScheduleFrequency({ kind: "once" }, t)).toBe("Once");
    expect(formatScheduleFrequency({ kind: "every", everySeconds: 7_200 }, t)).toBe("Every 2 hours");
    expect(formatScheduleFrequency({ kind: "every", everySeconds: 90 }, t)).toBe("Every 90 seconds");
  });
  it("orders overdue records first and formats relative targets", () => {
    const now = Date.parse("2026-09-06T12:00:00Z"); const records = [{ id: "future", scheduledAt: "2026-09-06T13:00:00Z" }, { id: "late", scheduledAt: "2026-09-06T11:58:00Z" }];
    expect(orderScheduleRecords(records, now).map(record => record.id)).toEqual(["late", "future"]);
    expect(formatScheduleRelative(records[0]!.scheduledAt, now, t)).toBe("in 1 hour");
    expect(formatScheduleRelative(records[1]!.scheduledAt, now, t)).toBe("2 minutes overdue");
  });
});
