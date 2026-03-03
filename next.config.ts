import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  async rewrites() {
    return process.env.NODE_ENV === "development"
      ? [
          {
            source: "/api/py/:path*",
            destination: "http://127.0.0.1:8000/api/py/:path*",
          },
        ]
      : [];
  },
};

export default withNextIntl(nextConfig);
