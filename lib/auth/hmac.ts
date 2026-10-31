import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Υπογραφή των κλήσεων eshop → μηχανή (server-to-server, κανένας browser).
 *
 * Headers: `X-B2B-Timestamp` (ms), `X-B2B-Nonce`, `X-B2B-Signature` =
 *   base64url(HMAC-SHA256(secret, `${ts}\n${nonce}\n${METHOD}\n${path+query}\n${sha256hex(body)}`))
 * Δεκτό παράθυρο ±5′· κάθε nonce μία φορά (RequestNonce). Το ίδιο αρχείο αντιγράφεται στο eshop για την υπογραφή.
 */
export const SKEW_MS = 5 * 60_000;
export const H = { ts: "x-b2b-timestamp", nonce: "x-b2b-nonce", sig: "x-b2b-signature" } as const;

const sha256hex = (body: string | Uint8Array) => createHash("sha256").update(body).digest("hex");

export function canonical(ts: string, nonce: string, method: string, pathWithQuery: string, body: string | Uint8Array) {
  return `${ts}\n${nonce}\n${method.toUpperCase()}\n${pathWithQuery}\n${sha256hex(body)}`;
}

export function sign(secret: string, method: string, pathWithQuery: string, body: string | Uint8Array = "", now = Date.now()) {
  const ts = String(now);
  const nonce = randomBytes(16).toString("base64url");
  const sig = createHmac("sha256", secret).update(canonical(ts, nonce, method, pathWithQuery, body)).digest("base64url");
  return { [H.ts]: ts, [H.nonce]: nonce, [H.sig]: sig };
}

export type VerifyResult = { ok: true; nonce: string; expiresAt: Date } | { ok: false; reason: "missing" | "skew" | "signature" };

/** Ελέγχει υπογραφή και χρόνο. Τη μοναδικότητα του nonce την ελέγχει ο καλών (βάση). */
export function verify(
  secret: string,
  h: { get(name: string): string | null },
  method: string,
  pathWithQuery: string,
  body: string | Uint8Array,
  now = Date.now(),
): VerifyResult {
  const ts = h.get(H.ts), nonce = h.get(H.nonce), sig = h.get(H.sig);
  if (!ts || !nonce || !sig || !/^\d{10,16}$/.test(ts) || nonce.length < 16 || nonce.length > 64) return { ok: false, reason: "missing" };
  if (Math.abs(now - Number(ts)) > SKEW_MS) return { ok: false, reason: "skew" };
  const want = createHmac("sha256", secret).update(canonical(ts, nonce, method, pathWithQuery, body)).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "signature" };
  return { ok: true, nonce, expiresAt: new Date(Number(ts) + SKEW_MS) };
}
