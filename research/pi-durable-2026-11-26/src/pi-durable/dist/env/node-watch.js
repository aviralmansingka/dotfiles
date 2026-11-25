import { createHash } from "node:crypto";
import { watch as fsWatch } from "node:fs";
import { lstat, readdir, readFile, stat, statfs } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import { FileError } from "./index.js";
const DEBOUNCE_MS = 50;
/**
 * On macOS, `fs.watch` returns before libuv's FSEvents stream is live, and changes in between are never reported
 * (about 2% of changes made right after the call, none after 100 ms). A rescan this long after installing watchers
 * catches them.
 */
const FSEVENTS_SETTLE_MS = 500;
const DEFAULT_POLL_MS = 2000;
const DEFAULT_MAX_DIRECTORIES = 10_000;
/** The one `overflow` change; it carries nothing else. */
const OVERFLOW = { kind: "overflow" };
/** In polling mode, recently modified small files are also compared by content: a second write within the file system's
 * timestamp granularity can keep size and modification time. */
const HASH_MAX_BYTES = 256 * 1024;
const HASH_RECENT_MS = 5000;
/** Linux `statfs` magic numbers of file systems that accept watches but do not report changes made elsewhere. */
const UNRELIABLE_FILE_SYSTEMS = new Set([
    0x6969, // NFS
    0x517b, // SMB
    0xff534d42, // CIFS
    0xfe534d42, // SMB2
    0x65735546, // FUSE (sshfs, Android shared storage)
    0x01021997, // 9P (WSL2 Windows drives)
    0x0bd00bd0, // Lustre
    0x47504653, // GPFS
    0x00c36400, // Ceph
    0x5346414f, // OpenAFS
    0x6b414653, // kAFS
    0x5dca2df5, // sdcardfs
]);
class BudgetExceeded extends Error {
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
function isDenied(error) {
    return isNodeError(error) && (error.code === "EACCES" || error.code === "EPERM");
}
function entryOf(stats, hash) {
    const kind = stats.isFile()
        ? "file"
        : stats.isDirectory()
            ? "directory"
            : stats.isSymbolicLink()
                ? "symlink"
                : "other";
    return {
        kind,
        dev: stats.dev,
        ino: stats.ino,
        size: kind === "directory" ? 0 : stats.size,
        mtimeMs: kind === "directory" ? 0 : stats.mtimeMs,
        ...(hash === undefined ? {} : { hash }),
    };
}
function sameEntry(a, b) {
    return (a.kind === b.kind &&
        a.dev === b.dev &&
        a.ino === b.ino &&
        a.size === b.size &&
        a.mtimeMs === b.mtimeMs &&
        a.hash === b.hash);
}
/** Ancestors of `path`, nearest first, up to the root. */
function ancestorsOf(path) {
    const result = [];
    for (let current = dirname(path);; current = dirname(current)) {
        result.push(current);
        if (dirname(current) === current)
            return result;
    }
}
/** Whether `path` is `ancestor` or below it. */
function isWithin(path, ancestor) {
    return path === ancestor || path.startsWith(ancestor.endsWith(sep) ? ancestor : ancestor + sep);
}
function excluded(target, name) {
    return (target.hidden && name.startsWith(".")) || target.names.has(name);
}
/**
 * Watches by snapshots: native events only trigger a debounced rescan, and changes are the difference between
 * snapshots plus the event paths. A replaced file, a renamed or recreated ancestor, or a directory created with its
 * contents therefore never depends on which events an operating system sends. New directories get their watchers
 * before they are scanned again, so nothing written into them before the watcher existed is missed.
 */
export class NodeFileWatcher {
    #targets;
    #onChange;
    #pollIntervalMs;
    #maxDirectories;
    #watchers = new Map();
    #events = new Set();
    #mode;
    #snapshot = new Map();
    #timer;
    #settleTimer;
    #running;
    #dirty = false;
    #stopped = false;
    constructor(targets, onChange, mode, options) {
        this.#targets = targets;
        this.#onChange = onChange;
        this.#mode = mode;
        this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
        this.#maxDirectories = options.maxDirectories ?? DEFAULT_MAX_DIRECTORIES;
    }
    /** Establish coverage: watchers first, then the snapshot later changes are compared with. */
    static async open(targets, resolvePath, onChange, options) {
        const resolved = targets.map((target) => ({
            path: resolvePath(target.path),
            recursive: target.recursive === true,
            hidden: target.exclude?.hidden === true,
            names: new Set(target.exclude?.names ?? []),
        }));
        // Windows refuses to rename a directory while another directory below it is open, and a native watcher keeps
        // every watched directory open: watching would break renames of their parents, so Windows polls.
        const mode = options.mode ??
            (process.platform === "win32" || (await anyUnreliable(resolved.map((target) => target.path)))
                ? "polling"
                : "native");
        const watcher = new NodeFileWatcher(resolved, onChange, mode, options);
        try {
            await watcher.#sync(false);
        }
        catch (error) {
            watcher.#stop();
            if (error instanceof BudgetExceeded)
                throw new FileError("invalid", error.message);
            throw error;
        }
        watcher.#schedulePoll();
        return watcher;
    }
    get mode() {
        return this.#mode;
    }
    async stop(_context) {
        if (this.#stopped)
            return;
        this.#stop();
        await this.#running;
    }
    #stop() {
        this.#stopped = true;
        clearTimeout(this.#timer);
        this.#timer = undefined;
        clearTimeout(this.#settleTimer);
        this.#settleTimer = undefined;
        for (const { watcher } of this.#watchers.values())
            watcher.close();
        this.#watchers.clear();
    }
    #deliver(change) {
        if (this.#stopped)
            return;
        try {
            this.#onChange(change);
        }
        catch {
            // A throwing callback must not stop watching.
        }
    }
    #schedulePoll() {
        if (this.#stopped || this.#mode !== "polling")
            return;
        this.#timer = setTimeout(() => {
            this.#timer = undefined;
            void this.#flush().finally(() => this.#schedulePoll());
        }, this.#pollIntervalMs);
    }
    #scheduleFlush() {
        if (this.#stopped || this.#timer !== undefined)
            return;
        this.#timer = setTimeout(() => {
            this.#timer = undefined;
            void this.#flush();
        }, DEBOUNCE_MS);
    }
    #scheduleSettle() {
        if (this.#stopped)
            return;
        clearTimeout(this.#settleTimer);
        this.#settleTimer = setTimeout(() => {
            this.#settleTimer = undefined;
            void this.#flush();
        }, FSEVENTS_SETTLE_MS);
    }
    #flush() {
        if (this.#running !== undefined) {
            this.#dirty = true;
            return this.#running;
        }
        this.#running = (async () => {
            try {
                do {
                    this.#dirty = false;
                    const events = [...this.#events];
                    this.#events.clear();
                    const changed = await this.#sync(true);
                    for (const path of events)
                        changed.add(path);
                    if (changed.size > 0)
                        this.#deliver({ kind: "paths", paths: [...changed].sort() });
                } while (this.#dirty && !this.#stopped);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const fileError = error instanceof FileError
                    ? error
                    : new FileError(isDenied(error) ? "permission_denied" : "invalid", message);
                this.#deliver({ kind: "failed", error: fileError });
                this.#stop();
            }
            finally {
                this.#running = undefined;
            }
        })();
        return this.#running;
    }
    /** Rescan, report differences, and install watchers for new directories, rescanning until none are new. */
    async #sync(report) {
        const changed = new Set();
        for (let round = 0; round < 10 && !this.#stopped; round++) {
            const scan = await this.#scan();
            // Closed during the scan: installing watchers now would leak them.
            if (this.#stopped)
                break;
            const next = scan.snapshot;
            if (report)
                for (const path of this.#diff(this.#snapshot, next))
                    changed.add(path);
            this.#snapshot = next;
            if (this.#mode === "polling" || !this.#reconcileWatchers(scan))
                break;
            if (process.platform === "darwin")
                this.#scheduleSettle();
            // Something written into a new directory before its watcher existed shows up in the next round.
            report = true;
        }
        return changed;
    }
    #diff(previous, next) {
        const changed = [];
        for (const [path, entry] of next) {
            const before = previous.get(path);
            if (before === undefined || !sameEntry(before, entry))
                changed.push(this.#reported(path));
        }
        for (const path of previous.keys())
            if (!next.has(path))
                changed.push(this.#reported(path));
        return changed;
    }
    /** An ancestor that changed identity moved every target below it; report those targets. */
    #reported(path) {
        if (this.#targets.some((target) => isWithin(path, target.path)))
            return path;
        return this.#targets.find((target) => isWithin(target.path, path))?.path ?? path;
    }
    async #scan() {
        const snapshot = new Map();
        const linkedFiles = new Set();
        // Directories are counted once, but traversed once per target: overlapping targets differ in recursion and
        // exclusions, and an entry recorded for one target must still be descended into for another.
        const counted = new Set();
        const traversed = new Set();
        /** Kinds of listed entries, not following links: a target that links to a directory is recorded by `stat`, but
         * symbolic links below a recursive target are not followed. */
        const listed = new Map();
        const countDirectory = (path) => {
            counted.add(path);
            if (counted.size > this.#maxDirectories) {
                throw new BudgetExceeded(`Watched paths exceed ${this.#maxDirectories} directories`);
            }
        };
        const record = async (path, stats) => {
            let hash;
            if (this.#mode === "polling" &&
                stats.isFile() &&
                stats.size <= HASH_MAX_BYTES &&
                Date.now() - stats.mtimeMs < HASH_RECENT_MS) {
                hash = await readFile(path).then((content) => createHash("sha256").update(content).digest("hex"), () => undefined);
            }
            snapshot.set(path, entryOf(stats, hash));
        };
        const scanDirectory = async (index, target, directory) => {
            const key = `${index}\0${directory}`;
            if (traversed.has(key))
                return;
            traversed.add(key);
            let names;
            try {
                names = await readdir(directory);
            }
            catch (error) {
                // The watched directory itself must be readable; below it, unreadable directories are skipped.
                if (directory === target.path && isDenied(error))
                    throw error;
                if (isNodeError(error) && ["ENOENT", "EACCES", "EPERM", "ENOTDIR"].includes(error.code ?? ""))
                    return;
                throw error;
            }
            for (const name of names) {
                if (excluded(target, name))
                    continue;
                const path = `${directory.endsWith(sep) ? directory : directory + sep}${name}`;
                let kind = listed.get(path);
                if (kind === undefined) {
                    const stats = await lstat(path).catch(() => undefined);
                    if (stats === undefined)
                        continue;
                    kind = entryOf(stats).kind;
                    listed.set(path, kind);
                    // A target's own entry (following links) wins over its listing by another target.
                    if (!snapshot.has(path))
                        await record(path, stats);
                }
                if (target.recursive && kind === "directory") {
                    countDirectory(path);
                    await scanDirectory(index, target, path);
                }
            }
        };
        for (const [index, target] of this.#targets.entries()) {
            for (const ancestor of ancestorsOf(target.path)) {
                if (snapshot.has(ancestor))
                    continue;
                const stats = await lstat(ancestor).catch(() => undefined);
                // Identity only: an ancestor's own timestamps change with every unrelated sibling.
                if (stats !== undefined)
                    snapshot.set(ancestor, { ...entryOf(stats), size: 0, mtimeMs: 0 });
            }
            // The target itself may be a symbolic link to what is watched; follow it. A missing target is watched for its
            // creation; one that cannot be reached for lack of permission fails.
            let stats;
            try {
                stats = await stat(target.path);
            }
            catch (error) {
                if (isDenied(error))
                    throw error;
                continue;
            }
            await record(target.path, stats);
            if (stats.isFile() && (await lstat(target.path).catch(() => undefined))?.isSymbolicLink()) {
                linkedFiles.add(target.path);
            }
            if (stats.isDirectory()) {
                countDirectory(target.path);
                await scanDirectory(index, target, target.path);
            }
        }
        return { snapshot, linkedFiles };
    }
    /**
     * Watch every existing ancestor of each target, each target directory, each target that is a symbolic link to a file
     * (changes to that file are not events of the link's directory), and on Linux each directory below a recursive target
     * (elsewhere one recursive watcher per target). Returns whether a watcher was added.
     */
    #reconcileWatchers({ snapshot, linkedFiles }) {
        const wanted = new Map();
        for (const path of linkedFiles)
            wanted.set(path, false);
        const perDirectory = process.platform === "linux" || process.platform === "android";
        for (const target of this.#targets) {
            for (const ancestor of ancestorsOf(target.path)) {
                if (snapshot.get(ancestor)?.kind === "directory" && !wanted.has(ancestor))
                    wanted.set(ancestor, false);
            }
            if (snapshot.get(target.path)?.kind !== "directory")
                continue;
            const recursiveRoot = target.recursive && !perDirectory;
            wanted.set(target.path, recursiveRoot);
            if (target.recursive && perDirectory) {
                for (const [path, entry] of snapshot) {
                    if (entry.kind === "directory" && path !== target.path && isWithin(path, target.path)) {
                        wanted.set(path, false);
                    }
                }
            }
        }
        for (const [path, installed] of this.#watchers) {
            const entry = snapshot.get(path);
            // Gone, or replaced: a watcher follows the directory it was installed on, not the path.
            if (!wanted.has(path) || entry === undefined || entry.dev !== installed.dev || entry.ino !== installed.ino) {
                installed.watcher.close();
                this.#watchers.delete(path);
            }
        }
        let added = false;
        for (const [path, recursive] of wanted) {
            const entry = snapshot.get(path);
            if (this.#watchers.has(path) || entry === undefined)
                continue;
            const linked = linkedFiles.has(path);
            try {
                const watcher = fsWatch(path, { recursive, persistent: false }, (_event, filename) => linked
                    ? this.#onLinkedFileEvent(path)
                    : this.#onEvent(path, filename === null ? undefined : String(filename)));
                // A watched directory that disappears or fails: rescan, which also replaces the watcher.
                watcher.on("error", () => {
                    watcher.close();
                    if (this.#watchers.get(path)?.watcher === watcher)
                        this.#watchers.delete(path);
                    this.#scheduleFlush();
                });
                this.#watchers.set(path, { watcher, dev: entry.dev, ino: entry.ino });
                added = true;
            }
            catch (error) {
                // Out of watches or unsupported: compare snapshots from now on, and say coverage was uncertain.
                if (isNodeError(error) && error.code !== "ENOENT" && error.code !== "EACCES" && error.code !== "EPERM") {
                    this.#switchToPolling();
                    return false;
                }
            }
        }
        return added;
    }
    #switchToPolling() {
        if (this.#mode === "polling")
            return;
        this.#mode = "polling";
        for (const { watcher } of this.#watchers.values())
            watcher.close();
        this.#watchers.clear();
        this.#deliver(OVERFLOW);
        clearTimeout(this.#timer);
        this.#timer = undefined;
        this.#schedulePoll();
    }
    #onEvent(directory, filename) {
        if (this.#stopped)
            return;
        const path = filename === undefined ? directory : `${directory.endsWith(sep) ? directory : directory + sep}${filename}`;
        // Events about unrelated siblings of an ancestor, or about excluded entries, are ignored.
        const relevant = this.#inScope(path);
        if (relevant)
            this.#events.add(this.#reported(path));
        if (relevant || filename === undefined)
            this.#scheduleFlush();
    }
    /** The file a target links to changed: report the target. */
    #onLinkedFileEvent(target) {
        if (this.#stopped)
            return;
        this.#events.add(target);
        this.#scheduleFlush();
    }
    #inScope(path) {
        for (const target of this.#targets) {
            if (isWithin(target.path, path))
                return true;
            if (!isWithin(path, target.path) || path === target.path)
                continue;
            const components = relative(target.path, path).split(sep);
            if (!target.recursive && components.length > 1)
                continue;
            if (components.some((name) => excluded(target, name)))
                continue;
            return true;
        }
        return false;
    }
}
/** Whether any path, or its nearest existing ancestor, is on a file system that does not report remote changes. */
async function anyUnreliable(paths) {
    if (process.platform !== "linux" && process.platform !== "android")
        return false;
    for (const path of paths) {
        for (const candidate of [path, ...ancestorsOf(path)]) {
            const info = await statfs(candidate).catch(() => undefined);
            if (info === undefined)
                continue;
            if (UNRELIABLE_FILE_SYSTEMS.has(info.type))
                return true;
            break;
        }
    }
    return false;
}
//# sourceMappingURL=node-watch.js.map