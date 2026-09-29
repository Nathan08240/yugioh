import { useMemo, useState } from "react";
import { CardView } from "./Card.tsx";
import { DuelView, useCards } from "./cards.ts";
import { Shell } from "./Shell.tsx";
import "./styles/connexion.css";
import { supabase } from "./supabase.ts";
import { Icon } from "./ui.tsx";

const AUTH_ERRORS = new Map([
  ["invalid_credentials", "Email ou mot de passe incorrect."],
  ["email_not_confirmed", "Email pas encore confirmé : cliquez sur le lien reçu par email."],
  ["user_already_exists", "Un compte existe déjà avec cet email."],
  ["weak_password", "Mot de passe trop faible : 6 caractères au moins."],
]);

// Red-Eyes, Dark Magician and Blue-Eyes, fanned under the title.
const FAN: [number, string][] = [
  [74677422, "ultra"],
  [46986414, "secret"],
  [89631139, "ultra"],
];

export function Connexion() {
  const cards = useCards();
  const view = useMemo(() => ({ cards, show: () => {}, seat: 0 }), [cards]);
  return (
    <Shell id="connexion" notice>
      <div className="connexion">
        <div className="connexion__titre" data-entree>
          <p className="surtitre">Duels en ligne · Boosters · Mode Histoire</p>
          <h1 className="logotype">
            Duel
            <br />
            Monsters
          </h1>
          <p className="connexion__accroche">Construisez votre deck, ouvrez vos boosters et rejouez les grands duels de Battle City.</p>
          <div className="eventail" aria-hidden="true">
            <DuelView value={view}>
              {FAN.map(([code, rarity]) => (
                <CardView key={code} code={code} rarity={rarity} />
              ))}
            </DuelView>
          </div>
        </div>
        <AuthForm />
      </div>
    </Shell>
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
      className="panneau panneau--holo connexion__form"
      data-entree
      onSubmit={(event) => {
        event.preventDefault();
        submit(new FormData(event.currentTarget));
      }}
    >
      <h2 className="titre-panneau">{signup ? "Créer un compte" : "Connexion"}</h2>
      <label className="champ">
        <span>Email</span>
        <span className="champ__saisie">
          <Icon id="ui-mail" />
          <input name="email" type="email" autoComplete="email" required />
        </span>
      </label>
      <label className="champ">
        <span>Mot de passe</span>
        <span className="champ__saisie">
          <Icon id="ui-cle" />
          <input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={6} required />
        </span>
      </label>
      {notice && (
        <p className={notice.error ? "message message--erreur" : "message message--succes"} role="alert">
          {notice.text}
        </p>
      )}
      <button type="submit" className="btn btn--grand" disabled={pending}>
        {signup ? "Créer le compte" : "Se connecter"}
      </button>
      <button
        type="button"
        className="lien"
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
