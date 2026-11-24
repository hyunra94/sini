-- 케어로그 동기화용 테이블. 사용자별로 자기 행만 읽고 쓸 수 있다.
create table if not exists public.carelog_records (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  key        text    not null,
  data       jsonb,
  updated_at bigint  not null,
  deleted    boolean not null default false,
  primary key (user_id, key)
);

alter table public.carelog_records enable row level security;

create policy "carelog own records" on public.carelog_records
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.carelog_records from anon;

-- 앱 주소와 공개 키가 알려져도 남이 가입해 테이블을 마구 채우지 못하도록 제한을 둔다.
alter table public.carelog_records
  add constraint carelog_key_format check (key ~ '^(day:\d{4}-\d{2}-\d{2}|med:[a-z0-9]{1,24}|settings)$'),
  add constraint carelog_data_size check (data is null or octet_length(data::text) <= 16000),
  add constraint carelog_updated_at_sane check (updated_at > 0);

create or replace function public.carelog_limit_rows()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.carelog_records where user_id = new.user_id) >= 5000 then
    raise exception 'carelog: record limit reached';
  end if;
  return new;
end $$;

revoke all on function public.carelog_limit_rows() from public, anon, authenticated;

create trigger carelog_limit_rows
  before insert on public.carelog_records
  for each row execute function public.carelog_limit_rows();

-- ---------- 알림 ----------
-- 기기 등록 표. 알림은 supabase/functions/carelog-notify 함수가 5분마다 확인해서 보낸다.
create table if not exists public.carelog_push (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  -- 알려진 푸시 서비스 주소만 받는다 (서버가 아무 주소로나 요청을 보내지 않도록)
  constraint carelog_push_endpoint_host check (
    length(endpoint) <= 1000 and
    endpoint ~ '^https://([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|notify\.windows\.com|push\.services\.mozilla\.com)/'),
  constraint carelog_push_key_size check (length(p256dh) between 80 and 100 and length(auth) between 16 and 32)
);
create index if not exists carelog_push_user on public.carelog_push (user_id);
alter table public.carelog_push enable row level security;
create policy "carelog own push" on public.carelog_push
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.carelog_push from anon;

create or replace function public.carelog_limit_push()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.carelog_push where user_id = new.user_id) >= 10 then
    raise exception 'carelog: device limit reached';
  end if;
  return new;
end $$;
revoke all on function public.carelog_limit_push() from public, anon, authenticated;
create trigger carelog_limit_push before insert on public.carelog_push
  for each row execute function public.carelog_limit_push();

-- 같은 알림을 두 번 보내지 않도록 남기는 기록 (서버만 읽고 쓴다)
create table if not exists public.carelog_notified (
  user_id uuid not null references auth.users (id) on delete cascade,
  key     text not null,
  at      timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.carelog_notified enable row level security;
revoke all on public.carelog_notified from anon, authenticated;

-- 서버 전용 값: 'vapid'(알림 서명 키, 함수가 처음 실행될 때 스스로 만든다), 'cron'(예약 작업 암호).
-- 정책이 없으므로 앱에서는 읽을 수 없다. 값은 저장소에 두지 않는다.
create table if not exists public.carelog_private (
  name  text primary key,
  value text not null
);
alter table public.carelog_private enable row level security;
revoke all on public.carelog_private from anon, authenticated;
insert into public.carelog_private (name, value)
  values ('cron', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (name) do nothing;

create extension if not exists pg_cron;
create extension if not exists pg_net;
-- 5분마다 함수를 부른다. 암호는 표에서 읽어 헤더로 보낸다.
select cron.schedule('carelog-notify', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://ulrfeuafmbbobxnklnuy.supabase.co/functions/v1/carelog-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.carelog_private where name = 'cron')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000)
$job$);
