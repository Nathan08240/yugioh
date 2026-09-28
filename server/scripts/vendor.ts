// Clone or update external engine data (card scripts, card database) into server/vendor/.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

for (const repo of ["CardScripts", "BabelCDB"]) {
  const dir = join(import.meta.dirname, "..", "vendor", repo);
  const args = existsSync(dir)
    ? ["-C", dir, "pull", "--ff-only", "--depth", "1"]
    : ["clone", "--depth", "1", `https://github.com/ProjectIgnis/${repo}.git`, dir];
  execFileSync("git", args, { stdio: "inherit" });
}
