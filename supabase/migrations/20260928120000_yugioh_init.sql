-- Schéma du jeu Yu-Gi-Oh!, écrit uniquement par le serveur de jeu (rôle yugioh_server).
create schema yugioh;

create table yugioh.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pseudo text not null check (pseudo ~ '^[A-Za-z0-9_-]{3,20}$'),
  created_at timestamptz not null default now()
);
create unique index profiles_pseudo_key on yugioh.profiles (lower(pseudo));

-- Cartes possédées, identifiées par leur passcode ocgcore.
create table yugioh.collection (
  user_id uuid not null references yugioh.profiles on delete cascade,
  card_code integer not null check (card_code > 0),
  quantity integer not null check (quantity > 0),
  primary key (user_id, card_code)
);

create table yugioh.decks (
  id bigint generated always as identity primary key,
  user_id uuid not null references yugioh.profiles on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  main_deck integer[] not null default '{}' check (cardinality(main_deck) <= 60),
  extra_deck integer[] not null default '{}' check (cardinality(extra_deck) <= 15),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table yugioh.booster_state (
  user_id uuid primary key references yugioh.profiles on delete cascade,
  next_free_at timestamptz not null default now(),
  pending integer not null default 0 check (pending >= 0)
);

-- Journal des ouvertures (audit anti-triche) : le serveur n'a ni UPDATE ni DELETE dessus.
create table yugioh.booster_openings (
  id bigint generated always as identity primary key,
  user_id uuid not null references yugioh.profiles on delete cascade,
  set_code text not null,
  source text not null check (source in ('free', 'earned')),
  cards integer[] not null check (cardinality(cards) > 0),
  opened_at timestamptz not null default now()
);
create index booster_openings_user_idx on yugioh.booster_openings (user_id, opened_at desc);

create table yugioh.story_duels (
  user_id uuid not null references yugioh.profiles on delete cascade,
  duel_id text not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, duel_id)
);

create table yugioh.story_unlocks (
  user_id uuid not null references yugioh.profiles on delete cascade,
  unlock_id text not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, unlock_id)
);

-- Rôle du serveur, créé sans mot de passe : le propriétaire le définit à la main
-- (alter role yugioh_server password '...'), jamais dans une migration.
create role yugioh_server login;
grant usage on schema yugioh to yugioh_server;
grant select, insert, update, delete on
  yugioh.profiles, yugioh.collection, yugioh.decks, yugioh.booster_state,
  yugioh.story_duels, yugioh.story_unlocks
  to yugioh_server;
grant select, insert on yugioh.booster_openings to yugioh_server;

-- RLS partout : seul yugioh_server a une politique, anon et authenticated n'ont rien.
alter table yugioh.profiles enable row level security;
alter table yugioh.collection enable row level security;
alter table yugioh.decks enable row level security;
alter table yugioh.booster_state enable row level security;
alter table yugioh.booster_openings enable row level security;
alter table yugioh.story_duels enable row level security;
alter table yugioh.story_unlocks enable row level security;

create policy server_all on yugioh.profiles to yugioh_server using (true) with check (true);
create policy server_all on yugioh.collection to yugioh_server using (true) with check (true);
create policy server_all on yugioh.decks to yugioh_server using (true) with check (true);
create policy server_all on yugioh.booster_state to yugioh_server using (true) with check (true);
create policy server_all on yugioh.booster_openings to yugioh_server using (true) with check (true);
create policy server_all on yugioh.story_duels to yugioh_server using (true) with check (true);
create policy server_all on yugioh.story_unlocks to yugioh_server using (true) with check (true);
