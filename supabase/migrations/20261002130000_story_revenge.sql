-- Revanche des boss du mode Histoire : boosters à Ultra Rare garantie en attente, ouverts avant le compteur habituel.
-- La revanche gagnée est gardée dans yugioh.story_unlocks ('revenge:<arc>'), sans nouvelle table : RLS déjà en place.
alter table yugioh.booster_state add column ultra_pending integer not null default 0 check (ultra_pending >= 0);
