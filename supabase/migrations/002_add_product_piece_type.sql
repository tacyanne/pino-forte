-- Pino Forte - classifica pecas existentes e futuras
ALTER TABLE products
ADD COLUMN IF NOT EXISTS piece_type text NOT NULL DEFAULT 'Pino';

UPDATE products
SET piece_type = 'Pino'
WHERE piece_type IS NULL OR btrim(piece_type) = '';

CREATE INDEX IF NOT EXISTS products_piece_type_idx ON products(piece_type);
