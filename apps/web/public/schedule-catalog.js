const UNITS = [{ unit: "day", seconds: 86_400 }, { unit: "hour", seconds: 3_600 }, { unit: "minute", seconds: 60 }, { unit: "second", seconds: 1 }];

export function orderScheduleRecords(records, now) {
  return records.map((record, index) => ({ record, index })).sort((left, right) => {
    const leftTime = Date.parse(left.record.scheduledAt); const rightTime = Date.parse(right.record.scheduledAt);
    const leftOverdue = leftTime <= now; const rightOverdue = rightTime <= now;
    return leftOverdue !== rightOverdue ? Number(rightOverdue) - Number(leftOverdue) : leftTime - rightTime || left.index - right.index;
  }).map(({ record }) => record);
}

function unitLabel(unit, value, t) { return t(`schedule.unit.${unit}.${value === 1 ? "one" : "other"}`).replace("{count}", String(value)); }

export function formatScheduleFrequency(record, t) {
  if (record.kind !== "every") return t("schedule.frequency.once");
  const selected = UNITS.find(candidate => record.everySeconds % candidate.seconds === 0) ?? UNITS[3]; const value = record.everySeconds / selected.seconds;
  return t("schedule.frequency.every").replace("{value}", String(value)).replace("{unit}", unitLabel(selected.unit, value, t));
}

export function formatScheduleRelative(scheduledAt, now, t) {
  const difference = Date.parse(scheduledAt) - now; if (difference === 0) return t("schedule.relative.now");
  const absoluteSeconds = Math.abs(difference) / 1_000; const selected = UNITS.find(candidate => absoluteSeconds >= candidate.seconds) ?? UNITS[3];
  const value = Math.max(1, difference > 0 ? Math.ceil(absoluteSeconds / selected.seconds) : Math.floor(absoluteSeconds / selected.seconds)); const unit = unitLabel(selected.unit, value, t);
  return t(difference > 0 ? "schedule.relative.future" : "schedule.relative.overdue").replace("{value}", String(value)).replace("{unit}", unit);
}

export function formatScheduleLocalTime(scheduledAt, locale) { return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(Date.parse(scheduledAt)); }
