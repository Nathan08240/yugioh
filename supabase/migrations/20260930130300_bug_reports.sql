-- Signalements de problème pendant ou après un duel : de quoi le rejouer exactement (graine, règles, decks, réponses).
-- Ajout seul : le serveur ne peut ni modifier ni supprimer un signalement.
create table yugioh.bug_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references yugioh.profiles on delete cascade,
  message text not null default '' check (char_length(message) <= 500),
  payload jsonb not null check (octet_length(payload::text) <= 1048576),
  created_at timestamptz not null default now()
);
create index bug_reports_user_idx on yugioh.bug_reports (user_id, created_at desc);

grant select, insert on yugioh.bug_reports to yugioh_server;
alter table yugioh.bug_reports enable row level security;
create policy server_all on yugioh.bug_reports to yugioh_server using (true) with check (true);
