import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptSecrets } from "@/lib/crypto/secrets";
import { FetchBlocked } from "@/lib/net/safe-fetch";
import type { Location, StockRow, TestResult, TestStep } from "@/lib/contracts";
import { connectorFor } from "./registry";
import { StepError, type TestCtx } from "./types";

const TOTAL_TIMEOUT_MS = 90_000;

/**
 * Τρέχει τον έλεγχο μιας σύνδεσης, τον αποθηκεύει και ενημερώνει την κατάσταση.
 * Η κατάσταση `active` δεν πέφτει από αποτυχημένο έλεγχο — καταγράφεται μόνο (την παύση την αποφασίζει ο συγχρονισμός).
 */
export async function runConnectionTest(connectionId: string, requestedBy?: string): Promise<TestResult | null> {
  const conn = await db.connection.findUnique({ where: { id: connectionId } });
  if (!conn) return null;
  const def = connectorFor(conn.type);
  const startedAt = new Date();
  const steps: TestStep[] = [];
  let sample: StockRow[] = [], locations: Location[] = [], total: number | null = null, fieldHints: Record<string, string> | undefined;
  let review = !def.autoTest, failedCritical = false;

  const step: TestCtx<unknown, unknown>["step"] = async (key, fn, opts) => {
    const t0 = Date.now();
    try {
      const message = await fn();
      steps.push({ key, ok: true, message, ms: Date.now() - t0 });
      return true;
    } catch (e) {
      steps.push({ key, ok: false, message: messageOf(e), ms: Date.now() - t0 });
      if (opts?.critical !== false) failedCritical = true;
      return false;
    }
  };

  // ① στοιχεία: config και secrets σύμφωνα με τον τύπο
  const cfg = def.config.safeParse(conn.config);
  let secrets: unknown = null;
  const configOk = await step("config", async () => {
    if (!cfg.success) throw new StepError(`Λείπουν ή είναι λάθος στοιχεία: ${cfg.error.issues.map((i) => `${i.path.join(".") || "—"}: ${i.message}`).join("· ")}`);
    if (def.secrets) {
      if (!conn.secretsEnc) {
        const opt = def.secrets.safeParse({});
        if (!opt.success) throw new StepError("Δεν έχουν δοθεί τα στοιχεία πρόσβασης");
        secrets = opt.data;
      } else {
        const parsed = def.secrets.safeParse(decryptSecrets(conn.secretsEnc));
        if (!parsed.success) throw new StepError("Τα αποθηκευμένα στοιχεία πρόσβασης δεν είναι πλήρη — δώσ' τα ξανά");
        secrets = parsed.data;
      }
    }
    return "Τα στοιχεία είναι πλήρη";
  });
  // ο connector καταγράφει δικό του βήμα «config» μόνο όταν δεν υπάρχει άλλο· αποφεύγουμε διπλό
  if (configOk) steps.pop();

  if (configOk) {
    const ctx: TestCtx<unknown, unknown> = {
      connectionId,
      config: cfg.data,
      secrets,
      step,
      setSample: (r) => { sample = r.slice(0, 5); },
      setLocations: (l) => { locations = l.slice(0, 500); },
      setTotal: (n) => { total = n; },
      setFieldHints: (h) => { fieldHints = h; },
      markReview: () => { review = true; },
    };
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(() => { steps.push({ key: "reach", ok: false, message: "Ο έλεγχος ξεπέρασε το χρονικό όριο", ms: TOTAL_TIMEOUT_MS }); failedCritical = true; resolve(); }, TOTAL_TIMEOUT_MS); });
    await Promise.race([def.test(ctx).catch((e) => { steps.push({ key: "reach", ok: false, message: messageOf(e), ms: 0 }); failedCritical = true; }), timeout]);
    clearTimeout(timer);
  }

  const outcome: TestResult["outcome"] = failedCritical ? "failed" : review ? "review" : "ok";
  const durationMs = Date.now() - startedAt.getTime();
  const row = await db.connectionTest.create({
    data: {
      connectionId, outcome, requestedBy, startedAt, durationMs, total,
      steps: steps as unknown as Prisma.InputJsonValue,
      sample: sample as unknown as Prisma.InputJsonValue,
      locations: locations as unknown as Prisma.InputJsonValue,
      ...(fieldHints ? { fieldHints } : {}),
    },
  });
  const status = conn.status === "active" || conn.status === "paused" ? conn.status : outcome === "ok" ? "ok" : outcome === "failed" ? "failed" : "testing";
  await db.connection.update({ where: { id: connectionId }, data: { status, lastTestAt: startedAt, ...(outcome === "ok" ? { lastOkAt: startedAt } : {}) } });

  return { testId: row.id, connectionId, outcome, steps, sample, locations, total, ...(fieldHints ? { fieldHints } : {}), startedAt: startedAt.toISOString(), durationMs };
}

function messageOf(e: unknown): string {
  if (e instanceof StepError || e instanceof FetchBlocked) return e.message;
  if (e instanceof Error && /^(Ο server|Δεν βρέθηκε|Πρόβλημα|Σφάλμα σύνδεσης)/.test(e.message)) return e.message;
  console.error("[test]", e instanceof Error ? e.message : e);
  return "Απρόβλεπτο σφάλμα κατά τον έλεγχο";
}
