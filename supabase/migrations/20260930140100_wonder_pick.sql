-- Pioche miracle : un tirage de 5 cartes par joueur et par jour (date Europe/Paris), dont le joueur garde une carte à l'aveugle.
-- `cards` et `rarities` sont dans l'ordre où les cartes sont montrées face visible ; la carte face cachée n° i est celle
-- de rang `shuffle[i]`. `picked` est le n° face cachée choisi, null tant que le joueur n'a pas choisi.
create table yugioh.wonder_picks (
  user_id uuid not null references yugioh.profiles on delete cascade,
  day date not null default (now() at time zone 'Europe/Paris')::date,
  set_code text not null,
  cards integer[] not null check (cardinality(cards) = 5),
  rarities text[] not null check (cardinality(rarities) = 5),
  shuffle integer[] not null check (cardinality(shuffle) = 5),
  drawn_at timestamptz not null default now(),
  picked smallint check (picked between 0 and 4),
  picked_at timestamptz,
  check ((picked is null) = (picked_at is null)),
  primary key (user_id, day)
);

-- Le serveur ne peut modifier que le choix : le tirage reste celui enregistré.
grant select, insert on yugioh.wonder_picks to yugioh_server;
grant update (picked, picked_at) on yugioh.wonder_picks to yugioh_server;
alter table yugioh.wonder_picks enable row level security;
create policy server_all on yugioh.wonder_picks to yugioh_server using (true) with check (true);
