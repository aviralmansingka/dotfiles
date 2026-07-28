import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { __transcriptLinks } from "../../pi/.pi/agent/extensions/transcript-scroll.ts";

const log = process.env.V03_CLIPBOARD_LOG!;
const trace = process.env.V03_FIXTURE_TRACE!;
const vault = process.env.V03_VAULT_ROOT!;
const server = process.env.NVIM!;
const note = `${vault}/notes/Target.md`;
const url = "https://fixture.example/path?q=1#frag";
const run = (argv: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(argv[0], argv.slice(1), { stdio: "ignore" });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`nvim exited ${code}`)));
});

export default function fixture(pi: ExtensionAPI) {
  void writeFile(log, "");
  void writeFile(trace, "fixture-extension-loaded\n");
  __transcriptLinks.configureForTest({
    clipboard: { write: async (value: string) => appendFile(log, `${value}\n`) },
    neovim: { open: async (argv: string[]) => {
      await appendFile(trace, `nvim ${JSON.stringify(argv)}\n`);
      await run(["nvim", ...argv]);
    } },
    clock: { setTimeout, clearTimeout },
    vaultRoot: vault,
    nvimServer: server,
  });
  pi.registerCommand("v03-fixture", {
    description: "render deterministic transcript link fixtures",
    handler: async () => {
      pi.sendMessage({
        customType: "v03-fixture",
        display: true,
        content: [
          "history-01", "history-02", "history-03", "history-04", "history-05", "history-06",
          `HTTPS [${url}](${url})`,
          "Vault [[notes/Target#Chosen Heading|Target heading]]",
          `Control [Target.md](file://${note}#Chosen%20Heading)`,
        ].join("\n"),
      });
    },
  });
  pi.registerCommand("v03-typed", {
    description: "record terminal input reaching Pi",
    handler: async (_args, ctx) => {
      await appendFile(trace, "typed-input-reached-pi\n");
      ctx.ui.setStatus("v03-typed", "Typed input reached Pi");
    },
  });
}
