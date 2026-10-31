import { z } from "zod";
import { CONTRACT_VERSION } from "@/lib/contracts";
import { internal } from "@/lib/auth/internal";
import { connectors } from "@/lib/connectors/registry";
import { ok } from "@/lib/http";

/** Κατάλογος τρόπων σύνδεσης για τις φόρμες του eshop: ετικέτα, αυτόματος έλεγχος, αν προσφέρεται τώρα (`available`), JSON Schema στοιχείων/secrets. */
export const GET = internal(async () => {
  const list = [...connectors.values()].map((c) => ({
    type: c.type,
    label: c.label,
    autoTest: c.autoTest,
    available: c.available === true,
    config: z.toJSONSchema(c.config, { io: "input", unrepresentable: "any" }),
    secrets: c.secrets ? z.toJSONSchema(c.secrets, { io: "input", unrepresentable: "any" }) : null,
  }));
  return ok({ contract: CONTRACT_VERSION, connectors: list });
});
