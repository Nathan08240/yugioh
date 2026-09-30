-- Meilleure note de chaque duel d'histoire gagné, de 1 à 3 étoiles. Les victoires déjà enregistrées valent 1 étoile.
alter table yugioh.story_duels add column stars smallint not null default 1 check (stars between 1 and 3);

-- Victoires sur des duels d'histoire déjà gagnés : un booster toutes les 3.
alter table yugioh.profiles add column story_replays integer not null default 0 check (story_replays >= 0);
