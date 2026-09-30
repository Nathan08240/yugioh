-- Saisons du mode classé : un mois civil en France ('2026-10'). `season` est la saison du dernier passage du joueur
-- (nulle tant qu'il n'est entré dans aucune), `season_games` ses duels classés de cette saison.
alter table yugioh.profiles
  add column season text check (season ~ '^[0-9]{4}-[0-9]{2}$'),
  add column season_games integer not null default 0 check (season_games >= 0);
create index profiles_season_rating_idx on yugioh.profiles (season, rating desc) where season_games > 0;

-- Résultat de chaque saison terminée d'un joueur, en ajout seul : la clé primaire garde d'une double récompense.
create table yugioh.ranked_seasons (
  user_id uuid not null references yugioh.profiles on delete cascade,
  season text not null check (season ~ '^[0-9]{4}-[0-9]{2}$'),
  final_rating integer not null,
  games integer not null check (games >= 0),
  boosters integer not null check (boosters >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, season)
);
create index ranked_seasons_season_idx on yugioh.ranked_seasons (season, final_rating desc) where games > 0;

grant select, insert on yugioh.ranked_seasons to yugioh_server;
alter table yugioh.ranked_seasons enable row level security;
create policy server_all on yugioh.ranked_seasons to yugioh_server using (true) with check (true);
