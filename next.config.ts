import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb', // aquí defines el nuevo límite
    },
  },
  // puedes tener más configuraciones aquí
};

module.exports = nextConfig;

export default nextConfig;
