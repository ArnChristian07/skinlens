-- 0019_notifications.sql
-- Server-owned notifications.
--
-- Before this migration every notification lived only in the phone's SQLite:
-- nothing was ever written to public.notifications, its bigint id could not
-- hold the app's text ids ("scan-2026-11-24", "apptrepl-<uuid>-scheduled"),
-- and a patient only learned about a doctor's reply when their own phone
-- happened to diff the appointments table. Now:
--   * appointment notices (both directions) are inserted HERE, by triggers,
--     in the same transaction as the appointment change — so they exist even
--     when the other person's phone is off, carry the real event time, and
--     survive reinstalls / new devices;
--   * clients may only insert their own scan reminders / daily tips;
--   * clients may only flip `read` and delete their own rows;
--   * the table is in the realtime publication so open apps update live.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run (or `supabase db push`).

-- ── replace the old (unused, bigint-id) table ─────────────────────────────
do $$
begin
  if to_regclass('public.notifications') is not null then
    if exists (select 1 from public.notifications) then
      raise exception
        'public.notifications still has rows — back them up and empty the table before running 0019.';
    end if;
    drop table public.notifications cascade;
  end if;
end $$;

create table public.notifications (
  id             text primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  type           text not null
    check (type in ('scan_reminder', 'daily_tip', 'appointment_reply', 'appointment_request')),
  title          text not null,
  message        text not null,
  read           boolean not null default false,
  appointment_id uuid references public.appointments (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- ── RLS + column privileges ───────────────────────────────────────────────
alter table public.notifications enable row level security;

revoke all on public.notifications from anon;
revoke all on public.notifications from authenticated;
grant select, insert, delete on public.notifications to authenticated;
-- Only the read flag is client-writable; title/message/type stay as the server wrote them.
grant update (read) on public.notifications to authenticated;

create policy "notifications: owner select" on public.notifications
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "notifications: owner mark read" on public.notifications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "notifications: owner delete" on public.notifications
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Appointment notices come only from the triggers below — a client can't forge one.
create policy "notifications: owner insert reminders" on public.notifications
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and type in ('scan_reminder', 'daily_tip')
  );

-- ── helpers ───────────────────────────────────────────────────────────────
-- Clinic-local time, same format the 0015 guard uses in its messages.
create or replace function public.notification_when(p_at timestamptz)
returns text
language sql
immutable
as $$
  select to_char(p_at at time zone 'Asia/Manila', 'Mon FMDD, FMHH12:MI AM')
$$;

create or replace function public.push_notification(
  p_id text,
  p_user uuid,
  p_type text,
  p_title text,
  p_message text,
  p_appointment uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (id, user_id, type, title, message, appointment_id)
  values (p_id, p_user, p_type, p_title, p_message, p_appointment)
  -- Same event twice (e.g. a retried write) must not reset a row the user already read.
  on conflict (id) do nothing
$$;

revoke execute on function public.push_notification(text, uuid, text, text, text, uuid)
  from public, anon, authenticated;

-- ── appointment → notification trigger ────────────────────────────────────
create or replace function public.notify_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doctor_name text;
  v_patient_name text;
  v_clinic_name text;
  v_when text;
  v_doc record;
  v_repick boolean;
begin
  select c.name into v_clinic_name from public.clinics c where c.id = new.clinic_id;
  v_patient_name := coalesce(nullif(trim(new.patient_name), ''), 'A patient');

  -- ── doctor side: a new request, or a re-picked time after a bump ──
  v_repick := tg_op = 'UPDATE'
    and old.status = 'needs_reschedule'
    and new.status = 'requested';

  if (tg_op = 'INSERT' and new.status = 'requested') or v_repick then
    v_when := case when new.preferred_time is not null
      then ' for ' || public.notification_when(new.preferred_time) else '' end;

    for v_doc in
      select d.user_id
      from public.doctors d
      where d.clinic_id = new.clinic_id
        and d.is_active = true
        and (new.doctor_id is null or d.user_id = new.doctor_id)
    loop
      if v_repick then
        perform public.push_notification(
          'apptreq-' || new.id || '-' || v_doc.user_id || '-t'
            || coalesce(extract(epoch from new.preferred_time)::bigint::text, '0'),
          v_doc.user_id,
          'appointment_request',
          'New time requested',
          v_patient_name || ' picked a new time' || v_when || ' after their first choice was booked.',
          new.id
        );
      else
        perform public.push_notification(
          'apptreq-' || new.id || '-' || v_doc.user_id,
          v_doc.user_id,
          'appointment_request',
          'New appointment request',
          v_patient_name || ' requested a visit'
            || case when new.doctor_id is not null then ' with you'
                    else ' at ' || coalesce(v_clinic_name, 'your clinic') end
            || v_when || '.',
          new.id
        );
      end if;
    end loop;
  end if;

  if tg_op <> 'UPDATE' then
    return null;
  end if;

  -- ── patient side: the clinic answered ──
  select coalesce(nullif(trim(d.display_name), ''), v_clinic_name, 'The clinic')
    into v_doctor_name
  from public.doctors d
  where d.user_id = new.doctor_id;
  v_doctor_name := coalesce(v_doctor_name, v_clinic_name, 'The clinic');

  if new.status is distinct from old.status then
    if new.status = 'scheduled' then
      perform public.push_notification(
        'apptrepl-' || new.id || '-scheduled',
        new.patient_id, 'appointment_reply', 'Visit confirmed',
        v_doctor_name || ' scheduled your visit for '
          || coalesce(public.notification_when(new.scheduled_at), 'a confirmed time') || '.',
        new.id
      );
    elsif new.status = 'declined' then
      perform public.push_notification(
        'apptrepl-' || new.id || '-declined',
        new.patient_id, 'appointment_reply', 'Request declined',
        v_doctor_name || ' declined your visit request. Book another clinic from the map.',
        new.id
      );
    elsif new.status = 'completed' then
      perform public.push_notification(
        'apptrepl-' || new.id || '-completed',
        new.patient_id, 'appointment_reply', 'Visit completed',
        v_doctor_name || ' marked your visit as complete.',
        new.id
      );
    elsif new.status = 'needs_reschedule' then
      perform public.push_notification(
        'apptrepl-' || new.id || '-bumped-'
          || coalesce(extract(epoch from new.preferred_time)::bigint::text, '0'),
        new.patient_id, 'appointment_reply', 'Pick a new time',
        coalesce(public.notification_when(new.preferred_time), 'The time you asked for')
          || ' was just booked by another patient. Open My Appointments to choose another schedule.',
        new.id
      );
    elsif new.status = 'cancelled' and old.status = 'scheduled'
          and auth.uid() is distinct from new.patient_id then
      -- The clinic cancelled a confirmed visit (a patient cancelling needs no notice).
      perform public.push_notification(
        'apptrepl-' || new.id || '-cancelled',
        new.patient_id, 'appointment_reply', 'Visit cancelled',
        v_doctor_name || ' cancelled your visit. Book a new time from the map.',
        new.id
      );
    end if;
  elsif new.status = 'scheduled'
        and new.scheduled_at is distinct from old.scheduled_at
        and new.scheduled_at is not null then
    perform public.push_notification(
      'apptrepl-' || new.id || '-moved-' || extract(epoch from new.scheduled_at)::bigint::text,
      new.patient_id, 'appointment_reply', 'Visit moved',
      v_doctor_name || ' moved your visit to ' || public.notification_when(new.scheduled_at) || '.',
      new.id
    );
  end if;

  return null;
end $$;

revoke execute on function public.notify_appointment_change() from public, anon, authenticated;

drop trigger if exists appointments_notify on public.appointments;
create trigger appointments_notify
  after insert or update of status, scheduled_at on public.appointments
  for each row execute function public.notify_appointment_change();

-- ── realtime ──────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

notify pgrst, 'reload schema';
