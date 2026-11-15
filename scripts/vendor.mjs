// Vendors selected upstream skills into plugins/aidw/library/vendor/<upstream>/ (blueprint 7.3, decision D-17).
//
//   node scripts/vendor.mjs <upstream> [--ref <git ref>]
//
// Downloads the upstream tarball, copies only the skills listed in scripts/vendor.config.json,
// copies the upstream LICENSE and records the exact commit in UPSTREAM.md.
// Review the result with `git diff plugins/aidw/library/vendor/<upstream>` and keep or revert per skill.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const config = JSON.parse(readFileSync(new URL("./vendor.config.json", import.meta.url), "utf8"));
const [name, ...rest] = process.argv.slice(2);
const refFlag = rest.indexOf("--ref");
const up = config[name];
if (!up) {
  console.error(`usage: node scripts/vendor.mjs <${Object.keys(config).join("|")}> [--ref <ref>]`);
  process.exit(2);
}
const ref = refFlag >= 0 ? rest[refFlag + 1] : up.ref;

// curl rather than fetch: curl honors HTTPS_PROXY and friends out of the box.
const curl = (...args) => execFileSync("curl", ["-fsSL", "-A", "aidw-vendor-script", ...args]);

const sha = JSON.parse(
  curl("-H", "Accept: application/vnd.github+json", `https://api.github.com/repos/${up.repo}/commits/${ref}`).toString(),
).sha;
if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error(`could not resolve ${up.repo}@${ref}`);

const work = mkdtempSync(join(tmpdir(), `aidw-vendor-${name}-`));
const tarball = join(work, "src.tar.gz");
curl("-o", tarball, `https://codeload.github.com/${up.repo}/tar.gz/${sha}`);
execFileSync("tar", ["-xzf", tarball, "-C", work]);
const srcRoot = join(work, readdirSync(work).find((d) => d !== "src.tar.gz"));

const dest = join("plugins/aidw/library/vendor", name);
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

const missing = [];
for (const [skill, path] of Object.entries(up.skills)) {
  const from = join(srcRoot, path);
  if (!existsSync(join(from, "SKILL.md"))) {
    missing.push(`${skill} (${path})`);
    continue;
  }
  cpSync(from, join(dest, skill), { recursive: true });
}
cpSync(join(srcRoot, up.license), join(dest, "LICENSE"));

writeFileSync(
  join(dest, "UPSTREAM.md"),
  `# Upstream: ${up.repo}

- Commit: \`${sha}\` (ref \`${ref}\`)
- Synced: ${new Date().toISOString().slice(0, 10)}
- License: see \`LICENSE\` (copied verbatim from upstream)
- Role in aidw: ${up.role}

Vendored verbatim; aidw never edits these files. aidw-specific behavior lives in the
adapter instructions of the aidw skills that load them. Re-sync with
\`node scripts/vendor.mjs ${name}\` and review \`git diff\`.

## Skills

${Object.entries(up.skills)
  .map(([s, p]) => `- \`${s}\` <- \`${p}\`${missing.some((m) => m.startsWith(`${s} `)) ? " **(missing upstream)**" : ""}`)
  .join("\n")}
`,
);
rmSync(work, { recursive: true, force: true });

console.log(`vendored ${name} @ ${sha.slice(0, 12)} -> ${dest}`);
if (missing.length) {
  console.error(`missing upstream: ${missing.join(", ")}`);
  process.exit(1);
}
