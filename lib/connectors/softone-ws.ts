import iconv from "iconv-lite";
import { z } from "zod";
import { safeFetch } from "@/lib/net/safe-fetch";
import { StepError, type ConnectorDef } from "./types";

/**
 * SoftOne του μέλους μέσω των επίσημων Web Services: login → authenticate (δύο βήματα), απαντήσεις σε windows-1253.
 * Ζητάμε από το μέλος web account **μόνο ανάγνωσης**. Μόνο επίσημα services (κανένα /s1services/JS/…).
 */
const Config = z.object({
  /** serial του oncloud (π.χ. 01102358330113 ή το όνομα πριν το .oncloud.gr) ή πλήρες https://…/s1services */
  url: z.string().min(3).max(300),
  appId: z.string().regex(/^\d{3,6}$/, "Το AppID είναι αριθμός"),
  company: z.string().regex(/^\d{1,6}$/),
  branch: z.string().regex(/^\d{1,6}$/),
  module: z.string().regex(/^\d{1,4}$/).default("0"),
  refid: z.string().regex(/^\d{1,6}$/),
});
const Secrets = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) });
type Cfg = z.infer<typeof Config>;

export const baseUrl = (url: string) => (/^https:\/\//i.test(url) ? url.replace(/\/$/, "") : `https://${url.trim()}.oncloud.gr/s1services`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(cfg: Cfg, body: object): Promise<any> {
  const res = await safeFetch(baseUrl(cfg.url), { method: "POST", httpsOnly: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs: 20_000, maxBytes: 5 * 1024 * 1024 });
  if (!res.bytes.length) throw new StepError(`Οι web services απάντησαν HTTP ${res.status} χωρίς περιεχόμενο — η υπηρεσία δεν τρέχει`);
  const text = iconv.decode(res.bytes, "win1253");
  try { return JSON.parse(text); } catch { throw new StepError(`Το SoftOne απάντησε HTTP ${res.status} με μη έγκυρο JSON`); }
}

export const softoneWs: ConnectorDef<Cfg, z.infer<typeof Secrets>> = {
  type: "softone-ws",
  label: "SoftOne (Web Services)",
  autoTest: true,
  config: Config,
  secrets: Secrets,
  async test(ctx) {
    const cfg = ctx.config;
    const s = ctx.secrets!;
    let clientID = "";

    if (!(await ctx.step("reach", async () => {
      const login = await call(cfg, { service: "login", username: s.username, password: s.password, appId: cfg.appId });
      if (!login.success) throw new StepError(`Η είσοδος απέτυχε: ${login.error ?? "λάθος στοιχεία"}`);
      clientID = login.clientID;
      return "Ο server απαντά και τα στοιχεία εισόδου είναι σωστά";
    }))) return;

    if (!(await ctx.step("auth", async () => {
      const auth = await call(cfg, { service: "authenticate", clientID, company: cfg.company, branch: cfg.branch, module: cfg.module, refid: cfg.refid });
      if (!auth.success) throw new StepError(`Η ταυτοποίηση απέτυχε (εταιρεία/υποκατάστημα/χρήστης): ${auth.error ?? ""}`.trim());
      clientID = auth.clientID;
      return `Συνδεθήκαμε στην εταιρεία ${cfg.company}, υποκατάστημα ${cfg.branch}`;
    }))) return;

    await ctx.step("read-sample", async () => {
      const info = await call(cfg, { service: "getBrowserInfo", clientID, appId: cfg.appId, object: "ITEM", list: "", filters: "ITEM.ISACTIVE=1" });
      if (!info.success) throw new StepError(`Δεν διαβάζονται τα είδη: ${info.error ?? "χωρίς δικαίωμα;"}`);
      const total = Number(info.totalcount ?? 0);
      ctx.setTotal(total);
      const data = await call(cfg, { service: "getBrowserData", clientID, appId: cfg.appId, reqID: info.reqID, start: 0, limit: 5 });
      const cols: string[] = (info.columns ?? []).map((c: { dataIndex: string }) => c.dataIndex);
      const at = (re: RegExp) => cols.findIndex((c) => re.test(c));
      const iCode = at(/^ITEM\.CODE$/), iName = at(/^ITEM\.NAME$/), iQty = at(/QTY1|BALANCE|ITEMTRDATA_QTY/i), iEan = at(/CODE1$|BARCODE/i);
      if (iQty >= 0 && iCode >= 0) {
        ctx.setSample((data.rows ?? []).slice(0, 5).map((r: string[]) => ({
          externalSku: String(r[iCode]),
          ...(iName >= 0 ? { title: String(r[iName]).slice(0, 300) } : {}),
          ...(iEan >= 0 && r[iEan] ? { ean: String(r[iEan]).slice(0, 20) } : {}),
          locationRef: "total",
          qty: Number(r[iQty]) || 0,
        })));
      }
      return `Διαβάστηκαν τα είδη: ${total.toLocaleString("el-GR")} ενεργά${iQty < 0 ? " (το απόθεμα ανά αποθήκη θα ρυθμιστεί στη σύνδεση)" : ""}`;
    });

    await ctx.step("locations", async () => {
      const t = await call(cfg, { service: "GetTable", clientID, appId: cfg.appId, TABLE: "WHOUSE", FIELDS: "WHOUSE,NAME,ISACTIVE", FILTER: "ISACTIVE=1" });
      if (!t.success) throw new StepError(`Δεν διαβάζονται οι αποθήκες: ${t.error ?? ""}`.trim());
      const rows: (string[] | Record<string, string>)[] = t.data ?? t.rows ?? [];
      const locs = rows.map((r) => (Array.isArray(r) ? { ref: String(r[0]), name: String(r[1]) } : { ref: String(r.WHOUSE), name: String(r.NAME) }));
      ctx.setLocations(locs);
      return `Βρέθηκαν ${locs.length} αποθήκες — αντιστοίχισέ τες με τα καταστήματα`;
    }, { critical: false });
  },
};
