import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/** "Add to Home Screen": the dashboard opens like an app on phones. */
export default function manifest(): MetadataRoute.Manifest {
  const name = env.platformName;
  return {
    name,
    short_name: name.length > 14 ? name.slice(0, 14) : name,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
