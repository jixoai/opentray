// Stage the packaged AI Skill beside the built CLI bundle: the skill module
// resolves `skill/` relative to its output directory.
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "skill");
await mkdir(join(root, "dist"), { recursive: true });
await cp(source, join(root, "dist", "skill"), { recursive: true });
console.log("skill: staged packaged AI skill into dist/skill");
