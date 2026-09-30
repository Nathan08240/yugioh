import { useEffect, useRef, useState, type FormEvent } from "react";
import { REPORT_MAX } from "../../server/src/protocol.ts";

// How to report a problem: `send` the optional text, `sent` counts the reports the server has stored.
export type Report = { send: (message: string) => void; sent: number };

// A button that opens a small form: an optional text, then Envoyer or Annuler. Escape cancels without reaching the other Escape handlers.
export function Signaler({ report }: Readonly<{ report: Report }>) {
  const [ouvert, setOuvert] = useState(false);
  // Reports stored when the form was sent: a higher count means the server took this one.
  const [envoye, setEnvoye] = useState<number>();
  const champ = useRef<HTMLTextAreaElement>(null);
  const fait = envoye !== undefined && report.sent > envoye;
  useEffect(() => {
    if (!ouvert) return;
    champ.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOuvert(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [ouvert]);
  const fermer = () => {
    setOuvert(false);
    setEnvoye(undefined);
  };
  const envoyer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEnvoye(report.sent);
    report.send((new FormData(event.currentTarget).get("message") as string).trim());
  };
  if (!ouvert) {
    return (
      <button type="button" className="btn btn--fantome signaler__bouton" onClick={() => setOuvert(true)}>
        Signaler un problème
      </button>
    );
  }
  if (fait) {
    return (
      <div className="signaler panneau" role="status">
        <p>Signalement envoyé, merci.</p>
        <button type="button" className="btn" onClick={fermer}>
          Fermer
        </button>
      </div>
    );
  }
  return (
    <form className="signaler panneau" aria-label="Signaler un problème" onSubmit={envoyer}>
      <label className="champ">
        <span>Que s'est-il passé ? (facultatif)</span>
        <textarea ref={champ} name="message" rows={3} maxLength={REPORT_MAX} />
      </label>
      <div className="signaler__actions">
        <button type="submit" className="btn">
          Envoyer
        </button>
        <button type="button" className="btn btn--fantome" onClick={fermer}>
          Annuler
        </button>
      </div>
    </form>
  );
}
