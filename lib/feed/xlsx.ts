import { inflateRawSync } from "node:zlib";

/**
 * Ελάχιστη ανάγνωση .xlsx (πρώτο φύλλο → πίνακας κειμένων), χωρίς εξωτερική βιβλιοθήκη: το xlsx είναι zip με XML.
 * Διαβάζει τις τιμές όπως αποθηκεύτηκαν (όχι τύπους/μορφοποιήσεις). Το παλιό .xls (BIFF) δεν υποστηρίζεται.
 */

/** Υπογραφή zip (`PK\x03\x04`) — κάθε .xlsx ξεκινά έτσι. */
export const isZip = (buf: Buffer) => buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
/** Υπογραφή OLE2 — το παλιό .xls. */
export const isLegacyXls = (buf: Buffer) => buf.length > 8 && buf.readUInt32BE(0) === 0xd0cf11e0 && buf.readUInt32BE(4) === 0xa1b11ae1;

const MAX_INFLATED = 200 * 1024 * 1024; // προστασία από zip bomb

function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Δεν είναι έγκυρο αρχείο xlsx");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let k = 0; k < count && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + xlen + clen;
    if (!/^(xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml)$/.test(name)) continue;
    const ln = buf.readUInt16LE(local + 26), lx = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + ln + lx, local + 30 + ln + lx + csize);
    const file = method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_INFLATED - total }) : Buffer.from(data);
    total += file.length;
    out.set(name, file);
  }
  return out;
}

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** Οι γραμμές του πρώτου φύλλου ως πίνακας κειμένων. */
export function readXlsx(buf: Buffer, maxRows = 200_000): string[][] {
  const files = unzip(buf);
  const shared = files.get("xl/sharedStrings.xml")?.toString("utf8");
  const strings = shared ? [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [];
  const sheetName = [...files.keys()].filter((n) => n.startsWith("xl/worksheets/")).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))[0];
  if (!sheetName) throw new Error("Το αρχείο δεν έχει φύλλο");
  const xml = files.get(sheetName)!.toString("utf8");
  const rows: string[][] = [];
  for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    for (const c of (r[1] ?? "").matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] ?? "";
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const t = attrs.match(/t="(\w+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const val = t === "s" ? strings[Number(v)] ?? "" : t === "inlineStr" ? texts(body) : v != null ? unxml(v) : "";
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows.push(Array.from(row, (x) => (x ?? "").trim()));
    if (rows.length >= maxRows) break;
  }
  return rows;
}

/** Πίνακας → αντικείμενα με κεφαλίδες από την πρώτη γραμμή που έχει ≥2 τιμές (στις 20 πρώτες — συχνά υπάρχει τίτλος πάνω). */
export function xlsxObjects(buf: Buffer): Record<string, string>[] {
  const rows = readXlsx(buf);
  const h = rows.slice(0, 20).findIndex((r) => r.filter(Boolean).length >= 2);
  if (h < 0) return [];
  const head = rows[h];
  return rows.slice(h + 1).filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""]).filter(([k]) => k)));
}
