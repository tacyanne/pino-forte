export function displayProductLine<T extends { name?: unknown; lineName?: unknown }>(product: T) {
  return { ...product, name: product.lineName || product.name };
}
