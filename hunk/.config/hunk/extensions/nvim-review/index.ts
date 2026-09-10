import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, posix, resolve, win32 } from "node:path";
import type {
  ExtensionCliCommandHandler,
  ExtensionVcsAdapter,
  ExtensionVcsPatchResult,
  HunkExtensionAPI,
} from "hunkdiff/extension";

export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 1_000_000;
export const MAX_TOTAL_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_FILES = 512;
export const MAX_TOTAL_LINES = 100_000;
export const MAX_PATH_BYTES = 4_096;

export interface NvimReviewFile {
  readonly path: string;
  readonly text: string;
}

export interface NvimReviewSnapshot {
  readonly files: readonly NvimReviewFile[];
}

let snapshotPath: string | undefined;

/** Create an error Hunk recognizes as an extension-owned user error. */
function userError(message: string) {
  const error = new Error(message) as Error & { suggestions: string[] };
  error.name = "HunkExtensionUserError";
  error.suggestions = [];
  return error;
}

/** Require a plain object with exactly the expected keys. */
function exactRecord(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key)) ? record : null;
}

/** Report whether a path contains a terminal or NUL control character. */
function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Normalize one worktree-relative path without consulting the filesystem. */
function safeRelativePath(input: string) {
  const portable = input.replaceAll("\\", "/");
  const normalized = posix.normalize(portable);
  if (
    input.length === 0 ||
    !input.isWellFormed() ||
    Buffer.byteLength(input) > MAX_PATH_BYTES ||
    hasControlCharacter(input) ||
    isAbsolute(input) ||
    win32.isAbsolute(input) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    throw userError("Snapshot buffer paths must stay relative to the Hunk working directory.");
  }
  return normalized;
}

/** Count represented source lines without allocating one string per line. */
function logicalLineCount(text: string) {
  let lines = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) lines += 1;
  }
  return Math.max(1, lines + (text.endsWith("\n") ? 0 : 1));
}

/** Validate and freeze the source-only public snapshot shape. */
export function parseSnapshotValue(value: unknown): NvimReviewSnapshot {
  const record = exactRecord(value, ["files"]);
  if (!record || !Array.isArray(record.files)) {
    throw userError('The snapshot must contain exactly a "files" array.');
  }
  if (record.files.length > MAX_FILES) {
    throw userError(`The snapshot may contain at most ${MAX_FILES} files.`);
  }

  const seen = new Set<string>();
  const files: NvimReviewFile[] = [];
  let totalBytes = 0;
  let totalLines = 0;
  for (const candidate of record.files) {
    const file = exactRecord(candidate, ["path", "text"]);
    if (!file || typeof file.path !== "string" || typeof file.text !== "string") {
      throw userError('Each snapshot file must contain exactly string "path" and "text" fields.');
    }
    const path = safeRelativePath(file.path);
    if (seen.has(path))
      throw userError(`The snapshot contains duplicate path ${JSON.stringify(path)}.`);
    seen.add(path);

    const bytes = Buffer.byteLength(file.text);
    if (bytes > MAX_SOURCE_BYTES) {
      throw userError(`Buffer ${JSON.stringify(path)} exceeds ${MAX_SOURCE_BYTES} UTF-8 bytes.`);
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
      throw userError(`Snapshot source exceeds ${MAX_TOTAL_SOURCE_BYTES} UTF-8 bytes.`);
    }
    totalLines += logicalLineCount(file.text);
    if (totalLines > MAX_TOTAL_LINES) {
      throw userError(`Snapshot source exceeds ${MAX_TOTAL_LINES} logical lines.`);
    }
    files.push(Object.freeze({ path, text: file.text }));
  }
  return Object.freeze({ files: Object.freeze(files) });
}

/** Read one file without ever buffering more than the declared snapshot bound. */
async function readBoundedSnapshot(path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) {
      throw userError(`The snapshot must be a file no larger than ${MAX_SNAPSHOT_BYTES} bytes.`);
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      signal?.throwIfAborted();
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_SNAPSHOT_BYTES + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_SNAPSHOT_BYTES) {
        throw userError(`The snapshot must be no larger than ${MAX_SNAPSHOT_BYTES} bytes.`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

/** Load, decode, validate, and freeze one complete snapshot file. */
export async function loadSnapshotFile(path: string, signal?: AbortSignal) {
  const bytes = await readBoundedSnapshot(path, signal);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw userError("The snapshot must contain valid UTF-8 JSON.");
  }
  try {
    return parseSnapshotValue(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw userError("The snapshot must contain valid JSON.");
    throw error;
  }
}

/** Split source into logical lines while retaining exact line endings. */
function exactSourceLines(text: string) {
  if (text === "") return [""];
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 0x0a) continue;
    lines.push(text.slice(start, index + 1));
    start = index + 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/** Build one unchanged full-context patch without normalizing source text. */
export function contextPatch(path: string, text: string) {
  const lines = exactSourceLines(text);
  const oldPath = JSON.stringify(`a/${path}`);
  const newPath = JSON.stringify(`b/${path}`);
  const range = lines.length === 1 ? "1" : `1,${lines.length}`;
  const parts = [
    `diff --git ${oldPath} ${newPath}\n--- ${oldPath}\n+++ ${newPath}\n@@ -${range} +${range} @@\n`,
  ];
  for (const line of lines) parts.push(" ", line, line.endsWith("\n") ? "" : "\n");
  if (!text.endsWith("\n")) parts.push("\\ No newline at end of file\n");
  return parts.join("");
}

/** Hash semantic paths and exact source so equal keys guarantee equal reader answers. */
function snapshotDigest(snapshot: NvimReviewSnapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot.files)).digest("hex");
}

/** Load the captured snapshot through Hunk's ordinary public VCS result contract. */
async function loadReview(cwd: string, signal?: AbortSignal): Promise<ExtensionVcsPatchResult> {
  if (!snapshotPath) {
    throw userError("No Neovim snapshot was selected; run `hunk nvim-review <snapshot.json>`.");
  }
  const snapshot = await loadSnapshotFile(snapshotPath, signal);
  signal?.throwIfAborted();
  const sourceByPath = new Map(snapshot.files.map((file) => [file.path, file.text] as const));
  return {
    repoRoot: cwd,
    sourceLabel: cwd,
    title: "Neovim buffer snapshot",
    patchText: snapshot.files.map((file) => contextPatch(file.path, file.text)).join(""),
    sourceCacheKey: `nvim-review:${snapshotDigest(snapshot)}`,
    readFileSource: async ({ path }) => sourceByPath.get(path) ?? null,
  };
}

/** Capture the snapshot argument before delegating terminal ownership to stock Hunk. */
const runNvimReview: ExtensionCliCommandHandler = (args, context) => {
  context.signal.throwIfAborted();
  if (args.length !== 1 || !args[0]) {
    throw userError("Usage: hunk nvim-review <snapshot.json>");
  }
  snapshotPath = resolve(context.cwd, args[0]);
  return { kind: "delegate", argv: ["diff", "--staged", "--vcs", "nvim-review"] };
};

/** Register the source-only proof command and explicitly selected VCS adapter. */
export default function nvimReviewExtension(hunk: HunkExtensionAPI) {
  hunk.registerCliCommand(
    {
      name: "nvim-review",
      summary: "Review an exact Neovim buffer snapshot",
      usage: "<snapshot.json>",
    },
    runNvimReview,
  );
  hunk.registerVcsAdapter({
    id: "nvim-review",
    name: "Neovim snapshot",
    detect: () => null,
    operations: {
      "working-tree-diff": {
        load: (input, context) => {
          if (!input.staged) {
            throw userError("Neovim snapshot reviews require --staged read-only mode.");
          }
          return loadReview(context.cwd, context.signal);
        },
      },
    },
  } satisfies ExtensionVcsAdapter);
}
