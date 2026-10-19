import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

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
      {
        // Durable snapshot image copies (src/lib/snapshot-image-blob.ts).
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default withWorkflow(nextConfig);
