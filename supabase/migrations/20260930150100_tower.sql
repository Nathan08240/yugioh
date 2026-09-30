-- Mode Tour : étages gagnés dans la tentative en cours (le prochain duel est l'étage suivant) et record d'une tentative.
-- Les récompenses des paliers sont gardées dans yugioh.story_unlocks ('tower:3', 'tower:6', 'tower:10').
alter table yugioh.profiles add column tower_floor smallint not null default 0 check (tower_floor between 0 and 10);
alter table yugioh.profiles add column tower_best smallint not null default 0 check (tower_best between 0 and 10);
