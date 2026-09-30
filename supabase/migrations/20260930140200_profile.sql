-- Avatar et carte favorite du joueur (passcodes de cartes possédées, contrôle fait par le serveur). Nuls par défaut.
-- Une carte qui n'est plus possédée garde son affichage : pas de clé étrangère ni de nettoyage.
alter table yugioh.profiles
  add column avatar_code integer check (avatar_code > 0),
  add column favorite_code integer check (favorite_code > 0);
