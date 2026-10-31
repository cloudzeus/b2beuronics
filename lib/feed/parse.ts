import { XMLParser } from "fast-xml-parser";
import iconv from "iconv-lite";
import type { Location, StockRow } from "@/lib/contracts";
import { isLegacyXls, isZip, xlsxObjects } from "./xlsx";

/**
 * Ανάλυση feed/αρχείου στοκ (XML, CSV, JSON, Excel .xlsx) σε επίπεδες γραμμές, με πρόταση αντιστοίχισης πεδίων.
 * Για τον έλεγχο σύνδεσης και τα ανεβάσματα· η πλήρης επεξεργασία (Φάση 2) χρησιμοποιεί την ίδια ανάλυση.
 */
export type TextFormat = "xml" | "csv" | "json";
export type Format = TextFormat | "xlsx";
export type Flat = Record<string, string>;
export type Parsed = { format: Format; rows: Flat[]; columns: string[] };

export function detectFormat(text: string, contentType = ""): TextFormat {
  const t = text.trimStart();
  if (/json/i.test(contentType) || t.startsWith("{") || t.startsWith("[")) return "json";
  if (/xml/i.test(contentType) || t.startsWith("<")) return "xml";
  return "csv";
}

export function parseFeed(text: string, format: TextFormat): Parsed {
  const rows = format === "csv" ? parseCsv(text) : format === "json" ? largestArray(JSON.parse(text)) : largestArray(new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false, trimValues: true }).parse(text));
  const columns = [...new Set(rows.slice(0, 200).flatMap((r) => Object.keys(r)))];
  return { format, rows, columns };
}

/** Όνομα μορφής για τα μηνύματα προς το μέλος. */
export const formatLabel = (f: Format | "auto") => (f === "xlsx" ? "Excel" : f === "auto" ? "αρχείο" : f.toUpperCase());

export type Encoding = "auto" | "utf8" | "win1253" | "iso-8859-7";

/** Κείμενο από bytes: δηλωμένη κωδικοποίηση (header ή <?xml encoding?>) ή UTF-8. */
export function decode(bytes: Buffer, enc: Encoding, contentType = ""): string {
  const declared = (contentType.match(/charset=([\w-]+)/i)?.[1] ?? bytes.subarray(0, 200).toString("latin1").match(/encoding=["']([\w-]+)/i)?.[1] ?? "").toLowerCase();
  const pick = enc !== "auto" ? enc : /1253/.test(declared) ? "win1253" : /8859-7/.test(declared) ? "iso-8859-7" : "utf8";
  return pick === "utf8" ? bytes.toString("utf8") : iconv.decode(bytes, pick);
}

/** Αρχείο ή απάντηση feed σε γραμμές: αναγνωρίζει μόνο του το Excel από την υπογραφή zip. */
export function parseBytes(bytes: Buffer, format: Format | "auto", encoding: Encoding = "auto", contentType = ""): Parsed {
  if (isLegacyXls(bytes)) throw new Error("Το παλιό Excel (.xls) δεν υποστηρίζεται — αποθηκεύστε το ως .xlsx ή CSV");
  if (format === "xlsx" || (format === "auto" && isZip(bytes))) {
    const rows = xlsxObjects(bytes);
    return { format: "xlsx", rows, columns: [...new Set(rows.slice(0, 200).flatMap((r) => Object.keys(r)))] };
  }
  const text = decode(bytes, encoding, contentType);
  return parseFeed(text, format === "auto" ? detectFormat(text, contentType) : format);
}

/** Η μεγαλύτερη λίστα αντικειμένων μέσα στο δέντρο = τα προϊόντα. */
function largestArray(tree: unknown): Flat[] {
  let best: unknown[] = [];
  const walk = (n: unknown, depth: number) => {
    if (depth > 8 || n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      if (n.length > best.length && n.some((x) => x && typeof x === "object" && !Array.isArray(x))) best = n;
      for (const x of n.slice(0, 3)) walk(x, depth + 1);
      return;
    }
    for (const v of Object.values(n)) walk(v, depth + 1);
  };
  walk(tree, 0);
  // ένα μόνο προϊόν στο XML έρχεται ως αντικείμενο, όχι λίστα
  if (!best.length && tree && typeof tree === "object") {
    const one = Object.values(tree as object).find((v) => v && typeof v === "object" && !Array.isArray(v));
    if (one) best = Object.values(one as object).filter((v) => v && typeof v === "object" && !Array.isArray(v));
  }
  return best.filter((x) => x && typeof x === "object" && !Array.isArray(x)).map((x) => flatten(x as Record<string, unknown>));
}

function flatten(o: Record<string, unknown>, prefix = "", out: Flat = {}, depth = 0): Flat {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      const text = (v as Record<string, unknown>)["#text"];
      if (text !== undefined && Object.keys(v).every((x) => x === "#text" || x.startsWith("@"))) out[key] = String(text);
      else if (depth < 2) flatten(v as Record<string, unknown>, key, out, depth + 1);
    } else if (Array.isArray(v)) {
      if (v.every((x) => typeof x !== "object")) out[key] = v.join("|");
    } else out[key] = String(v);
  }
  return out;
}

export function parseCsv(text: string): Flat[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = [";", ",", "\t", "|"].map((d) => [d, splitLine(lines[0], d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitLine(lines[0], delim).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = splitLine(l, delim);
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? "").trim()]).filter(([h]) => h));
  });
}

function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === d && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// ---------- Πρόταση αντιστοίχισης ----------

export type Field = "sku" | "ean" | "mpn" | "brand" | "title" | "qty" | "location";
const PATTERNS: [Field, RegExp][] = [
  ["ean", /(^|[._@])(ean|ean13|barcode|gtin|upc|bar_?code)$/i],
  ["mpn", /(^|[._@])(mpn|part_?(no|number)|model|manufacturer_?code|κωδ.*κατασκ)/i],
  ["qty", /(^|[._@])(qty|quantity|stock|stock_?qty|stock_?quantity|ποσότητα|ποσοτητα|απόθεμα|αποθεμα|υπόλοιπο|υπολοιπο)$/i],
  ["location", /(^|[._@])(store|store_?(id|code)|warehouse|whouse|branch|location|κατάστημα|καταστημα|αποθήκη|αποθηκη|υποκ)/i],
  ["brand", /(^|[._@])(brand|manufacturer|μάρκα|μαρκα|κατασκευαστής|κατασκευαστης)$/i],
  ["title", /(^|[._@])(name|title|product_?name|description|περιγραφή|περιγραφη|όνομα|ονομα)$/i],
  ["sku", /(^|[._@])(sku|code|item_?code|product_?(id|code)|id|κωδικός|κωδικος)$/i],
];

export function suggestFields(columns: string[], rows: Flat[]): Partial<Record<Field, string>> {
  const hints: Partial<Record<Field, string>> = {};
  const used = new Set<string>();
  for (const [field, re] of PATTERNS) {
    const col = columns.find((c) => !used.has(c) && re.test(c));
    if (col) { hints[field] = col; used.add(col); }
  }
  // EAN από το περιεχόμενο: στήλη με 8/12/13/14 ψηφία στις περισσότερες γραμμές
  if (!hints.ean) {
    const sample = rows.slice(0, 50);
    const col = columns.find((c) => !used.has(c) && sample.length > 0 && sample.filter((r) => /^\d{8}$|^\d{12,14}$/.test(r[c] ?? "")).length / sample.length > 0.7);
    if (col) hints.ean = col;
  }
  return hints;
}

export const toQty = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const s = v.trim().toLowerCase();
  if (/^(in ?stock|instock|yes|ναι|διαθέσιμο|διαθεσιμο|true)$/.test(s)) return 1;
  if (/^(out ?of ?stock|outofstock|no|όχι|οχι|μη διαθέσιμο|false)$/.test(s)) return 0;
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Γραμμές → κανονικοποιημένο στοκ με βάση την αντιστοίχιση. Χωρίς στήλη τοποθεσίας → «default». */
export function toStockRows(rows: Flat[], map: Partial<Record<Field, string>>, limit = Infinity): StockRow[] {
  const out: StockRow[] = [];
  if (!map.sku && !map.ean) return out;
  for (const r of rows) {
    if (out.length >= limit) break;
    const sku = (map.sku && r[map.sku]) || (map.ean && r[map.ean]);
    const qty = toQty(map.qty ? r[map.qty] : undefined);
    if (!sku || qty === null) continue;
    out.push({
      externalSku: sku.slice(0, 100),
      ...(map.ean && r[map.ean] ? { ean: r[map.ean].slice(0, 20) } : {}),
      ...(map.mpn && r[map.mpn] ? { mpn: r[map.mpn].slice(0, 100) } : {}),
      ...(map.brand && r[map.brand] ? { brand: r[map.brand].slice(0, 100) } : {}),
      ...(map.title && r[map.title] ? { title: r[map.title].slice(0, 300) } : {}),
      locationRef: ((map.location && r[map.location]) || "default").slice(0, 100),
      qty,
    });
  }
  return out;
}

export function locationsOf(rows: StockRow[] | Flat[], key?: string, cap = 200): Location[] {
  const refs = new Set<string>();
  for (const r of rows as (StockRow & Flat)[]) {
    const v = key ? r[key] : r.locationRef;
    if (v) refs.add(String(v));
    if (refs.size >= cap) break;
  }
  return [...refs].map((ref) => ({ ref, name: ref }));
}
