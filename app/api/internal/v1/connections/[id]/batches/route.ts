import { internal } from "@/lib/auth/internal";
import { loadConnection, type IdParams } from "@/lib/connections";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";

/**
 * Ιστορικό συγχρονισμών μιας σύνδεσης (push / ανέβασμα), νεότερα πρώτα: `?limit=` έως 200, `?before=` ISO για σελίδες.
 * Χωρίς τα δεδομένα (gz) — μόνο μετρήσεις, κατάσταση και σφάλμα. Μαζί σύνοψη ανά ημέρα για τις τελευταίες 30.
 */
export const GET = internal<IdParams>(async (req, _ctx, route) => {
  const l = await loadConnection(route);
  if (!l.conn) return l.res;
  const q = new URL(req.url).searchParams;
  const limit = Math.min(200, Math.max(1, Number(q.get("limit")) || 50));
  const before = q.get("before") ? new Date(q.get("before")!) : null;
  const where = { connectionId: l.conn.id, ...(before && !isNaN(+before) ? { receivedAt: { lt: before } } : {}) };
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [batches, days] = await Promise.all([
    db.inboundBatch.findMany({ where, orderBy: { receivedAt: "desc" }, take: limit, select: { id: true, source: true, mode: true, accepted: true, rejected: true, bytes: true, status: true, error: true, receivedAt: true } }),
    db.$queryRaw<{ day: Date; n: bigint; accepted: bigint; rejected: bigint; failed: bigint }[]>`
      SELECT date_trunc('day', "receivedAt" AT TIME ZONE 'Europe/Athens') AS day, count(*) AS n, sum(accepted) AS accepted, sum(rejected) AS rejected,
             count(*) FILTER (WHERE status = 'failed') AS failed
      FROM "InboundBatch" WHERE "connectionId" = ${l.conn.id} AND "receivedAt" >= ${since} GROUP BY 1 ORDER BY 1`,
  ]);
  return ok({
    batches: batches.map((b) => ({ ...b, receivedAt: b.receivedAt.toISOString() })),
    days: days.map((d) => ({ day: d.day.toISOString().slice(0, 10), batches: Number(d.n), accepted: Number(d.accepted), rejected: Number(d.rejected), failed: Number(d.failed) })),
    next: batches.length === limit ? batches[batches.length - 1].receivedAt.toISOString() : null,
  });
});
