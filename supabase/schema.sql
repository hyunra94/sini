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
