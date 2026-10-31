import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { EngineEvent } from "@/lib/contracts";

/**
 * Εφαρμογή των γεγονότων του eshop στο αντίγραφο. Κανόνες:
 * - ίδιο event id δεύτερη φορά → `duplicate` (idempotent· το eshop μπορεί να ξαναστείλει με ασφάλεια)
 * - γεγονός παλαιότερο από ό,τι έχουμε (`eventAt`) → `stale`
 * - απενεργοποίηση μέλους → ανάκληση κλειδιών push και παύση συνδέσεων
 * - αλλαγή τύπου σύνδεσης → σβήνουν τα secrets (ανήκαν στον άλλο τύπο) και η κατάσταση γυρίζει σε draft
 */
export type ApplyStatus = "applied" | "duplicate" | "stale";

export async function applyEvent(ev: EngineEvent): Promise<ApplyStatus> {
  const at = new Date(ev.at);
  return db.$transaction(async (tx) => {
    // ON CONFLICT DO NOTHING: το διπλότυπο είναι αναμενόμενο, όχι σφάλμα (και δεν γεμίζει τα logs)
    const ins = await tx.inboxEvent.createMany({ data: [{ id: ev.id, type: ev.type, at }], skipDuplicates: true });
    if (!ins.count) return "duplicate";

    switch (ev.type) {
      case "partner.upserted": {
        const d = ev.data;
        const cur = await tx.partner.findUnique({ where: { id: d.id }, select: { eventAt: true, active: true } });
        if (cur && cur.eventAt > at) return "stale";
        const data = { s1Trdr: d.s1Trdr, name: d.name, afm: d.afm, active: d.active, eventAt: at };
        await tx.partner.upsert({ where: { id: d.id }, create: { id: d.id, ...data }, update: data });
        if (!d.active && (cur?.active ?? true)) {
          await tx.pushKey.updateMany({ where: { connection: { partnerId: d.id }, revokedAt: null }, data: { revokedAt: new Date() } });
          await tx.connection.updateMany({ where: { partnerId: d.id }, data: { status: "paused" } });
        }
        return "applied";
      }
      case "store.upserted": {
        const d = ev.data;
        const cur = await tx.store.findUnique({ where: { id: d.id }, select: { eventAt: true } });
        if (cur && cur.eventAt > at) return "stale";
        await requirePartner(tx, d.partnerId);
        const data = { partnerId: d.partnerId, s1BranchId: d.s1BranchId, name: d.name, city: d.city, active: d.active, eventAt: at };
        await tx.store.upsert({ where: { id: d.id }, create: { id: d.id, ...data }, update: data });
        return "applied";
      }
      case "connection.upserted": {
        const d = ev.data;
        const cur = await tx.connection.findUnique({ where: { id: d.id }, select: { eventAt: true, type: true, status: true } });
        if (cur && cur.eventAt > at) return "stale";
        await requirePartner(tx, d.partnerId);
        const typeChanged = !!cur && cur.type !== d.type;
        const base = { partnerId: d.partnerId, type: d.type, config: d.config as Prisma.InputJsonValue, storeIds: d.storeIds, active: d.active, eventAt: at };
        const status = !d.active ? "paused" : typeChanged ? "draft" : cur?.status === "paused" ? "draft" : undefined;
        await tx.connection.upsert({
          where: { id: d.id },
          create: { id: d.id, ...base, status: d.active ? "draft" : "paused" },
          update: { ...base, ...(status ? { status } : {}), ...(typeChanged ? { secretsEnc: null, secretKeys: [], secretsSetAt: null } : {}) },
        });
        if (typeChanged) await tx.pushKey.updateMany({ where: { connectionId: d.id, revokedAt: null }, data: { revokedAt: new Date() } });
        return "applied";
      }
      case "connection.deleted": {
        await tx.connection.deleteMany({ where: { id: ev.data.id } });
        return "applied";
      }
    }
  });
}

async function requirePartner(tx: Prisma.TransactionClient, id: string) {
  const p = await tx.partner.findUnique({ where: { id }, select: { id: true } });
  if (!p) throw new MissingParent(`Το μέλος ${id} δεν υπάρχει ακόμη — στείλε πρώτα partner.upserted`);
}

export class MissingParent extends Error {}
