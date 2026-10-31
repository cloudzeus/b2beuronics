import { test } from "node:test";
import assert from "node:assert/strict";
import { H, sign, SKEW_MS, verify } from "./hmac";

const secret = "s".repeat(48);
const hdr = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

test("σωστή υπογραφή γίνεται δεκτή", () => {
  const h = sign(secret, "POST", "/api/internal/v1/events", '{"a":1}');
  const r = verify(secret, hdr(h), "POST", "/api/internal/v1/events", '{"a":1}');
  assert.equal(r.ok, true);
});

test("αλλαγμένο σώμα, μέθοδος, διαδρομή ή secret απορρίπτονται", () => {
  const h = sign(secret, "POST", "/x?y=1", "body");
  assert.deepEqual(verify(secret, hdr(h), "POST", "/x?y=1", "body2"), { ok: false, reason: "signature" });
  assert.deepEqual(verify(secret, hdr(h), "PUT", "/x?y=1", "body"), { ok: false, reason: "signature" });
  assert.deepEqual(verify(secret, hdr(h), "POST", "/x?y=2", "body"), { ok: false, reason: "signature" });
  assert.deepEqual(verify("t".repeat(48), hdr(h), "POST", "/x?y=1", "body"), { ok: false, reason: "signature" });
});

test("παλιά υπογραφή (εκτός παραθύρου) και ελλιπή headers", () => {
  const now = Date.now();
  const h = sign(secret, "GET", "/x", "", now - SKEW_MS - 1000);
  assert.deepEqual(verify(secret, hdr(h), "GET", "/x", "", now), { ok: false, reason: "skew" });
  const rest: Record<string, string> = sign(secret, "GET", "/x");
  delete rest[H.sig];
  assert.deepEqual(verify(secret, hdr(rest), "GET", "/x", ""), { ok: false, reason: "missing" });
});
