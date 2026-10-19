import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { isLocalAuth } from "./src/lib/auth-mode";

const nextConfig: NextConfig = {
  // Lets client components know the app runs without login (src/lib/auth-mode.ts).
  env: { NEXT_PUBLIC_LOCAL_AUTH: isLocalAuth() ? "1" : "" },
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

export default withWorkflow(nextConfig);
