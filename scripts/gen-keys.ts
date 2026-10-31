/**
 * Τυπώνει νέα κλειδιά για το .env (δεν τα γράφει πουθενά):
 *   npm run keys:gen
 * SECRETS_KEYS: το νέο μπαίνει ΠΡΩΤΟ, τα παλιά μένουν μετά για να αποκρυπτογραφούνται τα υπάρχοντα.
 * INTERNAL_HMAC_SECRET: ίδιο και στο eshop (B2B_ENGINE_SECRET).
 */
import { randomBytes } from "node:crypto";

const id = `k${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
console.log(`SECRETS_KEYS=${id}:${randomBytes(32).toString("base64")}`);
console.log(`INTERNAL_HMAC_SECRET=${randomBytes(48).toString("base64url")}`);
