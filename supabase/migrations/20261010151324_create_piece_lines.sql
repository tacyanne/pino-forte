CREATE TABLE public.piece_lines (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 200),
  active boolean NOT NULL DEFAULT true,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);
CREATE UNIQUE INDEX piece_lines_name_ci_key ON public.piece_lines (lower(name));
INSERT INTO public.piece_lines (name)
SELECT min(btrim(name)) FROM public.products GROUP BY lower(btrim(name));
ALTER TABLE public.products ADD COLUMN line_name text;
UPDATE public.products p SET line_name = l.name FROM public.piece_lines l
WHERE lower(btrim(p.name)) = lower(l.name);
ALTER TABLE public.products ADD CONSTRAINT products_line_name_fkey
  FOREIGN KEY (line_name) REFERENCES public.piece_lines(name) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public.piece_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.piece_lines FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.piece_lines TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.piece_lines_id_seq TO service_role;
NOTIFY pgrst, 'reload schema';
