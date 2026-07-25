import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);
const CASE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "verify_nvim",
    label: "Verify Neovim",
    description: "Run one named scripts/verify-nvim case and return its unmodified exit status, stdout, and stderr.",
    promptSnippet: "Run a deterministic Neovim harness case without exposing a general-purpose shell.",
    parameters: Type.Object({
      case: Type.String({ description: "Harness case name, such as agent-keymaps." }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const script = join(ctx.cwd, "scripts", "verify-nvim");
      const configHome = join(ctx.cwd, "nvim", ".config");
      const command = `XDG_CONFIG_HOME="$PWD/nvim/.config" scripts/verify-nvim ${params.case}`;

      if (!CASE_PATTERN.test(params.case)) {
        const details = {
          command,
          cwd: ctx.cwd,
          exit_code: 2,
          stdout: "",
          stderr: `Invalid case name: ${params.case}`,
        };
        return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
      }

      try {
        await access(script, constants.X_OK);
        const result = await execFileAsync(script, [params.case], {
          cwd: ctx.cwd,
          encoding: "utf8",
          env: { ...process.env, XDG_CONFIG_HOME: configHome },
          maxBuffer: 1024 * 1024,
          signal,
        });
        const details = {
          command,
          cwd: ctx.cwd,
          exit_code: 0,
          stdout: String(result.stdout ?? ""),
          stderr: String(result.stderr ?? ""),
        };
        return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
      } catch (error) {
        const failure = error as Error & {
          code?: number | string;
          stdout?: string | Buffer;
          stderr?: string | Buffer;
        };
        const details = {
          command,
          cwd: ctx.cwd,
          exit_code: typeof failure.code === "number" ? failure.code : 1,
          stdout: String(failure.stdout ?? ""),
          stderr: String(failure.stderr ?? failure.message),
        };
        return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
      }
    },
  });
}
