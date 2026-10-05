import type { Session } from "@supabase/auth-js";
import { useEffect, useState } from "react";
import { Connexion } from "./Connexion.tsx";
import { Lobby } from "./Lobby.tsx";
import { bindSkip, sequences } from "./motion.ts";
import { Shell } from "./Shell.tsx";
import { supabase } from "./supabase.ts";

export function App() {
  // undefined while the stored session is being read.
  const [session, setSession] = useState<Session | null>();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  // A click, Escape or Space skips the sequence being played, anywhere in the game.
  useEffect(() => bindSkip(sequences), []);

  if (session === undefined) {
    return (
      <Shell id="chargement">
        <p className="ecran-message">Chargement…</p>
      </Shell>
    );
  }
  if (session === null) return <Connexion />;
  return <Lobby key={session.user.id} />;
}
