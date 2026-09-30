-- Liste de souhaits : cartes du pool que le joueur aimerait obtenir (100 au maximum, limite tenue par le serveur).
create table yugioh.wishlist (
  user_id uuid not null references yugioh.profiles on delete cascade,
  card_code integer not null check (card_code > 0),
  added_at timestamptz not null default now(),
  primary key (user_id, card_code)
);

grant select, insert, delete on yugioh.wishlist to yugioh_server;
alter table yugioh.wishlist enable row level security;
create policy server_all on yugioh.wishlist to yugioh_server using (true) with check (true);
