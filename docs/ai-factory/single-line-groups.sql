-- Account-global library of reusable single-line groups (lib/factory/groups.ts).
-- Apply in the Supabase SQL editor. Mirrors the cost_models RLS pattern: every row
-- is owned by auth.uid() and only the owner can read/write it.

create table if not exists public.single_line_groups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists single_line_groups_user_idx on public.single_line_groups (user_id, updated_at desc);

-- No duplicate group names per user (the app also dedupes by name on save).
create unique index if not exists single_line_groups_user_name_uidx on public.single_line_groups (user_id, name);

alter table public.single_line_groups enable row level security;

-- Idempotent: drop-then-create so re-running can't half-apply (a missing SELECT
-- policy is the usual cause of "saved but can't import").
drop policy if exists "owner can read"   on public.single_line_groups;
drop policy if exists "owner can insert" on public.single_line_groups;
drop policy if exists "owner can update" on public.single_line_groups;
drop policy if exists "owner can delete" on public.single_line_groups;

create policy "owner can read" on public.single_line_groups
  for select using (auth.uid() = user_id);
create policy "owner can insert" on public.single_line_groups
  for insert with check (auth.uid() = user_id);
create policy "owner can update" on public.single_line_groups
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner can delete" on public.single_line_groups
  for delete using (auth.uid() = user_id);

-- Verify the 4 policies exist:
-- select policyname, cmd from pg_policies where tablename = 'single_line_groups';
