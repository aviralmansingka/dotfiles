#!/usr/bin/env node
// Install vim-style navigation into terminal-browser tabs over CDP.
//
//   ./tb-vim.mjs --watch      install now and keep every tab covered (default)
//   ./tb-vim.mjs --once       install into open tabs, then exit
//   ./tb-vim.mjs --all        every open tab, not only the first
//   ./tb-vim.mjs --list       show browsers and page targets
//   ./tb-vim.mjs --cdp 9222   use a raw CDP port instead of terminal-browser
//
// Chromium drops script registrations when the CDP client disconnects, so the
// layer is re-evaluated after each page load while this process stays alive.
// Run it under nohup or in its own pane to keep keys working.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const LAYER = readFileSync(join(here, "vim-layer.js"), "utf8");
const POLL_MS = 1200;

const args = process.argv.slice(2);
let browserKey = null;
let cdpPort = null;
let all = false;
let once = false;
let watch = true;
let list = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--browser") browserKey = args[++i];
  else if (a === "--cdp") cdpPort = Number(args[++i]);
  else if (a === "--all") all = true;
  else if (a === "--once") once = true;
  else if (a === "--watch") watch = true;
  else if (a === "--list") list = true;
  else if (a === "-h" || a === "--help") {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), "utf8")
        .split("\n")
        .slice(1, 13)
        .join("\n")
        .replace(/^\/\/ ?/gm, ""),
    );
    process.exit(0);
  } else {
    console.error(`unknown argument: ${a}`);
    process.exit(2);
  }
}
if (once) watch = false;

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
    (t) =>
      t.type === "page" &&
      t.webSocketDebuggerUrl &&
      !t.url.startsWith("devtools://"),
  );
}

function connect(url, onEvent) {
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
    if (msg.id) {
      const call = pending.get(msg.id);
      if (!call) return;
      pending.delete(msg.id);
      if (msg.error) call.reject(new Error(msg.error.message));
      else call.resolve(msg.result);
      return;
    }
    if (msg.method && onEvent) onEvent(msg.method, msg.params || {});
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
    get closed() {
      return ws.readyState === WebSocket.CLOSED;
    },
  };
}

const live = new Map(); // target id -> cdp

async function inject(cdp) {
  return cdp.send("Runtime.evaluate", { expression: LAYER, returnByValue: true });
}

async function attach(port, target) {
  const cdp = connect(target.webSocketDebuggerUrl, (method) => {
    if (method === "Page.loadEventFired") {
      inject(cdp).catch(() => {});
    }
  });

  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: LAYER });
  const res = await inject(cdp);
  const status = res?.result?.value ?? "installed";

  if (watch) {
    live.set(target.id, cdp);
  } else {
    cdp.close();
  }
  return status;
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

  // Several browser windows can share one CDP port, so a selected browser
  // limits work to its own tabs. Refresh the scope now and then, because new
  // tabs appear after start.
  let allowed = new Set(
    (browser.tabs || []).map((t) => t.targetId).filter(Boolean),
  );
  const inScope = (t) => !allowed.size || allowed.has(t.id);
  const seen = new Set();
  let sweeps = 0;

  function refreshScope() {
    const fresh = listBrowsers().browsers || [];
    const match = fresh.find((b) => b.key === browser.key);
    if (match) {
      allowed = new Set(
        (match.tabs || []).map((t) => t.targetId).filter(Boolean),
      );
    }
  }

  async function sweep() {
    if (browserKey && ++sweeps % 5 === 0) refreshScope();
    let targets;
    try {
      targets = await pageTargets(browser.cdpPort);
    } catch (err) {
      if (watch) return;
      throw err;
    }
    for (const t of targets) {
      if (!inScope(t)) continue;
      if (live.has(t.id)) continue;
      if (!watch && seen.has(t.id)) continue;
      seen.add(t.id);
      try {
        const status = await attach(browser.cdpPort, t);
        console.log(`  + ${t.title || "(untitled)"}  ${status}`);
      } catch (err) {
        console.error(`  ! ${t.url}: ${err.message}`);
      }
      if (!all && !watch) break;
    }
  }

  await sweep();
  if (!watch) return;

  console.log(
    `watching browser ${browser.key} on cdp ${browser.cdpPort} (ctrl+c to stop)`,
  );
  setInterval(() => {
    for (const [id, cdp] of live) if (cdp.closed) live.delete(id);
    sweep();
  }, POLL_MS);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
