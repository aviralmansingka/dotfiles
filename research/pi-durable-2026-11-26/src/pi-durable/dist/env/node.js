import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { access, appendFile, lstat, mkdir, mkdtemp, opendir, open as openFile, readdir, readFile, realpath, rename, rm, writeFile, } from "node:fs/promises";
import { homedir, constants as osConstants, tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamDecoder } from "./decode.js";
import { ExecutionError, err, FileError, ok, toError, } from "./index.js";
import { LineScanner } from "./line-scan.js";
import { NodeFileWatcher } from "./node-watch.js";
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;
const EXIT_STDIO_GRACE_MS = 100;
const SPILL_HIGH_WATER_MARK = 1024 * 1024;
/** Largest single read of a `BinaryReader`, so a huge `length` allocates only as much as the file yields. */
const BINARY_READ_CHUNK = 1024 * 1024;
function resolveTimeoutMs(timeout) {
    if (timeout === undefined)
        return ok(undefined);
    if (!Number.isFinite(timeout) || timeout <= 0) {
        return err(new ExecutionError("timeout", "Invalid timeout: must be a finite number of seconds"));
    }
    const timeoutMs = timeout * 1000;
    if (timeoutMs > MAX_TIMEOUT_MS) {
        return err(new ExecutionError("timeout", `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`));
    }
    return ok(timeoutMs);
}
function resolvePath(cwd, path) {
    let normalized = path;
    if (normalized === "~") {
        normalized = homedir();
    }
    else if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))) {
        normalized = join(homedir(), normalized.slice(2));
    }
    else if (normalized.startsWith("file://")) {
        try {
            normalized = fileURLToPath(normalized);
        }
        catch {
            // Keep malformed URLs as ordinary paths so filesystem methods preserve their non-throwing contract.
        }
    }
    return isAbsolute(normalized) ? resolve(normalized) : resolve(cwd, normalized);
}
function fileKindFromStats(stats) {
    if (stats.isFile())
        return "file";
    if (stats.isDirectory())
        return "directory";
    if (stats.isSymbolicLink())
        return "symlink";
    return undefined;
}
function fileInfoFromStats(path, stats) {
    const kind = fileKindFromStats(stats);
    if (!kind)
        return err(new FileError("invalid", "Unsupported file type", path));
    return ok({
        name: basename(path),
        path,
        kind,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
    });
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
function toFileError(error, fallbackPath) {
    if (error instanceof FileError)
        return error;
    const cause = toError(error);
    const nodeError = isNodeError(error) ? error : undefined;
    const path = typeof nodeError?.path === "string" ? nodeError.path : fallbackPath;
    if (nodeError) {
        const message = nodeError.message;
        switch (nodeError.code) {
            case "ABORT_ERR":
                return new FileError("aborted", message, path, cause);
            case "ENOENT":
                return new FileError("not_found", message, path, cause);
            case "EACCES":
            case "EPERM":
                return new FileError("permission_denied", message, path, cause);
            case "ENOTDIR":
                return new FileError("not_directory", message, path, cause);
            case "EISDIR":
                return new FileError("is_directory", message, path, cause);
            case "EINVAL":
                return new FileError("invalid", message, path, cause);
        }
    }
    return new FileError("unknown", cause.message, path, cause);
}
function abortResult(signal, path) {
    return signal?.aborted ? err(new FileError("aborted", "aborted", path)) : undefined;
}
async function pathExists(path) {
    try {
        await access(path, constants.F_OK);
        return true;
    }
    catch {
        return false;
    }
}
async function runCommand(command, args, timeoutMs) {
    return await new Promise((resolve) => {
        let stdout = "";
        let child;
        try {
            child = spawn(command, args, {
                stdio: ["ignore", "pipe", "ignore"],
                windowsHide: true,
            });
        }
        catch {
            resolve({ stdout: "", status: null });
            return;
        }
        const timeout = setTimeout(() => {
            if (child.pid)
                killProcessTree(child.pid);
        }, timeoutMs);
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => {
            stdout += chunk;
        });
        child.on("error", () => {
            clearTimeout(timeout);
            resolve({ stdout: "", status: null });
        });
        child.on("close", (status) => {
            clearTimeout(timeout);
            resolve({ stdout, status });
        });
    });
}
async function findExecutableOnPath(executable) {
    const result = await runCommand(process.platform === "win32" ? "where" : "which", [executable], 5000);
    if (result.status !== 0 || !result.stdout)
        return null;
    const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
    return firstMatch && (await pathExists(firstMatch)) ? firstMatch : null;
}
// Keep in sync with packages/coding-agent/src/utils/shell.ts.
// Git for Windows reports its POSIX shell as `<root>/usr/bin/sh.exe`.
const GIT_FOR_WINDOWS_SHELL_SUFFIX = win32.join("usr", "bin", "sh.exe");
// Git Bash of the Git for Windows installation whose git.exe is on PATH, wherever it is installed.
// Returns the `<root>\bin\bash.exe` launcher, which sets up MSYSTEM and PATH for `usr\bin\bash.exe`.
async function findGitBashOfGitOnPath() {
    const git = await findExecutableOnPath("git.exe");
    if (!git)
        return null;
    const result = await runCommand(git, ["var", "GIT_SHELL_PATH"], 5000);
    if (result.status !== 0)
        return null;
    const gitShell = win32.normalize(result.stdout.trim());
    if (!gitShell.toLowerCase().endsWith(`\\${GIT_FOR_WINDOWS_SHELL_SUFFIX}`))
        return null;
    const bash = win32.join(gitShell.slice(0, -GIT_FOR_WINDOWS_SHELL_SUFFIX.length), "bin", "bash.exe");
    return (await pathExists(bash)) ? bash : null;
}
// Keep in sync with packages/coding-agent/src/utils/shell.ts.
function isLegacyWslBashPath(path) {
    const normalized = win32.normalize(path).toLowerCase();
    const systemRoot = process.env.SystemRoot;
    if (systemRoot) {
        if (!/^[a-z]:[\\/]/i.test(systemRoot))
            return false;
        return ["System32", "Sysnative"].some((directory) => normalized === win32.join(systemRoot, directory, "bash.exe").toLowerCase());
    }
    // Fall back to conventional launcher paths only when the Windows directory is unknown.
    return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/.test(normalized);
}
function getBashShellConfig(shell) {
    return isLegacyWslBashPath(shell) ? { shell, args: ["-s"], commandTransport: "stdin" } : { shell, args: ["-c"] };
}
async function getShellConfig(customShellPath) {
    if (customShellPath) {
        if (await pathExists(customShellPath)) {
            return ok(getBashShellConfig(customShellPath));
        }
        return err(new ExecutionError("shell_unavailable", `Custom shell path not found: ${customShellPath}`));
    }
    if (process.platform === "win32") {
        const candidates = [];
        const programFiles = process.env.ProgramFiles;
        if (programFiles)
            candidates.push(`${programFiles}\\Git\\bin\\bash.exe`);
        const programFilesX86 = process.env["ProgramFiles(x86)"];
        if (programFilesX86)
            candidates.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
        for (const candidate of candidates) {
            if (await pathExists(candidate)) {
                return ok(getBashShellConfig(candidate));
            }
        }
        // Must precede the generic bash.exe lookup, which usually finds the WSL launcher in System32 first.
        const gitBash = await findGitBashOfGitOnPath();
        if (gitBash) {
            return ok(getBashShellConfig(gitBash));
        }
        const bashOnPath = await findExecutableOnPath("bash.exe");
        if (bashOnPath) {
            return ok(getBashShellConfig(bashOnPath));
        }
        return err(new ExecutionError("shell_unavailable", `No bash shell found. Options:\n` +
            `  1. Install Git for Windows: https://git-scm.com/download/win\n` +
            `  2. Add your bash to PATH (Cygwin, MSYS2, etc.)\n` +
            "  3. Configure an explicit shellPath\n\n" +
            `Searched Git Bash in:\n${candidates.map((path) => `  ${path}`).join("\n")}\n` +
            "  the Git for Windows installation of git.exe on PATH"));
    }
    if (await pathExists("/bin/bash")) {
        return ok(getBashShellConfig("/bin/bash"));
    }
    const bashOnPath = await findExecutableOnPath("bash");
    if (bashOnPath) {
        return ok(getBashShellConfig(bashOnPath));
    }
    return ok({ shell: "sh", args: ["-c"] });
}
function getShellEnv(baseEnv, extraEnv, inheritEnv = true) {
    if (!inheritEnv)
        return { ...extraEnv };
    return {
        ...process.env,
        ...baseEnv,
        ...extraEnv,
    };
}
function killProcessTree(pid) {
    if (process.platform === "win32") {
        try {
            const child = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/F", "/T", "/PID", String(pid)], {
                stdio: "ignore",
                detached: true,
                windowsHide: true,
            });
            // A failed spawn emits "error" asynchronously; consume it to avoid crashing Node.
            child.once("error", () => { });
        }
        catch {
            // Ignore errors.
        }
        return;
    }
    try {
        process.kill(-pid, "SIGKILL");
    }
    catch {
        try {
            process.kill(pid, "SIGKILL");
        }
        catch {
            // Process already dead.
        }
    }
}
function waitForChildProcess(child, spillIsDraining) {
    return new Promise((resolvePromise, reject) => {
        let settled = false;
        let exited = false;
        let exitCode = null;
        let exitSignal = null;
        let postExitTimer;
        let stdoutEnded = child.stdout === null;
        let stderrEnded = child.stderr === null;
        const cleanup = () => {
            if (postExitTimer)
                clearTimeout(postExitTimer);
            child.removeListener("error", onError);
            child.removeListener("exit", onExit);
            child.removeListener("close", onClose);
            child.stdout?.removeListener("end", onStdoutEnd);
            child.stderr?.removeListener("end", onStderrEnd);
            child.stdout?.removeListener("data", onData);
            child.stderr?.removeListener("data", onData);
        };
        const finalize = () => {
            if (settled)
                return;
            settled = true;
            cleanup();
            child.stdout?.destroy();
            child.stderr?.destroy();
            resolvePromise({ code: exitCode, signal: exitSignal });
        };
        const maybeFinalizeAfterExit = () => {
            if (exited && stdoutEnded && stderrEnded)
                finalize();
        };
        const armIdleTimer = () => {
            if (postExitTimer)
                clearTimeout(postExitTimer);
            postExitTimer = setTimeout(() => {
                if (spillIsDraining())
                    armIdleTimer();
                else
                    finalize();
            }, EXIT_STDIO_GRACE_MS);
        };
        const onData = () => {
            if (exited && !settled)
                armIdleTimer();
        };
        const onStdoutEnd = () => {
            stdoutEnded = true;
            maybeFinalizeAfterExit();
        };
        const onStderrEnd = () => {
            stderrEnded = true;
            maybeFinalizeAfterExit();
        };
        const onError = (error) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(error);
        };
        const onExit = (code, signal) => {
            exited = true;
            exitCode = code;
            exitSignal = signal;
            maybeFinalizeAfterExit();
            if (!settled)
                armIdleTimer();
        };
        const onClose = (code, signal) => {
            exitCode = code;
            exitSignal = signal;
            finalize();
        };
        child.stdout?.once("end", onStdoutEnd);
        child.stderr?.once("end", onStderrEnd);
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        child.once("error", onError);
        child.once("exit", onExit);
        child.once("close", onClose);
    });
}
/** Strict LF reader; Node readline does not report whether its final line was newline-terminated. */
class NodeTextLineReader {
    file;
    path;
    decoder = new StreamDecoder();
    chunk = new Uint8Array(64 * 1024);
    byteOffset = 0;
    buffered = "";
    ended = false;
    closed = false;
    constructor(file, path) {
        this.file = file;
        this.path = path;
    }
    async readLine(context) {
        const aborted = abortResult(context.abortSignal, this.path);
        if (aborted)
            return aborted;
        if (this.closed)
            return err(new FileError("invalid", "Text line reader is closed", this.path));
        try {
            let newline = this.buffered.indexOf("\n");
            while (newline === -1 && !this.ended) {
                // Explicit positions allow an aborted read to be retried without skipping bytes.
                const { bytesRead } = await this.file.read(this.chunk, 0, this.chunk.length, this.byteOffset);
                const afterReadAbort = abortResult(context.abortSignal, this.path);
                if (afterReadAbort)
                    return afterReadAbort;
                this.byteOffset += bytesRead;
                this.ended = bytesRead === 0;
                const text = this.ended ? this.decoder.decode() : this.decoder.decode(this.chunk.subarray(0, bytesRead));
                // Only the new text is scanned, so a line longer than one read is not rescanned per read.
                const found = text.indexOf("\n");
                if (found !== -1)
                    newline = this.buffered.length + found;
                this.buffered += text;
            }
            if (newline !== -1) {
                const text = this.buffered.slice(0, newline);
                this.buffered = this.buffered.slice(newline + 1);
                return ok({ text, terminated: true });
            }
            if (this.buffered.length === 0)
                return ok(undefined);
            const text = this.buffered;
            this.buffered = "";
            return ok({ text, terminated: false });
        }
        catch (error) {
            return err(toFileError(error, this.path));
        }
    }
    async close(_context) {
        if (this.closed)
            return;
        this.closed = true;
        this.buffered = "";
        try {
            await this.file.close();
        }
        catch {
            // Closing is best-effort, including after cancellation or an earlier I/O failure.
        }
    }
}
function closedResult(what, path) {
    return err(new FileError("invalid", `${what} is closed`, path));
}
class NodeBinaryReader {
    file;
    path;
    closed = false;
    constructor(file, path) {
        this.file = file;
        this.path = path;
    }
    async info(context) {
        const aborted = abortResult(context.abortSignal, this.path);
        if (aborted)
            return aborted;
        if (this.closed)
            return closedResult("Binary reader", this.path);
        try {
            return fileInfoFromStats(this.path, await this.file.stat());
        }
        catch (error) {
            return err(toFileError(error, this.path));
        }
    }
    async read(offset, length, context) {
        const aborted = abortResult(context.abortSignal, this.path);
        if (aborted)
            return aborted;
        if (this.closed)
            return closedResult("Binary reader", this.path);
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
            return err(new FileError("invalid", "Offset and length must be non-negative safe integers", this.path));
        }
        const chunks = [];
        let total = 0;
        try {
            while (total < length) {
                const chunk = new Uint8Array(Math.min(length - total, BINARY_READ_CHUNK));
                const { bytesRead } = await this.file.read(chunk, 0, chunk.length, offset + total);
                const afterReadAbort = abortResult(context.abortSignal, this.path);
                if (afterReadAbort)
                    return afterReadAbort;
                if (bytesRead === 0)
                    break;
                chunks.push(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
                total += bytesRead;
            }
        }
        catch (error) {
            return err(toFileError(error, this.path));
        }
        if (chunks.length === 1)
            return ok(chunks[0]);
        const bytes = new Uint8Array(total);
        let position = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, position);
            position += chunk.length;
        }
        return ok(bytes);
    }
    async scanLines(options, context) {
        const aborted = abortResult(context.abortSignal, this.path);
        if (aborted)
            return aborted;
        if (this.closed)
            return closedResult("Binary reader", this.path);
        let scanner;
        try {
            scanner = new LineScanner(options.startLine, options.endLine);
        }
        catch {
            return err(new FileError("invalid", "Invalid line range", this.path));
        }
        const chunk = new Uint8Array(64 * 1024);
        try {
            for (let position = 0;;) {
                const { bytesRead } = await this.file.read(chunk, 0, chunk.length, position);
                const afterReadAbort = abortResult(context.abortSignal, this.path);
                if (afterReadAbort)
                    return afterReadAbort;
                if (bytesRead === 0)
                    return ok(scanner.finish());
                scanner.push(chunk.subarray(0, bytesRead));
                position += bytesRead;
            }
        }
        catch (error) {
            return err(toFileError(error, this.path));
        }
    }
    async close(_context) {
        if (this.closed)
            return;
        this.closed = true;
        await this.file.close().catch(() => undefined);
    }
}
class NodeDirReader {
    dir;
    path;
    done = false;
    closed = false;
    constructor(dir, path) {
        this.dir = dir;
        this.path = path;
    }
    async next(maxEntries, context) {
        const aborted = abortResult(context.abortSignal, this.path);
        if (aborted)
            return aborted;
        if (this.closed)
            return closedResult("Directory reader", this.path);
        if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
            return err(new FileError("invalid", "maxEntries must be a positive safe integer", this.path));
        }
        const entries = [];
        try {
            while (!this.done && entries.length < maxEntries) {
                const entry = await this.dir.read();
                if (entry === null) {
                    this.done = true;
                    break;
                }
                const loopAbort = abortResult(context.abortSignal, this.path);
                if (loopAbort)
                    return loopAbort;
                const entryPath = resolve(this.path, entry.name);
                let stats;
                try {
                    stats = await lstat(entryPath);
                }
                catch (error) {
                    // Removed between enumeration and lstat: not part of the listing any more.
                    if (isNodeError(error) && error.code === "ENOENT")
                        continue;
                    return err(toFileError(error, entryPath));
                }
                const info = fileInfoFromStats(entryPath, stats);
                if (info.ok)
                    entries.push(info.value);
            }
            return ok({ entries, done: this.done });
        }
        catch (error) {
            return err(toFileError(error, this.path));
        }
    }
    async close(_context) {
        if (this.closed)
            return;
        this.closed = true;
        await this.dir.close().catch(() => undefined);
    }
}
function symlinkRefused(path, cause) {
    return new FileError("invalid", "Refusing to follow a symbolic link", path, cause);
}
export class NodeExecutionEnv {
    /** Every local environment sees the same files. */
    id = "node:local";
    cwd;
    shellPath;
    shellEnv;
    watchOptions;
    activeChildPids = new Set();
    constructor(options) {
        this.cwd = options.cwd;
        this.shellPath = options.shellPath;
        this.shellEnv = options.shellEnv;
        this.watchOptions = options.watch ?? {};
    }
    async watch(targets, onChange, context) {
        const aborted = abortResult(context.abortSignal);
        if (aborted)
            return aborted;
        try {
            const watcher = await NodeFileWatcher.open(targets, (path) => resolvePath(this.cwd, path), onChange, this.watchOptions);
            const afterOpenAbort = abortResult(context.abortSignal);
            if (afterOpenAbort) {
                await watcher.stop(context);
                return afterOpenAbort;
            }
            return ok(watcher);
        }
        catch (error) {
            return err(toFileError(error));
        }
    }
    async absolutePath(path, _context) {
        return ok(resolvePath(this.cwd, path));
    }
    async joinPath(parts, _context) {
        return ok(join(...parts));
    }
    async exec(command, options, context) {
        const signal = context.abortSignal;
        if (signal?.aborted)
            return err(new ExecutionError("aborted", "aborted"));
        const timeoutMsResult = resolveTimeoutMs(options?.timeout);
        if (!timeoutMsResult.ok)
            return err(timeoutMsResult.error);
        const timeoutMs = timeoutMsResult.value;
        const cwd = options?.cwd ? resolvePath(this.cwd, options.cwd) : this.cwd;
        // A string runs through the shell; an argv array runs its program directly, without shell parsing.
        let program;
        let args;
        let stdinCommand;
        if (typeof command === "string") {
            const shellConfig = await getShellConfig(this.shellPath);
            if (!shellConfig.ok)
                return shellConfig;
            const commandFromStdin = shellConfig.value.commandTransport === "stdin";
            program = shellConfig.value.shell;
            args = commandFromStdin ? shellConfig.value.args : [...shellConfig.value.args, command];
            stdinCommand = commandFromStdin ? command : undefined;
        }
        else {
            const [first, ...rest] = command;
            if (first === undefined)
                return err(new ExecutionError("spawn_error", "Empty argv: no program to run"));
            program = first;
            args = rest;
        }
        try {
            await access(cwd, constants.F_OK);
        }
        catch (error) {
            const cause = toError(error);
            return err(new ExecutionError("spawn_error", `Working directory does not exist: ${cwd}\nCannot execute bash commands.`, cause));
        }
        return await new Promise((resolvePromise) => {
            let settled = false;
            let timedOut = false;
            let callbackError;
            let spillError;
            let child;
            let timeoutId;
            const spillPrefix = [];
            let spillPath;
            const spillQueue = [];
            let spillStart;
            let spillStream;
            let spillBackpressured = false;
            const onAbort = () => {
                if (child?.pid)
                    killProcessTree(child.pid);
            };
            const failCallback = (error) => {
                if (callbackError !== undefined)
                    return;
                const cause = toError(error);
                callbackError = new ExecutionError("callback_error", cause.message, cause);
                onAbort();
            };
            // One decoder per stream, so a character split across chunks of one stream survives interleaving.
            const stdoutDecoder = new StreamDecoder();
            const stderrDecoder = new StreamDecoder();
            // No output reaches the caller after exec() settled, for example from a descendant holding stdio open.
            const emit = (text, stream) => {
                if (settled || text === "" || options?.onOutput === undefined || callbackError !== undefined)
                    return;
                try {
                    options.onOutput(text, context, { stream });
                }
                catch (error) {
                    failCallback(error);
                }
            };
            // Output seen before the spill starts: counted against the thresholds and kept for the spill's prefix.
            let seenBytes = 0;
            let seenNewlines = 0;
            const settle = (result) => {
                if (settled)
                    return;
                settled = true;
                if (timeoutId)
                    clearTimeout(timeoutId);
                if (signal)
                    signal.removeEventListener("abort", onAbort);
                if (child?.pid)
                    this.activeChildPids.delete(child.pid);
                resolvePromise(result);
            };
            const pauseOutput = () => {
                child?.stdout?.pause();
                child?.stderr?.pause();
            };
            const resumeOutput = () => {
                if (callbackError || spillError || timedOut || signal?.aborted || spillBackpressured)
                    return;
                child?.stdout?.resume();
                child?.stderr?.resume();
            };
            const failSpill = (error) => {
                if (spillError !== undefined)
                    return;
                const cause = toError(error);
                spillError = new ExecutionError("unknown", `Failed to preserve complete shell output: ${cause.message}`, cause);
                spillBackpressured = false;
                onAbort();
            };
            const writeSpill = (chunk) => {
                if (spillStream === undefined || chunk.length === 0)
                    return;
                if (spillStream.write(chunk) || spillBackpressured)
                    return;
                spillBackpressured = true;
                pauseOutput();
                spillStream.once("drain", () => {
                    spillBackpressured = false;
                    resumeOutput();
                });
            };
            const startSpill = (chunk) => {
                if (spillStream !== undefined) {
                    writeSpill(chunk);
                    return;
                }
                spillQueue.push(chunk);
                if (spillStart !== undefined)
                    return;
                pauseOutput();
                spillStart = (async () => {
                    const created = await this.createTempFile({ prefix: "pi-output-", suffix: ".log" }, context);
                    if (!created.ok)
                        throw created.error;
                    spillPath = created.value;
                    spillStream = createWriteStream(spillPath, { flags: "a", highWaterMark: SPILL_HIGH_WATER_MARK });
                    spillStream.on("error", failSpill);
                    for (const queued of spillQueue)
                        writeSpill(queued);
                    spillQueue.length = 0;
                })()
                    .catch(failSpill)
                    .finally(resumeOutput);
            };
            const finishSpill = async () => {
                await spillStart;
                const stream = spillStream;
                if (stream === undefined || spillError !== undefined || stream.destroyed)
                    return;
                await new Promise((resolveFinish) => {
                    stream.once("error", () => resolveFinish());
                    stream.once("finish", resolveFinish);
                    stream.end();
                });
            };
            try {
                child = spawn(program, args, {
                    cwd,
                    detached: process.platform !== "win32",
                    env: getShellEnv(this.shellEnv, options?.env, options?.inheritEnv),
                    stdio: [stdinCommand === undefined ? "ignore" : "pipe", "pipe", "pipe"],
                    windowsHide: true,
                });
                if (child.pid)
                    this.activeChildPids.add(child.pid);
                if (stdinCommand !== undefined) {
                    child.stdin?.on("error", () => { });
                    child.stdin?.end(stdinCommand);
                }
            }
            catch (error) {
                const cause = toError(error);
                settle(err(new ExecutionError("spawn_error", cause.message, cause)));
                return;
            }
            timeoutId =
                timeoutMs === undefined
                    ? undefined
                    : setTimeout(() => {
                        timedOut = true;
                        onAbort();
                    }, timeoutMs);
            if (signal) {
                if (signal.aborted)
                    onAbort();
                else
                    signal.addEventListener("abort", onAbort, { once: true });
            }
            const feed = (source, decoder) => (chunk) => {
                emit(decoder.decode(chunk), source);
                const spill = options?.spill;
                if (spill === undefined || chunk.length === 0)
                    return;
                if (spillStart !== undefined) {
                    startSpill(chunk);
                    return;
                }
                seenBytes += chunk.length;
                for (let index = chunk.indexOf(0x0a); index !== -1; index = chunk.indexOf(0x0a, index + 1))
                    seenNewlines++;
                const lines = seenNewlines + (chunk[chunk.length - 1] === 0x0a ? 0 : 1);
                if (seenBytes <= spill.afterBytes && lines <= spill.afterLines) {
                    spillPrefix.push(chunk);
                    return;
                }
                for (const prefix of spillPrefix)
                    startSpill(prefix);
                spillPrefix.length = 0;
                startSpill(chunk);
            };
            child.stdout?.on("data", feed("stdout", stdoutDecoder));
            child.stderr?.on("data", feed("stderr", stderrDecoder));
            void waitForChildProcess(child, () => spillError === undefined &&
                spillStart !== undefined &&
                (spillStream === undefined || spillBackpressured)).then(async ({ code, signal: exitSignal }) => {
                await finishSpill();
                emit(stdoutDecoder.decode(), "stdout");
                emit(stderrDecoder.decode(), "stderr");
                if (callbackError) {
                    settle(err(callbackError));
                    return;
                }
                const interrupted = timedOut
                    ? new ExecutionError("timeout", `timeout:${options?.timeout}`)
                    : signal?.aborted
                        ? new ExecutionError("aborted", "aborted")
                        : undefined;
                if (interrupted !== undefined) {
                    if (spillPath !== undefined)
                        interrupted.spillPath = spillPath;
                    settle(err(interrupted));
                    return;
                }
                if (spillError) {
                    settle(err(spillError));
                    return;
                }
                // A process killed by a signal (e.g. OOM killer) has no exit code; map it
                // to the conventional 128 + signal number so callers do not mistake it
                // for a successful exit.
                const exitCode = code ?? (exitSignal ? 128 + (osConstants.signals[exitSignal] ?? 0) : 1);
                settle(ok({ exitCode, ...(spillPath === undefined ? {} : { spillPath }) }));
            }, (error) => settle(err(new ExecutionError("spawn_error", error.message, error))));
        });
    }
    async openTextLineReader(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(context.abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            const file = await openFile(resolved, "r");
            const afterOpenAbort = abortResult(context.abortSignal, resolved);
            if (afterOpenAbort) {
                await file.close().catch(() => undefined);
                return afterOpenAbort;
            }
            return ok(new NodeTextLineReader(file, resolved));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async readTextFile(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const signal = context.abortSignal;
        const aborted = abortResult(signal, resolved);
        if (aborted)
            return aborted;
        try {
            return ok(await readFile(resolved, { encoding: "utf8", signal }));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async readTextLines(path, options, context) {
        if (options?.maxLines !== undefined && options.maxLines <= 0)
            return ok([]);
        const opened = await this.openTextLineReader(path, context);
        if (!opened.ok)
            return opened;
        const lines = [];
        try {
            while (options?.maxLines === undefined || lines.length < options.maxLines) {
                const line = await opened.value.readLine(context);
                if (!line.ok)
                    return line;
                if (line.value === undefined)
                    break;
                lines.push(line.value.text);
            }
            return ok(lines);
        }
        finally {
            await opened.value.close(context);
        }
    }
    async readBinaryFile(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const signal = context.abortSignal;
        const aborted = abortResult(signal, resolved);
        if (aborted)
            return aborted;
        try {
            return ok(await readFile(resolved, { signal }));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async openBinaryReader(path, options, context) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(context.abortSignal, resolved);
        if (aborted)
            return aborted;
        const noFollow = options?.noFollow === true;
        let file;
        try {
            let flags = constants.O_RDONLY;
            if (process.platform === "win32") {
                // Windows has no O_NOFOLLOW; check the final component before opening (not race-free).
                if (noFollow && (await lstat(resolved)).isSymbolicLink())
                    return err(symlinkRefused(resolved));
            }
            else {
                // Nonblocking, so opening a FIFO does not wait for a writer.
                flags |= constants.O_NONBLOCK;
                if (noFollow)
                    flags |= constants.O_NOFOLLOW;
            }
            file = await openFile(resolved, flags);
            const stats = await file.stat();
            if (!stats.isFile()) {
                await file.close().catch(() => undefined);
                return err(stats.isDirectory()
                    ? new FileError("is_directory", "EISDIR: illegal operation on a directory, read", resolved)
                    : new FileError("invalid", "Not a regular file", resolved));
            }
            const afterOpenAbort = abortResult(context.abortSignal, resolved);
            if (afterOpenAbort) {
                await file.close().catch(() => undefined);
                return afterOpenAbort;
            }
            return ok(new NodeBinaryReader(file, resolved));
        }
        catch (error) {
            await file?.close().catch(() => undefined);
            // O_NOFOLLOW reports a final-component symlink as ELOOP (EMLINK on some BSDs).
            if (noFollow && isNodeError(error) && (error.code === "ELOOP" || error.code === "EMLINK")) {
                return err(symlinkRefused(resolved, toError(error)));
            }
            return err(toFileError(error, resolved));
        }
    }
    async writeFile(path, content, context) {
        const resolved = resolvePath(this.cwd, path);
        const signal = context.abortSignal;
        const aborted = abortResult(signal, resolved);
        if (aborted)
            return aborted;
        try {
            await mkdir(resolve(resolved, ".."), { recursive: true });
            const afterMkdirAbort = abortResult(signal, resolved);
            if (afterMkdirAbort)
                return afterMkdirAbort;
            await writeFile(resolved, content, { signal });
            return ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async appendFile(path, content, context) {
        const resolved = resolvePath(this.cwd, path);
        const signal = context.abortSignal;
        const aborted = abortResult(signal, resolved);
        if (aborted)
            return aborted;
        try {
            await mkdir(resolve(resolved, ".."), { recursive: true });
            const afterMkdirAbort = abortResult(signal, resolved);
            if (afterMkdirAbort)
                return afterMkdirAbort;
            await appendFile(resolved, content);
            const afterAppendAbort = abortResult(signal, resolved);
            return afterAppendAbort ?? ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async truncateFile(path, size, context) {
        const resolved = resolvePath(this.cwd, path);
        const signal = context.abortSignal;
        const aborted = abortResult(signal, resolved);
        if (aborted)
            return aborted;
        if (!Number.isSafeInteger(size) || size < 0) {
            return err(new FileError("invalid", "File size must be a non-negative safe integer", resolved));
        }
        let file;
        try {
            file = await openFile(resolved, "r+");
            await file.truncate(size);
            const afterTruncateAbort = abortResult(signal, resolved);
            return afterTruncateAbort ?? ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
        finally {
            await file?.close().catch(() => undefined);
        }
    }
    async flushFile(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const signal = context.abortSignal;
        const aborted = abortResult(signal, resolved);
        if (aborted)
            return aborted;
        let file;
        try {
            file = await openFile(resolved, "r+");
            // POSIX refuses to open a directory for writing; Windows opens it, so check explicitly.
            if ((await file.stat()).isDirectory())
                return err(new FileError("is_directory", "Is a directory", resolved));
            await file.sync();
            const afterSyncAbort = abortResult(signal, resolved);
            return afterSyncAbort ?? ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
        finally {
            await file?.close().catch(() => undefined);
        }
    }
    async renameFile(sourcePath, destinationPath, context) {
        const source = resolvePath(this.cwd, sourcePath);
        const destination = resolvePath(this.cwd, destinationPath);
        const aborted = abortResult(context.abortSignal, destination);
        if (aborted)
            return aborted;
        try {
            await rename(source, destination);
            return ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, source));
        }
    }
    async fileInfo(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(context.abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            return fileInfoFromStats(resolved, await lstat(resolved));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async listDir(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const signal = context.abortSignal;
        const aborted = abortResult(signal, resolved);
        if (aborted)
            return aborted;
        try {
            const entries = await readdir(resolved, { withFileTypes: true });
            const infos = [];
            for (const entry of entries) {
                const loopAbort = abortResult(signal, resolved);
                if (loopAbort)
                    return loopAbort;
                const entryPath = resolve(resolved, entry.name);
                try {
                    const info = fileInfoFromStats(entryPath, await lstat(entryPath));
                    if (info.ok)
                        infos.push(info.value);
                }
                catch (error) {
                    // Removed between enumeration and lstat: not part of the listing any more.
                    if (isNodeError(error) && error.code === "ENOENT")
                        continue;
                    return err(toFileError(error, entryPath));
                }
            }
            return ok(infos);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async openDirReader(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(context.abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            const dir = await opendir(resolved);
            const afterOpenAbort = abortResult(context.abortSignal, resolved);
            if (afterOpenAbort) {
                await dir.close().catch(() => undefined);
                return afterOpenAbort;
            }
            return ok(new NodeDirReader(dir, resolved));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async canonicalPath(path, context) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(context.abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            return ok(await realpath(resolved));
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async exists(path, context) {
        const result = await this.fileInfo(path, context);
        if (result.ok)
            return ok(true);
        if (result.error.code === "not_found")
            return ok(false);
        return err(result.error);
    }
    async createDir(path, options, context) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(context.abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            await mkdir(resolved, { recursive: options?.recursive ?? true });
            return ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async remove(path, options, context) {
        const resolved = resolvePath(this.cwd, path);
        const aborted = abortResult(context.abortSignal, resolved);
        if (aborted)
            return aborted;
        try {
            await rm(resolved, { recursive: options?.recursive ?? false, force: options?.force ?? false });
            return ok(undefined);
        }
        catch (error) {
            return err(toFileError(error, resolved));
        }
    }
    async createTempDir(prefix, context) {
        const aborted = abortResult(context.abortSignal);
        if (aborted)
            return aborted;
        try {
            prefix ??= "tmp-";
            return ok(await mkdtemp(join(tmpdir(), prefix)));
        }
        catch (error) {
            return err(toFileError(error));
        }
    }
    async createTempFile(options, context) {
        const dir = await this.createTempDir("tmp-", context);
        if (!dir.ok)
            return dir;
        const filePath = join(dir.value, `${options?.prefix ?? ""}${randomUUID()}${options?.suffix ?? ""}`);
        try {
            await writeFile(filePath, "");
            return ok(filePath);
        }
        catch (error) {
            return err(toFileError(error, filePath));
        }
    }
    async cleanup(_context) {
        for (const pid of this.activeChildPids)
            killProcessTree(pid);
        this.activeChildPids.clear();
    }
}
//# sourceMappingURL=node.js.map