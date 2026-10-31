import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { checkUrl, FetchBlocked, isPrivateAddress, safeFetch } from "./safe-fetch";

test("ιδιωτικές διευθύνσεις", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.70.50.43", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2a00:1450:4001::1"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("checkUrl: πρωτόκολλα, στοιχεία στο URL, localhost", () => {
  assert.throws(() => checkUrl("ftp://x.gr/a"), FetchBlocked);
  assert.throws(() => checkUrl("http://x.gr/a", true), /https/);
  assert.throws(() => checkUrl("https://user:pw@x.gr/"), /όνομα χρήστη/);
  assert.throws(() => checkUrl("http://localhost:3000/"), /εσωτερικό/);
  assert.throws(() => checkUrl("http://[::1]/"), /εσωτερικό/);
  assert.throws(() => checkUrl("http://169.254.169.254/latest/meta-data"), /εσωτερικό/);
  assert.equal(checkUrl("https://shop.example.gr/feed.xml").hostname, "shop.example.gr");
});

test("όνομα που λύνεται σε εσωτερική IP μπλοκάρεται στη σύνδεση (DNS)", async () => {
  // localtest.me → 127.0.0.1 (δημόσιο DNS)· αν δεν υπάρχει δίκτυο, αρκεί να μη φτάσει ποτέ στο τοπικό
  await assert.rejects(safeFetch("http://localtest.me/", { timeoutMs: 5000 }), (e: Error) => /εσωτερικό|Δεν βρέθηκε|απάντησε/.test(e.message));
});

test("όριο μεγέθους και redirect προς εσωτερική διεύθυνση", async () => {
  process.env.ALLOW_PRIVATE_NETWORK = "1";
  const big = Buffer.alloc(2048, 97);
  const srv = createServer((req, res) => {
    if (req.url === "/big") { res.end(big); return; }
    if (req.url === "/redir") { res.writeHead(302, { Location: "/ok" }); res.end(); return; }
    res.end("ok");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  try {
    await assert.rejects(safeFetch(`http://127.0.0.1:${port}/big`, { maxBytes: 1024 }), /πολύ μεγάλο/);
    const r = await safeFetch(`http://127.0.0.1:${port}/redir`);
    assert.equal(r.bytes.toString(), "ok");
    delete process.env.ALLOW_PRIVATE_NETWORK;
    await assert.rejects(safeFetch(`http://127.0.0.1:${port}/ok`), /εσωτερικό/);
  } finally {
    delete process.env.ALLOW_PRIVATE_NETWORK;
    srv.close();
  }
});
