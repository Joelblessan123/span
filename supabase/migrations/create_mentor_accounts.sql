-- Mentor dashboard logins linked to Board of Mentors (advisors).
-- Synthetic Auth email: {username}@mentors.spanationwide.org (no real inbox / no Cloudflare).
-- Mentors are NOT members — they stay off the public directory membership list.

CREATE TABLE IF NOT EXISTS public.mentor_accounts (
  mentor_account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id UUID NOT NULL UNIQUE REFERENCES public.advisors(advisor_id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  login_email TEXT NOT NULL UNIQUE,
  user_id UUID UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provisioned_by UUID REFERENCES public.members(member_id) ON DELETE SET NULL,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mentor_accounts_username_format CHECK (
    username ~ '^[a-z0-9]+([.][a-z0-9]+)*$'
    AND char_length(username) BETWEEN 3 AND 64
  ),
  CONSTRAINT mentor_accounts_login_email_domain CHECK (
    login_email = (username || '@mentors.spanationwide.org')
  )
);

CREATE INDEX IF NOT EXISTS idx_mentor_accounts_user_id ON public.mentor_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_mentor_accounts_active ON public.mentor_accounts(active);

COMMENT ON TABLE public.mentor_accounts IS
  'Auth link for Board of Mentors advisors. Login via username → {username}@mentors.spanationwide.org.';

CREATE OR REPLACE FUNCTION public.update_mentor_accounts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_mentor_accounts_updated_at ON public.mentor_accounts;
CREATE TRIGGER update_mentor_accounts_updated_at
  BEFORE UPDATE ON public.mentor_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_mentor_accounts_updated_at();

ALTER TABLE public.mentor_accounts ENABLE ROW LEVEL SECURITY;

-- Execs (registration flag) can list/manage mentor account rows from the dashboard.
CREATE POLICY "Executive directors can select mentor accounts"
  ON public.mentor_accounts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid()
        AND (m.registration = true OR m.registration = 'true')
    )
  );

-- Mentors can read their own account row (username display, etc.).
CREATE POLICY "Mentors can select own mentor account"
  ON public.mentor_accounts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND active = true);

-- Inserts/updates/deletes go through the mentors-provision edge function (service role).

-- Expand bills access helper so mentor Auth users pass existing bills RLS / RPCs.
CREATE OR REPLACE FUNCTION public.has_bills_permission()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_permission BOOLEAN;
BEGIN
  SELECT (bills = true OR bills = 'true')
  INTO v_has_permission
  FROM public.members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF COALESCE(v_has_permission, false) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.mentor_accounts ma
    WHERE ma.user_id = auth.uid()
      AND ma.active = true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.has_bills_permission() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_bills_permission() TO authenticated;

-- Align bill write policies with the helper (members.bills OR active mentor).
DROP POLICY IF EXISTS "Members with bills permission can insert bills" ON public.bills;
CREATE POLICY "Members with bills permission can insert bills"
  ON public.bills
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_bills_permission());

DROP POLICY IF EXISTS "Members with bills permission can update bills" ON public.bills;
CREATE POLICY "Members with bills permission can update bills"
  ON public.bills
  FOR UPDATE
  TO authenticated
  USING (public.has_bills_permission())
  WITH CHECK (public.has_bills_permission());

DROP POLICY IF EXISTS "Members with bills permission can delete bills" ON public.bills;
CREATE POLICY "Members with bills permission can delete bills"
  ON public.bills
  FOR DELETE
  TO authenticated
  USING (public.has_bills_permission());

-- SELECT was still members.bills-only; mentors need it for loadAllBills + insert…returning.
DROP POLICY IF EXISTS "Members with bills permission can select bills" ON public.bills;
CREATE POLICY "Members with bills permission can select bills"
  ON public.bills
  FOR SELECT
  TO authenticated
  USING (public.has_bills_permission());

DROP POLICY IF EXISTS "bill_outreach_targets_bill_team_all" ON public.bill_outreach_targets;
CREATE POLICY "bill_outreach_targets_bill_team_all"
  ON public.bill_outreach_targets
  FOR ALL
  TO authenticated
  USING (public.has_bills_permission())
  WITH CHECK (public.has_bills_permission());

COMMENT ON POLICY "bill_outreach_targets_bill_team_all" ON public.bill_outreach_targets IS
  'Bills team (members.bills), active mentors, and execs can read/write outreach targets.';

-- Research RPC: reuse helper (includes mentors). Keep OUT columns in sync with bills_proposal_pdf_url.sql.
DROP FUNCTION IF EXISTS public.get_bills_research();

CREATE OR REPLACE FUNCTION public.get_bills_research()
RETURNS TABLE (
  bill_id integer,
  state text,
  name text,
  "position" text,
  description text,
  bill_date date,
  legiscan_link text,
  google_doc_link text,
  bill_collaborators jsonb,
  status text,
  hidden boolean,
  submitted_by uuid,
  submitted_at timestamptz,
  proposal_pdf_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_bills_permission() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.bill_id,
    b.state,
    b.name,
    b.position,
    b.description,
    b.bill_date,
    b.legiscan_link,
    b.google_doc_link,
    b.bill_collaborators,
    b.status,
    COALESCE(b.hidden, false),
    b.submitted_by,
    b.submitted_at,
    b.proposal_pdf_url
  FROM public.bills b
  WHERE b.status IS DISTINCT FROM 'outreach_only'
  ORDER BY b.submitted_at DESC NULLS LAST, b.bill_date DESC NULLS LAST, b.bill_id DESC;
END;
$$;

COMMENT ON FUNCTION public.get_bills_research() IS
  'Returns non-internal bill fields for dashboard Research tab (excludes outreach_only stubs); requires members.bills or an active mentor account.';

REVOKE ALL ON FUNCTION public.get_bills_research() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bills_research() TO authenticated;

-- Session payload for mentor dashboard (SECURITY DEFINER — no broad advisors SELECT needed).
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
    'username', ma.username,
    'login_email', ma.login_email,
    'active', ma.active
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

REVOKE ALL ON FUNCTION public.get_mentor_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mentor_session() TO authenticated;

COMMENT ON FUNCTION public.get_mentor_session() IS
  'Returns mentor profile + username for the signed-in Auth user, or {} if not a mentor.';

-- Proposal PDF storage: allow mentors via the same helper.
DROP POLICY IF EXISTS "Members with bills permission can select proposals" ON storage.objects;
CREATE POLICY "Members with bills permission can select proposals"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'proposals' AND public.has_bills_permission());

DROP POLICY IF EXISTS "Members with bills permission can upload proposals" ON storage.objects;
CREATE POLICY "Members with bills permission can upload proposals"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'proposals' AND public.has_bills_permission());

DROP POLICY IF EXISTS "Members with bills permission can update proposals" ON storage.objects;
CREATE POLICY "Members with bills permission can update proposals"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'proposals' AND public.has_bills_permission())
  WITH CHECK (bucket_id = 'proposals' AND public.has_bills_permission());
