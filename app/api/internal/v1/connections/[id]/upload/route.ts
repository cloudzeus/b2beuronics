import { z } from "zod";
import { FieldMap } from "@/lib/contracts";
import { BadRequest, internal } from "@/lib/auth/internal";
import { loadConnection, type IdParams } from "@/lib/connections";
import { formatLabel, parseBytes, suggestFields, toStockRows, type Field } from "@/lib/feed/parse";
import { fail, ok } from "@/lib/http";
import { saveBatch } from "@/lib/inbound";

/**
 * Ανέβασμα αρχείου από την πύλη B2B (σύνδεση «Ανέβασμα αρχείου»). Το eshop προωθεί είτε κείμενο (`content`:
 * CSV/JSON/XML) είτε τα bytes σε base64 (`contentBase64`: Excel .xlsx ή οποιοδήποτε από τα παραπάνω).
 * Χωρίς `map` → αυτόματη αναγνώριση στηλών· η απάντηση λέει τι αναγνωρίστηκε.
 * `dryRun` → τίποτα δεν αποθηκεύεται: στήλες, 5 ακατέργαστες γραμμές, πρόταση αντιστοίχισης και τι θα γινόταν δεκτό
 * (η οθόνη αντιστοίχισης της πύλης).
 */
const Body = z
  .object({
    filename: z.string().max(200),
    mode: z.enum(["full", "delta"]).default("full"),
    format: z.enum(["auto", "csv", "json", "xml", "xlsx"]).default("auto"),
    content: z.string().min(1).max(4 * 1024 * 1024).optional(),
    contentBase64: z.string().min(1).max(4 * 1024 * 1024).optional(),
    map: FieldMap.optional(),
    dryRun: z.boolean().default(false),
  })
  .refine((b) => !!b.content !== !!b.contentBase64, { message: "Δώστε ακριβώς ένα από τα content / contentBase64" });

export const POST = internal<IdParams>(async (_req, ctx, route) => {
  const l = await loadConnection(route);
  if (!l.conn) return l.res;
  if (l.conn.type !== "manual") return fail(400, "wrong_type", "Το ανέβασμα αρχείου υπάρχει μόνο στη σύνδεση «Ανέβασμα αρχείου»");
  const b = Body.safeParse(ctx.json());
  if (!b.success) throw new BadRequest("Μη έγκυρο σώμα", b.error.issues.slice(0, 20));
  const bytes = b.data.contentBase64 ? Buffer.from(b.data.contentBase64, "base64") : Buffer.from(b.data.content!, "utf8");
  const format = b.data.format === "auto" && /\.xlsx$/i.test(b.data.filename) ? "xlsx" : b.data.format;
  let parsed;
  try { parsed = parseBytes(bytes, format, b.data.contentBase64 ? "auto" : "utf8"); } catch (e) {
    throw new BadRequest(/\.xls\b/.test(String(e)) ? (e as Error).message : `Το αρχείο δεν διαβάζεται ως ${formatLabel(format)}`);
  }
  const suggested = suggestFields(parsed.columns, parsed.rows);
  const lost = Object.entries(b.data.map ?? {}).filter(([, c]) => !parsed.columns.includes(c));
  if (lost.length) throw new BadRequest(`Δεν υπάρχουν στο αρχείο οι στήλες: ${lost.map(([, c]) => `«${c}»`).join(", ")}`);
  const map = { ...suggested, ...b.data.map } as Partial<Record<Field, string>>;
  const rows = toStockRows(parsed.rows, map);
  if (b.data.dryRun) {
    const locs = map.location ? [...new Set(rows.map((r) => r.locationRef))].slice(0, 200) : ["default"];
    const preview = parsed.rows.slice(0, 5).map((r) => Object.fromEntries(Object.entries(r).slice(0, 200).map(([k, v]) => [k, String(v ?? "").slice(0, 200)])));
    return ok({ dryRun: true, format: parsed.format, columns: parsed.columns.slice(0, 200), preview, suggested, map, sample: rows.slice(0, 5), locations: locs, lines: parsed.rows.length, accepted: rows.length, rejected: parsed.rows.length - rows.length });
  }
  const batch = await saveBatch(l.conn.id, "upload", b.data.mode, rows, parsed.rows.length - rows.length);
  return ok({ batchId: batch.id, format: parsed.format, columns: parsed.columns.slice(0, 100), map, lines: parsed.rows.length, accepted: rows.length, rejected: parsed.rows.length - rows.length });
});
