-- Résultat de chaque duel terminé pour chaque joueur humain, écrit par le serveur de jeu. Journal en ajout seul.
-- deck_id est nul si le deck a été supprimé depuis. level : niveau du bot (bot) ou de l'histoire (story).
create table yugioh.duel_results (
  id bigint generated always as identity primary key,
  user_id uuid not null references yugioh.profiles on delete cascade,
  deck_id bigint references yugioh.decks (id) on delete set null,
  mode text not null check (mode in ('online', 'bot', 'story')),
  level text,
  won boolean not null,
  reason integer not null,
  turns integer not null check (turns >= 0),
  played_at timestamptz not null default now()
);
create index duel_results_user_deck_idx on yugioh.duel_results (user_id, deck_id);

grant select, insert on yugioh.duel_results to yugioh_server;
alter table yugioh.duel_results enable row level security;
create policy server_all on yugioh.duel_results to yugioh_server using (true) with check (true);
