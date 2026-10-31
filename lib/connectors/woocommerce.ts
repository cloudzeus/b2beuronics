import { z } from "zod";
import { safeFetch } from "@/lib/net/safe-fetch";
import { StepError, type ConnectorDef } from "./types";

/** WooCommerce του μέλους: REST v3, μόνο GET, κλειδιά με δικαίωμα «Read». HTTPS υποχρεωτικά. */
const Config = z.object({ baseUrl: z.string().url().max(300) });
const Secrets = z.object({
  consumerKey: z.string().regex(/^ck_[a-f0-9]{20,64}$/i, "Το Consumer key ξεκινά με ck_"),
  consumerSecret: z.string().regex(/^cs_[a-f0-9]{20,64}$/i, "Το Consumer secret ξεκινά με cs_"),
});

type Product = { id: number; sku?: string; name?: string; stock_quantity?: number | null; stock_status?: string; manage_stock?: boolean };

export const woocommerce: ConnectorDef<z.infer<typeof Config>, z.infer<typeof Secrets>> = {
  type: "woocommerce",
  label: "WooCommerce",
  autoTest: true,
  available: true,
  config: Config,
  secrets: Secrets,
  async test(ctx) {
    const base = ctx.config.baseUrl.replace(/\/+$/, "").replace(/\/wp-json.*$/, "");
    const auth = "Basic " + Buffer.from(`${ctx.secrets!.consumerKey}:${ctx.secrets!.consumerSecret}`).toString("base64");
    let products: Product[] = [];

    if (!(await ctx.step("reach", async () => {
      const r = await safeFetch(`${base}/wp-json/`, { httpsOnly: true, timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 });
      if (r.status === 404) throw new StepError("Το site απαντά, αλλά δεν βρέθηκε το WordPress REST API (/wp-json)");
      if (r.status >= 500) throw new StepError(`Το site απάντησε με σφάλμα HTTP ${r.status}`);
      return "Το site και το REST API απαντούν";
    }))) return;

    if (!(await ctx.step("auth", async () => {
      const r = await safeFetch(`${base}/wp-json/wc/v3/products?per_page=5&status=publish&_fields=id,sku,name,stock_quantity,stock_status,manage_stock`, { httpsOnly: true, headers: { Authorization: auth, Accept: "application/json" }, timeoutMs: 20_000, maxBytes: 2 * 1024 * 1024 });
      if (r.status === 401 || r.status === 403) throw new StepError("Τα κλειδιά απορρίφθηκαν — έλεγξε ότι είναι σωστά και έχουν δικαίωμα «Read»");
      if (r.status !== 200) throw new StepError(`Το WooCommerce απάντησε HTTP ${r.status}`);
      products = JSON.parse(r.bytes.toString("utf8")) as Product[];
      const total = Number(r.headers.get("x-wp-total"));
      ctx.setTotal(Number.isFinite(total) ? total : null);
      return `Τα κλειδιά δουλεύουν${Number.isFinite(total) ? ` — ${total.toLocaleString("el-GR")} δημοσιευμένα προϊόντα` : ""}`;
    }))) return;

    await ctx.step("read-sample", async () => {
      const managed = products.filter((p) => p.manage_stock);
      ctx.setSample(products.slice(0, 5).map((p) => ({
        externalSku: (p.sku || String(p.id)).slice(0, 100),
        ...(p.name ? { title: p.name.slice(0, 300) } : {}),
        locationRef: "eshop",
        qty: p.stock_quantity ?? (p.stock_status === "instock" ? 1 : 0),
      })));
      ctx.setLocations([{ ref: "eshop", name: "Απόθεμα eshop" }]);
      const noSku = products.filter((p) => !p.sku).length;
      return [
        managed.length ? `Το απόθεμα παρακολουθείται σε ${managed.length}/${products.length} του δείγματος` : "Το δείγμα δεν έχει ποσότητες (μόνο «διαθέσιμο/μη»)",
        noSku ? `${noSku} χωρίς SKU` : "",
      ].filter(Boolean).join(" · ");
    });
  },
};
