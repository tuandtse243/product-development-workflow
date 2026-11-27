// Vendors selected upstream skills into plugins/aidw/library/vendor/<upstream>/ or its `dest` (blueprint 7.3, decision D-17).
//
//   node scripts/vendor.mjs <upstream> [--ref <git ref>]
//
// Downloads the upstream tarball, copies only the skills listed in scripts/vendor.config.json,
// copies the upstream LICENSE and records the exact commit in UPSTREAM.md.
// An upstream may also list `files` (single files that are not skills, such as a rule catalog) and a `notice`
// (its third-party notices). An upstream with no skills is fetched file by file, without the tarball.
// `dest` overrides the folder under library/vendor/ (default: the upstream's key), e.g. "anthropics/html-effectiveness".
// Review the result with `git diff plugins/aidw/library/vendor/<upstream>` and keep or revert per skill.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
const files = Object.entries(up.files ?? {});
const loose = [up.license, up.notice, ...files.map(([, path]) => path)].filter(Boolean);
let srcRoot;
if (Object.keys(up.skills).length || up.shared) {
  const tarball = join(work, "src.tar.gz");
  curl("-o", tarball, `https://codeload.github.com/${up.repo}/tar.gz/${sha}`);
  execFileSync("tar", ["-xzf", tarball, "-C", work]);
  srcRoot = join(work, readdirSync(work).find((d) => d !== "src.tar.gz"));
} else {
  // No skill folder to copy: fetch only the named files at the resolved commit.
  srcRoot = join(work, "src");
  for (const path of loose) {
    mkdirSync(dirname(join(srcRoot, path)), { recursive: true });
    try {
      curl("-o", join(srcRoot, path), `https://raw.githubusercontent.com/${up.repo}/${sha}/${path}`);
    } catch {
      // reported as missing below
    }
  }
}

const dest = join("plugins/aidw/library/vendor", up.dest ?? name);
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
if (up.notice) cpSync(join(srcRoot, up.notice), join(dest, "NOTICE.md"));
for (const [to, path] of files) {
  if (!existsSync(join(srcRoot, path))) {
    missing.push(`${to} (${path})`);
    continue;
  }
  cpSync(join(srcRoot, path), join(dest, to));
}

// Files the skills link to outside their own folder (`../../references/x.md`). They are copied to the same
// relative place, a sibling of <upstream>/, so the links work without editing a vendored file.
const shared = Object.entries(up.shared ?? {});
for (const [dir, files] of shared) {
  const sharedDest = join(dest, "..", dir);
  const owner = join(sharedDest, "UPSTREAM.md");
  if (existsSync(owner) && !readFileSync(owner, "utf8").includes(`\`${up.repo}\``)) {
    throw new Error(`${sharedDest} already belongs to another upstream`);
  }
  rmSync(sharedDest, { recursive: true, force: true });
  mkdirSync(sharedDest, { recursive: true });
  for (const file of files) {
    if (!existsSync(join(srcRoot, dir, file))) {
      missing.push(`${dir}/${file}`);
      continue;
    }
    cpSync(join(srcRoot, dir, file), join(sharedDest, file));
  }
  writeFileSync(
    owner,
    `# Upstream: ${up.repo}\n\nCopied verbatim from \`${dir}/\` of \`${up.repo}\`; the vendored skills in \`../${name}/\` link here.\nCommit and licence: see \`../${name}/UPSTREAM.md\` and \`../${name}/LICENSE\`. aidw never edits these files.\n`,
  );
}

writeFileSync(
  join(dest, "UPSTREAM.md"),
  `# Upstream: ${up.repo}

- Commit: \`${sha}\` (ref \`${ref}\`)
- Synced: ${new Date().toISOString().slice(0, 10)}
- License: see \`LICENSE\` (copied verbatim from upstream)${up.notice ? "; third-party notices in \`NOTICE.md\`" : ""}
- Role in aidw: ${up.role}

Vendored verbatim; aidw never edits these files. aidw-specific behavior lives in the
adapter instructions of the aidw skills that load them. Re-sync with
\`node scripts/vendor.mjs ${name}\` and review \`git diff\`.

${
  Object.keys(up.skills).length
    ? `## Skills\n\n${Object.entries(up.skills)
        .map(([s, p]) => `- \`${s}\` <- \`${p}\`${missing.some((m) => m.startsWith(`${s} `)) ? " **(missing upstream)**" : ""}`)
        .join("\n")}\n`
    : ""
}${files.length ? `${Object.keys(up.skills).length ? "\n" : ""}## Files\n\n${files.map(([to, path]) => `- \`${to}\` <- \`${path}\``).join("\n")}\n` : ""}${shared.length ? `\n## Shared files\n\n${shared.flatMap(([dir, files]) => files.map((f) => `- \`../${dir}/${f}\` <- \`${dir}/${f}\``)).join("\n")}\n` : ""}`,
);
rmSync(work, { recursive: true, force: true });

console.log(`vendored ${name} @ ${sha.slice(0, 12)} -> ${dest}`);
if (missing.length) {
  console.error(`missing upstream: ${missing.join(", ")}`);
  process.exit(1);
}
