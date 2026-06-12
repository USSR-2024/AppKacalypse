import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8081";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // В dev проксируем /api/* на бэк. В проде /api/* до Next не доходит — его забирает Caddy.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
