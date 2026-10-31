import { createHash, randomBytes } from "node:crypto";

/** Κλειδιά push API: `eus_` + 32 τυχαία bytes. Φυλάμε μόνο sha256 και τα πρώτα 12 ψηφία για αναγνώριση. */
export const PUSH_KEY_PREFIX = "eus_";

export function newPushKey() {
  const key = PUSH_KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, prefix: key.slice(0, 12), hash: hashPushKey(key) };
}

export const hashPushKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** `Authorization: Bearer eus_…` → το κλειδί, ή null. */
export function bearer(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(eus_[A-Za-z0-9_-]{40,60})$/);
  return m ? m[1] : null;
}
