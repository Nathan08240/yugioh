-- Deck actif du joueur, utilisé pour les duels. Nul si le joueur n'a pas encore de deck, ou si son deck actif est supprimé.
alter table yugioh.profiles add column active_deck_id bigint references yugioh.decks (id) on delete set null;
