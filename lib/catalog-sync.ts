export const CATALOG_CHANNEL = "pino-catalog-updates";

export async function fetchCatalogProducts<T>(
  signal?: AbortSignal,
): Promise<T[]> {
  const response = await fetch("/api/catalog/products", {
    cache: "no-store",
    signal,
  });
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.products)) {
    throw new Error("Não foi possível atualizar o catálogo. Tente novamente.");
  }
  return data.products;
}

export function notifyCatalogUpdate() {
  window.dispatchEvent(new Event(CATALOG_CHANNEL));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CATALOG_CHANNEL);
    channel.postMessage("updated");
    channel.close();
  }
}

// Cross-tab saves refresh immediately; polling also covers other devices.
export function watchCatalogUpdates(refresh: () => void) {
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(CATALOG_CHANNEL)
      : null;
  const whenVisible = () => {
    if (!document.hidden) refresh();
  };
  channel?.addEventListener("message", whenVisible);
  window.addEventListener(CATALOG_CHANNEL, whenVisible);
  window.addEventListener("focus", whenVisible);
  document.addEventListener("visibilitychange", whenVisible);
  window.addEventListener("pageshow", whenVisible);
  const timer = window.setInterval(whenVisible, 15000);
  return () => {
    channel?.close();
    window.clearInterval(timer);
    window.removeEventListener(CATALOG_CHANNEL, whenVisible);
    window.removeEventListener("focus", whenVisible);
    window.removeEventListener("pageshow", whenVisible);
    document.removeEventListener("visibilitychange", whenVisible);
  };
}
