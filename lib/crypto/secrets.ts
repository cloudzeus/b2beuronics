import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Κρυπτογράφηση των διαπιστευτηρίων των μελών (AES-256-GCM).
 *
 * `SECRETS_KEYS` = λίστα `id:base64(32 bytes)` χωρισμένη με κόμμα· το πρώτο κρυπτογραφεί, όλα αποκρυπτογραφούν
 * (εναλλαγή κλειδιού χωρίς να χαθούν τα παλιά). Μορφή αποθήκευσης: `id.iv.tag.ciphertext` (base64url).
 * Δημιουργία κλειδιού: `npm run keys:gen`.
 */
type Keyring = { current: string; keys: Map<string, Buffer> };

export function parseKeyring(raw: string | undefined): Keyring {
  const keys = new Map<string, Buffer>();
  let current = "";
  for (const part of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf(":");
    if (i < 1) throw new Error("SECRETS_KEYS: κάθε κλειδί πρέπει να είναι id:base64");
    const id = part.slice(0, i);
    const key = Buffer.from(part.slice(i + 1), "base64");
    if (key.length !== 32) throw new Error(`SECRETS_KEYS: το κλειδί «${id}» δεν είναι 32 bytes`);
    if (!/^[a-z0-9]{1,16}$/i.test(id)) throw new Error(`SECRETS_KEYS: μη έγκυρο id «${id}»`);
    keys.set(id, key);
    current ||= id;
  }
  if (!current) throw new Error("Λείπει το SECRETS_KEYS");
  return { current, keys };
}

let cached: Keyring | null = null;
const keyring = () => (cached ??= parseKeyring(process.env.SECRETS_KEYS));

export function encryptSecrets(value: Record<string, string>, ring: Keyring = keyring()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ring.keys.get(ring.current)!, iv);
  // το id του κλειδιού δένεται στο κείμενο (AAD): δεν μπορεί να αλλάξει χωρίς να αποτύχει η αποκρυπτογράφηση
  cipher.setAAD(Buffer.from(ring.current));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [ring.current, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptSecrets(stored: string, ring: Keyring = keyring()): Record<string, string> {
  const [id, iv, tag, body] = stored.split(".");
  const key = ring.keys.get(id);
  if (!key || !iv || !tag || !body) throw new Error("Τα αποθηκευμένα στοιχεία δεν αποκρυπτογραφούνται (άγνωστο κλειδί)");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const text = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  return JSON.parse(text) as Record<string, string>;
}
