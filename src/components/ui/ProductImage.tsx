/**
 * Product photograph wrapper.
 *
 * Every image path currently resolves to a generated placeholder SVG (see
 * scripts/generate-placeholders.mjs) — vector art needs no raster
 * optimization, so a plain lazy-loaded <img> is used here. Once real photos
 * (WebP/AVIF) are uploaded, swap the <img> below for next/image; every call
 * site already passes width/height/alt so the switch is a one-file change.
 */
 
export function ProductImage({
  src,
  alt,
  className = '',
  width,
  height,
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={className}
    />
  );
}
