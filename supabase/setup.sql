-- Run once in a NEW, dedicated Supabase project, using SQL Editor.
-- No anonymous browser access: only the server's service_role may access this data.
create table if not exists public.requests (
 id text primary key,
 token text not null,
 category text not null check (category in ('addition','problem')),
 kind text not null check (kind in ('series','movie','channel')),
 title text not null,
 language text not null check (language in ('subtitled','dubbed','original')),
 season text, episode text, issue text, notes text, attachment text, mime text,
 status text not null default 'new' check (status in ('new','working','done','declined')),
 reply text not null default '',
 created timestamptz not null
);
create index if not exists requests_created_idx on public.requests (created desc);
create index if not exists requests_attachment_idx on public.requests (attachment);
alter table public.requests enable row level security;
revoke all on public.requests from anon, authenticated;
grant select, insert, update, delete on public.requests to service_role;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('softtv-attachments','softtv-attachments',false,15728640,
 array['image/jpeg','image/png','image/webp','video/mp4','video/webm'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
