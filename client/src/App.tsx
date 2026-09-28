import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { Lobby } from "./Lobby.tsx";
import { supabase } from "./supabase.ts";

const AUTH_ERRORS = new Map([
  ["invalid_credentials", "Email ou mot de passe incorrect."],
  ["email_not_confirmed", "Email pas encore confirmé : cliquez sur le lien reçu par email."],
  ["user_already_exists", "Un compte existe déjà avec cet email."],
  ["weak_password", "Mot de passe trop faible."],
]);

export function App() {
  // undefined while the stored session is being read.
  const [session, setSession] = useState<Session | null>();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <div className="app">
      <header className="top">
        <h1>Duel Monsters</h1>
        {session && (
          <button
            type="button"
            className="link"
            onClick={() => {
              supabase.auth.signOut();
            }}
          >
            Déconnexion
          </button>
        )}
      </header>
      <main className="panel">
        {session === undefined && <p className="muted">Chargement…</p>}
        {session === null && <AuthForm />}
        {session && <Lobby key={session.user.id} />}
      </main>
      <footer className="source">
        <a href="https://github.com/Nathan08240/yugioh" target="_blank" rel="noreferrer">Code source</a>
      </footer>
    </div>
  );
}

function AuthForm() {
  const [signup, setSignup] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const [pending, setPending] = useState(false);

  async function submit(form: FormData) {
    const credentials = { email: form.get("email") as string, password: form.get("password") as string };
    setPending(true);
    const { data, error } = signup
      ? await supabase.auth.signUp({ ...credentials, options: { emailRedirectTo: location.origin } })
      : await supabase.auth.signInWithPassword(credentials);
    setPending(false);
    if (error) {
      setNotice({ text: AUTH_ERRORS.get(error.code ?? "") ?? error.message, error: true });
    } else if (!data.session) {
      // Email confirmation is on: no session until the link is clicked.
      setNotice({ text: "Compte créé. Un email de confirmation vous a été envoyé : cliquez sur le lien, puis connectez-vous.", error: false });
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        submit(new FormData(event.currentTarget));
      }}
    >
      <h2>{signup ? "Créer un compte" : "Connexion"}</h2>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Mot de passe
        <input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={6} required />
      </label>
      {notice && (
        <p className={notice.error ? "error" : "notice"} role="alert">
          {notice.text}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {signup ? "Créer le compte" : "Se connecter"}
      </button>
      <button
        type="button"
        className="link"
        onClick={() => {
          setSignup(!signup);
          setNotice(undefined);
        }}
      >
        {signup ? "J'ai déjà un compte" : "Pas encore de compte ? S'inscrire"}
      </button>
    </form>
  );
}
