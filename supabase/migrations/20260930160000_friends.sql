-- Amis : une ligne par demande (demandeur -> destinataire), 'accepted' une fois acceptée. 100 lignes au plus par joueur,
-- dans un sens ou dans l'autre (limite tenue par le serveur). La présence en ligne n'est jamais stockée.
create table yugioh.friendships (
  user_id uuid not null references yugioh.profiles on delete cascade,
  friend_id uuid not null references yugioh.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index friendships_friend_idx on yugioh.friendships (friend_id);

-- Journal des demandes envoyées, pour la limite de 20 par heure : une demande retirée compte quand même.
create table yugioh.friend_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references yugioh.profiles on delete cascade,
  created_at timestamptz not null default now()
);
create index friend_requests_user_idx on yugioh.friend_requests (user_id, created_at desc);

grant select, insert, update, delete on yugioh.friendships to yugioh_server;
grant select, insert on yugioh.friend_requests to yugioh_server;
alter table yugioh.friendships enable row level security;
alter table yugioh.friend_requests enable row level security;
create policy server_all on yugioh.friendships to yugioh_server using (true) with check (true);
create policy server_all on yugioh.friend_requests to yugioh_server using (true) with check (true);
