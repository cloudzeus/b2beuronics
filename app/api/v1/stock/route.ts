import { PushBody, type PushResponse } from "@/lib/contracts";
import { bearer, hashPushKey } from "@/lib/auth/push-key";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { saveBatch, validateItems } from "@/lib/inbound";

/**
 * Push API — το ERP του μέλους στέλνει το στοκ του:
 *   POST /api/v1/stock   Authorization: Bearer eus_…   Content-Type: application/json
 *   { "mode": "full" | "delta", "items": [{ "sku", "location", "qty", "ean"?, "mpn"?, "brand"?, "title"? }] }
 * Όρια: 20 MB, 50.000 γραμμές, ένα αίτημα ανά 30″ ανά σύνδεση. Τεκμηρίωση για τον τεχνικό: docs/push-api.md
 */
const MAX_BYTES = 20 * 1024 * 1024;
const MIN_INTERVAL_MS = 30_000;

export async function POST(req: Request) {
  const key = bearer(req.headers.get("authorization"));
  if (!key) return fail(401, "unauthorized", "Λείπει ή είναι λάθος το κλειδί (Authorization: Bearer eus_…)");
  const pk = await db.pushKey.findUnique({ where: { hash: hashPushKey(key) }, include: { connection: { include: { partner: { select: { active: true } } } } } });
  if (!pk || pk.revokedAt) return fail(401, "unauthorized", "Το κλειδί δεν είναι έγκυρο ή έχει ανακληθεί");
  const c = pk.connection;
  if (!c.partner.active || !c.active || c.type !== "push-api") return fail(403, "inactive", "Η σύνδεση δεν είναι ενεργή");

  if (!/^application\/json/i.test(req.headers.get("content-type") ?? "")) return fail(415, "content_type", "Χρειάζεται Content-Type: application/json");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return fail(413, "too_large", "Το αίτημα ξεπερνά τα 20 MB");

  const last = await db.inboundBatch.findFirst({ where: { connectionId: c.id, source: "push" }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } });
  const wait = last ? MIN_INTERVAL_MS - (Date.now() - last.receivedAt.getTime()) : 0;
  if (wait > 0) return Response.json({ error: { code: "rate_limited", message: "Πολύ συχνά αιτήματα" } }, { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } });

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return fail(413, "too_large", "Το αίτημα ξεπερνά τα 20 MB");
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return fail(400, "bad_json", "Το σώμα δεν είναι έγκυρο JSON"); }
  const body = PushBody.safeParse(json);
  if (!body.success) return fail(400, "bad_request", "Μη έγκυρο σώμα", body.error.issues.slice(0, 20));

  const { accepted, rejected, rejectedTotal } = validateItems(body.data.items);
  const batch = await saveBatch(c.id, "push", body.data.mode, accepted, rejectedTotal);
  await db.pushKey.update({ where: { id: pk.id }, data: { lastUsedAt: new Date() } });

  const res: PushResponse = { batchId: batch.id, accepted: accepted.length, rejected, rejectedTotal };
  return ok(res, accepted.length ? 202 : 422);
}
