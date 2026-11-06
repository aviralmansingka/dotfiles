#!/usr/bin/env node
// Format Markdown so Prettier wraps prose by the width a reader sees.
// Each link destination becomes a short token, Prettier runs, then the real
// destinations come back. Reference definitions, wiki links, and autolinks
// get the same treatment.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const file = process.argv[2] || "-";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

const urls = [];
const put = (url) => `x${urls.push(url)}x`;

const masked = input
  .replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (_, open, url, close) => open + put(url) + close)
  .replace(/^(\s*\[[^\]]+\]:\s*)(\S+)/gm, (_, head, url) => head + put(url))
  .replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, (_, target, alias) => `[[${put(target)}${alias || ""}]]`)
  .replace(/<([a-z][a-z0-9+.-]*:[^>]+)>/gi, (_, url) => `<${put(url)}>`);

const mason = join(homedir(), ".local/share/nvim/mason/bin/prettier");
const command = process.env.PRETTIER_BIN || (existsSync(mason) ? mason : "prettier");
const result = spawnSync(command, ["--stdin-filepath", file], { input: masked, encoding: "utf8" });
if (result.error || result.status !== 0) {
  process.stderr.write(result.stderr || String(result.error));
  process.exit(result.status ?? 1);
}

process.stdout.write(result.stdout.replace(/x(\d+)x/g, (match, n) => urls[Number(n) - 1] ?? match));
