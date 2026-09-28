// Use one frame for the web catalog and the 36 x 29 mm PDF image area.
export const CATALOG_IMAGE_WIDTH = 720;
export const CATALOG_IMAGE_HEIGHT = 580;

export function loadCatalogImage(url: string, grayscale = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error("Não foi possível carregar a imagem da peça."));
    image.onload = () => {
      try {
        const source = document.createElement("canvas");
        source.width = image.naturalWidth;
        source.height = image.naturalHeight;
        const context = source.getContext("2d");
        if (!context) throw new Error("Canvas indisponível.");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, source.width, source.height);
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, source.width, source.height);
        let left = source.width, top = source.height, right = -1, bottom = -1;
        // Ignore blank margins, retaining the drawing and all dimension labels.
        for (let y = 0; y < source.height; y += 1) {
          for (let x = 0; x < source.width; x += 1) {
            const i = (y * source.width + x) * 4;
            if (Math.min(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) < 245) {
              left = Math.min(left, x); top = Math.min(top, y);
              right = Math.max(right, x); bottom = Math.max(bottom, y);
            }
            if (grayscale) {
              const gray = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114;
              pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
            }
          }
        }
        if (grayscale) context.putImageData(pixels, 0, 0);
        if (right < left) { left = 0; top = 0; right = source.width - 1; bottom = source.height - 1; }
        const width = right - left + 1, height = bottom - top + 1;
        const frame = document.createElement("canvas");
        frame.width = CATALOG_IMAGE_WIDTH;
        frame.height = CATALOG_IMAGE_HEIGHT;
        const output = frame.getContext("2d");
        if (!output) throw new Error("Canvas indisponível.");
        output.fillStyle = "#fff";
        output.fillRect(0, 0, frame.width, frame.height);
        const padding = 24;
        const scale = Math.min((frame.width - padding * 2) / width, (frame.height - padding * 2) / height);
        // The RN 183 scan has heavier strokes than the other technical drawings.
        // Soften only its rendering, consistently in the web catalog and PDF.
        output.globalAlpha = url === "/rn-183.jpeg" ? 0.75 : 1;
        output.drawImage(source, left, top, width, height,
          (frame.width - width * scale) / 2, (frame.height - height * scale) / 2,
          width * scale, height * scale);
        resolve(frame.toDataURL("image/jpeg", 0.95));
      } catch (error) {
        reject(error);
      }
    };
    image.src = url;
  });
}
