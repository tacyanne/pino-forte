"use client";

import { useEffect, useRef, useState } from "react";
import { CatalogImage } from "./catalog-image";

export function ZoomableCatalogImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const modal = dialog.current;
    if (!open || !modal) return;
    modal.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      modal.close();
      document.body.style.overflow = overflow;
    };
  }, [open]);
  useEffect(() => { setOpen(false); }, [src]);
  return (
    <>
      <button type="button" className="catalog-image-zoom-trigger" aria-label={`Ampliar imagem de ${alt}`} onClick={() => setOpen(true)}>
        <CatalogImage src={src} alt={alt} />
        <span aria-hidden="true">Ampliar ⤢</span>
      </button>
      <dialog ref={dialog} className="catalog-image-zoom-dialog" aria-label={`Imagem ampliada de ${alt}`}
        onCancel={() => setOpen(false)} onClose={() => setOpen(false)}
        onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        {open && <div className="catalog-image-zoom-panel">
          <header><strong>{alt}</strong><button type="button" autoFocus aria-label="Fechar imagem ampliada" onClick={() => setOpen(false)}>×</button></header>
          <CatalogImage src={src} alt={alt} />
        </div>}
      </dialog>
    </>
  );
}
