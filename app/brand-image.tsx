const logoSources = [240, 480, 720, 960]
  .map((width) => `/logo-sistema-retina-${width}.webp ${width}w`)
  .join(", ");

/** Lossless derivatives of the original artwork; CSS owns the existing layout. */
export function BrandImage({ className, alt, sizes }: {
  className?: string;
  alt: string;
  sizes: string;
}) {
  return <img
    className={className}
    src="/logo-sistema-retina-720.webp"
    srcSet={logoSources}
    sizes={sizes}
    width={6000}
    height={2043}
    loading="eager"
    fetchPriority="high"
    decoding="async"
    alt={alt}
  />;
}
