"use client";

import { useEffect, useRef, useState } from "react";
import { CatalogImage } from "./catalog-image";

export function ZoomableCatalogImage({ src, alt }: { src: string; alt: string }) {
  // Guarda qual src está aberto: trocar de imagem fecha o zoom sem setState em efeito.
  const [openSrc, setOpenSrc] = useState<string | null>(null);
  const open = openSrc === src;
  const setOpen = (value: boolean) => setOpenSrc(value ? src : null);
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
