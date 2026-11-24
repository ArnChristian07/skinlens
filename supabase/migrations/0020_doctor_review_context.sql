-- 0020_doctor_review_context.sql
-- Gives the dermatologist what they need to judge an AI result instead of
-- rubber-stamping numbers:
--   1. get_patient_latest_result now also returns the scan photo (only the
--      remote Cloudinary URL — device-only file:// paths are useless on the
--      doctor's phone), how it was captured, and whether the patient said
--      the detection "doesn't match my skin".
--   2. get_patient_concerns(uuid[]) — one batched call so request cards can
--      show each patient's reason for the visit (self-reported main concern
--      + newest AI detection) without opening the review panels.
--
-- Access rules are unchanged: the caller must be an active doctor whose
-- clinic holds a non-cancelled / non-declined appointment with the patient
-- (assert_doctor_can_review from 0012). Still no survey answers or emails.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run (or `supabase db push`).
-- Idempotent — safe to re-run. Requires 0007 and 0012.

-- ── 1. latest result + photo ──────────────────────────────────────────────
create or replace function public.get_patient_latest_result(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
begin
  perform public.assert_doctor_can_review(p_patient_id);

  select jsonb_build_object(
    'id', r.id,
    'severity', r.severity,
    'healthscore', r.healthscore,
    'confidence', r.confidence,
    'detection_label', r.detection_label,
    'validation_status', r.validation_status,
    'doctor_notes', r.doctor_notes,
    'validated_at', r.validated_at,
    'created_at', r.created_at,
    'image_url', case when r.image_url like 'http%' then r.image_url else null end,
    'source_type', r.source_type,
    -- survey_answers is free text JSON; match the one flag without casting
    -- (a malformed row must not break the doctor's panel).
    'patient_disputed', coalesce(r.survey_answers ~ '"match"\s*:\s*"no"', false)
  )
  into v_row
  from public.results r
  where r.user_id = p_patient_id
  order by r.created_at desc nulls last
  limit 1;

  return v_row;  -- jsonb null when the patient has never scanned
end $$;

revoke all on function public.get_patient_latest_result(uuid) from public, anon;
grant execute on function public.get_patient_latest_result(uuid) to authenticated;

-- ── 2. reason-for-visit for request cards (batched) ───────────────────────
create or replace function public.get_patient_concerns(p_ids uuid[])
returns table (
  patient_id uuid,
  main_concerns text,
  latest_detection text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pid,
    (select sp.main_concerns from public.skin_profile sp where sp.id::text = pid::text),
    (select r.detection_label
       from public.results r
      where r.user_id = pid
      order by r.created_at desc nulls last
      limit 1)
  from unnest(p_ids) as pid
  where exists (
    select 1
    from public.appointments a
    join public.doctors d
      on d.user_id = auth.uid()
     and d.is_active = true
     and d.clinic_id = a.clinic_id
    where a.patient_id = pid
      and a.status not in ('cancelled', 'declined')
  );
$$;

revoke all on function public.get_patient_concerns(uuid[]) from public, anon;
grant execute on function public.get_patient_concerns(uuid[]) to authenticated;

notify pgrst, 'reload schema';
