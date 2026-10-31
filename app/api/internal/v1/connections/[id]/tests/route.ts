import { internal } from "@/lib/auth/internal";
import { loadConnection, publicConnection, type IdParams } from "@/lib/connections";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";

/** Κατάσταση της σύνδεσης + ιστορικό ελέγχων (νεότεροι πρώτα, `?limit=` έως 50). */
export const GET = internal<IdParams>(async (req, _ctx, route) => {
  const l = await loadConnection(route);
  if (!l.conn) return l.res;
  const limit = Math.min(50, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 10));
  const tests = await db.connectionTest.findMany({ where: { connectionId: l.conn.id }, orderBy: { startedAt: "desc" }, take: limit });
  return ok({ connection: publicConnection(l.conn), tests });
});
