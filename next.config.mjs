/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Type errors are reported by `npm run typecheck`; they do not block the Docker build.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis", "nodemailer"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
      // Custom reseller domains post forms back to the same host; Next checks Origin == Host.
    },
  },
  async headers() {
    const noFrame = securityHeaders.filter((h) => h.key !== "X-Frame-Options");
    return [
      // Everything except the store widget may only be framed by the platform itself.
      { source: "/:path((?!embed/).*)", headers: securityHeaders },
      // Store widget (/embed/<store>, used by /widget.js) may be shown on resellers' websites.
      { source: "/embed/:path*", headers: [...noFrame, { key: "Content-Security-Policy", value: "frame-ancestors *" }] },
    ];
  },
};

export default nextConfig;
