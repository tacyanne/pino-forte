"use client";

import { useEffect, useState } from "react";
import { productImageSource } from "../../lib/product-images";
import {
  fetchCatalogProducts,
  watchCatalogUpdates,
} from "../../lib/catalog-sync";
import { ZoomableCatalogImage } from "./zoomable-catalog-image";

type CatalogProduct = {
  id: number;
  code: string;
  name: string;
  pieceType: string;
  measure: string;
  price: number;
  imageData?: string | null;
  active: boolean;
};
const whatsapp =
  "https://wa.me/5543991565317?text=" +
  encodeURIComponent(
    "Olá! Preciso realizar um pedido de peças para suspensão.",
  );
function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function CatalogView({
  initialProducts,
  distributor,
}: {
  initialProducts: CatalogProduct[];
  distributor: boolean;
}) {
  const [catalogProducts, setCatalogProducts] = useState(initialProducts);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const products = await fetchCatalogProducts<CatalogProduct>(
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setCatalogProducts(products);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Não foi possível atualizar o catálogo. Tentaremos novamente automaticamente.",
          );
      } finally {
        pending = false;
      }
    };
    const stop = watchCatalogUpdates(() => {
      void refresh();
    });
    void refresh();
    return () => {
      stop();
      controller.abort();
    };
  }, []);
  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <div className="catalog-header-inner">
          <img
            src="/logo-sistema.png"
            alt="Pino Forte — Fabricação de Peças para Suspensão"
          />
          <div className="catalog-title">
            <h1>
              {distributor ? "Catálogo distribuidor" : "Catálogo de preços"}
            </h1>
          </div>
        </div>
      </header>

      <section className="catalog-content" aria-label="Peças disponíveis">
        {error && <p role="alert">{error}</p>}
        {distributor && (
          <div className="catalog-discount-rule">
            <strong>Regra de desconto</strong>
            <span>5% até 9 unidades</span>
            <span>8% de 10 a 19 unidades</span>
            <span>10% de 20 em diante</span>
          </div>
        )}
        {catalogProducts.length ? (
          <div className="catalog-grid">
            {catalogProducts.map((product) => (
              <article className="catalog-card" key={product.id}>
                <div className="catalog-card-top">
                  <span className="catalog-code">{product.code}</span>
                  <strong className="catalog-price">
                    {money(product.price)}
                  </strong>
                </div>
                <div className="catalog-product">
                  {productImageSource(product) ? (
                    <ZoomableCatalogImage
                      src={productImageSource(product)}
                      alt={`${product.name} · ${product.code}`}
                    />
                  ) : (
                    <div className="catalog-pin" aria-hidden="true">
                      <i />
                      <i />
                    </div>
                  )}
                  <div>
                    <span className="catalog-type">{product.pieceType}</span>
                    <h3>{product.name}</h3>
                    <strong>{product.measure}</strong>
                  </div>
                </div>
                {distributor && (
                  <div className="catalog-discount-values">
                    <strong>Preço por peça</strong>
                    <span>5%: {money(product.price * 0.95)}</span>
                    <span>8%: {money(product.price * 0.92)}</span>
                    <span>10%: {money(product.price * 0.9)}</span>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="empty">Nenhuma peça disponível no momento.</p>
        )}
      </section>

      <footer className="catalog-footer">
        <div>
          <strong>Faça seu pedido de forma rápida e fácil</strong>
        </div>
        <a
          href={whatsapp}
          target="_blank"
          rel="noreferrer"
          aria-label="Falar no WhatsApp"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20.5 3.5A11.7 11.7 0 0 0 12.1 0C5.6 0 .3 5.3.3 11.8c0 2.1.5 4.1 1.6 5.9L0 24l6.5-1.7c1.7.9 3.6 1.4 5.6 1.4h.1c6.5 0 11.8-5.3 11.8-11.8 0-3.2-1.2-6.1-3.5-8.4Zm-8.4 18.2c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-3.8 1 1-3.7-.2-.4a9.8 9.8 0 1 1 8.5 4.7Zm5.4-7.3c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-2-.9-3.3-1.7-4.6-4-.3-.5.3-.5.9-1.6.1-.2.1-.4 0-.6l-.9-2.2c-.2-.5-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.2-1.2 2.9s1.2 3.3 1.4 3.5c.2.2 2.4 3.7 5.9 5.2.8.4 1.5.6 2 .7.8.3 1.6.2 2.2.1.7-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.3-.6-.4Z" />
          </svg>
          Falar no WhatsApp
        </a>
      </footer>
    </main>
  );
}
