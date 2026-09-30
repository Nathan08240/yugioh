import type { ClientMessage } from "../../server/src/protocol.ts";
import "./styles/souhaits.css";

type Props = { code: number; wished: boolean; send: (msg: ClientMessage) => void; label?: boolean; className?: string };

// Heart toggling a card in the wishlist: a round icon on a binder card, or a labelled button in the detail panel.
export function WishButton({ code, wished, send, label = false, className = "" }: Readonly<Props>) {
  const text = wished ? "Retirer des souhaits" : "Ajouter aux souhaits";
  return (
    <button
      type="button"
      className={`souhait ${label ? "souhait--texte" : ""} ${className}`}
      aria-pressed={wished}
      aria-label={label ? undefined : text}
      title={text}
      onClick={() => send(wished ? { type: "wish_remove", code } : { type: "wish_add", code })}
    >
      <span aria-hidden="true">{wished ? "♥" : "♡"}</span>
      {label && (wished ? "Dans mes souhaits" : text)}
    </button>
  );
}
