-- Mode classé : classement Elo du joueur (1000 au départ) et nombre de duels classés joués.
alter table yugioh.profiles
  add column rating integer not null default 1000,
  add column ranked_games integer not null default 0 check (ranked_games >= 0);
create index profiles_rating_idx on yugioh.profiles (rating desc) where ranked_games > 0;

-- Journal des duels classés, en ajout seul : joueurs par siège, gagnant (nul pour une égalité), classements avant et après.
create table yugioh.ranked_matches (
  id bigint generated always as identity primary key,
  player_a uuid not null references yugioh.profiles on delete cascade,
  player_b uuid not null references yugioh.profiles on delete cascade,
  winner uuid references yugioh.profiles on delete cascade,
  rating_a_before integer not null,
  rating_a_after integer not null,
  rating_b_before integer not null,
  rating_b_after integer not null,
  reason integer not null,
  played_at timestamptz not null default now(),
  check (winner in (player_a, player_b))
);

grant select, insert on yugioh.ranked_matches to yugioh_server;
alter table yugioh.ranked_matches enable row level security;
create policy server_all on yugioh.ranked_matches to yugioh_server using (true) with check (true);
