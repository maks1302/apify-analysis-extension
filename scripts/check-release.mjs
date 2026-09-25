import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

const requiredFiles = [
  "manifest.json",
  "content.js",
  "interceptor.js",
  "styles.css",
  "logo.svg",
  "README.md",
  "PRIVACY.md",
  "LICENSE",
];

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) fail(`Missing ${file}`);
}

let manifest;
try {
  manifest = JSON.parse(read("manifest.json"));
} catch (error) {
  fail(`manifest.json is invalid JSON: ${error.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail("Only Manifest V3 is expected");
  if (!/^\d+(?:\.\d+){0,3}$/.test(manifest.version || "")) fail("Invalid extension version");
  if ((manifest.name || "").length > 75) fail("Extension name exceeds 75 characters");
  if ((manifest.description || "").length > 132) fail("Description exceeds 132 characters");

  const permissions = manifest.permissions || [];
  if (permissions.length !== 1 || permissions[0] !== "storage") {
    fail("The privacy baseline expects storage to be the only Chrome permission");
  }

  const contentMatches = (manifest.content_scripts || []).flatMap((entry) => entry.matches || []);
  if (!contentMatches.length || contentMatches.some((match) => match !== "https://console.apify.com/*")) {
    fail("Content scripts must be restricted to https://console.apify.com/*");
  }

  const iconPaths = Object.values(manifest.icons || {});
  for (const iconPath of iconPaths) {
    if (!existsSync(resolve(root, iconPath))) fail(`Manifest icon does not exist: ${iconPath}`);
  }
}

for (const file of ["content.js", "interceptor.js"]) {
  const result = spawnSync(process.execPath, ["--check", resolve(root, file)], { encoding: "utf8" });
  if (result.status !== 0) fail(`${file} failed syntax validation\n${result.stderr}`);
}

const interceptor = read("interceptor.js");
if (!interceptor.includes('const ENDPOINT_HOST = "console-backend.apify.com"')) {
  fail("Apify analytics hostname allowlist is missing");
}
if (!interceptor.includes('target.protocol !== "https:" || target.hostname !== ENDPOINT_HOST')) {
  fail("HTTPS/hostname enforcement is missing");
}

const runtimeSource = `${read("content.js")}\n${interceptor}`;
for (const pattern of [/\beval\s*\(/, /\bnew\s+Function\s*\(/, /\bsendBeacon\s*\(/]) {
  if (pattern.test(runtimeSource)) fail(`Disallowed runtime pattern found: ${pattern}`);
}

const css = read("styles.css");
let braceDepth = 0;
for (const character of css) {
  if (character === "{") braceDepth += 1;
  if (character === "}") braceDepth -= 1;
  if (braceDepth < 0) break;
}
if (braceDepth !== 0) fail("styles.css has unbalanced braces");

if (!process.exitCode) {
  console.log(`Release checks passed for ${manifest.name} v${manifest.version}`);
}
