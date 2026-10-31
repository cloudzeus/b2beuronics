/**
 * Συμβόλαιο ανάμεσα στο κεντρικό eshop (euronics.gr) και στη μηχανή διαθεσιμότητας (b2b.dgsmart.gr).
 *
 * Το αρχείο είναι αυτοτελές (μόνο zod) ώστε να αντιγράφεται ως έχει στο κεντρικό (`lib/b2b-engine/contracts.ts`).
 * Κάθε αλλαγή εδώ = αλλαγή έκδοσης `CONTRACT_VERSION` και ενημέρωση του docs/contracts.md.
 */
import { z } from "zod";

export const CONTRACT_VERSION = "2026-10-31.2";

// ---------- Τρόποι σύνδεσης ----------

export const CONNECTION_TYPES = [
  "softone-ws",
  "entersoft",
  "epsilon",
  "galaxy",
  "woocommerce",
  "shopify",
  "magento",
  "opencart",
  "prestashop",
  "feed-url",
  "sftp",
  "push-api",
  "manual",
] as const;
export const ConnectionType = z.enum(CONNECTION_TYPES);
export type ConnectionType = z.infer<typeof ConnectionType>;

export const ConnectionStatus = z.enum(["draft", "testing", "ok", "failed", "active", "paused"]);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

// ---------- ① Γεγονότα: κεντρικό → μηχανή ----------
// Το κεντρικό είναι master για μέλη, καταστήματα και συνδέσεις· η μηχανή κρατά αντίγραφο με τα ίδια id.

const id = z.string().min(1).max(64);

export const PartnerData = z.object({
  id,
  s1Trdr: z.number().int().nullable(),
  name: z.string().min(1).max(200),
  afm: z.string().max(20).nullable(),
  active: z.boolean(),
});

export const StoreData = z.object({
  id,
  partnerId: id,
  s1BranchId: z.number().int().nullable(),
  name: z.string().min(1).max(200),
  city: z.string().max(100).nullable(),
  active: z.boolean(),
});

export const ConnectionData = z.object({
  id,
  partnerId: id,
  type: ConnectionType,
  /** μη ευαίσθητα: URL, serial, εταιρεία/υποκατάστημα, μορφή feed — τα secrets πάνε χωριστά (PUT …/secrets) */
  config: z.record(z.string(), z.unknown()),
  storeIds: z.array(id),
  active: z.boolean(),
});

const base = { id: z.string().min(8).max(64), at: z.iso.datetime() };
export const EngineEvent = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("partner.upserted"), data: PartnerData }),
  z.object({ ...base, type: z.literal("store.upserted"), data: StoreData }),
  z.object({ ...base, type: z.literal("connection.upserted"), data: ConnectionData }),
  z.object({ ...base, type: z.literal("connection.deleted"), data: z.object({ id }) }),
]);
export type EngineEvent = z.infer<typeof EngineEvent>;
export const EventBatch = z.object({ events: z.array(EngineEvent).min(1).max(500) });

// ---------- Εντολές: κεντρικό → μηχανή ----------

export const SecretsBody = z.object({ secrets: z.record(z.string(), z.string().max(4000)) });
export const LocationMapBody = z.object({
  map: z.array(z.object({ externalRef: z.string().min(1).max(100), storeId: id.nullable() })).max(500),
});

// ---------- Αποτέλεσμα ελέγχου σύνδεσης ----------

export const TestStepKey = z.enum(["config", "reach", "auth", "read-sample", "locations", "received"]);
export const TestStep = z.object({
  key: TestStepKey,
  ok: z.boolean(),
  /** σε απλά ελληνικά, για να το δει το μέλος */
  message: z.string(),
  ms: z.number().int().nonnegative(),
});
export type TestStep = z.infer<typeof TestStep>;

/** Μία γραμμή στοκ όπως την κανονικοποιεί κάθε connector. */
export const StockRow = z.object({
  externalSku: z.string().min(1).max(100),
  ean: z.string().max(20).optional(),
  mpn: z.string().max(100).optional(),
  brand: z.string().max(100).optional(),
  title: z.string().max(300).optional(),
  locationRef: z.string().min(1).max(100),
  qty: z.number().finite(),
  updatedAt: z.iso.datetime().optional(),
});
export type StockRow = z.infer<typeof StockRow>;

export const Location = z.object({ ref: z.string(), name: z.string() });
export type Location = z.infer<typeof Location>;

/**
 * `ok`: πέρασαν όλα τα βήματα που ο τύπος υποστηρίζει.
 * `review`: ο τύπος δεν έχει ακόμη αυτόματο έλεγχο — η σύνδεση εξετάζεται από εμάς.
 */
export const TestOutcome = z.enum(["ok", "failed", "review"]);
export const TestResult = z.object({
  testId: z.string(),
  connectionId: id,
  outcome: TestOutcome,
  steps: z.array(TestStep),
  /** έως 5 γραμμές, χωρίς προσωπικά δεδομένα */
  sample: z.array(StockRow).max(5),
  locations: z.array(Location),
  /** όσα προϊόντα δήλωσε το σύστημά τους, αν το ξέρουμε */
  total: z.number().int().nullable(),
  /** για feed: προτεινόμενη αντιστοίχιση στηλών/πεδίων */
  fieldHints: z.record(z.string(), z.string()).optional(),
  /** για feed/αρχείο: όλες οι στήλες και έως 5 ακατέργαστες γραμμές — για την αντιστοίχιση με το χέρι (μόνο στην άμεση απάντηση) */
  columns: z.array(z.string()).optional(),
  preview: z.array(z.record(z.string(), z.string())).max(5).optional(),
  startedAt: z.iso.datetime(),
  durationMs: z.number().int(),
});
export type TestResult = z.infer<typeof TestResult>;

// ---------- Αντιστοίχιση στηλών (feed / αρχείο) ----------

export const MAP_FIELDS = ["sku", "ean", "mpn", "brand", "title", "qty", "location"] as const;
/** πεδίο δικό μας → στήλη στο αρχείο τους· όποιο λείπει αναγνωρίζεται αυτόματα */
export const FieldMap = z.partialRecord(z.enum(MAP_FIELDS), z.string().min(1).max(200));
export type FieldMap = z.infer<typeof FieldMap>;

// ---------- Ιστορικό συγχρονισμών ----------

export const BatchLog = z.object({
  id: z.string(),
  source: z.enum(["push", "upload", "pull"]),
  mode: z.enum(["full", "delta"]),
  accepted: z.number().int(),
  rejected: z.number().int(),
  bytes: z.number().int(),
  status: z.string(),
  error: z.string().nullable(),
  receivedAt: z.iso.datetime(),
});
export type BatchLog = z.infer<typeof BatchLog>;

// ---------- Push API: ERP μέλους → μηχανή ----------

export const PUSH_MAX_ITEMS = 50_000;
export const PushItem = z.object({
  sku: z.string().min(1).max(100),
  ean: z.string().max(20).optional(),
  mpn: z.string().max(100).optional(),
  brand: z.string().max(100).optional(),
  title: z.string().max(300).optional(),
  location: z.string().min(1).max(100),
  qty: z.number().finite(),
});
export const PushBody = z.object({
  /** full: η πλήρης εικόνα (ό,τι λείπει = 0) · delta: μόνο όσα άλλαξαν */
  mode: z.enum(["full", "delta"]),
  generatedAt: z.iso.datetime().optional(),
  items: z.array(z.unknown()).min(1).max(PUSH_MAX_ITEMS),
});
export const PushResponse = z.object({
  batchId: z.string(),
  accepted: z.number().int(),
  rejected: z.array(z.object({ index: z.number().int(), reason: z.string() })).max(100),
  rejectedTotal: z.number().int(),
});
export type PushResponse = z.infer<typeof PushResponse>;

// ---------- ② Projection: μηχανή → κεντρικό (Φάση 2, ορίζεται από τώρα) ----------

export const AvailabilityState = z.enum(["in", "low", "out"]);
export const AvailabilityRow = z.object({
  variantId: id,
  storeId: id,
  state: AvailabilityState,
  /** ακριβής μόνο αν το μέλος το επιτρέπει· αλλιώς null */
  qty: z.number().int().nullable(),
  seenAt: z.iso.datetime(),
  /** ο connector μπορεί να επιβεβαιώσει live τη στιγμή της παραγγελίας */
  liveCheck: z.boolean(),
});
export const ProjectionBatch = z.object({
  batchId: z.string(),
  upserts: z.array(AvailabilityRow).max(10_000),
  /** ζεύγη που δεν ισχύουν πια (π.χ. ξε-αντιστοίχιση) */
  removes: z.array(z.object({ variantId: id, storeId: id })).max(10_000),
});
