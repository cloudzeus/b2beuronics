import { z } from "zod";
import { safeFetch } from "@/lib/net/safe-fetch";
import { FieldMap } from "@/lib/contracts";
import { formatLabel, locationsOf, parseBytes, suggestFields, toStockRows } from "@/lib/feed/parse";
import { StepError, type ConnectorDef } from "./types";

/** Feed XML/CSV/JSON ή αρχείο Excel (.xlsx) σε διεύθυνση. Προαιρετικά Basic auth ή token σε header. */
const Config = z.object({
  url: z.string().url().max(2000),
  format: z.enum(["auto", "xml", "csv", "json", "xlsx"]).default("auto"),
  encoding: z.enum(["auto", "utf8", "win1253", "iso-8859-7"]).default("auto"),
  /** όνομα header για το token, π.χ. X-Api-Key (αλλιώς Authorization: Bearer) */
  tokenHeader: z.string().regex(/^[A-Za-z0-9-]{1,40}$/).optional(),
  /** αντιστοίχιση στηλών με το χέρι (από την πύλη)· ό,τι λείπει αναγνωρίζεται αυτόματα */
  map: FieldMap.optional(),
});
const Secrets = z.object({ username: z.string().max(100).optional(), password: z.string().max(200).optional(), token: z.string().max(2000).optional() });

export const feedUrl: ConnectorDef<z.infer<typeof Config>, z.infer<typeof Secrets>> = {
  type: "feed-url",
  label: "Feed ή αρχείο σε διεύθυνση (XML / Excel / CSV / JSON)",
  autoTest: true,
  available: true,
  config: Config,
  secrets: Secrets,
  async test(ctx) {
    const { url, format, encoding, tokenHeader } = ctx.config;
    const s = ctx.secrets ?? {};
    const headers: Record<string, string> = {};
    if (s.username) headers.Authorization = "Basic " + Buffer.from(`${s.username}:${s.password ?? ""}`).toString("base64");
    if (s.token) headers[tokenHeader ?? "Authorization"] = tokenHeader ? s.token : `Bearer ${s.token}`;
    let bytes: Buffer = Buffer.alloc(0), contentType = "";

    if (!(await ctx.step("reach", async () => {
      const r = await safeFetch(url, { headers, timeoutMs: 60_000, maxBytes: 100 * 1024 * 1024 });
      if (r.status === 401 || r.status === 403) throw new StepError("Ο server ζητά στοιχεία πρόσβασης ή τα απέρριψε");
      if (r.status !== 200) throw new StepError(`Ο server απάντησε HTTP ${r.status}`);
      contentType = r.headers.get("content-type") ?? "";
      bytes = r.bytes;
      return `Λήψη OK (${(r.bytes.length / 1024).toFixed(0)} KB)`;
    }))) return;

    await ctx.step("read-sample", async () => {
      let parsed;
      try { parsed = parseBytes(bytes, format, encoding, contentType); } catch (e) {
        throw new StepError(/\.xls\b/.test(String(e)) ? (e as Error).message : `Το αρχείο δεν διαβάζεται${format === "auto" ? "" : ` ως ${formatLabel(format)}`}`);
      }
      const fmt = formatLabel(parsed.format);
      if (!parsed.rows.length) throw new StepError(`Δεν βρέθηκαν προϊόντα στο ${fmt}`);
      ctx.setTotal(parsed.rows.length);
      const manual = ctx.config.map ?? {};
      const hints = { ...suggestFields(parsed.columns, parsed.rows), ...manual };
      const lost = Object.entries(manual).filter(([, c]) => !parsed.columns.includes(String(c)));
      if (lost.length) throw new StepError(`Η αντιστοίχιση δείχνει σε στήλες που δεν υπάρχουν πια στο αρχείο: ${lost.map(([f, c]) => `${f} → «${c}»`).join(", ")}`);
      ctx.setFieldHints(hints as Record<string, string>);
      ctx.setColumns(parsed.columns, parsed.rows.slice(0, 5));
      const stock = toStockRows(parsed.rows, hints);
      ctx.setSample(stock.slice(0, 5));
      ctx.setLocations(hints.location ? locationsOf(stock) : [{ ref: "default", name: "Ενιαίο απόθεμα" }]);
      const missing = [!hints.sku && !hints.ean ? "κωδικό/EAN" : "", !hints.qty ? "ποσότητα" : ""].filter(Boolean);
      if (missing.length) throw new StepError(`${parsed.rows.length} γραμμές ${fmt}, αλλά δεν αναγνωρίστηκε στήλη για ${missing.join(" και ")} — θα γίνει αντιστοίχιση με το χέρι`);
      return `${parsed.rows.length.toLocaleString("el-GR")} γραμμές ${fmt} · αναγνωρίστηκαν: ${Object.entries(hints).map(([k, v]) => `${k}=${v}`).join(", ")}`;
    });
  },
};
