import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    maximumRedirects: 0,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn11.bigcommerce.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
