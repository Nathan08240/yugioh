-- Sessions du mode Draft : le joueur et 3 bots draftent 6 boosters virtuels d'un même set (jamais ajoutés à la collection),
-- puis la session se joue comme le Scellé. Table à part : l'index unique de sealed_runs compte une session par joueur, tous modes.
create table yugioh.draft_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references yugioh.profiles on delete cascade,
  set_code text not null,
  round smallint not null default 1 check (round between 1 and 6),
  -- packs[s] : le booster devant le drafteur s (0 le joueur, 1 à 3 les bots) ; bots[s - 1] : les cartes gardées par le bot s.
  -- Cartes au format {code, rarity}.
  packs jsonb not null check (jsonb_typeof(packs) = 'array'),
  bots jsonb not null check (jsonb_typeof(bots) = 'array'),
  -- Cartes gardées par le joueur, un exemplaire par entrée, rarities[i] est la rareté de pool[i].
  pool integer[] not null default '{}' check (cardinality(pool) <= 54),
  rarities text[] not null default '{}' check (cardinality(rarities) = cardinality(pool)),
  deck integer[] check (cardinality(deck) <= 60),
  extra integer[] check (cardinality(extra) <= 15),
  wins smallint not null default 0 check (wins between 0 and 3),
  losses smallint not null default 0 check (losses between 0 and 2),
  status text not null default 'drafting' check (status in ('drafting', 'building', 'playing', 'done', 'abandoned')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index draft_runs_current_key on yugioh.draft_runs (user_id) where status in ('drafting', 'building', 'playing');

grant select, insert, update on yugioh.draft_runs to yugioh_server;
alter table yugioh.draft_runs enable row level security;
create policy server_all on yugioh.draft_runs to yugioh_server using (true) with check (true);
