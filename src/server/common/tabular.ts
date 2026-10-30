import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Spreadsheet files for import/export: CSV (any of , ; tab) and XLSX (first sheet).
 * No dependency: XLSX is a zip of XML parts, and only cell values are needed. The npm
 * builds of the common XLSX libraries are either unmaintained (with open advisories)
 * or far larger than this.
 */

export type Sheet = string[][];
export type Cell = string | number | null | undefined;

export class TabularError extends Error {
  readonly reason: "format" | "too_large" | "empty";
  constructor(reason: TabularError["reason"]) {
    super(reason);
    this.reason = reason;
  }
}

/** XML parts bigger than this are refused (zip bombs) */
const MAX_PART_BYTES = 64 * 1024 * 1024;

// ─── Reading ────────────────────────────────────────────────

/** Parses an uploaded CSV or XLSX file into rows of trimmed strings (empty rows dropped). */
export function readSheet(buffer: Buffer, fileName: string): Sheet {
  const isZip = buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
  const rows = isZip ? readXlsx(buffer) : /\.xlsx?$/i.test(fileName) ? fail("format") : parseCsv(decodeText(buffer));
  // CSV exports guard formulas with a leading apostrophe (toCsv); reading one back drops it
  const clean = rows.map((r) => r.map((v) => (isZip ? v : v.replace(/^'(?=[=+\-@])/, "")).trim())).filter((r) => r.some((v) => v !== ""));
  if (!clean.length) throw new TabularError("empty");
  return clean;
}

function fail(reason: TabularError["reason"]): never {
  throw new TabularError(reason);
}

/**
 * CSV bytes as text. UTF-8 (with or without BOM) is expected; Excel's "CSV" (not
 * "CSV UTF-8") is saved in the Windows code page, so invalid UTF-8 falls back to
 * Cyrillic (1251) or Turkish/Latin (1254) by the share of upper-half letters.
 */
export function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer);
  } catch {
    let high = 0;
    let letters = 0;
    for (const b of buffer) {
      if (b >= 0xc0) high++;
      if (b >= 0xc0 || (b >= 0x41 && b <= 0x7a)) letters++;
    }
    return new TextDecoder(letters && high / letters > 0.3 ? "windows-1251" : "windows-1254").decode(buffer);
  }
}

/** RFC 4180 CSV; the delimiter (`,` `;` or tab) is the most frequent one in the first line. */
export function parseCsv(text: string): Sheet {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  const delimiter = counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

  const rows: Sheet = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else quoted = false;
      } else value += ch;
    } else if (ch === '"' && value === "") quoted = true;
    else if (ch === delimiter) {
      row.push(value);
      value = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += ch;
  }
  if (value !== "" || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

/** Zip entries by name (central directory), inflated on demand. */
function unzip(buffer: Buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail("format");
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, { method: number; size: number; compressed: number; offset: number }>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== 0x02014b50) fail("format");
    const nameLen = buffer.readUInt16LE(p + 28);
    const name = buffer.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, {
      method: buffer.readUInt16LE(p + 10),
      compressed: buffer.readUInt32LE(p + 20),
      size: buffer.readUInt32LE(p + 24),
      offset: buffer.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + buffer.readUInt16LE(p + 30) + buffer.readUInt16LE(p + 32);
  }
  return (name: string): string | null => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.size > MAX_PART_BYTES) fail("too_large");
    if (buffer.readUInt32LE(e.offset) !== 0x04034b50) fail("format");
    const start = e.offset + 30 + buffer.readUInt16LE(e.offset + 26) + buffer.readUInt16LE(e.offset + 28);
    const data = buffer.subarray(start, start + e.compressed);
    try {
      if (e.method === 0) return data.toString("utf8");
      if (e.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES }).toString("utf8");
    } catch {
      fail("format");
    }
    return fail("format");
  };
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** XML text content: entities plus OOXML's `_x000D_` escapes. */
function xmlText(s: string) {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m),
    )
    .replace(/_x([0-9a-f]{4})_/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];

/** All `<t>` runs of a string item (rich text included, phonetic hints skipped). */
const runsText = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1]!)).join("");

/** Column index from a cell reference ("C12" → 2). */
function columnIndex(ref: string) {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    if (ch < "A" || ch > "Z") break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/** Style indexes whose number format is a date, so serial numbers can be shown as dates. */
function dateStyles(stylesXml: string | null) {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) custom.set(Number(attr(m[1]!, "numFmtId")), xmlText(attr(m[1]!, "formatCode") ?? ""));
  const isDate = (id: number) => {
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true;
    // Custom formats: a d/m/y token outside quotes and [colour]/[locale] brackets
    const code = custom.get(id)?.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    return !!code && /[dmy]/i.test(code) && !/^general$/i.test(code);
  };
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  [...xfs.matchAll(/<xf\b([^>]*)/g)].forEach((m, i) => {
    if (isDate(Number(attr(m[1]!, "numFmtId") ?? 0))) out.add(i);
  });
  return out;
}

/** Excel serial day (1900 system) → "YYYY-MM-DD" (with time when it has one). */
export function serialToIso(serial: number) {
  const ms = Math.round((serial - 25569) * 86_400_000);
  const iso = new Date(ms).toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
}

/** The first worksheet of an XLSX file as rows of strings. */
export function readXlsx(buffer: Buffer): Sheet {
  const read = unzip(buffer);
  const workbook = read("xl/workbook.xml") ?? fail("format");
  const rid = attr(/<sheet\b([^>]*)\/?>/.exec(workbook)?.[1] ?? "", "r:id");
  const rels = read("xl/_rels/workbook.xml.rels") ?? "";
  const target = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]!).find((a) => attr(a, "Id") === rid);
  const href = target ? attr(target, "Target")! : "worksheets/sheet1.xml";
  const path = href.startsWith("/") ? href.slice(1) : `xl/${href}`;
  const sheet = read(path) ?? fail("format");

  const shared = [...(read("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runsText(m[1]!));
  const dates = dateStyles(read("xl/styles.xml"));

  const rows: Sheet = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!;
      const body = cm[2] ?? "";
      const ref = attr(attrs, "r");
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      if (col > 1000) continue;
      const type = attr(attrs, "t");
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = runsText(body);
      else if (type === "b") value = v === "1" ? "true" : "false";
      else if (type === "e") value = "";
      else if (v !== undefined) {
        value = xmlText(v);
        const style = Number(attr(attrs, "s") ?? -1);
        if ((type === undefined || type === "n") && dates.has(style) && Number.isFinite(Number(value))) value = serialToIso(Number(value));
      }
      while (row.length < col) row.push("");
      row[col] = value;
    }
    rows.push(row);
  }
  return rows;
}

// ─── Writing ────────────────────────────────────────────────

/** CSV for Excel: UTF-8 with BOM (Azerbaijani letters), everything quoted, formulas neutralised. */
export function toCsv(rows: Cell[][]): string {
  const cell = (v: Cell) => {
    const s = v === null || v === undefined ? "" : String(v);
    return `"${(typeof v === "string" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  return `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

const escapeXml = (s: string) =>
  s
    // Characters XML 1.0 can't carry
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const columnName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** One-sheet XLSX. Strings are inline (never formulas); numbers stay numbers; the first row is bold and frozen. */
export function toXlsx(rows: Cell[][], sheetName = "Sheet1"): Buffer {
  const sheetRows = rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          const ref = `${columnName(ci)}${ri + 1}`;
          const style = ri === 0 ? ' s="1"' : "";
          if (v === null || v === undefined || v === "") return "";
          if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(v))}</t></is></c>`;
        })
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const name = escapeXml(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  return zip([
    [
      "[Content_Types].xml",
      `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    ["_rels/.rels", `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `${xml}<workbook ${ns} xmlns:r="${rel}"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    [
      "xl/_rels/workbook.xml.rels",
      `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      "xl/styles.xml",
      `${xml}<styleSheet ${ns}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ],
    [
      "xl/worksheets/sheet1.xml",
      `${xml}<worksheet ${ns}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheetRows}</sheetData></worksheet>`,
    ],
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer) {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal zip (deflate, no zip64): enough for the few parts of an export. */
function zip(files: [name: string, content: string][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const raw = Buffer.from(content, "utf8");
    const data = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x0021, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
