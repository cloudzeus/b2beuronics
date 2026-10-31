import { PrismaClient } from "@prisma/client";

/**
 * Ο Postgres είναι κοινός με άλλα projects· μπροστά του τρέχει PgBouncer (6432). Ίδιοι κανόνες με το eshop:
 *   μέσω PgBouncer: προεπιλογή 10 συνδέσεις ανά διεργασία · απευθείας (5432): 4 — `DB_POOL` αλλάζει την προεπιλογή.
 * ΟΧΙ `pgbouncer=true` (κλείνει τα prepared statements, κάθε ερώτημα ~5× πιο αργό). Migrations: DIRECT_URL (5432).
 */
export const viaPgBouncer = (url: string | undefined) => !!url && /:6432(\/|$)/.test(url.split("?")[0]);

function pooledUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  const extra = [
    ...(/[?&]connection_limit=/.test(url) ? [] : [`connection_limit=${Number(process.env.DB_POOL) || (viaPgBouncer(url) ? 10 : 4)}`]),
    ...(/[?&]pool_timeout=/.test(url) ? [] : ["pool_timeout=20"]),
  ];
  return extra.length ? `${url}${sep}${extra.join("&")}` : url;
}

const g = globalThis as unknown as { prisma?: PrismaClient };
const url = pooledUrl();
// χωρίς DATABASE_URL (tests χωρίς βάση) ο client φτιάχνεται κανονικά και αποτυγχάνει μόνο αν χρησιμοποιηθεί
export const db = g.prisma ?? new PrismaClient({ ...(url ? { datasources: { db: { url } } } : {}), log: ["error"] });
if (process.env.NODE_ENV !== "production") g.prisma = db;
