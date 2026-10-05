-- Échanges de cartes entre amis, 1 contre 1 : from_id donne un exemplaire de give_code contre un exemplaire de take_code de to_id.
-- Une offre en attente expire 24 h après created_at (filtre du serveur) ; refusée ou annulée, elle est supprimée. Les échanges
-- acceptés restent : ils comptent pour la limite de 3 par joueur et par jour (Europe/Paris, jour de decided_at).
create table yugioh.trades (
  id bigint generated always as identity primary key,
  from_id uuid not null references yugioh.profiles on delete cascade,
  to_id uuid not null references yugioh.profiles on delete cascade,
  give_code integer not null check (give_code > 0),
  take_code integer not null check (take_code > 0),
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (from_id <> to_id),
  check (give_code <> take_code),
  check ((status = 'accepted') = (decided_at is not null))
);
create index trades_from_idx on yugioh.trades (from_id, created_at desc);
create index trades_to_idx on yugioh.trades (to_id, created_at desc);

grant select, insert, update, delete on yugioh.trades to yugioh_server;
alter table yugioh.trades enable row level security;
create policy server_all on yugioh.trades to yugioh_server using (true) with check (true);
