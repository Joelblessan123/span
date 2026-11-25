-- SPAN library: exec-curated materials visible to every Classroom teacher and student.
-- Separate from per-assignment teacher materials (classroom_assignment_materials).
-- Apply after create_classroom_tables.sql (+ fix_classroom_rls_recursion.sql).

CREATE TABLE IF NOT EXISTS public.classroom_span_materials (
  material_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  file_path text,
  file_name text,
  link_url text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classroom_span_materials_has_content
    CHECK (file_path IS NOT NULL OR link_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_classroom_span_materials_active
  ON public.classroom_span_materials(active, created_at DESC);

ALTER TABLE public.classroom_span_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "classroom_span_materials_exec_all" ON public.classroom_span_materials;
CREATE POLICY "classroom_span_materials_exec_all"
  ON public.classroom_span_materials FOR ALL TO authenticated
  USING (public.is_span_exec()) WITH CHECK (public.is_span_exec());

DROP POLICY IF EXISTS "classroom_span_materials_member_select" ON public.classroom_span_materials;
CREATE POLICY "classroom_span_materials_member_select"
  ON public.classroom_span_materials FOR SELECT TO authenticated
  USING (
    active
    AND (
      public.current_classroom_student_id() IS NOT NULL
      OR public.current_classroom_teacher_id() IS NOT NULL
    )
  );

-- Storage: files live under classroom-submissions/span-library/{material_id}/…
DROP POLICY IF EXISTS "classroom_span_library_storage_member_select" ON storage.objects;
CREATE POLICY "classroom_span_library_storage_member_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'classroom-submissions'
  AND (storage.foldername(name))[1] = 'span-library'
  AND (
    public.is_span_exec()
    OR public.current_classroom_student_id() IS NOT NULL
    OR public.current_classroom_teacher_id() IS NOT NULL
  )
);

DROP POLICY IF EXISTS "classroom_span_library_storage_exec_insert" ON storage.objects;
CREATE POLICY "classroom_span_library_storage_exec_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'classroom-submissions'
  AND (storage.foldername(name))[1] = 'span-library'
  AND public.is_span_exec()
);

DROP POLICY IF EXISTS "classroom_span_library_storage_exec_delete" ON storage.objects;
CREATE POLICY "classroom_span_library_storage_exec_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'classroom-submissions'
  AND (storage.foldername(name))[1] = 'span-library'
  AND public.is_span_exec()
);

-- Exec "View as" teacher: execs manage assignment context files (…/_materials/…) and read any class file.
DROP POLICY IF EXISTS "classroom_submissions_storage_exec_all" ON storage.objects;
CREATE POLICY "classroom_submissions_storage_exec_all"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'classroom-submissions' AND public.is_span_exec())
WITH CHECK (bucket_id = 'classroom-submissions' AND public.is_span_exec());

COMMENT ON TABLE public.classroom_span_materials IS
  'SPAN-curated Classroom materials (exec-managed). Visible to all Classroom teachers and students.';
