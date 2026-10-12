import type { NextConfig } from "next";

// O catálogo precisa refletir na hora as alterações feitas no sistema.
const noStore = [{ key: "Cache-Control", value: "no-store, no-cache, must-revalidate" }];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/catalogo", headers: noStore },
      { source: "/api/catalog/:path*", headers: noStore },
    ];
  },
};

export default nextConfig;
