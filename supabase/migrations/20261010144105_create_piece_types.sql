-- Types are managed centrally; product references follow renames atomically.
CREATE TABLE public.piece_types (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  active boolean NOT NULL DEFAULT true,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);
CREATE UNIQUE INDEX piece_types_name_ci_key ON public.piece_types (lower(name));

INSERT INTO public.piece_types (name) VALUES ('Pino'), ('Bucha');
INSERT INTO public.piece_types (name)
SELECT min(btrim(piece_type)) FROM public.products
WHERE btrim(piece_type) <> ''
GROUP BY lower(btrim(piece_type))
ON CONFLICT DO NOTHING;

UPDATE public.products p SET piece_type = t.name
FROM public.piece_types t WHERE lower(btrim(p.piece_type)) = lower(t.name) AND p.piece_type <> t.name;

ALTER TABLE public.products ALTER COLUMN piece_type DROP DEFAULT;
ALTER TABLE public.products ADD CONSTRAINT products_piece_type_fkey
  FOREIGN KEY (piece_type) REFERENCES public.piece_types(name)
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- Existing app authentication stays on the server; no public type writes.
ALTER TABLE public.piece_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.piece_types FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.piece_types TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.piece_types_id_seq TO service_role;
NOTIFY pgrst, 'reload schema';
