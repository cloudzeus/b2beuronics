import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch, type Response } from "undici";

/**
 * Fetch για διευθύνσεις που δίνουν τα μέλη (feeds, eshop, ERP). Προστασία SSRF:
 * - μόνο http/https (και μόνο https όπου ζητηθεί), χωρίς στοιχεία χρήστη μέσα στο URL
 * - απαγορεύονται ιδιωτικές / loopback / link-local / CGNAT / multicast διευθύνσεις — ο έλεγχος γίνεται στη
 *   **σύνδεση** (lookup του undici), άρα πιάνει και DNS rebinding, και ξανά σε κάθε redirect (έως 3)
 * - όριο χρόνου και όριο μεγέθους σώματος
 * `ALLOW_PRIVATE_NETWORK=1` μόνο για τοπικές δοκιμές.
 */
export class FetchBlocked extends Error {}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("2001:db8");
  }
  return true; // ό,τι δεν αναγνωρίζεται, απορρίπτεται
}

const allowPrivate = () => process.env.ALLOW_PRIVATE_NETWORK === "1";

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
function safeLookup(hostname: string, options: object, cb: LookupCb) {
  dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, []);
    const list = addrs as LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad && !allowPrivate()) return cb(Object.assign(new FetchBlocked(`Η διεύθυνση ${hostname} οδηγεί σε εσωτερικό δίκτυο`), { code: "EBLOCKED" }), []);
    const wantAll = (options as { all?: boolean }).all;
    if (wantAll) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

const agent = new Agent({ connect: { lookup: safeLookup as never, timeout: 10_000 }, headersTimeout: 20_000, bodyTimeout: 30_000 });

export type SafeFetchOptions = {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
  httpsOnly?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
};

export type SafeResponse = { status: number; headers: Headers; url: string; bytes: Buffer };

export function checkUrl(raw: string, httpsOnly = false): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new FetchBlocked("Η διεύθυνση δεν είναι έγκυρη"); }
  if (u.protocol !== "https:" && (httpsOnly || u.protocol !== "http:")) throw new FetchBlocked(httpsOnly ? "Χρειάζεται διεύθυνση https://" : "Επιτρέπονται μόνο διευθύνσεις http:// ή https://");
  if (u.username || u.password) throw new FetchBlocked("Η διεύθυνση δεν πρέπει να περιέχει όνομα χρήστη/κωδικό — δώσ' τα στα στοιχεία σύνδεσης");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host) && !allowPrivate()) throw new FetchBlocked("Η διεύθυνση οδηγεί σε εσωτερικό δίκτυο");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host) && !allowPrivate()) throw new FetchBlocked("Η διεύθυνση οδηγεί σε εσωτερικό δίκτυο");
  return u;
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  let url = checkUrl(raw, opts.httpsOnly);
  for (let hop = 0; hop <= 3; hop++) {
    let res: Response;
    try {
      res = await fetch(url, { method: opts.method ?? "GET", headers: { "User-Agent": "EuronicsStock/1.0", ...opts.headers }, body: opts.body, redirect: "manual", dispatcher: agent, signal });
    } catch (e) {
      throw explain(e);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel();
      const next = new URL(res.headers.get("location")!, url);
      // στο redirect δεν στέλνουμε διαπιστευτήρια σε άλλο host
      if (next.host !== url.host && opts.headers) opts = { ...opts, headers: Object.fromEntries(Object.entries(opts.headers).filter(([k]) => !/^(authorization|cookie|x-api-key)$/i.test(k))) };
      url = checkUrl(next.toString(), opts.httpsOnly);
      continue;
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) { await res.body?.cancel(); throw new FetchBlocked(`Το αρχείο είναι πολύ μεγάλο (${mb(declared)} — όριο ${mb(maxBytes)})`); }
    const chunks: Buffer[] = [];
    let size = 0;
    if (res.body) {
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > maxBytes) { await res.body.cancel().catch(() => {}); throw new FetchBlocked(`Το αρχείο είναι πολύ μεγάλο (όριο ${mb(maxBytes)})`); }
        chunks.push(Buffer.from(chunk));
      }
    }
    return { status: res.status, headers: res.headers as unknown as Headers, url: url.toString(), bytes: Buffer.concat(chunks) };
  }
  throw new FetchBlocked("Πάρα πολλές ανακατευθύνσεις");
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Μεταφράζει τα σφάλματα δικτύου σε μήνυμα που καταλαβαίνει το μέλος. */
function explain(e: unknown): Error {
  if (e instanceof FetchBlocked) return e;
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = err.cause?.code;
  if (err.cause instanceof FetchBlocked) return err.cause;
  if (code === "EBLOCKED") return new FetchBlocked(err.cause?.message ?? "Η διεύθυνση οδηγεί σε εσωτερικό δίκτυο");
  if (err.name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT") return new Error("Ο server δεν απάντησε εγκαίρως");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new Error("Δεν βρέθηκε ο server (λάθος διεύθυνση;)");
  if (code === "ECONNREFUSED") return new Error("Ο server αρνήθηκε τη σύνδεση (θύρα κλειστή ή firewall)");
  if (code && /^ERR_TLS|CERT|UNABLE_TO_VERIFY|SELF_SIGNED|ERR_SSL/.test(code)) return new Error("Πρόβλημα με το πιστοποιητικό SSL του server (ληγμένο, αυτο-υπογεγραμμένο ή ελλιπής αλυσίδα πιστοποιητικών)");
  return new Error(`Σφάλμα σύνδεσης: ${err.cause?.message ?? err.message ?? "άγνωστο"}`);
}
