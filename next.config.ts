import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce standalone output so the runtime bundle carries only the deps it needs
  output: "standalone",
};

export default nextConfig;
