-- Promote RPC atomicity: wrong p_expected_rev → SQLSTATE 40001 / resume_struct_rev_conflict,
-- and no partial writes to profile or accomplishment.

DO $$
DECLARE
  user_a uuid := '00000000-0000-4000-8000-0000000000aa';
  aid uuid;
  rev_before int;
  status_before text;
  snap_before text;
  err_code text;
  err_msg text;
  result jsonb;
BEGIN
  UPDATE public.mt_profiles SET
    resume_struct = jsonb_build_object(
      'roles', jsonb_build_array(
        jsonb_build_object(
          'id', 'r1',
          'header', 'Eng at Acme',
          'sub', '2020–2024',
          'bullets', jsonb_build_array(
            jsonb_build_object('id', 'b0', 'text', 'Old bullet')
          )
        )
      ),
      'projects', '[]'::jsonb,
      'skills', '[]'::jsonb,
      'education', '[]'::jsonb,
      'certs', '[]'::jsonb
    ),
    resume_text = E'Jane\n\nEXPERIENCE\nEng at Acme\n- Old bullet\n',
    resume_struct_rev = 3,
    resume_reconcile_needed = false
  WHERE owner = user_a;

  INSERT INTO public.mt_accomplishments (
    owner, body_original, body_current, status, role_id
  ) VALUES (
    user_a, 'Shipped X — 10%', 'Shipped X — 10%', 'ready', 'r1'
  ) RETURNING id INTO aid;

  SELECT resume_struct_rev INTO rev_before FROM public.mt_profiles WHERE owner = user_a;
  SELECT status, promotion_snapshot INTO status_before, snap_before
  FROM public.mt_accomplishments WHERE id = aid;

  -- Authenticated JWT for SECURITY DEFINER auth.uid()
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);

  BEGIN
    SELECT public.promote_accomplishment(aid, 0, 'r1') INTO result;
    RAISE EXCEPTION 'expected resume_struct_rev_conflict, got success %', result;
  EXCEPTION
    WHEN serialization_failure OR SQLSTATE '40001' THEN
      err_code := SQLSTATE;
      err_msg := SQLERRM;
    WHEN OTHERS THEN
      err_code := SQLSTATE;
      err_msg := SQLERRM;
      IF err_msg NOT ILIKE '%resume_struct_rev_conflict%' THEN
        RAISE;
      END IF;
  END;

  IF err_msg NOT ILIKE '%resume_struct_rev_conflict%' THEN
    RAISE EXCEPTION 'unexpected error: [%] %', err_code, err_msg;
  END IF;
  IF err_code IS DISTINCT FROM '40001' AND err_msg NOT ILIKE '%resume_struct_rev_conflict%' THEN
    RAISE EXCEPTION 'expected SQLSTATE 40001, got % (%)', err_code, err_msg;
  END IF;

  -- Entire txn rolled back: rev + accomplishment unchanged
  IF (SELECT resume_struct_rev FROM public.mt_profiles WHERE owner = user_a) IS DISTINCT FROM rev_before THEN
    RAISE EXCEPTION 'rev changed after conflict';
  END IF;
  IF (SELECT status FROM public.mt_accomplishments WHERE id = aid) IS DISTINCT FROM status_before THEN
    RAISE EXCEPTION 'accomplishment status changed after conflict';
  END IF;
  IF (SELECT promotion_snapshot FROM public.mt_accomplishments WHERE id = aid) IS DISTINCT FROM snap_before THEN
    RAISE EXCEPTION 'promotion_snapshot set after conflict';
  END IF;
  IF (SELECT resume_text FROM public.mt_profiles WHERE owner = user_a) ILIKE '%Shipped X%' THEN
    RAISE EXCEPTION 'resume_text partially updated after conflict';
  END IF;

  -- Happy path with correct rev still works
  SELECT public.promote_accomplishment(aid, rev_before, 'r1') INTO result;
  IF (result->>'resume_struct_rev')::int IS DISTINCT FROM (rev_before + 1) THEN
    RAISE EXCEPTION 'promote did not bump rev: %', result;
  END IF;
  IF (SELECT status FROM public.mt_accomplishments WHERE id = aid) IS DISTINCT FROM 'promoted' THEN
    RAISE EXCEPTION 'promote did not mark accomplishment promoted';
  END IF;
  IF COALESCE(result->'resume_struct'->'roles'->0->'bullets'->-1->>'source_id', '') = '' THEN
    -- jsonb negative index may not work on all versions; check via SQL
    NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.mt_profiles p,
         jsonb_array_elements(p.resume_struct->'roles') r,
         jsonb_array_elements(r->'bullets') b
    WHERE p.owner = user_a
      AND b->>'source_id' = aid::text
  ) THEN
    RAISE EXCEPTION 'promoted bullet missing source_id';
  END IF;
END $$;

SELECT 'promote_atomicity_ok' AS result;
