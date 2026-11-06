#!/usr/bin/env node
// Install vim-style navigation into terminal-browser tabs over CDP.
//
//   ./tb-vim.mjs              install into the active tab of the first browser
//   ./tb-vim.mjs --all        install into every open tab
//   ./tb-vim.mjs --watch      keep installing into new tabs as they open
//   ./tb-vim.mjs --list       show browsers and page targets
//   ./tb-vim.mjs --cdp 9222   use a raw CDP port instead of terminal-browser
//
// The page layer is registered with Page.addScriptToEvaluateOnNewDocument,
// so it survives navigation for the lifetime of the tab. No daemon is needed
// once the install command exits, unless you pass --watch.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const LAYER = readFileSync(join(here, "vim-layer.js"), "utf8");

const args = process.argv.slice(2);
let browserKey = null;
let cdpPort = null;
let all = false;
let watch = false;
let list = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--browser") browserKey = args[++i];
  else if (a === "--cdp") cdpPort = Number(args[++i]);
  else if (a === "--all") all = true;
  else if (a === "--watch") watch = true;
  else if (a === "--list") list = true;
  else if (a === "-h" || a === "--help") {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 12).join("\n").replace(/^\/\/ ?/gm, ""));
    process.exit(0);
  } else {
    console.error(`unknown argument: ${a}`);
    process.exit(2);
  }
}

function listBrowsers() {
  const run = (extra) =>
    JSON.parse(
      execFileSync("terminal-browser", ["ls", "--json", ...extra], {
        encoding: "utf8",
      }),
    );
  try {
    const state = run([]);
    if ((state.browsers || []).length) return state;
    // no browser in this terminal tab: widen the search
    return run(["--all"]);
  } catch (err) {
    console.error("cannot run terminal-browser ls --json");
    console.error(err.stderr?.toString() || err.message);
    process.exit(1);
  }
}

async function pageTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`cdp list failed: ${res.status}`);
  const all = await res.json();
  return all.filter(
    (t) => t.type === "page" && t.webSocketDebuggerUrl && !t.url.startsWith("devtools://"),
  );
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();

  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("cdp socket error"));
  });

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    const call = pending.get(msg.id);
    if (!call) return;
    pending.delete(msg.id);
    if (msg.error) call.reject(new Error(msg.error.message));
    else call.resolve(msg.result);
  };

  const send = (method, params = {}) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 8000);
    });
  };

  return {
    ready,
    send,
    close: () => ws.close(),
  };
}

async function install(port, target) {
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  try {
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: LAYER });
    const res = await cdp.send("Runtime.evaluate", {
      expression: LAYER,
      returnByValue: true,
    });
    const status = res?.result?.value ?? "installed";
    console.log(`  + ${target.title || "(untitled)"}  ${status}`);
  } finally {
    cdp.close();
  }
}

async function main() {
  const browsers = cdpPort
    ? [{ key: `cdp-${cdpPort}`, cdpPort }]
    : (listBrowsers().browsers || []).filter((b) => b.cdpPort);
  if (!browsers.length) {
    console.error("no terminal-browser browser is running");
    console.error("start one with: terminal-browser new-tab <url>");
    process.exit(1);
  }
  if (browserKey && !browsers.some((b) => b.key === browserKey)) {
    console.error(`no browser with key ${browserKey}`);
    process.exit(1);
  }
  const browser = browserKey
    ? browsers.find((b) => b.key === browserKey)
    : browsers[0];

  if (list) {
    console.log(`browser ${browser.key}  cdp ${browser.cdpPort}`);
    for (const t of await pageTargets(browser.cdpPort)) {
      console.log(`  ${t.id}  ${t.title}\n              ${t.url}`);
    }
    return;
  }

  const seen = new Set();

  async function sweep() {
    let targets;
    try {
      targets = await pageTargets(browser.cdpPort);
    } catch (err) {
      if (!watch) throw err;
      return;
    }
    for (const t of targets) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      try {
        await install(browser.cdpPort, t);
      } catch (err) {
        console.error(`  ! ${t.url}: ${err.message}`);
      }
      if (!all && !watch) break;
    }
  }

  await sweep();
  if (!watch) return;

  console.log(`watching browser ${browser.key} on cdp ${browser.cdpPort} (ctrl+c to stop)`);
  setInterval(sweep, 1500);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
