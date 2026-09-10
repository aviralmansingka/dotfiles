import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionCliCommand,
  ExtensionCliCommandContext,
  ExtensionCliCommandHandler,
  ExtensionVcsAdapter,
  ExtensionVcsDiffInput,
  ExtensionVcsFileSourceRequest,
  HunkExtensionAPI,
} from "hunkdiff/extension";
import nvimReviewExtension, {
  contextPatch,
  loadSnapshotFile,
  MAX_FILES,
  MAX_SNAPSHOT_BYTES,
  MAX_SOURCE_BYTES,
  MAX_TOTAL_LINES,
  MAX_TOTAL_SOURCE_BYTES,
  parseSnapshotValue,
} from "./index";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Make one isolated snapshot directory. */
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "hunk-nvim-review-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** Capture the two public registrations without starting Hunk. */
function registrations() {
  let command: ExtensionCliCommand | undefined;
  let handler: ExtensionCliCommandHandler | undefined;
  let adapter: ExtensionVcsAdapter | undefined;
  nvimReviewExtension({
    registerCliCommand(value: ExtensionCliCommand, valueHandler: ExtensionCliCommandHandler) {
      command = value;
      handler = valueHandler;
    },
    registerVcsAdapter(value: ExtensionVcsAdapter) {
      adapter = value;
    },
  } as unknown as HunkExtensionAPI);
  if (!command || !handler || !adapter) throw new Error("Expected extension registrations.");
  return { command, handler, adapter };
}

/** Invoke the extension command without exposing terminal streams to it. */
async function selectSnapshot(handler: ExtensionCliCommandHandler, cwd: string, path: string) {
  let stdinReads = 0;
  let stdoutWrites = 0;
  const context = {
    cwd,
    signal: new AbortController().signal,
    stdin: {
      async *[Symbol.asyncIterator]() {
        stdinReads += 1;
        yield new Uint8Array();
      },
    },
    stdout: {
      async write() {
        stdoutWrites += 1;
      },
    },
    stderr: { async write() {} },
  } satisfies ExtensionCliCommandContext;
  const result = await handler([path], context);
  return { result, stdinReads, stdoutWrites };
}

/** Load the working-tree operation registered by the extension. */
async function loadReview(adapter: ExtensionVcsAdapter, cwd: string, staged = true) {
  const operation = adapter.operations?.["working-tree-diff"];
  if (!operation) throw new Error("Expected a working-tree operation.");
  const input = {
    kind: "vcs",
    staged,
    options: {},
  } satisfies ExtensionVcsDiffInput;
  return operation.load(input, { cwd, signal: new AbortController().signal });
}

/** Ask a captured source reader for one unchanged side. */
function sourceRequest(path: string, side: "old" | "new"): ExtensionVcsFileSourceRequest {
  return { path, changeType: "change", isUntracked: false, side };
}

describe("nvim-review extension", () => {
  test("registers an explicit-only VCS and delegates its command to stock diff", async () => {
    const { command, handler, adapter } = registrations();
    const selected = await selectSnapshot(handler, "/worktree", "snapshot.json");

    expect(command).toEqual({
      name: "nvim-review",
      summary: "Review an exact Neovim buffer snapshot",
      usage: "<snapshot.json>",
    });
    expect(adapter.detect("/worktree")).toBeNull();
    expect(selected.result).toEqual({
      kind: "delegate",
      argv: ["diff", "--staged", "--vcs", "nvim-review"],
    });
    await expect(loadReview(adapter, "/worktree", false)).rejects.toThrow("--staged");
    expect({ stdinReads: selected.stdinReads, stdoutWrites: selected.stdoutWrites }).toEqual({
      stdinReads: 0,
      stdoutWrites: 0,
    });
  });

  test("builds exact unchanged full-context patches and source readers", async () => {
    const cwd = temporaryDirectory();
    const snapshotPath = join(cwd, "snapshot.json");
    const files = [
      { path: "src/crlf.ts", text: "first\r\nsecond\r\n" },
      { path: "empty.txt", text: "" },
      { path: 'src/space "quoted".ts', text: "no final newline" },
    ];
    writeFileSync(snapshotPath, JSON.stringify({ files }));
    const { handler, adapter } = registrations();
    await selectSnapshot(handler, cwd, snapshotPath);
    const review = await loadReview(adapter, cwd);

    expect(review.repoRoot).toBe(cwd);
    expect(review.patchText).toContain("@@ -1,2 +1,2 @@\n first\r\n second\r\n");
    expect(review.patchText).toContain("@@ -1 +1 @@\n \n\\ No newline at end of file\n");
    expect(review.patchText).toContain(
      `diff --git ${JSON.stringify('a/src/space "quoted".ts')} ${JSON.stringify('b/src/space "quoted".ts')}`,
    );
    expect(review.patchText.match(/\n[+-](?![+-])/gu)).toBeNull();
    expect(review.readFileSource).toBeDefined();
    for (const file of files) {
      expect(await review.readFileSource!(sourceRequest(file.path, "old"))).toBe(file.text);
      expect(await review.readFileSource!(sourceRequest(file.path, "new"))).toBe(file.text);
    }
  });

  test("pins each reader and cache key to the snapshot loaded with it", async () => {
    const cwd = temporaryDirectory();
    const path = join(cwd, "snapshot.json");
    const { handler, adapter } = registrations();
    await selectSnapshot(handler, cwd, path);

    writeFileSync(path, JSON.stringify({ files: [{ path: "buffer.ts", text: "version one\n" }] }));
    const first = await loadReview(adapter, cwd);
    const repeated = await loadReview(adapter, cwd);
    writeFileSync(path, JSON.stringify({ files: [{ path: "buffer.ts", text: "version two\n" }] }));
    const second = await loadReview(adapter, cwd);

    expect(repeated.sourceCacheKey).toBe(first.sourceCacheKey);
    expect(second.sourceCacheKey).not.toBe(first.sourceCacheKey);
    expect(await first.readFileSource!(sourceRequest("buffer.ts", "new"))).toBe("version one\n");
    expect(await second.readFileSource!(sourceRequest("buffer.ts", "new"))).toBe("version two\n");
  });

  test("rejects oversized snapshots, source limits, unsafe paths, and duplicates", async () => {
    const cwd = temporaryDirectory();
    const oversized = join(cwd, "oversized.json");
    writeFileSync(oversized, Buffer.alloc(MAX_SNAPSHOT_BYTES + 1, 0x20));
    await expect(loadSnapshotFile(oversized)).rejects.toThrow(String(MAX_SNAPSHOT_BYTES));
    await expect(loadSnapshotFile(cwd)).rejects.toThrow("must be a file");

    const frozen = parseSnapshotValue({ files: [{ path: "frozen.ts", text: "exact" }] });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.files)).toBe(true);
    expect(Object.isFrozen(frozen.files[0])).toBe(true);

    expect(() =>
      parseSnapshotValue({ files: Array.from({ length: MAX_FILES + 1 }, () => ({})) }),
    ).toThrow(String(MAX_FILES));
    expect(() =>
      parseSnapshotValue({
        files: [{ path: "large.txt", text: "x".repeat(MAX_SOURCE_BYTES + 1) }],
      }),
    ).toThrow(String(MAX_SOURCE_BYTES));
    expect(() =>
      parseSnapshotValue({
        files: [{ path: "lines.txt", text: "\n".repeat(MAX_TOTAL_LINES + 1) }],
      }),
    ).toThrow(String(MAX_TOTAL_LINES));
    const aggregateChunk = "x".repeat(Math.floor(MAX_TOTAL_SOURCE_BYTES / 5) + 1);
    expect(() =>
      parseSnapshotValue({
        files: Array.from({ length: 5 }, (_, index) => ({
          path: `${index}.txt`,
          text: aggregateChunk,
        })),
      }),
    ).toThrow(String(MAX_TOTAL_SOURCE_BYTES));
    for (const path of [
      "../escape.ts",
      "/absolute.ts",
      "C:\\absolute.ts",
      "bad\npath.ts",
      "bad\u0080path.ts",
      "bad\u009bpath.ts",
      "bad\u009fpath.ts",
    ]) {
      expect(() => parseSnapshotValue({ files: [{ path, text: "x" }] })).toThrow("relative");
    }
    expect(() =>
      parseSnapshotValue({
        files: [
          { path: "src/file.ts", text: "one" },
          { path: "src/../src/file.ts", text: "two" },
        ],
      }),
    ).toThrow("duplicate");
  });

  test("declares one dependency-free API-25 folder entry", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "package.json"), "utf8"));
    expect(manifest).toMatchObject({
      private: true,
      hunk: { extensions: ["./index.ts"], apiVersion: 25 },
    });
    expect(manifest.dependencies).toBeUndefined();
  });
});

describe("contextPatch", () => {
  test("represents an empty buffer as unchanged line one", () => {
    expect(contextPatch("empty.txt", "")).toContain(
      "@@ -1 +1 @@\n \n\\ No newline at end of file\n",
    );
  });
});
