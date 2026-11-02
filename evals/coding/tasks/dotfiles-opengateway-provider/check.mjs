// Behaviour-only check for the OpenGateway provider task.
//
// Accepts any integration that leaves a loadable provider definition in the
// repo: an extension that registers a gateway provider on load (and is listed
// in settings.json), or a JSON model-config fragment with a gateway provider
// block. Endpoint and model ids are not pinned beyond "https + >=1 model".
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fail, loadExtension, ok } from "../../lib/pi-harness.mjs";
import { existsSync } from "node:fs";

const root = process.cwd();
const EXT_DIR = join(root, "pi/.pi/agent/extensions");
const SETTINGS = join(root, "pi/.pi/agent/settings.json");

const isGateway = (s) => typeof s === "string" && /gateway/i.test(s);

/** An extension that registers a gateway provider with a model list. */
async function fromExtensions() {
  if (!existsSync(EXT_DIR)) return undefined;
  const settings = JSON.parse(readFileSync(SETTINGS, "utf8"));
  const listed = new Set(
    (settings.extensions ?? []).map((e) => e.replace(/^[+-]/, "").replace(/^extensions\//, "").replace(/^\./, "")),
  );
  for (const file of readdirSync(EXT_DIR)) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(join(EXT_DIR, file), "utf8");
    if (!/registerProvider/.test(source) || !/gateway/i.test(source)) continue;
    if (!listed.has(file)) continue;
    let providers = [];
    try {
      ({ providers } = await loadExtension(`pi/.pi/agent/extensions/${file}`));
    } catch {
      continue;
    }
    const hit = providers.find((p) => {
      const name = p?.id ?? p?.name ?? p?.provider ?? "";
      const url = p?.baseUrl ?? p?.baseURL ?? p?.url ?? "";
      const models = p?.models ?? [];
      return (isGateway(name) || isGateway(url)) && /^https:\/\//.test(url) && models.length >= 1;
    });
    if (hit) return { how: `extension ${file}`, provider: hit };
  }
  return undefined;
}

/** A JSON model-config fragment in the repo describing a gateway provider. */
function fromJsonConfig() {
  const candidates = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git") continue;
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (/\.json(c|5)?(\.example)?$/.test(entry) && /gateway|models/i.test(entry)) candidates.push(path);
    }
  };
  walk(join(root, "pi/.pi/agent"));
  for (const path of candidates) {
    let data;
    try {
      data = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    const providers = data?.providers ?? {};
    for (const [id, provider] of Object.entries(providers)) {
      const url = provider?.baseUrl ?? "";
      const models = provider?.models ?? [];
      if ((isGateway(id) || isGateway(url)) && /^https:\/\//.test(url) && models.length >= 1) {
        return { how: path.replace(root + "/", ""), provider: { id, ...provider } };
      }
    }
  }
  return undefined;
}

const hit = (await fromExtensions()) ?? fromJsonConfig();
if (!hit) fail("no gateway provider definition found (extension registration or JSON model config)");

const url = hit.provider.baseUrl;
const count = (hit.provider.models ?? []).length;
if (!/^https:\/\//.test(url)) fail(`provider base URL is not https: ${url}`);

// The provider must be reachable from a fresh pi session: extension listed, or
// the JSON fragment is the documented config path (an example/overlay file).
console.log(`gateway provider via ${hit.how}: ${url} (${count} model entries)`);
ok("a loadable OpenGateway provider definition is in the repo");
