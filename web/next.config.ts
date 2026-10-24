import type { NextConfig } from "next";

const apiOrigin = (process.env.LOCAL_API_ORIGIN ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", ...(process.env.LOCAL_DEV_HOSTS || "").split(",").map(host => host.trim()).filter(Boolean)],
  // The site has its own floating menu bottom-left; the Next.js dev badge would sit on top of it. Error overlays still show.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];

    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        condition: { not: { path: "*.module.css" } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
