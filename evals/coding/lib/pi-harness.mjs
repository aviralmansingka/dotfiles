// Behaviour harness for pi extensions.
//
// Loads an extension's default export with a recording ExtensionAPI stub, so a
// check can drive what the brief actually specifies - registered tools,
// commands, hooks and settings - instead of importing helper names the brief
// never mentions. Only pi's public API names are assumed (registerTool,
// registerCommand, on, setModel, sendUserMessage, ui.notify).
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const STUB = `
class El { constructor(text){ this.text = text ?? ""; } }
class Editor extends El { constructor(){ super(""); this.value = ""; } getText(){ return this.value; } setText(v){ this.value = v; } handleInput(){ return false; } render(){ return []; } }
module.exports = {
  Text: El, TruncatedText: El, Spacer: El, Container: class extends El { addChild(){} },
  Box: El, Editor, Input: Editor, Markdown: El, Loader: El,
  matchesKey: () => false, decodeKittyPrintable: () => undefined,
  Key: new Proxy({}, { get: () => "key" }),
  truncateToWidth: (s) => String(s), visibleWidth: (s) => String(s).length,
  wrapText: (s) => [String(s)], padToWidth: (s) => String(s),
};
`;

/** Resolve jiti the way the repo's own tests do (test-lib/jiti.mjs). */
async function jitiFor(cwd) {
  const testLib = join(cwd, "pi/.pi/agent/extensions/test-lib/jiti.mjs");
  const { resolveJiti } = await import(pathToFileURL(testLib).href);
  const require = createRequire(testLib);
  const { jitiPath } = resolveJiti();
  const { createJiti } = require(jitiPath);
  return createJiti;
}

/**
 * Load `<cwd>/<relPath>` and call its default export with a recording stub.
 * Returns the recorded surface plus the raw module.
 */
export async function loadExtension(relPath, { cwd = process.cwd() } = {}) {
  const createJiti = await jitiFor(cwd);
  const dir = mkdtempSync(join(tmpdir(), "pi-harness-"));
  const stub = join(dir, "stub.cjs");
  writeFileSync(stub, STUB);
  const jiti = createJiti(pathToFileURL(join(cwd, relPath)).href, {
    alias: {
      "@earendil-works/pi-coding-agent": stub,
      "@earendil-works/pi-tui": stub,
    },
    moduleCache: false,
  });
  const mod = jiti(join(cwd, relPath));
  const recorded = recordingPi();
  if (typeof mod.default === "function") mod.default(recorded.pi);
  return { mod, ...recorded };
}

/** Recording ExtensionAPI + a matching command context. */
export function recordingPi() {
  const tools = new Map();
  const commands = new Map();
  const handlers = new Map();
  const providers = [];
  const models = [];
  const messages = [];
  const notes = [];
  const state = { hiddenLabel: undefined, modelResult: true };

  const pi = {
    registerTool: (tool) => void tools.set(tool.name, tool),
    registerCommand: (name, options) => void commands.set(name, options),
    on: (name, handler) => void handlers.set(name, handler),
    // pi's shape is registerProvider(id, config); accept a single object too.
    registerProvider: (idOrConfig, config) =>
      void providers.push(config ? { id: idOrConfig, ...config } : idOrConfig),
    setModel: async (model) => {
      models.push(model);
      return state.modelResult;
    },
    sendUserMessage: (text) => void messages.push(text),
    ui: {
      notify: (message, level) => void notes.push({ message, level }),
      setHiddenThinkingLabel: (label) => void (state.hiddenLabel = label),
      setWidget: () => {},
      setFooter: () => {},
    },
  };
  return { pi, tools, commands, handlers, providers, models, messages, notes, state };
}

/** Run a registered hook by name; returns its result (undefined when absent). */
export function callHook(handlers, name, event, ctx) {
  const handler = handlers.get(name);
  if (!handler) return undefined;
  return handler(event, ctx);
}

/** Minimal command context: model, registry, ui.notify, session file. */
export function commandCtx({ model, models = [], cwd = process.cwd(), sessionFile = undefined } = {}) {
  const notes = [];
  const ctx = {
    cwd,
    model,
    modelRegistry: {
      getModelsOfType: (type, provider) =>
        type === "chat" ? models.filter((m) => !provider || m.provider === provider) : [],
    },
    sessionManager: { getSessionFile: () => sessionFile ?? join(cwd, ".harness-session.jsonl") },
    ui: {
      notify: (message, level) => void notes.push({ message, level }),
      setWidget: () => {},
      setFooter: () => {},
      setHiddenThinkingLabel: () => {},
    },
  };
  return { ctx, notes };
}

export function fail(message) {
  console.error(`CHECK FAIL: ${message}`);
  process.exit(1);
}

export function ok(message) {
  console.log(`CHECK PASS: ${message}`);
}
