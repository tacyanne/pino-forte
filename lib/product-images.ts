const legacyImages: Record<string, string> = {
  "RN 183": "/rn-183.jpeg", "GR 188": "/img-006.png",
  "RN 180": "/img-000.png", "RN 190": "/img-001.png",
  "RN 205": "/img-002.png", "RN 225": "/img-003.png",
  "RO 215": "/img-004.png", "RO 235": "/img-005.png",
};

export function productImageSource(product: { code: string; imageData?: string | null }) {
  // An empty string means explicitly removed; null retains the original catalog image.
  return product.imageData ?? legacyImages[product.code] ?? "";
}

export const MAX_PRODUCT_IMAGE_LENGTH = 600_000;

export function productImageError(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_PRODUCT_IMAGE_LENGTH ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return "Envie uma imagem JPG, PNG ou WebP pelo campo de imagem da peça.";
  }
  try {
    const bytes = atob(value.slice("data:image/jpeg;base64,".length));
    if (bytes.charCodeAt(0) !== 255 || bytes.charCodeAt(1) !== 216 ||
        bytes.charCodeAt(bytes.length - 2) !== 255 || bytes.charCodeAt(bytes.length - 1) !== 217) throw new Error();
    // Check the JPEG frame size so bypassing the form cannot store oversized rasters.
    for (let i = 2; i + 8 < bytes.length;) {
      if (bytes.charCodeAt(i++) !== 255) throw new Error();
      while (bytes.charCodeAt(i) === 255) i++;
      const marker = bytes.charCodeAt(i++);
      const size = bytes.charCodeAt(i) * 256 + bytes.charCodeAt(i + 1);
      if (size < 2 || i + size > bytes.length) throw new Error();
      if ([192, 193, 194].includes(marker)) {
        const height = bytes.charCodeAt(i + 3) * 256 + bytes.charCodeAt(i + 4);
        const width = bytes.charCodeAt(i + 5) * 256 + bytes.charCodeAt(i + 6);
        if (width === 720 && height === 580) return null;
        throw new Error();
      }
      if (marker === 218 || marker === 217) break;
      i += size;
    }
  } catch { /* Report a friendly validation error below. */ }
  return "Imagem inválida. Selecione o arquivo novamente para padronizá-lo.";
}
