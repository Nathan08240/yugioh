-- Page d'administration : signalements marqués comme traités, et erreurs du navigateur envoyées par le client.
-- Ajout seul : le serveur ne peut toujours ni modifier le texte d'un signalement ni en supprimer.
alter table yugioh.bug_reports add column handled_at timestamptz;
grant update (handled_at) on yugioh.bug_reports to yugioh_server;

-- Une ligne par erreur distincte (empreinte du type, du message et du début de la pile) : les répétitions incrémentent `count`.
-- `user_id` est le dernier compte touché, seule donnée personnelle gardée. Le serveur ne garde que les 500 dernières erreurs vues.
create table yugioh.client_errors (
  id bigint generated always as identity primary key,
  fingerprint text not null unique check (char_length(fingerprint) = 64),
  kind text not null check (kind in ('error', 'rejection', 'render')),
  message text not null check (char_length(message) <= 300),
  stack text not null default '' check (char_length(stack) <= 2000),
  page text not null default '' check (char_length(page) <= 100),
  build text not null default '' check (char_length(build) <= 40),
  browser text not null default '' check (char_length(browser) <= 200),
  user_id uuid references yugioh.profiles on delete set null,
  count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index client_errors_seen_idx on yugioh.client_errors (count desc, last_seen_at desc);

grant select, insert, update, delete on yugioh.client_errors to yugioh_server;
alter table yugioh.client_errors enable row level security;
create policy server_all on yugioh.client_errors to yugioh_server using (true) with check (true);
