import { db } from "@/lib/db";
import { fail } from "@/lib/http";

export type IdParams = { params: Promise<{ id: string }> };

/** Η σύνδεση του URL ή απάντηση 404 (το eshop πρέπει πρώτα να στείλει `connection.upserted`). */
export async function loadConnection(route: IdParams) {
  const { id } = await route.params;
  const conn = await db.connection.findUnique({ where: { id }, include: { partner: { select: { active: true } } } });
  return conn ? { conn } : { res: fail(404, "not_found", "Η σύνδεση δεν υπάρχει στη μηχανή — στείλε πρώτα connection.upserted") };
}

/** Δημόσια μορφή μιας σύνδεσης: ποτέ secrets, μόνο τα ονόματα των πεδίων που έχουν οριστεί. */
export function publicConnection(c: { id: string; type: string; status: string; secretKeys: string[]; secretsSetAt: Date | null; lastTestAt: Date | null; lastOkAt: Date | null }) {
  return { id: c.id, type: c.type, status: c.status, secretKeys: c.secretKeys, secretsSetAt: c.secretsSetAt, lastTestAt: c.lastTestAt, lastOkAt: c.lastOkAt };
}
