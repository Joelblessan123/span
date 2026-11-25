-- SPAN library targeting: all members, selected schools, or selected classes.
-- Apply after classroom_span_library.sql.

-- ---------------------------------------------------------------------------
-- Audience on each material
-- ---------------------------------------------------------------------------
ALTER TABLE public.classroom_span_materials
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'all';

ALTER TABLE public.classroom_span_materials
  DROP CONSTRAINT IF EXISTS classroom_span_materials_audience_check;
ALTER TABLE public.classroom_span_materials
  ADD CONSTRAINT classroom_span_materials_audience_check
  CHECK (audience IN ('all', 'schools', 'classes'));

COMMENT ON COLUMN public.classroom_span_materials.audience IS
  'all = every teacher & student; schools = targets rows with school_id; classes = targets rows with class_id.';

-- ---------------------------------------------------------------------------
-- Targets (one row per school or class)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.classroom_span_material_targets (
  target_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES public.classroom_span_materials(material_id) ON DELETE CASCADE,
  school_id uuid REFERENCES public.classroom_schools(school_id) ON DELETE CASCADE,
  class_id uuid REFERENCES public.classroom_classes(class_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classroom_span_material_targets_one_kind CHECK (
    (school_id IS NOT NULL AND class_id IS NULL)
    OR (school_id IS NULL AND class_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS classroom_span_targets_material_school_uidx
  ON public.classroom_span_material_targets(material_id, school_id)
  WHERE school_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS classroom_span_targets_material_class_uidx
  ON public.classroom_span_material_targets(material_id, class_id)
  WHERE class_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Membership helpers (SECURITY DEFINER to avoid RLS recursion)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.classroom_member_school_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT t.school_id
  FROM public.classroom_teachers t
  WHERE t.teacher_id = public.current_classroom_teacher_id()
  UNION
  SELECT c.school_id
  FROM public.classroom_enrollments e
  INNER JOIN public.classroom_classes c ON c.class_id = e.class_id
  WHERE e.student_id = public.current_classroom_student_id();
$$;

CREATE OR REPLACE FUNCTION public.classroom_member_class_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT e.class_id
  FROM public.classroom_enrollments e
  WHERE e.student_id = public.current_classroom_student_id()
  UNION
  SELECT c.class_id
  FROM public.classroom_classes c
  WHERE c.teacher_id = public.current_classroom_teacher_id();
$$;

REVOKE ALL ON FUNCTION public.classroom_member_school_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_member_school_ids() TO authenticated;
REVOKE ALL ON FUNCTION public.classroom_member_class_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_member_class_ids() TO authenticated;

-- ---------------------------------------------------------------------------
-- Visibility: one material for the signed-in member
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.classroom_span_material_visible(p_material_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.classroom_span_materials m
    WHERE m.material_id = p_material_id
      AND m.active
      AND (
        public.current_classroom_student_id() IS NOT NULL
        OR public.current_classroom_teacher_id() IS NOT NULL
      )
      AND (
        m.audience = 'all'
        OR (
          m.audience = 'schools'
          AND EXISTS (
            SELECT 1
            FROM public.classroom_span_material_targets t
            WHERE t.material_id = m.material_id
              AND t.school_id IN (SELECT public.classroom_member_school_ids())
          )
        )
        OR (
          m.audience = 'classes'
          AND EXISTS (
            SELECT 1
            FROM public.classroom_span_material_targets t
            WHERE t.material_id = m.material_id
              AND t.class_id IN (SELECT public.classroom_member_class_ids())
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.classroom_span_material_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_span_material_visible(uuid) TO authenticated;

-- Storage: object path → material visibility (used for signed URLs).
CREATE OR REPLACE FUNCTION public.classroom_span_file_visible(p_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.classroom_span_materials m
    WHERE m.file_path = p_object_name
      AND public.classroom_span_material_visible(m.material_id)
  );
$$;

REVOKE ALL ON FUNCTION public.classroom_span_file_visible(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_span_file_visible(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "classroom_span_materials_member_select" ON public.classroom_span_materials;
CREATE POLICY "classroom_span_materials_member_select"
  ON public.classroom_span_materials FOR SELECT TO authenticated
  USING (public.classroom_span_material_visible(material_id));

ALTER TABLE public.classroom_span_material_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "classroom_span_targets_exec_all" ON public.classroom_span_material_targets;
CREATE POLICY "classroom_span_targets_exec_all"
  ON public.classroom_span_material_targets FOR ALL TO authenticated
  USING (public.is_span_exec()) WITH CHECK (public.is_span_exec());

DROP POLICY IF EXISTS "classroom_span_targets_member_select" ON public.classroom_span_material_targets;
CREATE POLICY "classroom_span_targets_member_select"
  ON public.classroom_span_material_targets FOR SELECT TO authenticated
  USING (public.classroom_span_material_visible(material_id));

DROP POLICY IF EXISTS "classroom_span_library_storage_member_select" ON storage.objects;
CREATE POLICY "classroom_span_library_storage_member_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'classroom-submissions'
  AND (storage.foldername(name))[1] = 'span-library'
  AND (
    public.is_span_exec()
    OR public.classroom_span_file_visible(name)
  )
);

COMMENT ON TABLE public.classroom_span_material_targets IS
  'Which schools or classes receive a SPAN library item when its audience is schools or classes.';
