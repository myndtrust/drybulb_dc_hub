-- Rackline DCIM — customer projects, sharing and Drybulb staff access.
-- Used by lib/rackline/saved-projects.ts, app/api/rackline/invites, the invite page
-- (app/(app)/invite/[token]) and the rackline-api Cloud Run service. Apply in the
-- Supabase SQL editor. Safe to run twice.
--
-- Access model (enforced here by RLS, not by the UI):
--   • A project is visible ONLY to its members and to Drybulb staff.
--   • Members: owner (the customer), editor, copier (view + duplicate), viewer.
--   • Exactly ONE owner per project (a unique index), and it is always the user in
--     rackline_projects.user_id. The creator starts as owner; ownership moves only
--     through rackline_transfer_ownership() or a staff-sent owner invite, which
--     demote the previous owner in the same transaction.
--   • Owners and staff invite people by email; only staff may invite an owner
--     (e.g. staff build a design, then hand it to the customer as owner).
--   • An invite is accepted only by a signed-in user whose account email matches
--     the invited address, and only after they complete registration
--     (member_profiles — the one-time "create your account" step). Accepting adds
--     the membership. Open invites also appear in the invitee's own inbox
--     (rackline_my_invites) so they can accept or decline without the link.
--   • Copiers can view and save their own duplicate; they never send changes.
--   • Only owners (and staff) write a project. Editors save their own copy
--     (source_id links it back) or send a change request; the owner accepts or
--     rejects it explicitly (rackline_decide_change). Viewers only view.
--   • Background drawing FILES are not in Postgres: they live in the private GCS
--     bucket gs://drybulb-rackline under projects/<project id>/, served only via
--     signed URLs by rackline-api after it checks rackline_role() for the caller.

-- ── Drybulb staff ─────────────────────────────────────────────────────────────
create table if not exists public.drybulb_staff (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.drybulb_staff enable row level security;
drop policy if exists "staff can read own row" on public.drybulb_staff;
create policy "staff can read own row" on public.drybulb_staff
  for select using (auth.uid() = user_id);
-- No insert/update/delete policies: staff are managed in this SQL editor only.

create or replace function public.is_drybulb_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.drybulb_staff where user_id = auth.uid())
$$;

-- ── Member registration ──────────────────────────────────────────────────────
create table if not exists public.member_profiles (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null check (length(full_name) between 1 and 200),
  company     text check (company is null or length(company) <= 200),
  job_title   text check (job_title is null or length(job_title) <= 200),
  accepted_terms_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.member_profiles enable row level security;
drop policy if exists "own profile read"   on public.member_profiles;
drop policy if exists "own profile insert" on public.member_profiles;
drop policy if exists "own profile update" on public.member_profiles;
create policy "own profile read" on public.member_profiles
  for select using (auth.uid() = user_id or public.is_drybulb_staff());
create policy "own profile insert" on public.member_profiles
  for insert with check (auth.uid() = user_id and lower(email) = lower(auth.jwt() ->> 'email'));
create policy "own profile update" on public.member_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id and lower(email) = lower(auth.jwt() ->> 'email'));

-- ── Projects ─────────────────────────────────────────────────────────────────
create table if not exists public.rackline_projects (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null,
  doc             jsonb not null,
  schema_version  int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists rackline_projects_updated_idx on public.rackline_projects (updated_at desc);
-- A member's own copy remembers the project it came from, so changes can be sent back.
alter table public.rackline_projects add column if not exists source_id uuid references public.rackline_projects (id) on delete set null;
-- The original's design when the copy was made: what the editor's changes are measured against.
alter table public.rackline_projects add column if not exists source_doc jsonb;
alter table public.rackline_projects enable row level security;

create table if not exists public.rackline_project_members (
  project_id  uuid not null references public.rackline_projects (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('owner', 'editor', 'copier', 'viewer')),
  email       text not null,
  added_by    uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists rackline_members_user_idx on public.rackline_project_members (user_id);
alter table public.rackline_project_members drop constraint if exists rackline_project_members_role_check;
alter table public.rackline_project_members add constraint rackline_project_members_role_check
  check (role in ('owner', 'editor', 'copier', 'viewer'));
alter table public.rackline_project_members enable row level security;

-- ── One owner per project ────────────────────────────────────────────────────
-- Normalise data created before this rule (extra owners become editors; the
-- project's user_id is the owner), then enforce it with a unique index.
update public.rackline_project_members m set role = 'editor'
  from public.rackline_projects p
 where p.id = m.project_id and m.role = 'owner' and m.user_id <> p.user_id;
insert into public.rackline_project_members (project_id, user_id, role, email, added_by)
select p.id, p.user_id, 'owner', coalesce(u.email, ''), p.user_id
  from public.rackline_projects p left join auth.users u on u.id = p.user_id
on conflict (project_id, user_id) do update set role = 'owner';
create unique index if not exists rackline_one_owner_idx on public.rackline_project_members (project_id) where role = 'owner';

-- The caller's role on a project: owner | editor | copier | viewer | staff | null (no access).
create or replace function public.rackline_role(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.rackline_project_members where project_id = p and user_id = auth.uid()),
    case when public.is_drybulb_staff() then 'staff' end
  )
$$;

-- The creator becomes owner automatically.
create or replace function public.rackline_add_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.rackline_project_members (project_id, user_id, role, email, added_by)
  values (new.id, new.user_id, 'owner',
          coalesce((select email from auth.users where id = new.user_id), ''), new.user_id)
  on conflict (project_id, user_id) do update set role = 'owner';
  return new;
end $$;
drop trigger if exists rackline_projects_owner on public.rackline_projects;
create trigger rackline_projects_owner after insert on public.rackline_projects
  for each row execute function public.rackline_add_owner();

drop policy if exists "owner can read"   on public.rackline_projects;
drop policy if exists "owner can insert" on public.rackline_projects;
drop policy if exists "owner can update" on public.rackline_projects;
drop policy if exists "owner can delete" on public.rackline_projects;
drop policy if exists "members read"     on public.rackline_projects;
drop policy if exists "create own"       on public.rackline_projects;
drop policy if exists "editors update"   on public.rackline_projects;
drop policy if exists "owners delete"    on public.rackline_projects;
-- `user_id = auth.uid()` keeps INSERT … RETURNING working before the owner
-- membership trigger has run.
create policy "members read" on public.rackline_projects
  for select using (user_id = auth.uid() or public.rackline_role(id) is not null);
create policy "create own" on public.rackline_projects
  for insert with check (auth.uid() = user_id);
drop policy if exists "owners update"    on public.rackline_projects;
-- Only the owner (or staff) writes the original. Editors save their own copy, or
-- send changes that the owner accepts explicitly (rackline_change_requests below).
create policy "owners update" on public.rackline_projects
  for update using (public.rackline_role(id) in ('owner', 'staff'))
  with check (public.rackline_role(id) in ('owner', 'staff'));
create policy "owners delete" on public.rackline_projects
  for delete using (public.rackline_role(id) in ('owner', 'staff'));

drop policy if exists "members see members" on public.rackline_project_members;
drop policy if exists "owners change roles" on public.rackline_project_members;
drop policy if exists "owners remove, members leave" on public.rackline_project_members;
create policy "members see members" on public.rackline_project_members
  for select using (public.rackline_role(project_id) is not null);
-- Roles change here, but never to or from owner: that is a transfer (below).
create policy "owners change roles" on public.rackline_project_members
  for update using (public.rackline_role(project_id) in ('owner', 'staff') and role <> 'owner')
  with check (public.rackline_role(project_id) in ('owner', 'staff') and role <> 'owner');
-- The owner can never be removed; anyone else may leave a project themselves.
create policy "owners remove, members leave" on public.rackline_project_members
  for delete using (
    role <> 'owner'
    and user_id <> (select p.user_id from public.rackline_projects p where p.id = project_id)
    and (user_id = auth.uid() or public.rackline_role(project_id) in ('owner', 'staff'))
  );

-- Make `new_owner` the project's one owner. Internal (no grant): called only by
-- rackline_transfer_ownership() and rackline_accept_invite(). The previous owner is
-- demoted FIRST so two owners never exist, even for an instant.
create or replace function public.rackline_set_owner(p uuid, new_owner uuid, new_email text, old_owner_role text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if old_owner_role not in ('editor', 'copier', 'viewer') then
    raise exception 'The previous owner must become an editor, copier or viewer.' using errcode = '22023';
  end if;
  update public.rackline_project_members set role = old_owner_role
   where project_id = p and role = 'owner' and user_id <> new_owner;
  insert into public.rackline_project_members (project_id, user_id, role, email, added_by)
  values (p, new_owner, 'owner', new_email, auth.uid())
  on conflict (project_id, user_id) do update set role = 'owner';
  update public.rackline_projects set user_id = new_owner where id = p;
end $$;
revoke all on function public.rackline_set_owner(uuid, uuid, text, text) from public, anon, authenticated;

-- Transfer ownership to an existing member. Owner (or staff) only.
create or replace function public.rackline_transfer_ownership(p uuid, to_user uuid, keep_as text default 'editor')
returns void
language plpgsql security definer set search_path = public as $$
declare target public.rackline_project_members%rowtype;
begin
  if coalesce(public.rackline_role(p), '') not in ('owner', 'staff') then
    raise exception 'Only the project owner can transfer ownership.' using errcode = '42501';
  end if;
  select * into target from public.rackline_project_members where project_id = p and user_id = to_user for update;
  if not found then raise exception 'They need to accept an invite to this project first.' using errcode = 'P0002'; end if;
  if target.role = 'owner' then return; end if;
  perform public.rackline_set_owner(p, to_user, target.email, keep_as);
end $$;
revoke all on function public.rackline_transfer_ownership(uuid, uuid, text) from public;
grant execute on function public.rackline_transfer_ownership(uuid, uuid, text) to authenticated;
-- No insert policy: memberships are created only by the owner trigger and by
-- rackline_accept_invite().

-- Projects visible to the caller, with the caller's role.
create or replace function public.rackline_my_projects()
returns table (id uuid, name text, schema_version int, created_at timestamptz, updated_at timestamptz, role text)
language sql stable security invoker set search_path = public as $$
  select p.id, p.name, p.schema_version, p.created_at, p.updated_at, public.rackline_role(p.id)
  from public.rackline_projects p
  order by p.updated_at desc
$$;

-- ── Invites ──────────────────────────────────────────────────────────────────
create table if not exists public.rackline_invites (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.rackline_projects (id) on delete cascade,
  email        text not null check (email = lower(email) and position('@' in email) > 1),
  role         text not null check (role in ('owner', 'editor', 'copier', 'viewer')),
  -- 64 hex chars from two v4 UUIDs (~244 random bits); the link is the credential.
  token        text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invited_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null
);
create index if not exists rackline_invites_project_idx on public.rackline_invites (project_id, created_at desc);
alter table public.rackline_invites drop constraint if exists rackline_invites_role_check;
alter table public.rackline_invites add constraint rackline_invites_role_check
  check (role in ('owner', 'editor', 'copier', 'viewer'));
-- Declining hides an invite from the invitee's inbox; owners still see it in Share.
alter table public.rackline_invites add column if not exists declined_at timestamptz;
create index if not exists rackline_invites_email_idx on public.rackline_invites (email) where accepted_at is null;
alter table public.rackline_invites enable row level security;

drop policy if exists "owners see invites"    on public.rackline_invites;
drop policy if exists "owners create invites" on public.rackline_invites;
drop policy if exists "owners revoke invites" on public.rackline_invites;
create policy "owners see invites" on public.rackline_invites
  for select using (public.rackline_role(project_id) in ('owner', 'staff'));
create policy "owners create invites" on public.rackline_invites
  for insert with check (
    invited_by = auth.uid()
    and public.rackline_role(project_id) in ('owner', 'staff')
    and (role <> 'owner' or public.is_drybulb_staff())
  );
create policy "owners revoke invites" on public.rackline_invites
  for delete using (public.rackline_role(project_id) in ('owner', 'staff'));

-- What an invite link shows before sign-in (the token itself is the secret).
create or replace function public.rackline_invite_preview(t text)
returns table (project_name text, invited_by text, email_hint text, role text, status text)
language sql stable security definer set search_path = public as $$
  select p.name,
         coalesce(mp.full_name, 'Drybulb'),
         left(i.email, 1) || '•••' || substr(i.email, position('@' in i.email)),
         i.role,
         case when i.accepted_at is not null then 'accepted'
              when i.expires_at < now() then 'expired'
              else 'open' end
  from public.rackline_invites i
  join public.rackline_projects p on p.id = i.project_id
  left join public.member_profiles mp on mp.user_id = i.invited_by
  where i.token = t
$$;

-- Accept an invite as the signed-in user. Returns the project id.
create or replace function public.rackline_accept_invite(t text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv public.rackline_invites%rowtype;
  me  text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then raise exception 'Sign in to accept this invite.' using errcode = '28000'; end if;
  select * into inv from public.rackline_invites where token = t for update;
  if not found then raise exception 'This invite link is not valid.' using errcode = 'P0002'; end if;
  if inv.accepted_at is not null then
    if inv.accepted_by = auth.uid() then return inv.project_id; end if;
    raise exception 'This invite has already been used.' using errcode = 'P0001';
  end if;
  if inv.expires_at < now() then raise exception 'This invite has expired. Ask for a new one.' using errcode = 'P0001'; end if;
  if inv.email <> me then
    raise exception 'This invite was sent to a different email address. Sign in with that account.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.member_profiles where user_id = auth.uid()) then
    raise exception 'Complete registration first.' using errcode = 'P0001';
  end if;
  if inv.role = 'owner' then
    -- A staff hand-over: the invitee becomes the one owner; the previous owner an editor.
    perform public.rackline_set_owner(inv.project_id, auth.uid(), me, 'editor');
  else
    insert into public.rackline_project_members (project_id, user_id, role, email, added_by)
    values (inv.project_id, auth.uid(), inv.role, me, inv.invited_by)
    on conflict (project_id, user_id) do update
      set role = case when public.rackline_project_members.role = 'owner' then 'owner' else excluded.role end;
  end if;
  update public.rackline_invites set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.project_id;
end $$;

-- The signed-in user's invite inbox: open invites addressed to their account email,
-- one per project (newest), skipping projects they already belong to. Relies on the
-- JWT email being verified — true for Google and email-code sign-in; never turn off
-- email confirmation, or anyone could claim another person's invites.
create or replace function public.rackline_my_invites()
returns table (token text, project_id uuid, project_name text, invited_by text, role text, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select * from (
    select distinct on (i.project_id)
           i.token, i.project_id, p.name, coalesce(mp.full_name, 'Drybulb'), i.role, i.created_at, i.expires_at
    from public.rackline_invites i
    join public.rackline_projects p on p.id = i.project_id
    left join public.member_profiles mp on mp.user_id = i.invited_by
    where auth.uid() is not null
      and i.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and i.accepted_at is null and i.declined_at is null and i.expires_at > now()
      and not exists (select 1 from public.rackline_project_members m
                      where m.project_id = i.project_id and m.user_id = auth.uid())
    order by i.project_id, i.created_at desc
  ) x
  order by x.created_at desc
$$;

-- Decline (every open invite to that project for the caller's email).
create or replace function public.rackline_decline_invite(t text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  update public.rackline_invites set declined_at = now()
   where email = me and accepted_at is null and declined_at is null
     and project_id = (select project_id from public.rackline_invites where token = t and email = me);
end $$;

revoke all on function public.rackline_my_invites() from public;
revoke all on function public.rackline_decline_invite(text) from public;
grant execute on function public.rackline_my_invites() to authenticated;
grant execute on function public.rackline_decline_invite(text) to authenticated;

revoke all on function public.rackline_accept_invite(text) from public;
grant execute on function public.rackline_accept_invite(text) to authenticated;
grant execute on function public.rackline_invite_preview(text) to anon, authenticated;
grant execute on function public.rackline_role(uuid) to authenticated;
grant execute on function public.is_drybulb_staff() to authenticated;
grant execute on function public.rackline_my_projects() to authenticated;

-- ── Change requests ─────────────────────────────────────────────────────────
-- Editors never overwrite the owner's project directly. They send their version
-- from their own copy and the owner accepts it (replacing the design), declines it,
-- or opens the editor's copy itself instead (view-only, live; the original is left
-- alone). One open request per editor per project; sending again replaces it.
create table if not exists public.rackline_change_requests (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.rackline_projects (id) on delete cascade,
  author_id     uuid not null references auth.users (id) on delete cascade,
  author_email  text not null,
  doc           jsonb not null,
  base_updated_at timestamptz not null,  -- the owner's version the change started from
  note          text check (note is null or length(note) <= 1000),
  status        text not null default 'open' check (status in ('open', 'accepted', 'partial', 'rejected')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references auth.users (id) on delete set null
);
create unique index if not exists rackline_change_open_idx on public.rackline_change_requests (project_id, author_id) where status = 'open';
create index if not exists rackline_change_project_idx on public.rackline_change_requests (project_id, created_at desc);
-- The editor's own copy the request came from (opened by the owner on request).
alter table public.rackline_change_requests add column if not exists base_doc jsonb;
alter table public.rackline_change_requests drop constraint if exists rackline_change_requests_status_check;
alter table public.rackline_change_requests add constraint rackline_change_requests_status_check
  check (status in ('open', 'accepted', 'partial', 'rejected'));
alter table public.rackline_change_requests add column if not exists copy_id uuid references public.rackline_projects (id) on delete set null;
alter table public.rackline_change_requests enable row level security;

drop policy if exists "authors and owners read" on public.rackline_change_requests;
drop policy if exists "authors withdraw"        on public.rackline_change_requests;
create policy "authors and owners read" on public.rackline_change_requests
  for select using (author_id = auth.uid() or public.rackline_role(project_id) in ('owner', 'staff'));
create policy "authors withdraw" on public.rackline_change_requests
  for delete using (author_id = auth.uid() and status = 'open');
-- No insert/update policies: requests are sent and decided only through the functions below.

-- Send (or replace) the caller's open change request. Editors only. `c` is the
-- caller's own copy (a project they own whose source is p), or null.
-- `bd` is the original's design the editor started from (for change-by-change review).
drop function if exists public.rackline_propose_change(uuid, jsonb, timestamptz, text);
drop function if exists public.rackline_propose_change(uuid, jsonb, timestamptz, text, uuid);
create or replace function public.rackline_propose_change(p uuid, d jsonb, base timestamptz, msg text default null, c uuid default null, bd jsonb default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if public.rackline_role(p) is distinct from 'editor' then
    raise exception 'Only editors on this project can send changes.' using errcode = '42501';
  end if;
  if c is not null and not exists (select 1 from public.rackline_projects
                                   where id = c and user_id = auth.uid() and source_id = p) then
    raise exception 'That copy is not yours, or was not made from this project.' using errcode = '42501';
  end if;
  insert into public.rackline_change_requests (project_id, author_id, author_email, doc, base_updated_at, note, copy_id, base_doc)
  values (p, auth.uid(), lower(coalesce(auth.jwt() ->> 'email', '')), d, base, nullif(trim(msg), ''), c, bd)
  on conflict (project_id, author_id) where status = 'open' do update
    set doc = excluded.doc, base_updated_at = excluded.base_updated_at, note = excluded.note,
        copy_id = excluded.copy_id, base_doc = excluded.base_doc, created_at = now()
  returning id into rid;
  return rid;
end $$;

-- Owner (or staff) accepts or rejects. Accepting replaces the project's design with
-- the proposed one (the project keeps its name) and returns the new updated_at.
create or replace function public.rackline_decide_change(r uuid, accept boolean)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  req public.rackline_change_requests%rowtype;
  ts  timestamptz;
begin
  select * into req from public.rackline_change_requests where id = r for update;
  if not found or req.status <> 'open' then raise exception 'That change request is no longer open.' using errcode = 'P0001'; end if;
  if coalesce(public.rackline_role(req.project_id), '') not in ('owner', 'staff') then
    raise exception 'Only the project owner can accept or reject changes.' using errcode = '42501';
  end if;
  if accept then
    update public.rackline_projects
       set doc = jsonb_set(req.doc, '{name}', to_jsonb(name)),
           schema_version = coalesce((req.doc ->> 'schemaVersion')::int, schema_version),
           updated_at = now()
     where id = req.project_id
    returning updated_at into ts;
  end if;
  update public.rackline_change_requests
     set status = case when accept then 'accepted' else 'rejected' end, decided_at = now(), decided_by = auth.uid()
   where id = r;
  return ts;
end $$;

-- Owner (or staff) opens the editor's copy instead of merging: adds the caller as a
-- viewer of that copy (live, read-only) and returns its id. The original is unchanged
-- and the request stays open, so it can still be accepted or declined later.
create or replace function public.rackline_open_change_copy(r uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare req public.rackline_change_requests%rowtype;
begin
  select * into req from public.rackline_change_requests where id = r;
  if not found then raise exception 'That change request no longer exists.' using errcode = 'P0002'; end if;
  if coalesce(public.rackline_role(req.project_id), '') not in ('owner', 'staff') then
    raise exception 'Only the project owner can open this copy.' using errcode = '42501';
  end if;
  if req.copy_id is null or not exists (select 1 from public.rackline_projects where id = req.copy_id) then
    raise exception 'Their copy is no longer available.' using errcode = 'P0002';
  end if;
  insert into public.rackline_project_members (project_id, user_id, role, email, added_by)
  values (req.copy_id, auth.uid(), 'viewer', lower(coalesce(auth.jwt() ->> 'email', '')), req.author_id)
  on conflict (project_id, user_id) do nothing;
  return req.copy_id;
end $$;

-- Owner (or staff) closes a request after reviewing it change by change. The owner
-- writes the chosen changes to the project themselves (an ordinary owner save);
-- this records the outcome: accepted (all), partial (some) or rejected (none).
create or replace function public.rackline_resolve_change(r uuid, outcome text)
returns void
language plpgsql security definer set search_path = public as $$
declare req public.rackline_change_requests%rowtype;
begin
  if outcome not in ('accepted', 'partial', 'rejected') then raise exception 'Unknown outcome.' using errcode = '22023'; end if;
  select * into req from public.rackline_change_requests where id = r for update;
  if not found or req.status <> 'open' then raise exception 'That change request is no longer open.' using errcode = 'P0001'; end if;
  if coalesce(public.rackline_role(req.project_id), '') not in ('owner', 'staff') then
    raise exception 'Only the project owner can accept or reject changes.' using errcode = '42501';
  end if;
  update public.rackline_change_requests set status = outcome, decided_at = now(), decided_by = auth.uid() where id = r;
end $$;

revoke all on function public.rackline_resolve_change(uuid, text) from public;
grant execute on function public.rackline_resolve_change(uuid, text) to authenticated;
revoke all on function public.rackline_propose_change(uuid, jsonb, timestamptz, text, uuid, jsonb) from public;
revoke all on function public.rackline_decide_change(uuid, boolean) from public;
revoke all on function public.rackline_open_change_copy(uuid) from public;
grant execute on function public.rackline_propose_change(uuid, jsonb, timestamptz, text, uuid, jsonb) to authenticated;
grant execute on function public.rackline_decide_change(uuid, boolean) to authenticated;
grant execute on function public.rackline_open_change_copy(uuid) to authenticated;

-- ── Notices ──────────────────────────────────────────────────────────────────
-- When a project is deleted, every other member gets a notice (shown in their
-- Rackline / dashboard until dismissed, and instantly to anyone who has it open).
-- project_id has no foreign key on purpose: the project is gone.
create table if not exists public.rackline_notices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('deleted')),
  project_id    uuid not null,
  project_name  text not null,
  actor_email   text,
  created_at    timestamptz not null default now(),
  seen_at       timestamptz
);
create index if not exists rackline_notices_user_idx on public.rackline_notices (user_id, created_at desc);
alter table public.rackline_notices enable row level security;

drop policy if exists "own notices read"    on public.rackline_notices;
drop policy if exists "own notices dismiss" on public.rackline_notices;
drop policy if exists "own notices delete"  on public.rackline_notices;
create policy "own notices read" on public.rackline_notices
  for select using (auth.uid() = user_id);
create policy "own notices dismiss" on public.rackline_notices
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own notices delete" on public.rackline_notices
  for delete using (auth.uid() = user_id);
-- No insert policy: notices are written only by the trigger below.

create or replace function public.rackline_notify_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.rackline_notices (user_id, kind, project_id, project_name, actor_email)
  select m.user_id, 'deleted', old.id, old.name, (select email from auth.users where id = auth.uid())
    from public.rackline_project_members m
   where m.project_id = old.id and m.user_id is distinct from auth.uid();
  return old;
end $$;
drop trigger if exists rackline_projects_notify_deleted on public.rackline_projects;
create trigger rackline_projects_notify_deleted before delete on public.rackline_projects
  for each row execute function public.rackline_notify_deleted();

-- ── Live sync ────────────────────────────────────────────────────────────────
-- Each project is ONE row shared by all its members. Publishing the table to
-- Supabase Realtime lets every open copy hear about a save immediately (RLS still
-- decides who receives which rows); the app also re-checks on focus and every 30 s.
-- Members and change requests are published too, so role changes and sent /
-- accepted changes reach open copies.
do $$
declare t text;
begin
  foreach t in array array['rackline_projects', 'rackline_project_members', 'rackline_change_requests', 'rackline_notices'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── Staff seed ───────────────────────────────────────────────────────────────
-- Sign in to drybulb.com once first so the auth user exists, then run:
insert into public.drybulb_staff (user_id)
select id from auth.users where lower(email) = 'eric@drybulb.com'
on conflict do nothing;

-- Verify:
-- select tablename, policyname, cmd from pg_policies where tablename like 'rackline_%' or tablename in ('member_profiles','drybulb_staff') order by 1, 2;
-- select * from public.drybulb_staff;
