-- Allow open teacher invites (school chosen from dropdown on the public form).
-- school_id null = teacher picks an active classroom_schools row; non-null = pinned.

ALTER TABLE public.classroom_invites
  DROP CONSTRAINT IF EXISTS classroom_invites_teacher_needs_school;

COMMENT ON COLUMN public.classroom_invites.school_id IS
  'Optional pin. Null = open invite; recipient selects an active school from a dropdown. Non-null = locked to that school.';

COMMENT ON COLUMN public.classroom_invites.kind IS
  'teacher: join an existing classroom school (dropdown on invite form). school_and_teacher is legacy/unused.';
