import { z } from "zod";
import iconv from "iconv-lite";
import { safeFetch } from "@/lib/net/safe-fetch";
import { detectFormat, locationsOf, parseFeed, suggestFields, toStockRows } from "@/lib/feed/parse";
import { StepError, type ConnectorDef } from "./types";

/** Feed XML/CSV/JSON σε διεύθυνση. Προαιρετικά Basic auth ή token σε header. */
const Config = z.object({
  url: z.string().url().max(2000),
  format: z.enum(["auto", "xml", "csv", "json"]).default("auto"),
  encoding: z.enum(["auto", "utf8", "win1253", "iso-8859-7"]).default("auto"),
  /** όνομα header για το token, π.χ. X-Api-Key (αλλιώς Authorization: Bearer) */
  tokenHeader: z.string().regex(/^[A-Za-z0-9-]{1,40}$/).optional(),
});
const Secrets = z.object({ username: z.string().max(100).optional(), password: z.string().max(200).optional(), token: z.string().max(2000).optional() });

export function decode(bytes: Buffer, enc: string, contentType: string): string {
  const declared = (contentType.match(/charset=([\w-]+)/i)?.[1] ?? bytes.subarray(0, 200).toString("latin1").match(/encoding=["']([\w-]+)/i)?.[1] ?? "").toLowerCase();
  const pick = enc !== "auto" ? enc : /1253/.test(declared) ? "win1253" : /8859-7/.test(declared) ? "iso-8859-7" : "utf8";
  return pick === "utf8" ? bytes.toString("utf8") : iconv.decode(bytes, pick);
}

export const feedUrl: ConnectorDef<z.infer<typeof Config>, z.infer<typeof Secrets>> = {
  type: "feed-url",
  label: "Feed σε διεύθυνση (XML / CSV / JSON)",
  autoTest: true,
  config: Config,
  secrets: Secrets,
  async test(ctx) {
    const { url, format, encoding, tokenHeader } = ctx.config;
    const s = ctx.secrets ?? {};
    const headers: Record<string, string> = {};
    if (s.username) headers.Authorization = "Basic " + Buffer.from(`${s.username}:${s.password ?? ""}`).toString("base64");
    if (s.token) headers[tokenHeader ?? "Authorization"] = tokenHeader ? s.token : `Bearer ${s.token}`;
    let text = "", contentType = "";

    if (!(await ctx.step("reach", async () => {
      const r = await safeFetch(url, { headers, timeoutMs: 60_000, maxBytes: 100 * 1024 * 1024 });
      if (r.status === 401 || r.status === 403) throw new StepError("Ο server ζητά στοιχεία πρόσβασης ή τα απέρριψε");
      if (r.status !== 200) throw new StepError(`Ο server απάντησε HTTP ${r.status}`);
      contentType = r.headers.get("content-type") ?? "";
      text = decode(r.bytes, encoding, contentType);
      return `Λήψη OK (${(r.bytes.length / 1024).toFixed(0)} KB)`;
    }))) return;

    await ctx.step("read-sample", async () => {
      const fmt = format === "auto" ? detectFormat(text, contentType) : format;
      let parsed;
      try { parsed = parseFeed(text, fmt); } catch { throw new StepError(`Το αρχείο δεν διαβάζεται ως ${fmt.toUpperCase()}`); }
      if (!parsed.rows.length) throw new StepError(`Δεν βρέθηκαν προϊόντα στο ${fmt.toUpperCase()}`);
      ctx.setTotal(parsed.rows.length);
      const hints = suggestFields(parsed.columns, parsed.rows);
      ctx.setFieldHints(hints as Record<string, string>);
      const stock = toStockRows(parsed.rows, hints);
      ctx.setSample(stock.slice(0, 5));
      ctx.setLocations(hints.location ? locationsOf(stock) : [{ ref: "default", name: "Ενιαίο απόθεμα" }]);
      const missing = [!hints.sku && !hints.ean ? "κωδικό/EAN" : "", !hints.qty ? "ποσότητα" : ""].filter(Boolean);
      if (missing.length) throw new StepError(`${parsed.rows.length} γραμμές ${fmt.toUpperCase()}, αλλά δεν αναγνωρίστηκε στήλη για ${missing.join(" και ")} — θα γίνει αντιστοίχιση με το χέρι`);
      return `${parsed.rows.length.toLocaleString("el-GR")} γραμμές ${fmt.toUpperCase()} · αναγνωρίστηκαν: ${Object.entries(hints).map(([k, v]) => `${k}=${v}`).join(", ")}`;
    });
  },
};
