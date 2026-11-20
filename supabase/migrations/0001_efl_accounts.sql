-- =========================================================================
-- English Fluency Lab — personal accounts (Phase 2, Stage 1)
--
-- Security model
--   * Authentication: Supabase Auth (email one-time code / magic link).
--   * Authorisation: Row Level Security, FORCED on every table. A row is
--     visible/modifiable only when user_id = auth.uid(), i.e. the user id
--     inside the signed JWT verified by the server. The browser never sends
--     a user id: user_id defaults to auth.uid() and every policy checks it.
--   * The public "anon" key can do nothing here; only signed-in users
--     (role "authenticated") have privileges, and only on their own rows.
--   * No audio is ever stored server-side.
--   * Accounts are for adults (18+). Minors use guest mode (local only).
-- =========================================================================

-- ---------------------------------------------------------------- profiles
create table if not exists public.efl_profiles (
  user_id        uuid primary key default auth.uid()
                 references auth.users (id) on delete cascade,
  adult_confirmed boolean not null check (adult_confirmed = true),
  terms_version  text not null check (char_length(terms_version) between 1 and 40),
  created_at     timestamptz not null default now()
);

comment on table public.efl_profiles is
  'One row per learner account: records the 18+ confirmation and the privacy terms version accepted. No names or other personal data.';

-- ----------------------------------------------------------- learner state
create table if not exists public.efl_learner_state (
  user_id       uuid primary key default auth.uid()
                references auth.users (id) on delete cascade,
  state         jsonb not null,
  state_version integer not null check (state_version between 1 and 1000),
  rev           bigint not null default 1,
  device        text check (device is null or char_length(device) <= 80),
  updated_at    timestamptz not null default now(),
  constraint efl_state_is_object check (jsonb_typeof(state) = 'object'),
  constraint efl_state_size check (pg_column_size(state) < 2 * 1024 * 1024)
);

comment on table public.efl_learner_state is
  'The learner''s synced progress document (same versioned format as the local efl-progress). Optimistic concurrency via rev.';

-- rev / updated_at are server-controlled; user_id can never change.
create or replace function public.efl_state_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.rev := 1;
  else
    if new.user_id is distinct from old.user_id then
      raise exception 'user_id cannot change' using errcode = '42501';
    end if;
    new.rev := old.rev + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.efl_state_guard() from public, anon, authenticated;

drop trigger if exists efl_state_guard on public.efl_learner_state;
create trigger efl_state_guard
  before insert or update on public.efl_learner_state
  for each row execute function public.efl_state_guard();

-- -------------------------------------------------------- row level security
alter table public.efl_profiles enable row level security;
alter table public.efl_profiles force row level security;
alter table public.efl_learner_state enable row level security;
alter table public.efl_learner_state force row level security;

-- Supabase grants ALL on new public tables to anon/authenticated through
-- default privileges (including TRUNCATE, which RLS does not cover).
-- Start from zero and grant back only what the app needs.
revoke all on public.efl_profiles from public, anon, authenticated;
revoke all on public.efl_learner_state from public, anon, authenticated;
grant select, insert, delete on public.efl_profiles to authenticated;
grant select, insert, update, delete on public.efl_learner_state to authenticated;

drop policy if exists efl_profiles_select on public.efl_profiles;
drop policy if exists efl_profiles_insert on public.efl_profiles;
drop policy if exists efl_profiles_delete on public.efl_profiles;
create policy efl_profiles_select on public.efl_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy efl_profiles_insert on public.efl_profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy efl_profiles_delete on public.efl_profiles
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists efl_state_select on public.efl_learner_state;
drop policy if exists efl_state_insert on public.efl_learner_state;
drop policy if exists efl_state_update on public.efl_learner_state;
drop policy if exists efl_state_delete on public.efl_learner_state;
create policy efl_state_select on public.efl_learner_state
  for select to authenticated using (user_id = (select auth.uid()));
-- saving progress requires the 18+ confirmation row of the same user
create policy efl_state_insert on public.efl_learner_state
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.efl_profiles p where p.user_id = (select auth.uid()))
  );
create policy efl_state_update on public.efl_learner_state
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy efl_state_delete on public.efl_learner_state
  for delete to authenticated using (user_id = (select auth.uid()));

-- ----------------------------------------------------------- save with rev
-- SECURITY INVOKER: runs with the caller's privileges, so RLS applies.
-- p_expected_rev = null  -> first save (insert); fails if a row exists.
-- p_expected_rev = n     -> update only if the stored rev is still n.
-- Returns {"status":"ok","rev":n} or {"status":"conflict","rev":current}.
create or replace function public.efl_save_state(
  p_state jsonb,
  p_state_version integer,
  p_expected_rev bigint,
  p_device text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rev bigint;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_expected_rev is null then
    insert into public.efl_learner_state (state, state_version, device)
    values (p_state, p_state_version, p_device)
    on conflict (user_id) do nothing
    returning rev into v_rev;
  else
    update public.efl_learner_state
       set state = p_state, state_version = p_state_version, device = p_device
     where user_id = auth.uid() and rev = p_expected_rev
    returning rev into v_rev;
  end if;
  if v_rev is null then
    select rev into v_rev from public.efl_learner_state where user_id = auth.uid();
    return jsonb_build_object('status', 'conflict', 'rev', v_rev);
  end if;
  return jsonb_build_object('status', 'ok', 'rev', v_rev);
end;
$$;

revoke all on function public.efl_save_state(jsonb, integer, bigint, text) from public, anon, authenticated;
grant execute on function public.efl_save_state(jsonb, integer, bigint, text) to authenticated;

-- ------------------------------------------------------- delete my account
-- SECURITY DEFINER is required to delete from auth.users. It takes no
-- arguments: it can only ever delete the caller (auth.uid()). Cascades
-- remove efl_profiles and efl_learner_state.
create or replace function public.efl_delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.efl_delete_my_account() from public, anon, authenticated;
grant execute on function public.efl_delete_my_account() to authenticated;
