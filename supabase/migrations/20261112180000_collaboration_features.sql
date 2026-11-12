alter table public.document_shares
  drop constraint if exists document_shares_role_check;

alter table public.document_shares
  add constraint document_shares_role_check
  check (role in ('editor', 'viewer'));

create table if not exists public.document_presence (
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (document_id, user_id)
);

create index if not exists document_presence_last_seen_idx
  on public.document_presence (document_id, last_seen_at desc);

create table if not exists public.document_comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  created_by uuid not null references public.users(id),
  from_position integer not null check (from_position >= 0),
  to_position integer not null check (to_position > from_position),
  selected_text text not null check (char_length(selected_text) <= 5000),
  body text not null check (char_length(body) between 1 and 2000),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists document_comments_document_idx
  on public.document_comments (document_id, created_at);

create table if not exists public.document_suggestions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  created_by uuid not null references public.users(id),
  from_position integer not null check (from_position >= 0),
  to_position integer not null check (to_position > from_position),
  original_text text not null check (char_length(original_text) <= 5000),
  suggested_text text not null check (char_length(suggested_text) between 1 and 5000),
  base_revision integer not null check (base_revision >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists document_suggestions_document_idx
  on public.document_suggestions (document_id, created_at);

create table if not exists public.document_attachments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  uploaded_by uuid not null references public.users(id),
  object_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  content_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);

create index if not exists document_attachments_document_idx
  on public.document_attachments (document_id, created_at);

alter table public.document_presence enable row level security;
alter table public.document_comments enable row level security;
alter table public.document_suggestions enable row level security;
alter table public.document_attachments enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'collabdocs-attachments',
  'collabdocs-attachments',
  false,
  10485760,
  array['application/pdf', 'text/plain', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
