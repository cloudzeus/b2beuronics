import { SecretsBody } from "@/lib/contracts";
import { BadRequest, internal } from "@/lib/auth/internal";
import { loadConnection, publicConnection, type IdParams } from "@/lib/connections";
import { connectorFor } from "@/lib/connectors/registry";
import { encryptSecrets } from "@/lib/crypto/secrets";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/http";

/**
 * Διαπιστευτήρια μιας σύνδεσης. Ελέγχονται με το σχήμα του τύπου, κρυπτογραφούνται και **δεν επιστρέφονται ποτέ**·
 * η απάντηση λέει μόνο ποια πεδία έχουν οριστεί. Κάθε αποθήκευση αντικαθιστά όλα τα προηγούμενα.
 */
export const PUT = internal<IdParams>(async (_req, ctx, route) => {
  const l = await loadConnection(route);
  if (!l.conn) return l.res;
  const def = connectorFor(l.conn.type);
  if (!def.secrets) return fail(400, "no_secrets", "Αυτός ο τρόπος σύνδεσης δεν χρειάζεται στοιχεία πρόσβασης");
  const body = SecretsBody.safeParse(ctx.json());
  if (!body.success) throw new BadRequest("Μη έγκυρο σώμα", body.error.issues);
  // κενές τιμές = δεν δόθηκαν
  const clean = Object.fromEntries(Object.entries(body.data.secrets).filter(([, v]) => v !== ""));
  const parsed = def.secrets.safeParse(clean);
  // στο μήνυμα μόνο το όνομα του πεδίου — ποτέ η τιμή
  if (!parsed.success) throw new BadRequest("Τα στοιχεία δεν είναι πλήρη", parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
  const values = parsed.data as Record<string, string>;
  const conn = await db.connection.update({
    where: { id: l.conn.id },
    data: { secretsEnc: encryptSecrets(values), secretKeys: Object.keys(values).sort(), secretsSetAt: new Date(), ...(l.conn.status === "active" ? {} : { status: "draft" }) },
  });
  return ok(publicConnection(conn));
});

export const DELETE = internal<IdParams>(async (_req, _ctx, route) => {
  const l = await loadConnection(route);
  if (!l.conn) return l.res;
  const conn = await db.connection.update({ where: { id: l.conn.id }, data: { secretsEnc: null, secretKeys: [], secretsSetAt: null, status: l.conn.status === "active" ? "paused" : "draft" } });
  return ok(publicConnection(conn));
});
