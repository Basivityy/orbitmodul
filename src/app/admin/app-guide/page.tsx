import { SubmitButton } from "@/components/client";
import { Card, Flash, PageHeader, Toggle } from "@/components/ui";
import { AppGuideCard } from "@/components/AppGuideCard";
import { appIconUrl, getAppGuide, PLATFORMS } from "@/lib/appGuide";
import { requireSuperAdmin } from "@/lib/auth";
import { saveAppGuideAction } from "../actions";

export const metadata = { title: "Customer app guide" };

export default async function AppGuidePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const g = await getAppGuide();
  const icon = appIconUrl(g);
  return (
    <>
      <PageHeader title="Customer app guide" description="Shown to every customer after payment — on the order page, in their account and in the activation email — together with their username and password. Used for all resellers whose package has MaxPlayer enabled." />
      <Flash sp={sp} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Settings">
          <form action={saveAppGuideAction} className="space-y-4">
            <Toggle name="enabled" label="Show the app guide to customers" defaultChecked={g.enabled} />
            <div>
              <label className="label" htmlFor="appName">App name</label>
              <input className="input" id="appName" name="appName" defaultValue={g.appName} />
            </div>
            <div>
              <label className="label" htmlFor="icon">App icon (PNG/JPG/WEBP, max 300 KB, square)</label>
              <div className="flex items-center gap-3">
                {icon && <img src={icon} alt="" width={48} height={48} className="rounded-xl" />}
                <input className="input" id="icon" name="icon" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
              </div>
              {icon && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="removeIcon" /> Remove icon</label>}
            </div>
            <fieldset className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <legend className="px-1 text-sm font-semibold">Devices</legend>
              <p className="hint mb-3">Tick the devices where customers can install the app. A link adds a Download button; the instruction is shown under the device ({"{app}"} = app name).</p>
              <div className="space-y-4">
                {PLATFORMS.map((p) => {
                  const e = g.platforms[p.key];
                  return (
                    <div key={p.key} className="space-y-2 border-t border-slate-100 pt-3 first:border-0 first:pt-0 dark:border-slate-800">
                      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name={`on_${p.key}`} defaultChecked={e.enabled} /> {p.label}</label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input className="input text-sm" name={`url_${p.key}`} defaultValue={e.url} placeholder="Download link (optional)" />
                        <input className="input text-sm" name={`note_${p.key}`} defaultValue={e.note} placeholder="Instruction (optional)" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </fieldset>
            <div>
              <label className="label" htmlFor="unsupportedNote">Not supported (shown in red)</label>
              <input className="input" id="unsupportedNote" name="unsupportedNote" defaultValue={g.unsupportedNote} placeholder="Not available on Hisense TVs (VIDAA)." />
            </div>
            <div>
              <label className="label" htmlFor="extraNote">Extra note (optional)</label>
              <textarea className="input" id="extraNote" name="extraNote" rows={2} defaultValue={g.extraNote} placeholder="e.g. On Fire TV search for the app in the Downloader app." />
            </div>
            <SubmitButton>Save</SubmitButton>
          </form>
        </Card>
        <Card title="Preview (what the customer sees)">
          <AppGuideCard guide={g} iconUrl={icon} username="demo1234" password="pass5678" />
        </Card>
      </div>
    </>
  );
}
