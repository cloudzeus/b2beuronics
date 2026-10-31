@AGENTS.md

## Κανόνες της μηχανής διαθεσιμότητας

1. **Χωρίς χρήστες.** Κανένα login, κανένα cookie. Εσωτερικά endpoints μόνο μέσω `internal()` (HMAC + nonce). Push API μόνο με κλειδί.
2. **Secrets**: μόνο μέσω `lib/crypto/secrets`. Ποτέ σε log, απάντηση API ή μήνυμα σφάλματος. Στα σφάλματα μόνο ονόματα πεδίων.
3. **Κάθε διεύθυνση που δίνει μέλος** περνά από `lib/net/safe-fetch` (SSRF). Ποτέ απλό `fetch` προς τρίτους.
4. **Connectors μόνο διαβάζουν** από τα συστήματα των μελών. SoftOne: μόνο επίσημα services, login → authenticate, win1253.
5. **Συμβόλαιο**: κάθε αλλαγή στο `lib/contracts` → νέο `CONTRACT_VERSION` + `docs/contracts.md` + η ίδια αλλαγή στο eshop (`lib/b2b-engine/`).
6. **Βάση κοινή με άλλα projects** (PgBouncer 6432): μικρό pool, όχι `pgbouncer=true`, migrations μέσω `DIRECT_URL`.
7. Μηνύματα προς μέλη σε απλά ελληνικά. Tests: `npm test` πριν από κάθε commit.
