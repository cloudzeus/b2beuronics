import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { db } from "@/lib/db";
import { locationsOf } from "@/lib/feed/parse";
import type { StockRow } from "@/lib/contracts";
import { StepError, type ConnectorDef, type TestCtx } from "./types";

/**
 * Push API και ανέβασμα αρχείου: δεν συνδεόμαστε εμείς σε αυτούς — ο έλεγχος κοιτά τι έχει έρθει.
 * Τα InboundBatch κρατούν τις αποδεκτές γραμμές ως gzip JSON (`StockRow[]`).
 */
const RECENT_DAYS = 7;

async function testInbound(ctx: TestCtx<unknown, unknown>, source: "push" | "upload") {
  if (source === "push" && !(await ctx.step("config", async () => {
    const keys = await db.pushKey.count({ where: { connectionId: ctx.connectionId, revokedAt: null } });
    if (!keys) throw new StepError("Δεν έχει εκδοθεί κλειδί API — έκδωσέ το και δώσ' το στον τεχνικό του ERP");
    return `Ενεργά κλειδιά: ${keys}`;
  }))) return;

  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
  const batch = await db.inboundBatch.findFirst({ where: { connectionId: ctx.connectionId, source, receivedAt: { gte: since } }, orderBy: { receivedAt: "desc" } });

  if (!(await ctx.step("received", async () => {
    if (!batch) throw new StepError(source === "push" ? `Δεν έχει έρθει αίτημα τις τελευταίες ${RECENT_DAYS} ημέρες — στείλτε ένα δοκιμαστικό` : "Δεν έχει ανέβει αρχείο ακόμη");
    if (!batch.accepted) throw new StepError(`Ήρθε στις ${batch.receivedAt.toLocaleString("el-GR", { timeZone: "Europe/Athens" })}, αλλά καμία γραμμή δεν ήταν έγκυρη (${batch.rejected} απορρίφθηκαν)`);
    return `Τελευταίο: ${batch.receivedAt.toLocaleString("el-GR", { timeZone: "Europe/Athens" })} · ${batch.accepted} γραμμές${batch.rejected ? `, ${batch.rejected} απορρίφθηκαν` : ""}`;
  }))) return;

  await ctx.step("read-sample", async () => {
    const rows = JSON.parse(gunzipSync(batch!.gz).toString("utf8")) as StockRow[];
    ctx.setTotal(rows.length);
    ctx.setSample(rows.slice(0, 5));
    ctx.setLocations(locationsOf(rows));
    return `Τοποθεσίες στο αρχείο: ${locationsOf(rows).length}`;
  });
}

export const pushApi: ConnectorDef = {
  type: "push-api",
  label: "Αποστολή από το σύστημά σας (API)",
  autoTest: true,
  config: z.object({}).passthrough(),
  secrets: null,
  test: (ctx) => testInbound(ctx, "push"),
};

export const manual: ConnectorDef = {
  type: "manual",
  label: "Ανέβασμα αρχείου (Excel / CSV / XML)",
  autoTest: true,
  available: true,
  config: z.object({}).passthrough(),
  secrets: null,
  test: (ctx) => testInbound(ctx, "upload"),
};
