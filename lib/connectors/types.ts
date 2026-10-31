import type { z } from "zod";
import type { ConnectionType, Location, StockRow, TestStep } from "@/lib/contracts";

/**
 * Κάθε τρόπος σύνδεσης υλοποιεί αυτό. Στη Φάση 1 μόνο `test`· στις επόμενες φάσεις προστίθενται
 * `listLocations` / `fetchStock` (pull) ή η επεξεργασία των InboundBatch (push / ανέβασμα).
 * Κανόνας: οι connectors **μόνο διαβάζουν** από τα συστήματα των μελών.
 */
export interface ConnectorDef<C = unknown, S = unknown> {
  type: ConnectionType;
  label: string;
  /** false = δεν υπάρχει ακόμη αυτόματος έλεγχος· το αποτέλεσμα είναι «review» και τη σύνδεση την ελέγχουμε εμείς */
  autoTest: boolean;
  /** τύπος που προσφέρεται τώρα στα μέλη (Φάση 1: XML/Excel, SoftOne WS, WooCommerce) — οι υπόλοιποι μένουν στο συμβόλαιο για αργότερα */
  available?: boolean;
  config: z.ZodType<C>;
  /** null = ο τύπος δεν έχει secrets */
  secrets: z.ZodType<S> | null;
  test(ctx: TestCtx<C, S>): Promise<void>;
}

export interface TestCtx<C, S> {
  connectionId: string;
  config: C;
  secrets: S | null;
  /** Εκτελεί ένα βήμα, μετρά χρόνο· σε σφάλμα το βήμα αποτυγχάνει και, αν είναι κρίσιμο, ο έλεγχος σταματά. */
  step(key: TestStep["key"], fn: () => Promise<string>, opts?: { critical?: boolean }): Promise<boolean>;
  setSample(rows: StockRow[]): void;
  setLocations(locs: Location[]): void;
  setTotal(n: number | null): void;
  setFieldHints(h: Record<string, string>): void;
  /** στήλες και ακατέργαστες γραμμές του αρχείου, για την οθόνη αντιστοίχισης */
  setColumns(cols: string[], preview: Record<string, string>[]): void;
  /** ο τύπος δεν έχει αυτόματο έλεγχο — το αποτέλεσμα γίνεται «review» */
  markReview(): void;
}

/** Σφάλμα με μήνυμα έτοιμο για το μέλος. */
export class StepError extends Error {}
