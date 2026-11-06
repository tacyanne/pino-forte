const logoSources = [480, 720, 960, 1440]
  .map((width) => `/logo-sistema-hd-${width}.webp ${width}w`)
  .join(", ");

/** Derivados em alta qualidade do logo transparente original (6000 px); o CSS define o layout. */
export function BrandImage({ className, alt, sizes }: {
  className?: string;
  alt: string;
  sizes: string;
}) {
  return <img
    className={className}
    src="/logo-sistema-hd-960.webp"
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
