import assert from "node:assert/strict";
import { test } from "node:test";
import { isOpen, localClock } from "./hours.ts";

const week = (open: boolean[], start = "09:00", end = "18:00") => ({ hours: open.map((o) => ({ open: o, start, end })) });
const weekdays = week([true, true, true, true, true, false, false]);

test("local clock follows the company's time zone", () => {
  // 2026-11-02 is a Monday; 05:30 UTC is 09:30 in Baku (UTC+4)
  assert.deepEqual(localClock(new Date("2026-11-02T05:30:00Z"), "Asia/Baku"), { day: 0, time: "09:30" });
  // Sunday 22:00 UTC is already Monday 02:00 in Baku
  assert.deepEqual(localClock(new Date("2026-11-01T22:00:00Z"), "Asia/Baku"), { day: 0, time: "02:00" });
});

test("open within the day's hours, end exclusive; closed days and nights are closed", () => {
  assert.equal(isOpen(weekdays, "Asia/Baku", new Date("2026-11-02T05:00:00Z")), true); // Mon 09:00
  assert.equal(isOpen(weekdays, "Asia/Baku", new Date("2026-11-02T04:59:00Z")), false); // Mon 08:59
  assert.equal(isOpen(weekdays, "Asia/Baku", new Date("2026-11-02T14:00:00Z")), false); // Mon 18:00
  assert.equal(isOpen(weekdays, "Asia/Baku", new Date("2026-11-07T08:00:00Z")), false); // Sat 12:00
});
