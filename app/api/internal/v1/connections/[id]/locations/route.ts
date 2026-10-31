import { LocationMapBody } from "@/lib/contracts";
import { BadRequest, internal } from "@/lib/auth/internal";
import { loadConnection, type IdParams } from "@/lib/connections";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";

/**
 * Αντιστοίχιση «αποθήκη στο σύστημά τους» → κατάστημα δικό μας. Ο πίνακας αντικαθίσταται ολόκληρος.
 * Επιτρέπονται μόνο καταστήματα του ίδιου μέλους που καλύπτει η σύνδεση.
 */
export const PUT = internal<IdParams>(async (_req, ctx, route) => {
  const l = await loadConnection(route);
  if (!l.conn) return l.res;
  const body = LocationMapBody.safeParse(ctx.json());
  if (!body.success) throw new BadRequest("Μη έγκυρη αντιστοίχιση", body.error.issues.slice(0, 20));
  const wanted = [...new Set(body.data.map.map((m) => m.storeId).filter((s): s is string => !!s))];
  const stores = await db.store.findMany({ where: { id: { in: wanted }, partnerId: l.conn.partnerId }, select: { id: true } });
  const valid = new Set(stores.map((s) => s.id));
  const bad = wanted.filter((s) => !valid.has(s) || (l.conn!.storeIds.length > 0 && !l.conn!.storeIds.includes(s)));
  if (bad.length) throw new BadRequest("Κάποια καταστήματα δεν ανήκουν στο μέλος ή στη σύνδεση", { storeIds: bad });
  const refs = body.data.map.map((m) => m.externalRef);
  if (new Set(refs).size !== refs.length) throw new BadRequest("Η ίδια αποθήκη εμφανίζεται δύο φορές");
  await db.$transaction([
    db.locationMap.deleteMany({ where: { connectionId: l.conn.id } }),
    db.locationMap.createMany({ data: body.data.map.map((m) => ({ connectionId: l.conn!.id, externalRef: m.externalRef, storeId: m.storeId })) }),
  ]);
  return ok({ mapped: body.data.map.filter((m) => m.storeId).length, ignored: body.data.map.filter((m) => !m.storeId).length });
});

export const GET = internal<IdParams>(async (_req, _ctx, route) => {
  const l = await loadConnection(route);
  if (!l.conn) return l.res;
  const map = await db.locationMap.findMany({ where: { connectionId: l.conn.id }, select: { externalRef: true, storeId: true }, orderBy: { externalRef: "asc" } });
  return ok({ map });
});
