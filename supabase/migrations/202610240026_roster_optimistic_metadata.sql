begin;

alter table public.neighborhood_trade_rosters
  add column updated_at timestamptz not null default now(),
  add column version bigint not null default 1;

commit;
