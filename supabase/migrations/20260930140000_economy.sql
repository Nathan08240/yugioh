-- Économie : points de collection, garantie Ultra Rare, récompense du jour, plafond des boosters de rejeu.
-- Points gagnés en convertissant les doublons (au-delà de 3 exemplaires), dépensés pour obtenir une carte précise.
alter table yugioh.profiles add column collection_points integer not null default 0 check (collection_points >= 0);
-- Jour (Europe/Paris) de la dernière récompense du jour, nul tant qu'aucune n'a été reçue.
alter table yugioh.profiles add column daily_on date;
-- Boosters de rejeu d'histoire accordés le jour replay_on (Europe/Paris), 2 au plus par jour.
alter table yugioh.profiles add column replay_on date;
alter table yugioh.profiles add column replay_boosters integer not null default 0 check (replay_boosters >= 0);
-- Boosters ouverts d'affilée sans Ultra Rare ou mieux : le suivant en contient une une fois 20 atteints. 0 pour les ouvertures passées.
alter table yugioh.booster_state add column since_ultra integer not null default 0 check (since_ultra >= 0);

-- Journal en ajout seul des conversions (points > 0) et des cartes obtenues avec des points (points < 0).
-- rarity est nulle pour un exemplaire de rareté inconnue (obtenu avant yugioh.collection_rarities).
create table yugioh.collection_exchanges (
  id bigint generated always as identity primary key,
  user_id uuid not null references yugioh.profiles on delete cascade,
  kind text not null check (kind in ('convert', 'craft')),
  card_code integer not null check (card_code > 0),
  rarity text check (rarity in ('common', 'shortprint', 'rare', 'super', 'ultra', 'ultimate', 'secret')),
  quantity integer not null check (quantity > 0),
  points integer not null,
  created_at timestamptz not null default now()
);
create index collection_exchanges_user_idx on yugioh.collection_exchanges (user_id, created_at desc);

grant select, insert on yugioh.collection_exchanges to yugioh_server;
alter table yugioh.collection_exchanges enable row level security;
create policy server_all on yugioh.collection_exchanges to yugioh_server using (true) with check (true);
