import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Parametres } from "./Parametres.tsx";

it("affiche chaque réglage en boutons radio nommés, le choix courant coché", () => {
  const html = renderToStaticMarkup(<Parametres />);
  expect(html.match(/type="radio"/g)).toHaveLength(10);
  expect(html).toContain("Vitesse des animations");
  expect(html).toMatch(/name="vitesse" checked="" value="normale"/);
});
