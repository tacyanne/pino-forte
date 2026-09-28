"use client";

import { useEffect, useRef, useState } from "react";
import { loadCatalogImage } from "../../lib/catalog-image";
import { productImageError } from "../../lib/product-images";
import { CatalogImage } from "./catalog-image";

export function ProductImageInput({ initialSource, disabled, onBusyChange }: {
  initialSource: string; disabled: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [value, setValue] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { generation.current++; onBusyChange(false); }, [onBusyChange]);
  const preview = value ?? initialSource;

  async function select(file?: File) {
    if (!file) return;
    const current = ++generation.current;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError("Escolha uma imagem JPG, PNG ou WebP de até 10 MB.");
      if (input.current) input.current.value = "";
      return;
    }
    setBusy(true); onBusyChange(true);
    const url = URL.createObjectURL(file);
    try {
      const data = await loadCatalogImage(url, false, true);
      const message = productImageError(data);
      if (message) throw new Error(message);
      if (current === generation.current) setValue(data);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "Não foi possível preparar a imagem.");
    } finally {
      URL.revokeObjectURL(url);
      if (current === generation.current) { setBusy(false); onBusyChange(false); }
      if (input.current) input.current.value = "";
    }
  }
  return (
    <section className="product-image-editor" aria-label="Imagem da peça">
      <div className="product-image-preview">
        {preview ? <CatalogImage src={preview} alt="Prévia da imagem da peça no catálogo" /> : <span>Sem imagem</span>}
      </div>
      <div className="product-image-controls">
        <label htmlFor="product-image-file"><strong>Imagem da peça</strong></label>
        <p>Tamanho, enquadramento e contraste ajustados automaticamente. Prefira desenhos nítidos com fundo branco.</p>
        <input ref={input} id="product-image-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy} onChange={(e) => void select(e.target.files?.[0])} aria-describedby="product-image-help" />
        <small id="product-image-help">JPG, PNG ou WebP · até 10 MB. A alteração será aplicada ao salvar a peça.</small>
        <div className="product-image-actions">
          {preview && <button type="button" className="cancel-button" disabled={disabled || busy} onClick={() => { setValue(""); setError(""); }}>Remover imagem</button>}
          {value !== undefined && <button type="button" className="cancel-button" disabled={disabled || busy} onClick={() => { setValue(undefined); setError(""); }}>Desfazer alteração da imagem</button>}
        </div>
        {busy && <p role="status">Padronizando imagem...</p>}
        {error && <p role="alert" className="product-image-error">{error}</p>}
        {value !== undefined && <input type="hidden" name="imageData" value={value} />}
      </div>
    </section>
  );
}
