# Συμβόλαιο eshop ↔ μηχανή διαθεσιμότητας

Έκδοση: `2026-10-31` (`CONTRACT_VERSION` στο `lib/contracts/index.ts`). Οι τύποι και τα σχήματα zod του αρχείου
αυτού αντιγράφονται ως έχουν στο eshop (`lib/b2b-engine/contracts.ts`), μαζί με το `lib/auth/hmac.ts` για την υπογραφή.

## Υπογραφή (όλα τα `/api/internal/**`)

Μόνο server-to-server. Ο browser δεν μιλά ποτέ με τη μηχανή.

| Header | Τιμή |
|---|---|
| `X-B2B-Timestamp` | ms από epoch (δεκτό ±5′) |
| `X-B2B-Nonce` | 16+ τυχαίοι χαρακτήρες, **μία φορά** |
| `X-B2B-Signature` | `base64url(HMAC-SHA256(INTERNAL_HMAC_SECRET, ts \n nonce \n METHOD \n path+query \n sha256hex(body)))` |

```ts
import { sign } from "./hmac";
const body = JSON.stringify({ events });
const path = "/api/internal/v1/events";
await fetch(ENGINE_URL + path, { method: "POST", headers: { "Content-Type": "application/json", ...sign(SECRET, "POST", path, body) }, body });
```

Σφάλματα: `401 bad_missing | bad_skew | bad_signature | replay`, `403 forbidden` (IP), `503 not_configured`.
Όλα τα σφάλματα έχουν τη μορφή `{ "error": { "code", "message", "details"? } }` με ελληνικό `message`.

## ① Γεγονότα — `POST /api/internal/v1/events`

Το eshop είναι master. Στέλνει outbox με έως 500 γεγονότα, με τη σειρά που έγιναν.

```json
{ "events": [
  { "id": "ev_01JB…", "type": "partner.upserted", "at": "2026-10-31T10:00:00.000Z",
    "data": { "id": "<Partner.id>", "s1Trdr": 665, "name": "ΠΑΡΡΑΣ ΑΝΔΡ ΚΩΝΣΤΑΝΤΙΝΟΣ", "afm": "046962962", "active": true } },
  { "id": "ev_01JC…", "type": "store.upserted", "at": "…",
    "data": { "id": "<Store.id>", "partnerId": "<Partner.id>", "s1BranchId": 30, "name": "ΠΑΡΡΑΣ ΑΝΔ - ΚΑΛΑΒΡΥΤΩΝ 24", "city": "ΑΜΑΛΙΑΔΑ", "active": true } },
  { "id": "ev_01JD…", "type": "connection.upserted", "at": "…",
    "data": { "id": "<Connection.id>", "partnerId": "…", "type": "woocommerce", "config": { "baseUrl": "https://shop.example.gr" }, "storeIds": ["…"], "active": true } },
  { "id": "ev_01JE…", "type": "connection.deleted", "at": "…", "data": { "id": "…" } }
] }
```

Απάντηση: `{ "applied": n, "duplicate": n, "stale": n, "failed": [{ "id", "error" }] }`.
- Ίδιο `id` ξανά → `duplicate`, οπότε το eshop ξαναστέλνει με ασφάλεια.
- `at` παλαιότερο από το τελευταίο που εφαρμόστηκε → `stale`.
- `failed` → ξαναστέλνεται. Συνήθως είναι κατάστημα ή σύνδεση πριν από το μέλος του.
- `partner.upserted` με `active:false` → ανάκληση κλειδιών push και παύση συνδέσεων.
- Αλλαγή `type` σύνδεσης → σβήνουν τα secrets και τα κλειδιά, η κατάσταση γυρίζει σε `draft`.

## Εντολές

| Μέθοδος | Διαδρομή | Τι κάνει |
|---|---|---|
| GET | `/api/internal/v1/connectors` | τύποι σύνδεσης: ετικέτα, `autoTest`, `available` (προσφέρεται τώρα στα μέλη — Φάση 1: `feed-url`, `manual`, `softone-ws`, `woocommerce`), JSON Schema για `config` και `secrets` (για τις φόρμες) |
| PUT | `/api/internal/v1/connections/:id/secrets` | `{ "secrets": { … } }` → έλεγχος με το σχήμα του τύπου, κρυπτογράφηση. Επιστρέφει μόνο `secretKeys` |
| DELETE | `/api/internal/v1/connections/:id/secrets` | σβήσιμο διαπιστευτηρίων |
| POST | `/api/internal/v1/connections/:id/test?by=<staffId\|b2bAccountId>` | έλεγχος τώρα (έως 90″) → `TestResult` |
| GET | `/api/internal/v1/connections/:id/tests?limit=10` | κατάσταση + ιστορικό ελέγχων |
| POST | `/api/internal/v1/connections/:id/push-keys?by=…` | νέο κλειδί push (μόνο τύπος `push-api`, έως 2 ενεργά). Το `key` επιστρέφεται **μία φορά** |
| GET | `/api/internal/v1/connections/:id/push-keys` | κλειδιά (πρόθεμα, χρήση, ανάκληση), χωρίς το κλειδί |
| DELETE | `/api/internal/v1/connections/:id/push-keys/:keyId` | ανάκληση, ισχύει αμέσως |
| GET/PUT | `/api/internal/v1/connections/:id/locations` | αντιστοίχιση `{ map: [{ externalRef, storeId \| null }] }`, αντικαθίσταται ολόκληρη· μόνο καταστήματα του ίδιου μέλους |
| POST | `/api/internal/v1/connections/:id/upload` | `{ filename, mode, format, content \| contentBase64, map? }`, μόνο για τύπο `manual`. `content` = κείμενο CSV/JSON/XML· `contentBase64` = τα bytes του αρχείου (Excel .xlsx ή οποιοδήποτε από τα άλλα). Το παλιό .xls απορρίπτεται με μήνυμα |

### `TestResult`

```json
{ "testId": "…", "connectionId": "…", "outcome": "ok | failed | review",
  "steps": [{ "key": "reach | auth | read-sample | locations | config | received", "ok": true, "message": "…", "ms": 412 }],
  "sample": [{ "externalSku": "K1", "ean": "520…", "locationRef": "01", "qty": 4 }],
  "locations": [{ "ref": "01", "name": "Κεντρικό" }], "total": 5321, "fieldHints": { "sku": "code", "qty": "stock" },
  "startedAt": "…", "durationMs": 1830 }
```

- `ok`: πέρασαν όλα τα κρίσιμα βήματα.
- `review`: ο τύπος δεν έχει ακόμη αυτόματο έλεγχο (Entersoft, Epsilon, Galaxy, Shopify, Magento, OpenCart, PrestaShop, SFTP). Τη σύνδεση την εξετάζουμε εμείς.
- `failed`: έστω ένα κρίσιμο βήμα απέτυχε, με το μήνυμα για το μέλος στο `message`.

Μια σύνδεση γίνεται `active` στο eshop μόνο όταν ο έλεγχος είναι `ok` **και** έχει αντιστοιχιστεί τουλάχιστον μία τοποθεσία.

## ② Projection — μηχανή → eshop (Φάση 2)

Ορίζεται από τώρα (`ProjectionBatch` / `AvailabilityRow`), ώστε το `StoreAvailability` του eshop να φτιαχτεί σωστά από την αρχή.

```json
{ "batchId": "…",
  "upserts": [{ "variantId": "…", "storeId": "…", "state": "in | low | out", "qty": 3, "seenAt": "…", "liveCheck": true }],
  "removes": [{ "variantId": "…", "storeId": "…" }] }
```

Θα σταλεί υπογεγραμμένο προς endpoint του eshop (`POST /api/b2b-engine/projection`), μόνο με τις αλλαγές.

## Push API (ERP μέλους → μηχανή)

Βλ. [push-api.md](push-api.md).
