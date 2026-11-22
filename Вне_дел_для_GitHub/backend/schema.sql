-- Вне дел: public — только общедоступные профили и публикации.
-- Почта хранится в auth.users и не попадает в публичные таблицы.
begin;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null check (char_length(name) between 1 and 60),
 city text not null default '' check (char_length(city) <= 50),
 bio text not null default '' check (char_length(bio) <= 500)
);
create table if not exists public.boards (
 user_id uuid primary key references auth.users(id) on delete cascade,
 data jsonb not null default '{"interests":[],"saved":[],"statuses":{},"notes":{}}'::jsonb,
 updated_at timestamptz not null default now(),
 constraint board_size check (octet_length(data::text) <= 100000)
);
create table if not exists public.posts (
 id text primary key check (id ~ '^post-[a-zA-Z0-9-]{1,80}$'),
 user_id uuid not null references public.profiles(id) on delete cascade,
 data jsonb not null,
 created_at timestamptz not null default now(),
 constraint post_size check (octet_length(data::text) <= 12000),
 constraint post_owner check (data->>'authorId' = user_id::text and data->>'id' = id)
);
create table if not exists public.messages (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check (kind in ('idea','wall')),
 target_id text not null check (char_length(target_id) between 1 and 100),
 body text not null check (char_length(body) between 1 and 300),
 created_at timestamptz not null default now()
);
create index if not exists messages_target_idx on public.messages(kind,target_id,created_at);
alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.posts enable row level security;
alter table public.messages enable row level security;
-- Явные разрешения необходимы: автоматическую выдачу доступа новым таблицам не включаем.
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.posts, public.messages to anon, authenticated;
grant insert, update on public.profiles, public.posts to authenticated;
grant select, insert, update on public.boards to authenticated;
grant insert on public.messages to authenticated;
create policy profiles_read on public.profiles for select using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy boards_private_read on public.boards for select to authenticated using ((select auth.uid()) = user_id);
create policy boards_private_insert on public.boards for insert to authenticated with check ((select auth.uid()) = user_id);
create policy boards_private_update on public.boards for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy posts_read on public.posts for select using (true);
create policy posts_insert on public.posts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy posts_update on public.posts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy messages_read on public.messages for select using (true);
create policy messages_insert on public.messages for insert to authenticated with check ((select auth.uid()) = user_id);
commit;
