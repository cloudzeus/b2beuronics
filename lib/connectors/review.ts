import { z } from "zod";
import { safeFetch } from "@/lib/net/safe-fetch";
import type { ConnectionType } from "@/lib/contracts";
import { StepError, type ConnectorDef } from "./types";

/**
 * Τύποι χωρίς αυτόματο έλεγχο ακόμη (υλοποιούνται ένας-ένας στις επόμενες φάσεις). Αν δοθεί διεύθυνση,
 * ελέγχουμε μόνο ότι απαντά· το αποτέλεσμα είναι «review» και τη σύνδεση την εξετάζουμε εμείς με το IT του μέλους.
 */
const Config = z.object({ url: z.string().url().max(500).optional(), notes: z.string().max(2000).optional() });
const Secrets = z.record(z.string(), z.string().max(2000));

function reviewOnly(type: ConnectionType, label: string): ConnectorDef<z.infer<typeof Config>, z.infer<typeof Secrets>> {
  return {
    type,
    label,
    autoTest: false,
    config: Config,
    secrets: Secrets,
    async test(ctx) {
      ctx.markReview();
      if (!ctx.config.url) {
        await ctx.step("config", async () => "Τα στοιχεία καταχωρήθηκαν· η σύνδεση θα ελεγχθεί από την ομάδα μας", { critical: false });
        return;
      }
      await ctx.step("reach", async () => {
        const r = await safeFetch(ctx.config.url!, { method: "GET", httpsOnly: true, timeoutMs: 15_000, maxBytes: 1024 * 1024 });
        if (r.status >= 500) throw new StepError(`Ο server απάντησε με σφάλμα HTTP ${r.status}`);
        return `Ο server απαντά (HTTP ${r.status}) · η σύνδεση θα ολοκληρωθεί από την ομάδα μας`;
      }, { critical: false });
    },
  };
}

export const reviewConnectors = [
  reviewOnly("entersoft", "Entersoft"),
  reviewOnly("epsilon", "Epsilon Net (Pylon / Business)"),
  reviewOnly("galaxy", "SingularLogic Galaxy"),
  reviewOnly("shopify", "Shopify"),
  reviewOnly("magento", "Magento / Adobe Commerce"),
  reviewOnly("opencart", "OpenCart"),
  reviewOnly("prestashop", "PrestaShop"),
  reviewOnly("sftp", "Αρχείο σε SFTP"),
];
