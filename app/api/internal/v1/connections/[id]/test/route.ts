import { internal } from "@/lib/auth/internal";
import { loadConnection, type IdParams } from "@/lib/connections";
import { runConnectionTest } from "@/lib/connectors/run-test";
import { fail, ok } from "@/lib/http";

export const maxDuration = 120;

/** «Έλεγχος σύνδεσης»: τρέχει τώρα και επιστρέφει το αποτέλεσμα βήμα-βήμα. `?by=<id>` για το ιστορικό. */
export const POST = internal<IdParams>(async (req, _ctx, route) => {
  const l = await loadConnection(route);
  if (!l.conn) return l.res;
  if (!l.conn.partner.active) return fail(409, "partner_inactive", "Το μέλος είναι ανενεργό");
  const recent = l.conn.lastTestAt && Date.now() - l.conn.lastTestAt.getTime() < 10_000;
  if (recent) return fail(429, "too_soon", "Περίμενε λίγα δευτερόλεπτα πριν από νέο έλεγχο");
  const by = new URL(req.url).searchParams.get("by")?.slice(0, 64) || undefined;
  return ok(await runConnectionTest(l.conn.id, by));
});
