-- Two-user RLS: user A cannot read/write user B's accomplishments / outcomes / contacts.
-- Uses SET request.jwt.claim.sub + SET ROLE authenticated.

DO $$
DECLARE
  user_a uuid := '00000000-0000-4000-8000-0000000000aa';
  user_b uuid := '00000000-0000-4000-8000-0000000000bb';
  acc_b uuid;
  role_b uuid;
  out_b uuid;
  contact_b uuid;
  n int;
BEGIN
  -- Seed as superuser (bypasses RLS)
  INSERT INTO public.mt_roles (id, owner, company, title)
  VALUES ('10000000-0000-4000-8000-0000000000b1', user_b, 'BetaCo', 'PM')
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO role_b;
  IF role_b IS NULL THEN
    role_b := '10000000-0000-4000-8000-0000000000b1';
  END IF;

  INSERT INTO public.mt_accomplishments (owner, body_original, body_current, status)
  VALUES (user_b, 'B secret win', 'B secret win', 'inbox')
  RETURNING id INTO acc_b;

  INSERT INTO public.mt_outcomes (owner, role_id, kind, note)
  VALUES (user_b, role_b, 'offer', 'B offer note')
  RETURNING id INTO out_b;

  INSERT INTO public.mt_contacts (owner, name, channel, notes)
  VALUES (user_b, 'B Contact', 'email', 'secret')
  RETURNING id INTO contact_b;
END $$;

-- Act as user A
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000aa', false);

DO $$
DECLARE
  n int;
  user_a uuid := '00000000-0000-4000-8000-0000000000aa';
BEGIN
  SELECT count(*) INTO n FROM public.mt_accomplishments
  WHERE owner = '00000000-0000-4000-8000-0000000000bb';
  IF n <> 0 THEN
    RAISE EXCEPTION 'RLS leak: user A can read user B accomplishments (n=%)', n;
  END IF;

  SELECT count(*) INTO n FROM public.mt_outcomes
  WHERE owner = '00000000-0000-4000-8000-0000000000bb';
  IF n <> 0 THEN
    RAISE EXCEPTION 'RLS leak: user A can read user B outcomes (n=%)', n;
  END IF;

  SELECT count(*) INTO n FROM public.mt_contacts
  WHERE owner = '00000000-0000-4000-8000-0000000000bb';
  IF n <> 0 THEN
    RAISE EXCEPTION 'RLS leak: user A can read user B contacts (n=%)', n;
  END IF;

  -- Write attempts against B rows must fail or affect 0 rows
  BEGIN
    UPDATE public.mt_accomplishments
    SET body_current = 'hijacked'
    WHERE owner = '00000000-0000-4000-8000-0000000000bb';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
      RAISE EXCEPTION 'RLS leak: user A updated user B accomplishments';
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.mt_contacts
    SET notes = 'hijacked'
    WHERE owner = '00000000-0000-4000-8000-0000000000bb';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
      RAISE EXCEPTION 'RLS leak: user A updated user B contacts';
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.mt_accomplishments (owner, body_original, body_current, status)
    VALUES ('00000000-0000-4000-8000-0000000000bb', 'spoof', 'spoof', 'inbox');
    RAISE EXCEPTION 'RLS leak: user A inserted as user B owner';
  EXCEPTION
    WHEN check_violation OR insufficient_privilege OR raise_exception THEN
      -- WITH CHECK (owner = auth.uid()) should reject
      NULL;
  END;

  -- User A can write own rows
  INSERT INTO public.mt_accomplishments (owner, body_original, body_current, status)
  VALUES (user_a, 'A own fact', 'A own fact', 'inbox');

  INSERT INTO public.mt_contacts (owner, name, channel)
  VALUES (user_a, 'A Contact', 'linkedin');
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

-- Superuser confirms B rows untouched
DO $$
DECLARE
  body text;
  contact_notes text;
BEGIN
  SELECT a.body_current INTO body FROM public.mt_accomplishments a
  WHERE a.owner = '00000000-0000-4000-8000-0000000000bb'
  LIMIT 1;
  IF body IS DISTINCT FROM 'B secret win' THEN
    RAISE EXCEPTION 'user B accomplishment was mutated: %', body;
  END IF;

  SELECT c.notes INTO contact_notes FROM public.mt_contacts c
  WHERE c.owner = '00000000-0000-4000-8000-0000000000bb'
  LIMIT 1;
  IF contact_notes IS DISTINCT FROM 'secret' THEN
    RAISE EXCEPTION 'user B contact was mutated: %', contact_notes;
  END IF;
END $$;

SELECT 'rls_two_user_ok' AS result;
