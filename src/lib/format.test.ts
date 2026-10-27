import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDate, formatDateTime, formatDuration, formatLocalMonth, formatMonth, formatMoney, fromDateTimeInput, toDateTimeInput, formatNumber, formatRelative, moneyInputValue, parseMoneyInput, percentChange } from "./format.ts";

const NBSP = " ";

test("numbers use locale grouping", () => {
  assert.equal(formatNumber(1234567, "az"), "1.234.567");
  assert.equal(formatNumber(1234567, "en"), "1,234,567");
  assert.equal(formatNumber(1234567, "ru"), `1${NBSP}234${NBSP}567`);
  assert.equal(formatNumber(-950, "az"), "-950");
});

test("money is minor units with ₼", () => {
  assert.equal(formatMoney(4825000, "az"), `48.250${NBSP}₼`);
  assert.equal(formatMoney(4825000, "en"), "₼48,250");
  assert.equal(formatMoney(4825000, "az", "AZN", true), `48,3 min${NBSP}₼`);
  assert.equal(formatMoney(250_000_000, "en", "AZN", true), "₼2.5M");
  assert.equal(formatMoney(2_000_000, "en", "AZN", true), "₼20K"); // no trailing ",0"
  assert.equal(formatMoney(0, "ru"), `0${NBSP}₼`);
});

test("durations pick the largest sensible unit", () => {
  assert.equal(formatDuration(0.2, "az"), `1${NBSP}dəq`);
  assert.equal(formatDuration(45, "az"), `45${NBSP}dəq`);
  assert.equal(formatDuration(190, "en"), `3${NBSP}h`);
  assert.equal(formatDuration(3 * 1440, "ru"), `3${NBSP}дн.`);
});

test("relative time", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  assert.equal(formatRelative("2026-10-22T11:59:40Z", now, "az"), "indicə");
  assert.equal(formatRelative("2026-10-22T09:00:00Z", now, "az"), `3${NBSP}saat əvvəl`);
  assert.equal(formatRelative("2026-10-22T09:00:00Z", now, "ru"), `3${NBSP}ч назад`);
});

test("dates render in the tenant time zone (Asia/Baku, UTC+4)", () => {
  // 21:30 UTC on Oct 22 is already Oct 23 in Baku
  assert.equal(formatDate("2026-10-22T21:30:00Z", "az", "day"), "23");
  assert.equal(formatDate("2026-10-22T10:00:00Z", "az", "long"), "22 oktyabr");
  assert.equal(formatDate("2026-10-22T10:00:00Z", "en", "short"), "22 Oct");
  assert.equal(formatDate("2026-05-02T10:00:00Z", "ru", "long"), "2 мая");
});

test("percent change", () => {
  assert.equal(percentChange(120, 100), 20);
  assert.equal(percentChange(80, 100), -20);
  assert.equal(percentChange(5, 0), null);
});

test("money input parsing", () => {
  assert.equal(parseMoneyInput("1250"), 125000);
  assert.equal(parseMoneyInput("1 250,5"), 125050);
  assert.equal(parseMoneyInput("0.99"), 99);
  assert.equal(parseMoneyInput(""), null);
  assert.equal(parseMoneyInput("-5"), null);
  assert.equal(parseMoneyInput("12.345"), null);
  assert.equal(parseMoneyInput("abc"), null);
  assert.equal(moneyInputValue(125050), "1250.5");
});

test("date-time inputs use the tenant time zone (Baku, UTC+4), not the machine's", () => {
  assert.equal(fromDateTimeInput("2026-10-22T18:00"), "2026-10-22T14:00:00.000Z");
  assert.equal(toDateTimeInput("2026-10-22T14:00:00.000Z"), "2026-10-22T18:00");
  assert.equal(toDateTimeInput(fromDateTimeInput("2026-12-31T23:30")!), "2026-12-31T23:30");
  assert.equal(fromDateTimeInput("garbage"), null);
  assert.equal(toDateTimeInput(null), "");
  assert.equal(formatDateTime("2026-10-22T14:00:00.000Z", "az"), "22 okt, 18:00");
  assert.equal(formatDateTime("2026-10-21T20:00:00.000Z", "en"), "22 Oct");
});

test("months: UTC month starts vs Baku month starts", () => {
  // Platform figures bucket by UTC month
  assert.equal(formatMonth("2026-10-01T00:00:00.000Z", "az"), "okt 2026");
  // A Baku month starts at 20:00 UTC the day before — still October locally
  assert.equal(formatLocalMonth("2026-09-30T20:00:00.000Z", "az"), "okt 2026");
  assert.equal(formatMonth("2026-09-30T20:00:00.000Z", "az"), "sen 2026");
  assert.equal(formatLocalMonth("2025-12-31T20:00:00.000Z", "en"), "Jan 2026");
});
