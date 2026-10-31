import { CONTRACT_VERSION } from "@/lib/contracts";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Για το healthcheck του Coolify. Δεν δείχνει δεδομένα, μόνο αν απαντά η βάση. */
export async function GET() {
  let dbOk = false;
  try { await db.$queryRaw`SELECT 1`; dbOk = true; } catch {}
  return Response.json({ ok: dbOk, db: dbOk, contract: CONTRACT_VERSION }, { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
