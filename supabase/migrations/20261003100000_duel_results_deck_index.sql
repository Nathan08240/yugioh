-- Supprimer un deck met à nul le deck_id de ses résultats (on delete set null) : sans index sur deck_id, Postgres parcourt
-- toute la table duel_results, qui grandit à chaque duel. Index en ajout seul.
create index duel_results_deck_idx on yugioh.duel_results (deck_id);
