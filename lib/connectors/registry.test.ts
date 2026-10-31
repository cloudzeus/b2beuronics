import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { CONNECTION_TYPES, StockRow, type Location, type TestStep } from "@/lib/contracts";
import { connectors } from "./registry";
import { feedUrl } from "./feed-url";
import { softoneWs } from "./softone-ws";
import { woocommerce } from "./woocommerce";
import type { TestCtx } from "./types";

test("κάθε τύπος του συμβολαίου έχει connector", () => {
  for (const t of CONNECTION_TYPES) assert.ok(connectors.get(t), t);
});

test("σχήματα στοιχείων", () => {
  assert.equal(softoneWs.config.safeParse({ url: "01102358330113", appId: "1001", company: "1001", branch: "1000", refid: "15" }).success, true);
  assert.equal(softoneWs.config.safeParse({ url: "x", appId: "abc", company: "1", branch: "1", refid: "1" }).success, false);
  assert.equal(woocommerce.secrets!.safeParse({ consumerKey: "ck_" + "a".repeat(40), consumerSecret: "cs_" + "b".repeat(40) }).success, true);
  assert.equal(woocommerce.secrets!.safeParse({ consumerKey: "abc", consumerSecret: "cs_" + "b".repeat(40) }).success, false);
});

function fakeCtx<C, S>(config: C, secrets: S | null) {
  const steps: TestStep[] = [];
  const out = { steps, sample: [] as StockRow[], locations: [] as Location[], total: null as number | null, hints: {} as Record<string, string> };
  const ctx: TestCtx<C, S> = {
    connectionId: "c1", config, secrets,
    step: async (key, fn) => { try { steps.push({ key, ok: true, message: await fn(), ms: 0 }); return true; } catch (e) { steps.push({ key, ok: false, message: (e as Error).message, ms: 0 }); return false; } },
    setSample: (r) => { out.sample = r; }, setLocations: (l) => { out.locations = l; }, setTotal: (n) => { out.total = n; }, setFieldHints: (h) => { out.hints = h; }, markReview: () => {},
  };
  return { ctx, out };
}

test("feed-url από τοπικό server: λήψη, win1253, αναγνώριση στηλών, δείγμα", async () => {
  process.env.ALLOW_PRIVATE_NETWORK = "1";
  const iconv = (await import("iconv-lite")).default;
  const body = iconv.encode("sku;ean;qty;αποθήκη\nK1;5201111111111;4;Λάρισα\nK2;5201111111112;0;Βόλος\n", "win1253");
  const srv = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer t0k") { res.writeHead(401); res.end(); return; }
    res.writeHead(200, { "Content-Type": "text/csv; charset=windows-1253" }); res.end(body);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/f.csv`;
  try {
    const bad = fakeCtx(feedUrl.config.parse({ url }), {});
    await feedUrl.test(bad.ctx);
    assert.equal(bad.out.steps[0].ok, false);
    const good = fakeCtx(feedUrl.config.parse({ url }), { token: "t0k" });
    await feedUrl.test(good.ctx);
    assert.deepEqual(good.out.steps.map((s) => s.ok), [true, true], JSON.stringify(good.out.steps));
    assert.equal(good.out.total, 2);
    assert.deepEqual(good.out.locations.map((l) => l.ref), ["Λάρισα", "Βόλος"]);
    for (const r of good.out.sample) assert.equal(StockRow.safeParse(r).success, true);
  } finally {
    delete process.env.ALLOW_PRIVATE_NETWORK;
    srv.close();
  }
});
