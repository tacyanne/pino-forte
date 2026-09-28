-- null preserves the original catalog image; empty text explicitly removes it.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_data text;
ALTER TABLE public.products ADD CONSTRAINT products_image_data_size
  CHECK (image_data IS NULL OR octet_length(image_data) <= 600000);
COMMENT ON COLUMN public.products.image_data IS
  'Normalized 720x580 JPEG data URI, saved atomically with the product. NULL uses legacy image; empty string means no image.';
