import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb", // aquí defines el nuevo límite
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cloud.appwrite.io",
        pathname: "/v1/storage/**",
      },
    ],
  },
  // puedes tener más configuraciones aquí
};

module.exports = nextConfig;

export default nextConfig;
