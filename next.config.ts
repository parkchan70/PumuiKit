import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs is a CommonJS package with node built-ins; keep it out of the bundler.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
