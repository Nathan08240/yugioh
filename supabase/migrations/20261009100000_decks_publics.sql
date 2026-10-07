-- Partage de decks par code et decks publics. Ajout seul : une copie figée du deck au moment où il est partagé ou publié,
-- indépendante du deck du joueur (modifié ou supprimé ensuite). `public` : le deck figure dans la liste des decks publics.
-- Le serveur tient les limites (10 decks publics et 50 codes de partage par joueur) et seul `copies` change après l'insertion.
create table yugioh.shared_decks (
  code text primary key check (char_length(code) = 8),
  user_id uuid not null references yugioh.profiles on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  description text not null default '' check (char_length(description) <= 200),
  main_deck integer[] not null check (cardinality(main_deck) between 40 and 60),
  extra_deck integer[] not null default '{}' check (cardinality(extra_deck) <= 15),
  public boolean not null default false,
  goat boolean not null default false,
  copies integer not null default 0 check (copies >= 0),
  created_at timestamptz not null default now()
);
create index shared_decks_user_idx on yugioh.shared_decks (user_id, public, created_at desc);
create index shared_decks_public_idx on yugioh.shared_decks (copies desc, created_at desc) where public;

-- Un joueur n'ajoute qu'une copie à un deck public, quel que soit le nombre de fois où il le copie.
create table yugioh.shared_deck_copies (
  code text not null references yugioh.shared_decks on delete cascade,
  user_id uuid not null references yugioh.profiles on delete cascade,
  primary key (code, user_id)
);

grant select, insert, delete on yugioh.shared_decks to yugioh_server;
grant update (copies) on yugioh.shared_decks to yugioh_server;
grant select, insert on yugioh.shared_deck_copies to yugioh_server;
alter table yugioh.shared_decks enable row level security;
alter table yugioh.shared_deck_copies enable row level security;
create policy server_all on yugioh.shared_decks to yugioh_server using (true) with check (true);
create policy server_all on yugioh.shared_deck_copies to yugioh_server using (true) with check (true);
