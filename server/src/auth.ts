// L'instance n'a pas de clé asymétrique (JWKS vide) : GoTrue valide lui-même le jeton,
// le serveur n'a besoin que de la clé anon publique, jamais du secret JWT.
// ponytail: un appel réseau par vérification, passer au JWKS si les clés asymétriques sont activées.
export async function verifySession(
  token: string,
  url = process.env.SUPABASE_URL,
  anonKey = process.env.SUPABASE_ANON_KEY,
): Promise<string | null> {
  if (!url || !anonKey) throw new Error("SUPABASE_URL ou SUPABASE_ANON_KEY absente");
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
  });
  if (response.status >= 500) throw new Error(`Supabase Auth indisponible (HTTP ${response.status})`);
  if (!response.ok) return null;
  const user = (await response.json()) as { id: string };
  return user.id;
}
