import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { db } from "@/lib/db";
import { PushItem, type StockRow } from "@/lib/contracts";

/** Έλεγχος γραμμών push/ανεβάσματος → κανονικοποιημένο στοκ + λίστα απορρίψεων (έως 100 με αιτία). */
export function validateItems(items: unknown[]) {
  const accepted: StockRow[] = [];
  const rejected: { index: number; reason: string }[] = [];
  let rejectedTotal = 0;
  items.forEach((raw, index) => {
    const p = PushItem.safeParse(raw);
    if (!p.success) {
      rejectedTotal++;
      if (rejected.length < 100) rejected.push({ index, reason: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 200) });
      return;
    }
    const { sku, location, ...rest } = p.data;
    accepted.push({ externalSku: sku, locationRef: location, ...rest });
  });
  return { accepted, rejected, rejectedTotal };
}

export async function saveBatch(connectionId: string, source: "push" | "upload", mode: "full" | "delta", rows: StockRow[], rejected: number) {
  const json = Buffer.from(JSON.stringify(rows), "utf8");
  return db.inboundBatch.create({
    data: { connectionId, source, mode, accepted: rows.length, rejected, bytes: json.length, sha256: createHash("sha256").update(json).digest("hex"), gz: gzipSync(json) },
    select: { id: true },
  });
}
