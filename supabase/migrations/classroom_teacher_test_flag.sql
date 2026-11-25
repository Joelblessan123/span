-- Test teacher accounts: keep the login and classes working, but hide from exec lists by default.
-- Mark a teacher as test with (use the teacher_id from the dashboard or a SELECT on classroom_teachers):
--   UPDATE public.classroom_teachers SET is_test = true WHERE teacher_id = '<uuid>';
-- Unmark with is_test = false.

ALTER TABLE public.classroom_teachers
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.classroom_teachers.is_test IS
  'When true, hidden from exec teacher lists, class pickers, and View-as lists unless exec turns on "Show test accounts". Login and data still work.';
