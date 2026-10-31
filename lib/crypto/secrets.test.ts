import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptSecrets, encryptSecrets, parseKeyring } from "./secrets";

const k = () => randomBytes(32).toString("base64");

test("κρυπτογράφηση ↔ αποκρυπτογράφηση, με ελληνικά", () => {
  const ring = parseKeyring(`a:${k()}`);
  const enc = encryptSecrets({ username: "χρήστης", password: "p@ss" }, ring);
  assert.ok(!enc.includes("p@ss"));
  assert.deepEqual(decryptSecrets(enc, ring), { username: "χρήστης", password: "p@ss" });
});

test("εναλλαγή κλειδιού: το νέο κρυπτογραφεί, το παλιό αποκρυπτογραφεί ακόμη", () => {
  const old = k();
  const enc = encryptSecrets({ a: "1" }, parseKeyring(`old:${old}`));
  const ring = parseKeyring(`new:${k()},old:${old}`);
  assert.deepEqual(decryptSecrets(enc, ring), { a: "1" });
  assert.ok(encryptSecrets({ a: "1" }, ring).startsWith("new."));
});

test("αλλοιωμένο κείμενο ή αλλαγμένο id κλειδιού απορρίπτεται", () => {
  const key = k();
  const ring = parseKeyring(`a:${key},b:${key}`);
  const enc = encryptSecrets({ a: "1" }, ring);
  const parts = enc.split(".");
  assert.throws(() => decryptSecrets(["b", ...parts.slice(1)].join("."), ring));
  const body = Buffer.from(parts[3], "base64url"); body[0] ^= 1;
  assert.throws(() => decryptSecrets([...parts.slice(0, 3), body.toString("base64url")].join("."), ring));
});

test("λάθος μήκος κλειδιού ή κενό keyring", () => {
  assert.throws(() => parseKeyring("a:" + randomBytes(16).toString("base64")), /32 bytes/);
  assert.throws(() => parseKeyring(""), /SECRETS_KEYS/);
});
