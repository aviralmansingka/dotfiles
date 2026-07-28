import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFile, writeFile } from "node:fs/promises";
import { __transcriptLinks } from "../../pi/.pi/agent/extensions/transcript-scroll.ts";

const log = process.env.V03_CLIPBOARD_LOG!;
const trace = process.env.V03_FIXTURE_TRACE!;
const vault = process.env.V03_VAULT_ROOT!;
const server = process.env.NVIM!;
const note = `${vault}/notes/Target.md`;
const url = "https://fixture.example/path?q=1#frag";
export default function fixture(pi: ExtensionAPI) {
  void writeFile(log, "");
  void writeFile(trace, "fixture-extension-loaded\n");
  __transcriptLinks.configureForTest({
    clipboard: { write: async (value: string) => appendFile(log, `${value}\n`) },
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
}
