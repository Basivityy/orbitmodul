function str(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  /** Public platform address: the domain set by the Super Admin, otherwise APP_URL. */
  get appUrl() {
    const override = (globalThis as unknown as { __publicUrl?: string | null }).__publicUrl;
    return (override || str("APP_URL", "http://localhost:3000")).replace(/\/$/, "");
  },
  /** APP_URL from .env (the address the server was installed with). */
  get installUrl() {
    return str("APP_URL", "http://localhost:3000").replace(/\/$/, "");
  },
  get appHost() {
    try {
      return new URL(env.appUrl).host;
    } catch {
      return "localhost:3000";
    }
  },
  get platformName() {
    const v = str("PLATFORM_NAME").trim();
    // The name of the first installs ("XUI Billing") is replaced by the brand.
    return v && v !== "XUI Billing" ? v : "OrbitModul";
  },
  /** Short description on the landing page and in search/link previews. */
  get platformTagline() {
    return str("PLATFORM_TAGLINE") || "Billing, activation codes and automatic line activation for resellers";
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
  get redisUrl() {
    return str("REDIS_URL", "redis://localhost:6379");
  },
  get smtp() {
    return {
      host: str("SMTP_HOST"),
      port: parseInt(str("SMTP_PORT", "587"), 10),
      secure: str("SMTP_SECURE", "false") === "true",
      user: str("SMTP_USER"),
      pass: str("SMTP_PASS"),
      from: str("SMTP_FROM", "OrbitModul <no-reply@example.com>"),
    };
  },
  get platformStripe() {
    return { secretKey: str("PLATFORM_STRIPE_SECRET_KEY"), webhookSecret: str("PLATFORM_STRIPE_WEBHOOK_SECRET") };
  },
  get sessionDays() {
    return parseInt(str("SESSION_DAYS", "14"), 10);
  },
  get trialDays() {
    return parseInt(str("TRIAL_DAYS", "14"), 10);
  },
  /** Global safety switch: when false, every panel integration is forced into test mode. */
  get liveOperationsAllowed() {
    return str("ALLOW_LIVE_PANEL_OPERATIONS", "false") === "true";
  },
  /** MaxPlayer accounts created per minute at most (each uses ~2 API requests). Keeps under MaxPlayer's request limit. */
  get maxPlayerPerMinute() {
    const n = parseInt(str("MAXPLAYER_ACCOUNTS_PER_MINUTE", "15"), 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 600) : 15;
  },
  get activationAttempts() {
    return parseInt(str("ACTIVATION_MAX_ATTEMPTS", "8"), 10);
  },
  // Based on .env so logging in keeps working on the original address after a domain is added.
  get secureCookies() {
    return env.installUrl.startsWith("https://");
  },
};
