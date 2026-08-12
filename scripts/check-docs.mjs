// Fails when a registered tool group or skill has no compact doc file.
// Run: node scripts/check-docs.mjs
import { readFileSync, readdirSync } from "node:fs";

const registry = readFileSync("src/lib/tools/registry.ts", "utf8");
const skills = readFileSync("src/lib/skills/registry.ts", "utf8");

const ids = [...registry.matchAll(/id: "([a-z]+)\.([a-zA-Z]+)"/g)].map((m) => m[0]);
const groups = new Set(
  [...registry.matchAll(/group: "([a-z]+)"/g)].map((m) => m[1]).concat(
    ["velodrome", "inkyswap", "hyperliquid", "nado", "tydro"],
  ),
);
const skillIds = [...skills.matchAll(/\n    id: "([a-z.]+)"/g)].map((m) => m[1]);

const toolDocs = readdirSync("docs/tools")
  .map((f) => readFileSync(`docs/tools/${f}`, "utf8"))
  .join("\n");
const skillDocs = readdirSync("docs/skills")
  .map((f) => readFileSync(`docs/skills/${f}`, "utf8"))
  .join("\n");

const missingGroups = [...groups].filter((g) => !toolDocs.includes(g));
const missingSkills = skillIds.filter((s) => !skillDocs.includes(s.split(".")[0]));

if (missingGroups.length || missingSkills.length) {
  console.error("Undocumented tool groups:", missingGroups.join(", ") || "none");
  console.error("Undocumented skills:", missingSkills.join(", ") || "none");
  process.exit(1);
}
console.log(`docs ok — ${groups.size} tool groups, ${skillIds.length} skills, ${ids.length} tools`);
