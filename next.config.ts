import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Use Next's in-process TypeScript checker; the CLI JSON output parser
    // fails in the current local build environment.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
