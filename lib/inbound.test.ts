import { test } from "node:test";
import assert from "node:assert/strict";
import { EventBatch, PushBody } from "@/lib/contracts";
import { validateItems } from "./inbound";

test("push: έγκυρες γραμμές περνούν, άκυρες καταγράφονται με αιτία", () => {
  const r = validateItems([{ sku: "A", location: "01", qty: 2 }, { sku: "", location: "01", qty: 1 }, { sku: "B", qty: 1 }, { sku: "C", location: "02", qty: "x" }]);
  assert.deepEqual(r.accepted, [{ externalSku: "A", locationRef: "01", qty: 2 }]);
  assert.equal(r.rejectedTotal, 3);
  assert.deepEqual(r.rejected.map((x) => x.index), [1, 2, 3]);
});

test("σώμα push και γεγονότα", () => {
  assert.equal(PushBody.safeParse({ mode: "full", items: [] }).success, false);
  assert.equal(PushBody.safeParse({ mode: "delta", items: [{}] }).success, true);
  const ev = EventBatch.safeParse({ events: [{ id: "ev_12345678", type: "store.upserted", at: "2026-10-31T10:00:00.000Z", data: { id: "s1", partnerId: "p1", s1BranchId: 30, name: "ΠΑΡΡΑΣ - ΚΑΛΑΒΡΥΤΩΝ 24", city: "ΑΜΑΛΙΑΔΑ", active: true } }] });
  assert.equal(ev.success, true);
  assert.equal(EventBatch.safeParse({ events: [{ id: "ev_12345678", type: "store.deleted", at: "2026-10-31T10:00:00.000Z", data: {} }] }).success, false);
});
