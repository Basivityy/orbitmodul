import { env } from "./env";
import { getSetting, setSetting } from "./settings";
import type { AppGuide } from "@/core/appGuide";
export type { AppGuide } from "@/core/appGuide";
export { guideDevices, guideEmailBlocks, guideLinks, guideSteps, PLATFORMS } from "@/core/appGuide";
import { defaultGuide, normalizeGuide } from "@/core/appGuide";

/**
 * "How to watch" guide shown to customers after activation (order page, portal, activation email):
 * app name, icon (uploaded by the Super Admin), download links and short steps.
 */
export const SETTING_APP_GUIDE = "app_guide";
export const SETTING_APP_ICON = "app_guide_icon";

export interface AppIcon {
  type: string;
  b64: string;
}

export const DEFAULT_GUIDE: AppGuide = defaultGuide();
export const ICON_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const ICON_MAX_BYTES = 300 * 1024;

export async function getAppGuide(): Promise<AppGuide> {
  return normalizeGuide(await getSetting<Partial<AppGuide> | null>(SETTING_APP_GUIDE, null));
}

export async function saveAppGuide(g: AppGuide): Promise<void> {
  await setSetting(SETTING_APP_GUIDE, g);
}

export async function getAppIcon(): Promise<AppIcon | null> {
  return getSetting<AppIcon | null>(SETTING_APP_ICON, null);
}

export async function setAppIcon(icon: AppIcon | null): Promise<void> {
  await setSetting(SETTING_APP_ICON, icon);
  const g = await getAppGuide();
  await saveAppGuide({ ...g, iconVersion: Date.now() });
}

/** Public, absolute URL of the icon (for emails) or null when no icon was uploaded. */
export function appIconUrl(g: AppGuide): string | null {
  return g.iconVersion ? `${env.appUrl}/api/public/app-icon?v=${g.iconVersion}` : null;
}

