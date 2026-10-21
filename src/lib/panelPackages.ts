import { decrypt } from "@/core/crypto";
import { createPanelAdapter } from "@/core/adapters/xui";
import { apiLogger } from "./audit";

export interface PanelPackageOption {
  panelId: string;
  id: string;
  name: string;
  label: string;
}

/** Reads the package list of each panel (read-only call; failures just give an empty list). */
export async function loadPanelPackageOptions(resellerId: string, panels: Array<{ id: string; name: string; type: string; apiUrl: string; apiKeyEnc: string; extraParams: unknown; lineOwnerId: string | null }>): Promise<PanelPackageOption[]> {
  const out: PanelPackageOption[] = [];
  await Promise.all(
    panels.map(async (p) => {
      try {
        const adapter = createPanelAdapter(p.type, { apiUrl: p.apiUrl, apiKey: decrypt(p.apiKeyEnc), extraParams: (p.extraParams as Record<string, string>) ?? {}, lineOwnerId: p.lineOwnerId, timeoutMs: 8000 }, { testMode: false, log: apiLogger(resellerId, "XUI") });
        for (const pk of await adapter.getPanelPackages()) {
          out.push({ panelId: p.id, id: pk.id, name: pk.name, label: `${pk.name} (#${pk.id}${pk.durationDays ? ` · ${pk.durationDays} days` : ""}${pk.maxConnections ? ` · ${pk.maxConnections} conn.` : ""})` });
        }
      } catch {
        /* panel unreachable — the field still accepts a typed id */
      }
    }),
  );
  return out;
}
