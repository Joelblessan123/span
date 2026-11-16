-- Deterministic school identity from NCES CCD directory (Urban Institute Education Data API).
ALTER TABLE public.classroom_schools
  ADD COLUMN IF NOT EXISTS nces_id text;

CREATE UNIQUE INDEX IF NOT EXISTS classroom_schools_nces_id_uidx
  ON public.classroom_schools (nces_id)
  WHERE nces_id IS NOT NULL;

COMMENT ON COLUMN public.classroom_schools.nces_id IS
  'NCES school id (ncessch). Used to dedupe schools picked from the public directory.';
