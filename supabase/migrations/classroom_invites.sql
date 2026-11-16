-- Classroom school/teacher self-join invites (exec-issued tokens), mirrored after mentor_invites.

CREATE TABLE IF NOT EXISTS public.classroom_invites (
  invite_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('school_and_teacher', 'teacher')),
  school_id uuid REFERENCES public.classroom_schools(school_id) ON DELETE CASCADE,
  label text,
  created_by uuid REFERENCES public.members(member_id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_classroom_invites_token ON public.classroom_invites(token);
CREATE INDEX IF NOT EXISTS idx_classroom_invites_expires ON public.classroom_invites(expires_at);
CREATE INDEX IF NOT EXISTS idx_classroom_invites_active
  ON public.classroom_invites(expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.classroom_invites IS
  'Exec-issued invite tokens for classroom/invite.html. Validated only via Edge Functions (service role).';
COMMENT ON COLUMN public.classroom_invites.kind IS
  'teacher: join an existing classroom school via dropdown on invite form. school_and_teacher is legacy/unused.';
COMMENT ON COLUMN public.classroom_invites.school_id IS
  'Optional pin. Null = open invite (recipient picks school from dropdown). Non-null = locked to that school.';

ALTER TABLE public.classroom_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "classroom_invites_exec_select"
  ON public.classroom_invites
  FOR SELECT
  TO authenticated
  USING (public.is_span_exec());

CREATE POLICY "classroom_invites_exec_insert"
  ON public.classroom_invites
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_span_exec());

CREATE POLICY "classroom_invites_exec_update"
  ON public.classroom_invites
  FOR UPDATE
  TO authenticated
  USING (public.is_span_exec())
  WITH CHECK (public.is_span_exec());
