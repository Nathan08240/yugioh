-- Missions du jour et succès : ce que les duels comptés et les ouvertures de boosters ont apporté à un joueur, par jour
-- (Europe/Paris). summons et damage : le meilleur d'un seul duel ; les autres colonnes s'additionnent.
-- Les récompenses versées sont gardées dans yugioh.story_unlocks, une seule fois chacune ('mission:<jour>:<id>',
-- 'mission:<jour>:bonus', 'succes:<id>'), comme les adversaires en ligne déjà comptés ce jour-là ('adversaire:<jour>:<id>').
create table yugioh.mission_days (
  user_id uuid not null references yugioh.profiles on delete cascade,
  day date not null,
  wins integer not null default 0 check (wins >= 0),
  fusion_wins integer not null default 0 check (fusion_wins >= 0),
  summons integer not null default 0 check (summons >= 0),
  damage integer not null default 0 check (damage >= 0),
  story_wins integer not null default 0 check (story_wins >= 0),
  ranked integer not null default 0 check (ranked >= 0),
  boosters integer not null default 0 check (boosters >= 0),
  primary key (user_id, day)
);

grant select, insert, update on yugioh.mission_days to yugioh_server;
alter table yugioh.mission_days enable row level security;
create policy server_all on yugioh.mission_days to yugioh_server using (true) with check (true);
