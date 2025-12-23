import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Expose the Node PORT env var to the app
  // Accessible as process.env.PORT (both server and client at build time)
  env: {
    PORT: process.env.PORT ?? "3000",
    ADMIN_USERNAME: process.env.ADMIN_USERNAME ?? "admin",
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "admin",
  },
  // Produce standalone output so the runtime bundle carries only the deps it needs
  output: "standalone",
};

export default nextConfig;
