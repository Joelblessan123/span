-- Fix: invalid input syntax for type uuid: "span-library"
--
-- Several classroom-submissions storage policies cast the first path folder to uuid:
--   ((storage.foldername(name))[1])::uuid
-- Postgres does not guarantee AND/OR evaluation order, so those casts can run on
-- non-class folders such as span-library/… and raise an error.
--
-- This migration swaps in a helper that returns NULL when the folder isn't a uuid,
-- and recreates the affected policies to use it. Apply after classroom_span_library_targets.sql.

CREATE OR REPLACE FUNCTION public.classroom_storage_class_id(p_object_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_class_id uuid;
BEGIN
  BEGIN
    v_class_id := ((storage.foldername(p_object_name))[1])::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_class_id := NULL;
  END;
  RETURN v_class_id;
END;
$$;

REVOKE ALL ON FUNCTION public.classroom_storage_class_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_storage_class_id(text) TO authenticated;

-- Student: read own submission files; read class materials for enrolled classes.
DROP POLICY IF EXISTS "classroom_submissions_storage_student_select" ON storage.objects;
CREATE POLICY "classroom_submissions_storage_student_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'classroom-submissions'
  AND (
    (storage.foldername(name))[3] = public.current_classroom_student_id()::text
    OR (
      (storage.foldername(name))[3] = '_materials'
      AND public.classroom_student_enrolled_in_class(public.classroom_storage_class_id(name))
    )
  )
);

-- Student: upload own submission into an enrolled class.
DROP POLICY IF EXISTS "classroom_submissions_storage_student_insert" ON storage.objects;
CREATE POLICY "classroom_submissions_storage_student_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'classroom-submissions'
  AND (storage.foldername(name))[3] = public.current_classroom_student_id()::text
  AND public.classroom_student_enrolled_in_class(public.classroom_storage_class_id(name))
);

-- Teacher: read every file in their classes.
DROP POLICY IF EXISTS "classroom_submissions_storage_teacher_select" ON storage.objects;
CREATE POLICY "classroom_submissions_storage_teacher_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'classroom-submissions'
  AND public.classroom_teacher_owns_class(public.classroom_storage_class_id(name))
);

-- Teacher: manage assignment context files under …/_materials/…
DROP POLICY IF EXISTS "classroom_submissions_storage_teacher_write_materials" ON storage.objects;
CREATE POLICY "classroom_submissions_storage_teacher_write_materials"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'classroom-submissions'
  AND (storage.foldername(name))[3] = '_materials'
  AND public.classroom_teacher_owns_class(public.classroom_storage_class_id(name))
);

DROP POLICY IF EXISTS "classroom_submissions_storage_teacher_update_materials" ON storage.objects;
CREATE POLICY "classroom_submissions_storage_teacher_update_materials"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'classroom-submissions'
  AND (storage.foldername(name))[3] = '_materials'
  AND public.classroom_teacher_owns_class(public.classroom_storage_class_id(name))
)
WITH CHECK (
  bucket_id = 'classroom-submissions'
  AND (storage.foldername(name))[3] = '_materials'
  AND public.classroom_teacher_owns_class(public.classroom_storage_class_id(name))
);

DROP POLICY IF EXISTS "classroom_submissions_storage_teacher_delete_materials" ON storage.objects;
CREATE POLICY "classroom_submissions_storage_teacher_delete_materials"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'classroom-submissions'
  AND (storage.foldername(name))[3] = '_materials'
  AND public.classroom_teacher_owns_class(public.classroom_storage_class_id(name))
);
