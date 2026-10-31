import { db } from "@/lib/db";
import { verify } from "@/lib/auth/hmac";
import { clientIp, fail } from "@/lib/http";

/**
 * Πύλη των εσωτερικών endpoints (`/api/internal/**`): μόνο το eshop, με υπογραφή HMAC και, αν οριστεί,
 * από συγκεκριμένες IP (`INTERNAL_ALLOWED_IPS`, χωρισμένες με κόμμα). Η μηχανή δεν έχει χρήστες.
 */
export type InternalCtx = { raw: string; json: <T = unknown>() => T };

const MAX_BODY = 5 * 1024 * 1024;

export function internal<P>(handler: (req: Request, ctx: InternalCtx, route: P) => Promise<Response>) {
  return async (req: Request, route: P): Promise<Response> => {
    const secret = process.env.INTERNAL_HMAC_SECRET;
    if (!secret || secret.length < 32) return fail(503, "not_configured", "Δεν έχει οριστεί το INTERNAL_HMAC_SECRET");

    const allowed = (process.env.INTERNAL_ALLOWED_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(clientIp(req) ?? "")) return fail(403, "forbidden", "Μη επιτρεπτή διεύθυνση");

    const raw = await req.text();
    if (raw.length > MAX_BODY) return fail(413, "too_large", "Πολύ μεγάλο αίτημα");
    const url = new URL(req.url);
    const v = verify(secret, req.headers, req.method, url.pathname + url.search, raw);
    if (!v.ok) return fail(401, `bad_${v.reason}`, "Μη έγκυρη υπογραφή");

    const fresh = await db.requestNonce.createMany({ data: [{ nonce: v.nonce, expiresAt: v.expiresAt }], skipDuplicates: true });
    if (!fresh.count) return fail(401, "replay", "Η υπογραφή έχει ήδη χρησιμοποιηθεί");
    // καθάρισμα των ληγμένων nonce: περίπου 1 στα 50 αιτήματα, χωρίς να καθυστερεί την απάντηση
    if (Math.random() < 0.02) void db.requestNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});

    const ctx: InternalCtx = {
      raw,
      json: <T,>() => {
        try { return JSON.parse(raw || "null") as T; } catch { throw new BadRequest("Το σώμα δεν είναι έγκυρο JSON"); }
      },
    };
    try {
      return await handler(req, ctx, route);
    } catch (e) {
      if (e instanceof BadRequest) return fail(400, "bad_request", e.message, e.details);
      console.error("[internal]", req.method, url.pathname, e instanceof Error ? e.message : e);
      return fail(500, "internal", "Εσωτερικό σφάλμα");
    }
  };
}

export class BadRequest extends Error {
  constructor(message: string, public details?: unknown) { super(message); }
}
