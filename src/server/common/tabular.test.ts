import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeText, parseCsv, readSheet, readXlsx, serialToIso, toCsv, toXlsx } from "./tabular.ts";

test("CSV: delimiter detection, quotes, newlines inside quotes, CRLF", () => {
  assert.deepEqual(parseCsv('ad,email\r\n"Əliyev, Aysel","a@x.az"\r\n'), [
    ["ad", "email"],
    ["Əliyev, Aysel", "a@x.az"],
  ]);
  assert.deepEqual(parseCsv('ad;qeyd\nKamran;"iki\nsətir ""sitat"""'), [
    ["ad", "qeyd"],
    ["Kamran", 'iki\nsətir "sitat"'],
  ]);
  assert.deepEqual(parseCsv("a\tb\n1\t2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.deepEqual(parseCsv('a,""'), [["a", ""]]);
});

test("CSV text: UTF-8 with BOM, then Windows code pages", () => {
  assert.equal(decodeText(Buffer.from("﻿Şəki", "utf8")), "Şəki");
  // "Иван" in windows-1251
  assert.equal(decodeText(Buffer.from([0xc8, 0xe2, 0xe0, 0xed])), "Иван");
  // "Gəncə" can't be saved in 1254; "Şirin" can: Ş = 0xDE
  assert.equal(decodeText(Buffer.from([0xde, 0x69, 0x72, 0x69, 0x6e])), "Şirin");
});

test("readSheet drops empty rows and trims; refuses a fake .xlsx", () => {
  assert.deepEqual(readSheet(Buffer.from(" ad , tel \n\n,\nAysel,+99450\n"), "a.csv"), [
    ["ad", "tel"],
    ["Aysel", "+99450"],
  ]);
  assert.throws(() => readSheet(Buffer.from("ad\n"), "a.xlsx"), /format/);
  assert.throws(() => readSheet(Buffer.from("\n,,\n"), "a.csv"), /empty/);
});

test("CSV export: BOM, quoting, formulas neutralised", () => {
  assert.equal(toCsv([["ad", "məbləğ"], ['=HYPERLINK("x")', 12.5], [null, "-5"]]), '﻿"ad","məbləğ"\r\n"\'=HYPERLINK(""x"")","12.5"\r\n"","\'-5"\r\n');
});

test("XLSX round trip: strings, numbers, gaps, special characters", () => {
  const rows = [
    ["Ad", "Məbləğ", "Qeyd"],
    ["Aysel <VIP> & co", 1700.5, ""],
    ["=1+1", null, 'sitat "x"\nsətir'],
  ];
  const file = toXlsx(rows, "Müştərilər");
  assert.equal(file.readUInt32LE(0), 0x04034b50);
  assert.deepEqual(readXlsx(file), [
    ["Ad", "Məbləğ", "Qeyd"],
    ["Aysel <VIP> & co", "1700.5"],
    ["=1+1", "", 'sitat "x"\nsətir'],
  ]);
});

test("Excel serial dates", () => {
  assert.equal(serialToIso(45658), "2025-01-01");
  assert.equal(serialToIso(45658.5), "2025-01-01 12:00");
});
