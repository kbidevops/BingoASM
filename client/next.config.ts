import type { NextConfig } from "next";

// Static export: `npm run build` writes plain HTML/JS to client/dist, which the Spring server
// serves directly (app.client-dist). No Node server is needed in production.
const nextConfig: NextConfig = {
  output: "export",
  distDir: "dist",
  images: { unoptimized: true },
};

export default nextConfig;
