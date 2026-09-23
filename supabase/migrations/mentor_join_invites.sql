-- Mentor self-join invites (exec-issued tokens) + contact fields on advisors.

ALTER TABLE public.advisors
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN public.advisors.email IS 'Personal email collected via mentor join invite (optional for exec-created mentors).';
COMMENT ON COLUMN public.advisors.phone IS 'Phone collected via mentor join invite (optional).';

-- Allow mentor Auth login_email to be either synthetic (@mentors.spanationwide.org) or a real address.
ALTER TABLE public.mentor_accounts
  DROP CONSTRAINT IF EXISTS mentor_accounts_login_email_domain;

ALTER TABLE public.mentor_accounts
  ADD CONSTRAINT mentor_accounts_login_email_format CHECK (
    login_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  );

CREATE TABLE IF NOT EXISTS public.mentor_invites (
  invite_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES public.members(member_id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  use_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mentor_invites_token ON public.mentor_invites(token);
CREATE INDEX IF NOT EXISTS idx_mentor_invites_expires ON public.mentor_invites(expires_at);

COMMENT ON TABLE public.mentor_invites IS
  'Exec-issued invite tokens for mentor-join.html. Validated only via Edge Functions (service role).';

ALTER TABLE public.mentor_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Executive directors can select mentor invites"
  ON public.mentor_invites
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid()
        AND (m.volunteer = true OR m.volunteer = 'true')
        AND (m.applications = true OR m.applications = 'true')
        AND (m.bills = true OR m.bills = 'true')
        AND (m.registration = true OR m.registration = 'true')
    )
  );

CREATE POLICY "Executive directors can insert mentor invites"
  ON public.mentor_invites
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid()
        AND (m.volunteer = true OR m.volunteer = 'true')
        AND (m.applications = true OR m.applications = 'true')
        AND (m.bills = true OR m.bills = 'true')
        AND (m.registration = true OR m.registration = 'true')
    )
  );

CREATE POLICY "Executive directors can update mentor invites"
  ON public.mentor_invites
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid()
        AND (m.volunteer = true OR m.volunteer = 'true')
        AND (m.applications = true OR m.applications = 'true')
        AND (m.bills = true OR m.bills = 'true')
        AND (m.registration = true OR m.registration = 'true')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid()
        AND (m.volunteer = true OR m.volunteer = 'true')
        AND (m.applications = true OR m.applications = 'true')
        AND (m.bills = true OR m.bills = 'true')
        AND (m.registration = true OR m.registration = 'true')
    )
  );

-- Login still works if advisor is inactive on the public board (invite flow starts active).
CREATE OR REPLACE FUNCTION public.get_mentor_session()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'mentor_account_id', ma.mentor_account_id,
    'advisor_id', a.advisor_id,
    'full_name', a.full_name,
    'title', a.title,
    'company', a.company,
    'photo', a.photo,
    'email', a.email,
    'phone', a.phone,
    'username', ma.username,
    'login_email', ma.login_email,
    'active', ma.active,
    'advisor_active', a.active
  )
  INTO result
  FROM public.mentor_accounts ma
  JOIN public.advisors a ON a.advisor_id = ma.advisor_id
  WHERE ma.user_id = auth.uid()
    AND ma.active = true
  LIMIT 1;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

-- Username → Auth email for Mentor login (invite accounts use a real email, not @mentors.spanationwide.org).
CREATE OR REPLACE FUNCTION public.resolve_mentor_auth_email(p_identifier text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ident text := lower(trim(coalesce(p_identifier, '')));
  result text;
BEGIN
  IF ident = '' THEN
    RETURN NULL;
  END IF;

  IF position('@' in ident) > 0 THEN
    SELECT ma.login_email INTO result
    FROM public.mentor_accounts ma
    WHERE lower(ma.login_email) = ident AND ma.active = true
    LIMIT 1;
  ELSE
    SELECT ma.login_email INTO result
    FROM public.mentor_accounts ma
    WHERE lower(ma.username) = ident AND ma.active = true
    LIMIT 1;
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_mentor_auth_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_mentor_auth_email(text) TO anon, authenticated;
