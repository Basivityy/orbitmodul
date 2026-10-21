import { SubmitButton } from "@/components/client";
import { Field, Toggle } from "@/components/ui";
import { savePanelAction } from "../actions/panels";

export function PanelForm({ panel, owners }: { panel?: { id: string; name: string; apiUrl: string; extraParams: unknown; testMode: boolean; namesApiUrl?: string | null; namesApiKeyEnc?: string | null; lineOwnerId?: string | null; streamUrl?: string | null }; owners?: Array<{ id: string; username: string; credits: string | null }> }) {
  const extra = panel ? Object.entries((panel.extraParams as Record<string, string>) ?? {}).map(([k, v]) => `${k}=${v}`).join("\n") : "";
  return (
    <form action={savePanelAction} className="space-y-4">
      {panel && <input type="hidden" name="id" value={panel.id} />}
      <div className="grid-form">
        <Field label="Panel name" name="name">
          <input className="input" id="name" name="name" defaultValue={panel?.name ?? ""} placeholder="My XUI panel" required />
        </Field>
        <Field label="API URL" name="apiUrl" hint="The API access-code URL, e.g. http://panel.example.com/resellerapi (use http:// if your panel has no SSL)">
          <input className="input" id="apiUrl" name="apiUrl" type="url" defaultValue={panel?.apiUrl ?? ""} placeholder="http://panel.example.com/resellerapi" required />
        </Field>
      </div>
      <Field label="API key" name="apiKey" hint={panel ? "Leave empty to keep the stored key. Keys are encrypted and never shown again." : "Generated in your XUI One profile. Stored encrypted."}>
        <input className="input font-mono" id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder={panel ? "•••••••• (unchanged)" : ""} required={!panel} />
      </Field>
      <Field label="Line owner — XUI user ID (admin API)" name="lineOwnerId" hint="With an admin API, new lines are created under this XUI reseller (member_id), e.g. 491 for BillingModule. Leave empty for a reseller API — lines then belong to that reseller automatically.">
        <input className="input max-w-xs" id="lineOwnerId" name="lineOwnerId" inputMode="numeric" list="xui-owners" defaultValue={panel?.lineOwnerId ?? ""} placeholder="e.g. 491" />
        {owners && owners.length > 0 && (
          <datalist id="xui-owners">
            {owners.map((o) => <option key={o.id} value={o.id}>{o.username}{o.credits !== null ? ` (credits: ${o.credits})` : ""}</option>)}
          </datalist>
        )}
      </Field>
      <Field label="Streaming URL / DNS (for apps)" name="streamUrl" hint="The address customers' players connect to, e.g. http://line.yourdomain.com:80. Your app receives it together with username and password. Empty = the API address.">
        <input className="input max-w-md font-mono" id="streamUrl" name="streamUrl" defaultValue={panel?.streamUrl ?? ""} placeholder="http://line.yourdomain.com:80" />
      </Field>
      <Field label="Additional settings (optional)" name="extraParams" hint="Extra parameters your panel's create_line requires, one key=value per line (for example member_id=12).">
        <textarea className="input font-mono" id="extraParams" name="extraParams" rows={3} defaultValue={extra} />
      </Field>
      <details className="rounded-xl border border-slate-200 p-4 dark:border-slate-800" open={!!panel?.namesApiUrl}>
        <summary className="cursor-pointer text-sm font-semibold">Bouquet names from another API (optional)</summary>
        <p className="hint mt-2">The XUI One <b>reseller</b> API returns bouquet IDs only. If you also have the panel&apos;s <b>admin</b> API, enter it here — it is used only to read bouquet names, never to create lines.</p>
        <div className="mt-3 grid-form">
          <Field label="Admin API URL" name="namesApiUrl">
            <input className="input" id="namesApiUrl" name="namesApiUrl" type="url" defaultValue={panel?.namesApiUrl ?? ""} placeholder="http://panel.example.com/adminapi" />
          </Field>
          <Field label="Admin API key" name="namesApiKey" hint={panel?.namesApiKeyEnc ? "Leave empty to keep the stored key." : "Stored encrypted."}>
            <input className="input font-mono" id="namesApiKey" name="namesApiKey" type="password" autoComplete="off" placeholder={panel?.namesApiKeyEnc ? "•••••••• (unchanged)" : ""} />
          </Field>
        </div>
      </details>
      <Toggle name="testMode" label="Test mode" defaultChecked={panel?.testMode ?? true} hint="Reading bouquets and credits uses the real panel, but creating/extending lines is simulated. Turn off to sell for real." />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="intent" value="connect">Connect &amp; test</SubmitButton>
        <SubmitButton name="intent" value="save" className="btn-secondary">Save settings</SubmitButton>
      </div>
    </form>
  );
}

