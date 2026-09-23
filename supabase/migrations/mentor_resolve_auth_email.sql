-- Map mentor username (or email) to the Auth email used at sign-in.
-- Invite signups store the real email as login_email; the login form also accepts the username.

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
    SELECT ma.login_email
    INTO result
    FROM public.mentor_accounts ma
    WHERE lower(ma.login_email) = ident
      AND ma.active = true
    LIMIT 1;
  ELSE
    SELECT ma.login_email
    INTO result
    FROM public.mentor_accounts ma
    WHERE lower(ma.username) = ident
      AND ma.active = true
    LIMIT 1;
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_mentor_auth_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_mentor_auth_email(text) TO anon, authenticated;

COMMENT ON FUNCTION public.resolve_mentor_auth_email(text) IS
  'Returns mentor_accounts.login_email for a username or email so Mentor login can sign in.';
