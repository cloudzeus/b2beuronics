# b2beuronics — μηχανή διαθεσιμότητας μελών Euronics

Χωριστή υπηρεσία (`b2b.dgsmart.gr`) με δική της βάση. Συνδέεται με τα ERP και τα eshop των μελών, κρατά τα διαπιστευτήριά τους, ελέγχει τις συνδέσεις και (Φάση 2) συγχρονίζει το απόθεμα ανά υποκατάστημα προς το eshop.

Η διαχείριση, η πύλη B2B, η είσοδος των μελών και το reporting είναι στο eshop (`euronics-redesign`). **Η μηχανή δεν έχει χρήστες.**

- Αρχιτεκτονική: [docs/architecture.md](docs/architecture.md)
- Συμβόλαιο με το eshop: [docs/contracts.md](docs/contracts.md)
- Οδηγός push API για τεχνικούς ERP: [docs/push-api.md](docs/push-api.md)

## Τεχνολογία

Next.js 16.3 (μόνο route handlers + μία στατική σελίδα), Prisma 6 σε Postgres (μέσω PgBouncer), zod 4, undici (ασφαλές fetch), fast-xml-parser, iconv-lite.

## Τοπικά

```bash
cp .env.example .env        # συμπλήρωσε DATABASE_URL / DIRECT_URL
npm run keys:gen            # SECRETS_KEYS + INTERNAL_HMAC_SECRET → στο .env
npm install
npm run db:deploy           # migrations στη βάση (μέσω DIRECT_URL)
npm run dev                 # http://localhost:3100
```

| Script | |
|---|---|
| `npm test` | unit tests (node:test μέσω tsx) |
| `npm run typecheck` / `npm run lint` | |
| `npm run db:deploy` / `db:status` | migrations |
| `npm run keys:gen` | νέα κλειδιά (τα τυπώνει, δεν τα γράφει) |

## Deploy (Coolify, Railpack)

- Repo `cloudzeus/b2beuronics`, branch `master`, domain `b2b.dgsmart.gr`.
- Railpack: `npm ci` → `npm run build` → `npm run start`. Δεν υπάρχει Dockerfile.
- Pre-deploy command: `npm run db:deploy`.
- Healthcheck: `GET /api/health`.
- Env: όπως το `.env.example`. **Χωρίς** `ALLOW_PRIVATE_NETWORK`.
- Το `INTERNAL_HMAC_SECRET` μπαίνει ίδιο και στο eshop (`B2B_ENGINE_SECRET`), μαζί με `B2B_ENGINE_URL=https://b2b.dgsmart.gr`.
- Το `INTERNAL_ALLOWED_IPS` παίρνει την IP του server του eshop.
