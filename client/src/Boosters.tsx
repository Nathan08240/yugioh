import { useEffect, useMemo, useState } from "react";
import type { ClientMessage } from "../../server/src/protocol.ts";
import { isDone, startReveal, stepReveal, type RevealState } from "./boosterReveal.ts";
import { CardView } from "./Card.tsx";
import { DuelView, useCards } from "./cards.ts";
import type { LobbyState } from "./lobby.ts";

type Send = (msg: ClientMessage) => void;
type BoosterSet = { code: string; name: string; date: string };
type Opened = NonNullable<LobbyState["opened"]>;

const HIGH_RARITY: ReadonlySet<string> = new Set(["rare", "super", "ultra", "ultimate", "secret"]);
const RARITY_LABELS = new Map([
  ["common", "Commune"],
  ["shortprint", "Peu commune"],
  ["rare", "Rare"],
  ["super", "Super Rare"],
  ["ultra", "Ultra Rare"],
  ["ultimate", "Ultimate Rare"],
  ["secret", "Secret Rare"],
]);
const rarityLabel = (rarity: string) => RARITY_LABELS.get(rarity) ?? rarity;

const REVEAL_INTERVAL_MS = 450;
const pad = (n: number) => String(n).padStart(2, "0");

// "" once the free booster is due, else a HH:MM:SS countdown.
function countdown(nextFreeAt: string, now: number): string {
  const remaining = Math.max(0, new Date(nextFreeAt).getTime() - now);
  if (remaining === 0) return "";
  const totalSeconds = Math.floor(remaining / 1000);
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}`;
}

// Boosters screen: free-booster countdown, earned count, set choice and the opening animation.
export function Boosters({ state, send }: Readonly<{ state: LobbyState; send: Send }>) {
  const cards = useCards();
  const view = useMemo(() => ({ cards, show: () => {}, seat: 0 }), [cards]);
  const [sets, setSets] = useState<BoosterSet[]>();
  const [selected, setSelected] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const [dismissedCount, setDismissedCount] = useState(0);

  useEffect(() => {
    send({ type: "booster_state" });
  }, []);

  useEffect(() => {
    fetch("/api/boosters")
      .then((res) => res.json())
      .then((data: BoosterSet[]) => {
        setSets(data);
        setSelected((current) => current ?? data[0]?.code);
      })
      .catch((error: unknown) => console.error(error));
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const boosters = state.boosters;
  const remaining = boosters ? countdown(boosters.nextFreeAt, now) : undefined;
  const canOpen = Boolean(boosters && selected && (remaining === "" || boosters.pending > 0));
  const opening = state.opened && state.openedCount > dismissedCount ? state.opened : undefined;

  return (
    <DuelView value={view}>
      {opening ? (
        <BoosterOpening
          key={state.openedCount}
          opened={opening}
          onDone={() => {
            setDismissedCount(state.openedCount);
            send({ type: "booster_state" });
          }}
        />
      ) : (
        <div className="stack boosters">
          <div className="booster-status">
            <div className="count">
              <span>Prochain gratuit</span>
              <strong>{boosters ? remaining || "Disponible" : "…"}</strong>
            </div>
            <div className="count">
              <span>Boosters gagnés</span>
              <strong>{boosters?.pending ?? "…"}</strong>
            </div>
          </div>
          {sets && (
            <div className="row">
              <select aria-label="Booster à ouvrir" value={selected} onChange={(event) => setSelected(event.target.value)}>
                {sets.map((set) => (
                  <option key={set.code} value={set.code}>
                    {set.name} ({set.date})
                  </option>
                ))}
              </select>
              <button type="button" disabled={!canOpen} onClick={() => selected && send({ type: "open_booster", set: selected })}>
                Ouvrir
              </button>
            </div>
          )}
          {boosters && !canOpen && <p className="muted">Aucun booster disponible pour l'instant.</p>}
        </div>
      )}
    </DuelView>
  );
}

function BoosterOpening({ opened, onDone }: Readonly<{ opened: Opened; onDone: () => void }>) {
  const [reveal, setReveal] = useState<RevealState>(() => startReveal(opened.cards.length));

  useEffect(() => {
    if (isDone(reveal)) return;
    const id = setTimeout(() => setReveal(stepReveal), REVEAL_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [reveal]);

  return (
    <div className="stack booster-opening">
      <div className="pack-open" aria-hidden="true" />
      <h2>Booster {opened.set}</h2>
      <ul className="reveal-grid">
        {opened.cards.map((card, index) => {
          const shown = index < reveal.revealed;
          const classes = ["reveal-inner", shown && "shown", shown && HIGH_RARITY.has(card.rarity) && "high"].filter(Boolean).join(" ");
          return (
            <li key={index} className="reveal-card">
              <div className={classes}>
                <CardView code={shown ? card.code : 0} />
                {shown && <span className="reveal-rarity">{rarityLabel(card.rarity)}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {isDone(reveal) && (
        <div className="stack center">
          <p className="muted">{opened.cards.length} cartes ajoutées à votre collection.</p>
          <button type="button" onClick={onDone}>
            Continuer
          </button>
        </div>
      )}
    </div>
  );
}
