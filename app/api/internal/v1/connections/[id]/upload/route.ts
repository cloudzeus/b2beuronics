import { z } from "zod";
import { BadRequest, internal } from "@/lib/auth/internal";
import { loadConnection, type IdParams } from "@/lib/connections";
import { detectFormat, parseFeed, suggestFields, toStockRows, type Field } from "@/lib/feed/parse";
import { fail, ok } from "@/lib/http";
import { saveBatch } from "@/lib/inbound";

/**
 * Ανέβασμα αρχείου από την πύλη B2B (σύνδεση «Ανέβασμα αρχείου»). Το eshop προωθεί το κείμενο (CSV/JSON/XML·
 * το Excel το μετατρέπει σε CSV πριν). Χωρίς `map` → αυτόματη αναγνώριση στηλών· η απάντηση λέει τι αναγνωρίστηκε.
 */
const Body = z.object({
  filename: z.string().max(200),
  mode: z.enum(["full", "delta"]).default("full"),
  format: z.enum(["auto", "csv", "json", "xml"]).default("auto"),
  content: z.string().min(1).max(4 * 1024 * 1024),
  map: z.record(z.enum(["sku", "ean", "mpn", "brand", "title", "qty", "location"]), z.string().max(200)).optional(),
});

export const POST = internal<IdParams>(async (_req, ctx, route) => {
  const l = await loadConnection(route);
  if (!l.conn) return l.res;
  if (l.conn.type !== "manual") return fail(400, "wrong_type", "Το ανέβασμα αρχείου υπάρχει μόνο στη σύνδεση «Ανέβασμα αρχείου»");
  const b = Body.safeParse(ctx.json());
  if (!b.success) throw new BadRequest("Μη έγκυρο σώμα", b.error.issues.slice(0, 20));
  const fmt = b.data.format === "auto" ? detectFormat(b.data.content) : b.data.format;
  let parsed;
  try { parsed = parseFeed(b.data.content, fmt); } catch { throw new BadRequest(`Το αρχείο δεν διαβάζεται ως ${fmt.toUpperCase()}`); }
  const map = (b.data.map ?? suggestFields(parsed.columns, parsed.rows)) as Partial<Record<Field, string>>;
  const rows = toStockRows(parsed.rows, map);
  const batch = await saveBatch(l.conn.id, "upload", b.data.mode, rows, parsed.rows.length - rows.length);
  return ok({ batchId: batch.id, format: fmt, columns: parsed.columns.slice(0, 100), map, lines: parsed.rows.length, accepted: rows.length, rejected: parsed.rows.length - rows.length });
});
