import { CONNECTION_TYPES, type ConnectionType } from "@/lib/contracts";
import { feedUrl } from "./feed-url";
import { manual, pushApi } from "./inbound";
import { reviewConnectors } from "./review";
import { softoneWs } from "./softone-ws";
import type { ConnectorDef } from "./types";
import { woocommerce } from "./woocommerce";

const all = [softoneWs, woocommerce, feedUrl, pushApi, manual, ...reviewConnectors] as ConnectorDef[];

export const connectors = new Map<ConnectionType, ConnectorDef>(all.map((c) => [c.type, c]));

// κάθε τύπος του συμβολαίου πρέπει να έχει connector (το ελέγχει και το test)
for (const t of CONNECTION_TYPES) if (!connectors.has(t)) throw new Error(`Λείπει connector για τον τύπο ${t}`);

export function connectorFor(type: string): ConnectorDef {
  const c = connectors.get(type as ConnectionType);
  if (!c) throw new Error(`Άγνωστος τύπος σύνδεσης: ${type}`);
  return c;
}
