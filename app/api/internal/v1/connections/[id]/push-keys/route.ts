import { internal } from "@/lib/auth/internal";
import { newPushKey } from "@/lib/auth/push-key";
import { loadConnection, type IdParams } from "@/lib/connections";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/http";

const MAX_ACTIVE = 2; // δύο ενεργά = εναλλαγή κλειδιού χωρίς διακοπή

/** Έκδοση κλειδιού push API. Το κλειδί επιστρέφεται **μία φορά** — το eshop το δείχνει και δεν το αποθηκεύει. */
export const POST = internal<IdParams>(async (req, _ctx, route) => {
  const l = await loadConnection(route);
  if (!l.conn) return l.res;
  if (l.conn.type !== "push-api") return fail(400, "wrong_type", "Κλειδιά API υπάρχουν μόνο στη σύνδεση «Αποστολή από το σύστημά σας»");
  if (!l.conn.partner.active) return fail(409, "partner_inactive", "Το μέλος είναι ανενεργό");
  const active = await db.pushKey.count({ where: { connectionId: l.conn.id, revokedAt: null } });
  if (active >= MAX_ACTIVE) return fail(409, "too_many", `Υπάρχουν ήδη ${MAX_ACTIVE} ενεργά κλειδιά — ανακάλεσε ένα πρώτα`);
  const k = newPushKey();
  const by = new URL(req.url).searchParams.get("by")?.slice(0, 64) || null;
  const row = await db.pushKey.create({ data: { connectionId: l.conn.id, prefix: k.prefix, hash: k.hash, createdBy: by } });
  return ok({ id: row.id, prefix: row.prefix, key: k.key, createdAt: row.createdAt }, 201);
});

export const GET = internal<IdParams>(async (_req, _ctx, route) => {
  const l = await loadConnection(route);
  if (!l.conn) return l.res;
  const keys = await db.pushKey.findMany({ where: { connectionId: l.conn.id }, orderBy: { createdAt: "desc" }, select: { id: true, prefix: true, createdAt: true, createdBy: true, lastUsedAt: true, revokedAt: true } });
  return ok({ keys });
});
