import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Native / Node-only modules of the backend (src/server): loaded from node_modules, not bundled
  serverExternalPackages: ["@node-rs/argon2", "mongodb", "nodemailer", "qrcode"],
};

export default nextConfig;
