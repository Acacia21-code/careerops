-- Assert CHECKs + updated_at triggers after schema.sql (or full migration upgrade).
-- Expects DO blocks to RAISE on failure.

DO $$
BEGIN
  -- status CHECK
  BEGIN
    INSERT INTO public.mt_accomplishments (owner, body_original, body_current, status)
    VALUES ('00000000-0000-4000-8000-0000000000aa', 'x', 'x', 'bogus');
    RAISE EXCEPTION 'expected mt_accomplishments_status_chk to reject bogus status';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- body CHECK (empty)
  BEGIN
    INSERT INTO public.mt_accomplishments (owner, body_original, body_current, status)
    VALUES ('00000000-0000-4000-8000-0000000000aa', '  ', 'ok', 'inbox');
    RAISE EXCEPTION 'expected mt_accomplishments_body_chk to reject blank body_original';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- promotion consistency: promoted without fields
  BEGIN
    INSERT INTO public.mt_accomplishments (
      owner, body_original, body_current, status
    ) VALUES (
      '00000000-0000-4000-8000-0000000000aa', 'shipped', 'shipped', 'promoted'
    );
    RAISE EXCEPTION 'expected mt_accomplishments_promotion_chk to reject bare promoted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- cadence CHECK
  BEGIN
    UPDATE public.mt_profiles
    SET bullet_memory_cadence = 'weekly'
    WHERE owner = '00000000-0000-4000-8000-0000000000aa';
    RAISE EXCEPTION 'expected mt_profiles_cadence_chk to reject weekly';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- portfolio promotion all-or-nothing
  BEGIN
    INSERT INTO public.mt_portfolio_items (
      owner, title, item_type, visibility, summary, body_current, promoted_project_id
    ) VALUES (
      '00000000-0000-4000-8000-0000000000aa',
      'CLI', 'code', 'private', 'Built CLI', 'Built CLI', 'p1'
    );
    RAISE EXCEPTION 'expected mt_portfolio_promotion_chk to reject partial promotion';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END $$;

-- body_original immutable trigger
DO $$
DECLARE
  aid uuid;
BEGIN
  INSERT INTO public.mt_accomplishments (owner, body_original, body_current, status)
  VALUES ('00000000-0000-4000-8000-0000000000aa', 'original fact', 'original fact', 'inbox')
  RETURNING id INTO aid;

  BEGIN
    UPDATE public.mt_accomplishments SET body_original = 'mutated' WHERE id = aid;
    RAISE EXCEPTION 'expected body_original immutability trigger';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT ILIKE '%immutable%' THEN
        RAISE;
      END IF;
  END;

  DELETE FROM public.mt_accomplishments WHERE id = aid;
END $$;

-- updated_at touch on profiles / roles / contacts.
-- now() is transaction-stable, so seed an old timestamp then UPDATE another column
-- and assert the BEFORE UPDATE trigger rewrites updated_at.
DO $$
DECLARE
  after_ts timestamptz;
  rid uuid;
  cid uuid;
  old_ts timestamptz := '2000-01-01T00:00:00Z';
BEGIN
  UPDATE public.mt_profiles
  SET updated_at = old_ts
  WHERE owner = '00000000-0000-4000-8000-0000000000aa';

  UPDATE public.mt_profiles
  SET full_name = COALESCE(full_name, '') || ' '
  WHERE owner = '00000000-0000-4000-8000-0000000000aa';

  SELECT updated_at INTO after_ts
  FROM public.mt_profiles
  WHERE owner = '00000000-0000-4000-8000-0000000000aa';

  IF after_ts <= old_ts THEN
    RAISE EXCEPTION 'mt_profiles updated_at trigger did not advance';
  END IF;

  INSERT INTO public.mt_roles (owner, company, title, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000000aa', 'Acme', 'Eng', old_ts)
  RETURNING id INTO rid;

  UPDATE public.mt_roles SET updated_at = old_ts WHERE id = rid;
  UPDATE public.mt_roles SET title = 'Senior Eng' WHERE id = rid;
  SELECT updated_at INTO after_ts FROM public.mt_roles WHERE id = rid;
  IF after_ts <= old_ts THEN
    RAISE EXCEPTION 'mt_roles updated_at trigger did not advance';
  END IF;

  INSERT INTO public.mt_contacts (owner, name, channel, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000000aa', 'Pat Recruiter', 'email', old_ts)
  RETURNING id INTO cid;

  UPDATE public.mt_contacts SET updated_at = old_ts WHERE id = cid;
  UPDATE public.mt_contacts SET notes = 'touched' WHERE id = cid;
  SELECT updated_at INTO after_ts FROM public.mt_contacts WHERE id = cid;
  IF after_ts <= old_ts THEN
    RAISE EXCEPTION 'mt_contacts updated_at trigger did not advance';
  END IF;

  DELETE FROM public.mt_contacts WHERE id = cid;
  DELETE FROM public.mt_roles WHERE id = rid;
END $$;

SELECT 'checks_triggers_ok' AS result;
