-- Répartition par rareté des exemplaires de yugioh.collection, qui reste la source du total. Les exemplaires obtenus
-- avant cette table n'y sont pas : leur rareté est inconnue (quantité de collection moins la somme des raretés).
create table yugioh.collection_rarities (
  user_id uuid not null,
  card_code integer not null,
  rarity text not null check (rarity in ('common', 'shortprint', 'rare', 'super', 'ultra', 'ultimate', 'secret')),
  quantity integer not null check (quantity > 0),
  primary key (user_id, card_code, rarity),
  foreign key (user_id, card_code) references yugioh.collection on delete cascade
);

grant select, insert, update, delete on yugioh.collection_rarities to yugioh_server;
alter table yugioh.collection_rarities enable row level security;
create policy server_all on yugioh.collection_rarities to yugioh_server using (true) with check (true);
