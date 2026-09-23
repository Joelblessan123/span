-- Allow mentor dashboard login even if the advisor is inactive on the public Board of Mentors.
-- (Inactive only hides them from the public Leadership tab; provisioned logins should still work.)

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

COMMENT ON FUNCTION public.get_mentor_session() IS
  'Returns mentor profile + username for the signed-in Auth user (advisor may be inactive on the public board), or {} if not a mentor.';
