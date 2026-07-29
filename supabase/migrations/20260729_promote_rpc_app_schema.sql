-- Track A2: transactional promote RPCs (production app.* + public.mt_* views).
-- Optimistic concurrency via resume_struct_rev. Server-side JSON mutation + resume_text sync.
-- Prod board role IDs are bigint; resume_struct role keys remain TEXT.
--
-- Track A3 will add Docker Postgres integration tests for rev-conflict txn failure.

-- ---------------------------------------------------------------------------
-- Helpers (stable role key mirrors web/lib/resume-sync.mjs stableRoleKey)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mt_stable_role_key(p_role jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  h text;
  hash bigint := 0;
  i int;
  code int;
  unsigned bigint;
BEGIN
  IF p_role ? 'id' AND nullif(trim(p_role->>'id'), '') IS NOT NULL THEN
    RETURN p_role->>'id';
  END IF;
  h := lower(trim(regexp_replace(COALESCE(p_role->>'header', ''), '\s+', ' ', 'g')));
  FOR i IN 1..char_length(h) LOOP
    code := ascii(substr(h, i, 1));
    hash := ((hash << 5) - hash + code);
    -- emulate JS signed 32-bit wrap
    hash := ((hash + 2147483648) % 4294967296) - 2147483648;
  END LOOP;
  unsigned := CASE WHEN hash < 0 THEN hash + 4294967296 ELSE hash END;
  RETURN 'role_' || to_hex(unsigned);
END;
$$;

CREATE OR REPLACE FUNCTION public.mt_jsonb_set_array_elem(
  p_arr jsonb,
  p_idx int,
  p_elem jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(CASE WHEN (ord - 1) = p_idx THEN p_elem ELSE elem END ORDER BY ord)
      FROM jsonb_array_elements(COALESCE(p_arr, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
    ),
    '[]'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION public.mt_render_resume_text_from_struct(
  p_struct jsonb,
  p_prior_text text DEFAULT ''
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  lines text[] := ARRAY[]::text[];
  prior text := COALESCE(p_prior_text, '');
  head_lines text[] := ARRAY[]::text[];
  raw_lines text[];
  l text;
  heads_re text := '^(professional\s+summary|summary|experience|skills|education|projects|certifications)';
  role jsonb;
  bullet jsonb;
  project jsonb;
  bt text;
  other_summary text := '';
  other_skills text := '';
  other_education text := '';
  cur text := NULL;
  buf text[] := ARRAY[]::text[];
  key text;
BEGIN
  raw_lines := string_to_array(replace(prior, E'\r\n', E'\n'), E'\n');
  FOREACH l IN ARRAY COALESCE(raw_lines, ARRAY[]::text[]) LOOP
    IF trim(l) ~* heads_re THEN
      EXIT;
    END IF;
    head_lines := array_append(head_lines, l);
  END LOOP;
  IF array_length(head_lines, 1) IS NOT NULL AND trim(array_to_string(head_lines, E'\n')) <> '' THEN
    lines := lines || ARRAY[trim(array_to_string(head_lines, E'\n')), ''];
  END IF;

  cur := NULL;
  buf := ARRAY[]::text[];
  FOREACH l IN ARRAY COALESCE(raw_lines, ARRAY[]::text[]) LOOP
    IF trim(l) ~* '^(professional\s+summary|summary|profile|experience|skills|education|projects|certifications)\s*:?\s*$' THEN
      IF cur = 'summary' THEN other_summary := trim(array_to_string(buf, E'\n'));
      ELSIF cur = 'skills' THEN other_skills := trim(array_to_string(buf, E'\n'));
      ELSIF cur = 'education' THEN other_education := trim(array_to_string(buf, E'\n'));
      END IF;
      key := lower(trim(l));
      IF key ~ 'summary|profile' THEN cur := 'summary';
      ELSIF key ~ 'skills' THEN cur := 'skills';
      ELSIF key ~ 'education' THEN cur := 'education';
      ELSE cur := NULL;
      END IF;
      buf := ARRAY[]::text[];
      CONTINUE;
    END IF;
    IF cur IS NOT NULL THEN
      buf := array_append(buf, l);
    END IF;
  END LOOP;
  IF cur = 'summary' THEN other_summary := trim(array_to_string(buf, E'\n'));
  ELSIF cur = 'skills' THEN other_skills := trim(array_to_string(buf, E'\n'));
  ELSIF cur = 'education' THEN other_education := trim(array_to_string(buf, E'\n'));
  END IF;

  IF nullif(trim(COALESCE(p_struct->>'summary', '')), '') IS NOT NULL THEN
    lines := lines || ARRAY['PROFESSIONAL SUMMARY', p_struct->>'summary', ''];
  ELSIF other_summary <> '' THEN
    lines := lines || ARRAY['PROFESSIONAL SUMMARY', other_summary, ''];
  END IF;

  lines := array_append(lines, 'EXPERIENCE');
  FOR role IN SELECT * FROM jsonb_array_elements(COALESCE(p_struct->'roles', '[]'::jsonb))
  LOOP
    lines := array_append(lines, COALESCE(role->>'header', '') ||
      CASE WHEN nullif(role->>'sub', '') IS NOT NULL THEN E'\n' || (role->>'sub') ELSE '' END);
    FOR bullet IN SELECT * FROM jsonb_array_elements(COALESCE(role->'bullets', '[]'::jsonb))
    LOOP
      bt := CASE
        WHEN jsonb_typeof(bullet) = 'string' THEN bullet #>> '{}'
        ELSE COALESCE(bullet->>'text', '')
      END;
      lines := array_append(lines, '- ' || bt);
    END LOOP;
    lines := array_append(lines, '');
  END LOOP;

  IF jsonb_array_length(COALESCE(p_struct->'projects', '[]'::jsonb)) > 0 THEN
    lines := array_append(lines, 'PROJECTS');
    FOR project IN SELECT * FROM jsonb_array_elements(p_struct->'projects')
    LOOP
      lines := array_append(lines, COALESCE(nullif(project->>'header', ''), nullif(project->>'title', ''), 'Project'));
      IF nullif(COALESCE(project->>'sub', project->>'url'), '') IS NOT NULL THEN
        lines := array_append(lines, COALESCE(project->>'sub', project->>'url'));
      END IF;
      FOR bullet IN SELECT * FROM jsonb_array_elements(COALESCE(project->'bullets', '[]'::jsonb))
      LOOP
        bt := CASE
          WHEN jsonb_typeof(bullet) = 'string' THEN bullet #>> '{}'
          ELSE COALESCE(bullet->>'text', '')
        END;
        lines := array_append(lines, '- ' || bt);
      END LOOP;
      lines := array_append(lines, '');
    END LOOP;
  END IF;

  IF jsonb_array_length(COALESCE(p_struct->'skills', '[]'::jsonb)) > 0 THEN
    lines := array_append(lines, 'SKILLS');
    FOR bullet IN SELECT * FROM jsonb_array_elements(p_struct->'skills')
    LOOP
      bt := CASE WHEN jsonb_typeof(bullet) = 'string' THEN bullet #>> '{}' ELSE COALESCE(bullet->>'text', '') END;
      lines := array_append(lines, '- ' || bt);
    END LOOP;
    lines := array_append(lines, '');
  ELSIF other_skills <> '' THEN
    lines := lines || ARRAY['SKILLS', other_skills, ''];
  END IF;

  IF jsonb_array_length(COALESCE(p_struct->'education', '[]'::jsonb)) > 0 THEN
    lines := array_append(lines, 'EDUCATION');
    FOR bullet IN SELECT * FROM jsonb_array_elements(p_struct->'education')
    LOOP
      bt := CASE WHEN jsonb_typeof(bullet) = 'string' THEN bullet #>> '{}' ELSE COALESCE(bullet->>'text', '') END;
      lines := array_append(lines, '- ' || bt);
    END LOOP;
    lines := array_append(lines, '');
  ELSIF other_education <> '' THEN
    lines := lines || ARRAY['EDUCATION', other_education, ''];
  END IF;

  IF jsonb_array_length(COALESCE(p_struct->'certs', '[]'::jsonb)) > 0 THEN
    lines := array_append(lines, 'CERTIFICATIONS');
    FOR bullet IN SELECT * FROM jsonb_array_elements(p_struct->'certs')
    LOOP
      bt := CASE WHEN jsonb_typeof(bullet) = 'string' THEN bullet #>> '{}' ELSE COALESCE(bullet->>'text', '') END;
      lines := array_append(lines, '- ' || bt);
    END LOOP;
  END IF;

  RETURN trim(array_to_string(lines, E'\n'));
END;
$$;

-- ---------------------------------------------------------------------------
-- promote_accomplishment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_accomplishment(
  p_accomplishment_id uuid,
  p_expected_rev int,
  p_role_id text DEFAULT NULL,
  p_role_header text DEFAULT NULL,
  p_role_sub text DEFAULT NULL,
  p_new_role_id text DEFAULT NULL,
  p_bullet_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_prof app.profiles%ROWTYPE;
  v_acc app.accomplishments%ROWTYPE;
  v_struct jsonb;
  v_roles jsonb;
  v_role jsonb;
  v_role_idx int := -1;
  v_role_key text;
  v_bullet_id text;
  v_bullet jsonb;
  v_bullets jsonb;
  v_existing jsonb;
  v_ord int;
  v_resume_text text;
  v_new_rev int;
  v_snap text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prof
  FROM app.profiles
  WHERE owner = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_prof.resume_struct_rev, 0) IS DISTINCT FROM COALESCE(p_expected_rev, 0) THEN
    RAISE EXCEPTION 'resume_struct_rev_conflict expected=% actual=%',
      COALESCE(p_expected_rev, 0), COALESCE(v_prof.resume_struct_rev, 0)
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_acc
  FROM app.accomplishments
  WHERE id = p_accomplishment_id AND owner = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'accomplishment not found' USING ERRCODE = 'P0002';
  END IF;

  v_struct := COALESCE(v_prof.resume_struct, '{}'::jsonb);
  IF v_struct->'roles' IS NULL OR jsonb_typeof(v_struct->'roles') <> 'array' THEN
    v_struct := jsonb_set(v_struct, '{roles}', '[]'::jsonb, true);
  END IF;
  IF v_struct->'projects' IS NULL OR jsonb_typeof(v_struct->'projects') <> 'array' THEN
    v_struct := jsonb_set(v_struct, '{projects}', '[]'::jsonb, true);
  END IF;

  v_roles := v_struct->'roles';
  v_role_key := COALESCE(nullif(trim(p_role_id), ''), nullif(trim(v_acc.role_id), ''));

  IF v_role_key IS NOT NULL THEN
    FOR v_ord, v_role IN
      SELECT ord, elem FROM jsonb_array_elements(v_roles) WITH ORDINALITY AS t(elem, ord)
    LOOP
      IF (v_role->>'id') = v_role_key
         OR public.mt_stable_role_key(v_role) = v_role_key THEN
        v_role_idx := (v_ord - 1)::int;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_role_idx < 0 AND nullif(trim(p_role_header), '') IS NOT NULL THEN
    v_role_key := COALESCE(nullif(trim(p_new_role_id), ''), gen_random_uuid()::text);
    v_role := jsonb_build_object(
      'id', v_role_key,
      'header', p_role_header,
      'sub', COALESCE(p_role_sub, ''),
      'bullets', '[]'::jsonb
    );
    v_roles := v_roles || jsonb_build_array(v_role);
    v_role_idx := jsonb_array_length(v_roles) - 1;
  END IF;

  IF v_role_idx < 0 THEN
    RAISE EXCEPTION 'Pick a resume role before promoting' USING ERRCODE = '22023';
  END IF;

  v_role := v_roles->v_role_idx;
  IF nullif(v_role->>'id', '') IS NULL THEN
    v_role := jsonb_set(v_role, '{id}', to_jsonb(public.mt_stable_role_key(v_role)), true);
  END IF;
  v_role_key := v_role->>'id';
  v_bullets := COALESCE(v_role->'bullets', '[]'::jsonb);
  IF jsonb_typeof(v_bullets) <> 'array' THEN
    v_bullets := '[]'::jsonb;
  END IF;

  v_snap := v_acc.body_current;

  -- Idempotent: already promoted to same bullet
  IF nullif(trim(v_acc.promoted_bullet_id), '') IS NOT NULL THEN
    FOR v_ord, v_existing IN
      SELECT ord, elem FROM jsonb_array_elements(v_bullets) WITH ORDINALITY AS t(elem, ord)
    LOOP
      IF (v_existing->>'id') = v_acc.promoted_bullet_id THEN
        v_existing := v_existing
          || jsonb_build_object(
            'text', v_snap,
            'source_type', 'accomplishment',
            'source_id', v_acc.id::text
          );
        v_bullets := public.mt_jsonb_set_array_elem(v_bullets, (v_ord - 1)::int, v_existing);
        v_role := jsonb_set(v_role, '{bullets}', v_bullets, true);
        v_roles := public.mt_jsonb_set_array_elem(v_roles, v_role_idx, v_role);
        v_struct := jsonb_set(v_struct, '{roles}', v_roles, true);
        v_bullet_id := v_acc.promoted_bullet_id;

        v_resume_text := public.mt_render_resume_text_from_struct(v_struct, COALESCE(v_prof.resume_text, ''));
        v_new_rev := COALESCE(v_prof.resume_struct_rev, 0) + 1;

        UPDATE app.profiles SET
          resume_struct = v_struct,
          resume_text = v_resume_text,
          resume_struct_rev = v_new_rev,
          structured_modified_at = v_now,
          resume_reconcile_needed = true
        WHERE owner = v_uid;

        UPDATE app.accomplishments SET
          promoted_role_id = v_role_key,
          promoted_bullet_id = v_bullet_id,
          promoted_at = COALESCE(v_acc.promoted_at, v_now),
          promotion_snapshot = v_snap,
          status = 'promoted',
          updated_at = v_now
        WHERE id = v_acc.id AND owner = v_uid
        RETURNING * INTO v_acc;

        RETURN jsonb_build_object(
          'resume_struct_rev', v_new_rev,
          'structured_modified_at', v_now,
          'resume_reconcile_needed', true,
          'resume_struct', v_struct,
          'resume_text', v_resume_text,
          'accomplishment', to_jsonb(v_acc)
        );
      END IF;
    END LOOP;
  END IF;

  v_bullet_id := COALESCE(nullif(trim(p_bullet_id), ''), gen_random_uuid()::text);
  v_bullet := jsonb_build_object(
    'id', v_bullet_id,
    'text', v_snap,
    'source_type', 'accomplishment',
    'source_id', v_acc.id::text
  );
  v_bullets := v_bullets || jsonb_build_array(v_bullet);
  v_role := jsonb_set(v_role, '{bullets}', v_bullets, true);
  v_roles := public.mt_jsonb_set_array_elem(v_roles, v_role_idx, v_role);
  v_struct := jsonb_set(v_struct, '{roles}', v_roles, true);

  v_resume_text := public.mt_render_resume_text_from_struct(v_struct, COALESCE(v_prof.resume_text, ''));
  v_new_rev := COALESCE(v_prof.resume_struct_rev, 0) + 1;

  UPDATE app.profiles SET
    resume_struct = v_struct,
    resume_text = v_resume_text,
    resume_struct_rev = v_new_rev,
    structured_modified_at = v_now,
    resume_reconcile_needed = true
  WHERE owner = v_uid;

  UPDATE app.accomplishments SET
    promoted_role_id = v_role_key,
    promoted_bullet_id = v_bullet_id,
    promoted_at = v_now,
    promotion_snapshot = v_snap,
    status = 'promoted',
    updated_at = v_now
  WHERE id = v_acc.id AND owner = v_uid
  RETURNING * INTO v_acc;

  RETURN jsonb_build_object(
    'resume_struct_rev', v_new_rev,
    'structured_modified_at', v_now,
    'resume_reconcile_needed', true,
    'resume_struct', v_struct,
    'resume_text', v_resume_text,
    'accomplishment', to_jsonb(v_acc)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- promote_portfolio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_portfolio(
  p_portfolio_id uuid,
  p_expected_rev int,
  p_project_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_prof app.profiles%ROWTYPE;
  v_item app.portfolio_items%ROWTYPE;
  v_struct jsonb;
  v_projects jsonb;
  v_project jsonb;
  v_project_idx int := -1;
  v_project_id text;
  v_ord int;
  v_bullet_texts text[];
  v_bt text;
  v_bullets jsonb := '[]'::jsonb;
  v_body text;
  v_snap text;
  v_resume_text text;
  v_new_rev int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prof
  FROM app.profiles
  WHERE owner = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_prof.resume_struct_rev, 0) IS DISTINCT FROM COALESCE(p_expected_rev, 0) THEN
    RAISE EXCEPTION 'resume_struct_rev_conflict expected=% actual=%',
      COALESCE(p_expected_rev, 0), COALESCE(v_prof.resume_struct_rev, 0)
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_item
  FROM app.portfolio_items
  WHERE id = p_portfolio_id AND owner = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'portfolio item not found' USING ERRCODE = 'P0002';
  END IF;

  v_struct := COALESCE(v_prof.resume_struct, '{}'::jsonb);
  IF v_struct->'projects' IS NULL OR jsonb_typeof(v_struct->'projects') <> 'array' THEN
    v_struct := jsonb_set(v_struct, '{projects}', '[]'::jsonb, true);
  END IF;
  IF v_struct->'roles' IS NULL OR jsonb_typeof(v_struct->'roles') <> 'array' THEN
    v_struct := jsonb_set(v_struct, '{roles}', '[]'::jsonb, true);
  END IF;

  v_projects := v_struct->'projects';
  v_project_id := COALESCE(
    nullif(trim(v_item.promoted_project_id), ''),
    nullif(trim(p_project_id), ''),
    gen_random_uuid()::text
  );

  FOR v_ord, v_project IN
    SELECT ord, elem FROM jsonb_array_elements(v_projects) WITH ORDINALITY AS t(elem, ord)
  LOOP
    IF (v_project->>'id') = v_project_id THEN
      v_project_idx := (v_ord - 1)::int;
      EXIT;
    END IF;
  END LOOP;

  -- Normalize portfolio bullet texts
  IF jsonb_typeof(v_item.bullets) = 'array' AND jsonb_array_length(v_item.bullets) > 0 THEN
    SELECT COALESCE(array_agg(x), ARRAY[]::text[]) INTO v_bullet_texts
    FROM (
      SELECT CASE
        WHEN jsonb_typeof(b) = 'string' THEN nullif(trim(b #>> '{}'), '')
        ELSE nullif(trim(COALESCE(b->>'text', '')), '')
      END AS x
      FROM jsonb_array_elements(v_item.bullets) AS b
    ) s
    WHERE x IS NOT NULL;
  ELSE
    v_body := COALESCE(v_item.body_current, v_item.summary, '');
    SELECT COALESCE(array_agg(trim(regexp_replace(line, '^[-•]\s*', ''))), ARRAY[]::text[])
      INTO v_bullet_texts
    FROM unnest(string_to_array(v_body, E'\n')) AS line
    WHERE trim(regexp_replace(line, '^[-•]\s*', '')) <> '';
  END IF;

  IF v_project_idx < 0 THEN
    FOREACH v_bt IN ARRAY COALESCE(v_bullet_texts, ARRAY[]::text[]) LOOP
      v_bullets := v_bullets || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'text', v_bt,
        'source_type', 'portfolio',
        'source_id', v_item.id::text
      ));
    END LOOP;
    v_project := jsonb_build_object(
      'id', v_project_id,
      'header', v_item.title,
      'title', v_item.title,
      'sub', COALESCE(v_item.url, ''),
      'url', COALESCE(v_item.url, ''),
      'bullets', v_bullets,
      'source_type', 'portfolio',
      'source_id', v_item.id::text
    );
    v_projects := v_projects || jsonb_build_array(v_project);
  ELSE
    v_project := v_projects->v_project_idx;
    v_project := v_project
      || jsonb_build_object(
        'header', v_item.title,
        'title', v_item.title,
        'sub', COALESCE(nullif(v_item.url, ''), v_project->>'sub'),
        'source_type', 'portfolio',
        'source_id', v_item.id::text
      );
    IF nullif(v_item.url, '') IS NOT NULL THEN
      v_project := jsonb_set(v_project, '{url}', to_jsonb(v_item.url), true);
    END IF;
    v_projects := public.mt_jsonb_set_array_elem(v_projects, v_project_idx, v_project);
  END IF;

  v_struct := jsonb_set(v_struct, '{projects}', v_projects, true);
  v_snap := v_item.title || E'\n' || array_to_string(COALESCE(v_bullet_texts, ARRAY[]::text[]), E'\n');
  v_resume_text := public.mt_render_resume_text_from_struct(v_struct, COALESCE(v_prof.resume_text, ''));
  v_new_rev := COALESCE(v_prof.resume_struct_rev, 0) + 1;

  UPDATE app.profiles SET
    resume_struct = v_struct,
    resume_text = v_resume_text,
    resume_struct_rev = v_new_rev,
    structured_modified_at = v_now,
    resume_reconcile_needed = true
  WHERE owner = v_uid;

  UPDATE app.portfolio_items SET
    promoted_project_id = v_project_id,
    promoted_at = v_now,
    promotion_snapshot = v_snap,
    updated_at = v_now
  WHERE id = v_item.id AND owner = v_uid
  RETURNING * INTO v_item;

  RETURN jsonb_build_object(
    'resume_struct_rev', v_new_rev,
    'structured_modified_at', v_now,
    'resume_reconcile_needed', true,
    'resume_struct', v_struct,
    'resume_text', v_resume_text,
    'portfolio', to_jsonb(v_item)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mt_stable_role_key(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mt_jsonb_set_array_elem(jsonb, int, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mt_render_resume_text_from_struct(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_accomplishment(uuid, int, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_portfolio(uuid, int, text) TO authenticated;

COMMENT ON FUNCTION public.promote_accomplishment IS
  'Atomic promote: check resume_struct_rev, mutate resume_struct + resume_text, update accomplishment promotion fields.';
COMMENT ON FUNCTION public.promote_portfolio IS
  'Atomic portfolio promote: check resume_struct_rev, mutate resume_struct.projects + resume_text, update portfolio promotion fields.';
