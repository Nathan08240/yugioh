import type { DeckResult, DuelMode } from "../../server/src/protocol.ts";

const MODES: [DuelMode, string][] = [
  ["online", "En ligne"],
  ["bot", "Contre le bot"],
  ["story", "Histoire"],
];
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

// Wins and losses of a deck, or of every deck when `deck` is undefined (the player's totals), optionally in one mode.
export function tally(results: readonly DeckResult[], deck?: number, mode?: DuelMode) {
  const rows = results.filter((row) => (deck === undefined || row.deck === deck) && (mode === undefined || row.mode === mode));
  const wins = rows.reduce((sum, row) => sum + row.wins, 0);
  const losses = rows.reduce((sum, row) => sum + row.losses, 0);
  const played = wins + losses;
  return { wins, losses, percent: played === 0 ? undefined : Math.round((wins * 100) / played) };
}

// Record of a deck in every mode, then in each mode played.
export function DeckRecord({ results, deck }: Readonly<{ results?: readonly DeckResult[]; deck: number }>) {
  if (!results) return null;
  const { wins, losses, percent } = tally(results, deck);
  if (percent === undefined) return <p className="texte-3 deck-bilan">Aucun duel joué avec ce deck.</p>;
  const modes = MODES.map(([mode, label]) => ({ label, ...tally(results, deck, mode) })).filter((row) => row.wins + row.losses > 0);
  return (
    <p className="texte-3 deck-bilan">
      {plural(wins, "victoire")} · {plural(losses, "défaite")} · {percent} % de victoires
      <span className="deck-bilan__modes">
        {modes.map(({ label, wins: won, losses: lost }) => (
          <span key={label}>
            {label} {won}-{lost}
          </span>
        ))}
      </span>
    </p>
  );
}
