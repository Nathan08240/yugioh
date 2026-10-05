-- Derniers duels terminés de chaque joueur humain, à revoir depuis le profil : de quoi rejouer le duel (graine, règles, decks,
-- réponses, fin) au format des signalements. Le serveur n'en garde que 20 par joueur et supprime les plus anciens.
-- Comme les tables voisines, seul le serveur y accède : il ne lit à un joueur que ses propres duels.
create table yugioh.duel_replays (
  id bigint generated always as identity primary key,
  user_id uuid not null references yugioh.profiles on delete cascade,
  seat smallint not null check (seat in (0, 1)),
  mode text not null check (mode in ('online', 'ranked', 'event', 'bot', 'story', 'tower', 'sealed', 'draft', 'puzzle', 'tutorial')),
  opponent text,
  -- Nul pour un match nul.
  won boolean,
  payload jsonb not null check (octet_length(payload::text) <= 1048576),
  played_at timestamptz not null default now()
);
create index duel_replays_user_idx on yugioh.duel_replays (user_id, id desc);

grant select, insert, delete on yugioh.duel_replays to yugioh_server;
alter table yugioh.duel_replays enable row level security;
create policy server_all on yugioh.duel_replays to yugioh_server using (true) with check (true);
