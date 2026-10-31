import { EventBatch } from "@/lib/contracts";
import { BadRequest, internal } from "@/lib/auth/internal";
import { applyEvent, MissingParent, type ApplyStatus } from "@/lib/events";
import { ok } from "@/lib/http";

/**
 * ① Γεγονότα από το eshop (μέλη, καταστήματα, συνδέσεις). Εφαρμόζονται με τη σειρά που ήρθαν.
 * Ό,τι αποτύχει επιστρέφεται στο `failed` και το eshop το ξαναστέλνει (τα υπόλοιπα είναι ήδη idempotent).
 */
export const POST = internal(async (_req, ctx) => {
  const parsed = EventBatch.safeParse(ctx.json());
  if (!parsed.success) throw new BadRequest("Μη έγκυρα γεγονότα", parsed.error.issues.slice(0, 20));
  const counts: Record<ApplyStatus, number> = { applied: 0, duplicate: 0, stale: 0 };
  const failed: { id: string; error: string }[] = [];
  for (const ev of parsed.data.events) {
    try {
      counts[await applyEvent(ev)]++;
    } catch (e) {
      if (!(e instanceof MissingParent)) console.error("[events]", ev.type, ev.id, e instanceof Error ? e.message : e);
      failed.push({ id: ev.id, error: e instanceof MissingParent ? e.message : "Αποτυχία εφαρμογής" });
    }
  }
  return ok({ ...counts, failed });
});
