"use client";

import { useEffect, useState } from "react";
import { loadCatalogImage } from "../../lib/catalog-image";

export function CatalogImage({ src, alt }: { src: string; alt: string }) {
  const [prepared, setPrepared] = useState<{ source: string; data: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadCatalogImage(src).then((data) => {
      if (!cancelled) setPrepared({ source: src, data });
    }).catch(() => { /* Keep the original image if canvas processing fails. */ });
    return () => { cancelled = true; };
  }, [src]);
  return <img className="catalog-product-image" src={prepared?.source === src ? prepared.data : src} alt={alt} width={720} height={580} />;
}
