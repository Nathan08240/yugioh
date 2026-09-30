-- Sessions du mode Scellé : réserve de 6 boosters virtuels (jamais ajoutée à la collection), deck construit avec elle,
-- duels contre le bot jusqu'à 3 victoires ou 2 défaites. Une seule session en cours par joueur.
create table yugioh.sealed_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references yugioh.profiles on delete cascade,
  set_code text not null,
  -- Un exemplaire par entrée, rarities[i] est la rareté de pool[i].
  pool integer[] not null check (cardinality(pool) > 0),
  rarities text[] not null check (cardinality(rarities) = cardinality(pool)),
  deck integer[] check (cardinality(deck) <= 60),
  extra integer[] check (cardinality(extra) <= 15),
  wins smallint not null default 0 check (wins between 0 and 3),
  losses smallint not null default 0 check (losses between 0 and 2),
  status text not null default 'building' check (status in ('building', 'playing', 'done', 'abandoned')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index sealed_runs_current_key on yugioh.sealed_runs (user_id) where status in ('building', 'playing');

grant select, insert, update on yugioh.sealed_runs to yugioh_server;
alter table yugioh.sealed_runs enable row level security;
create policy server_all on yugioh.sealed_runs to yugioh_server using (true) with check (true);
