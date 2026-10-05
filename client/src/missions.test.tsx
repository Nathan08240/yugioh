import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { initialLobby, reduce } from "./lobby.ts";
import { MissionsDuJour, rewardText, Succes } from "./Missions.tsx";

const missions = [
  { id: "victoire", text: "Gagner un duel", progress: 1, goal: 1, reward: { points: 30 } },
  { id: "invocations", text: "Invoquer 5 monstres en un duel", progress: 2, goal: 5, reward: { points: 30 } },
  { id: "boosters", text: "Ouvrir 2 boosters", progress: 0, goal: 2, reward: { points: 20 } },
];
const achievements = [{ id: "cent_victoires", title: "Centurion", text: "Gagner 100 duels", progress: 12, goal: 100, reward: { boosters: 3 } }];

it("garde les missions et les succès envoyés par le serveur", () => {
  const state = reduce(initialLobby, { type: "missions", missions, achievements });
  expect(state.missions).toEqual({ missions, achievements });
});

it("affiche la progression, la récompense de chaque mission et le booster des 3 faites", () => {
  const html = renderToStaticMarkup(<MissionsDuJour missions={missions} />);
  expect(html).toContain("Missions du jour");
  expect(html).toContain("2 / 5");
  expect(html).toContain("30 points");
  expect(html).toContain("Les 3 faites : 1 booster en plus.");
  const all = renderToStaticMarkup(<MissionsDuJour missions={missions.map((mission) => ({ ...mission, progress: mission.goal }))} />);
  expect(all).toContain("booster bonus gagné");
  expect(renderToStaticMarkup(<MissionsDuJour />)).toBe("");
});

it("liste les succès avec leur récompense unique", () => {
  const html = renderToStaticMarkup(<Succes achievements={achievements} />);
  expect(html).toContain("Succès 0 / 1");
  expect(html).toContain("Centurion");
  expect(html).toContain("12 / 100");
  expect(rewardText({ points: 50, boosters: 1 })).toBe("50 points et 1 booster");
});
