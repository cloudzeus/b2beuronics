import { internal } from "@/lib/auth/internal";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/http";

type P = { params: Promise<{ id: string; keyId: string }> };

/** Ανάκληση κλειδιού: ισχύει αμέσως (το push API ελέγχει `revokedAt` σε κάθε αίτημα). */
export const DELETE = internal<P>(async (_req, _ctx, route) => {
  const { id, keyId } = await route.params;
  const r = await db.pushKey.updateMany({ where: { id: keyId, connectionId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) return fail(404, "not_found", "Το κλειδί δεν βρέθηκε ή έχει ήδη ανακληθεί");
  return ok({ revoked: keyId });
});
