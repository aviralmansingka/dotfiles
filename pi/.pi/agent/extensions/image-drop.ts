import {
  formatDimensionNote,
  resizeImage,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rmdir, stat, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const IMAGE_EXTENSION = /\.(?:gif|jpe?g|png|webp)$/i;

type ImageData = {
  data: string;
  mimeType: string;
  hint?: string;
};

type PathToken = {
  start: number;
  end: number;
  path: string;
  title?: string;
  image?: Promise<ImageData | undefined>;
};

function pathTokens(text: string): PathToken[] {
  const tokens: PathToken[] = [];
  let start = -1;
  let value = "";
  let quote: "'" | '"' | undefined;

  const finish = (end: number) => {
    if (start >= 0 && IMAGE_EXTENSION.test(value) && /^(?:\/|\.{1,2}\/|~\/)/.test(value)) {
      tokens.push({ start, end, path: value });
    }
    start = -1;
    value = "";
    quote = undefined;
  };

  for (let index = 0; index <= text.length; index++) {
    const char = text[index];
    if (char === undefined || (!quote && /\s/.test(char))) {
      finish(index);
      continue;
    }
    if (start < 0) start = index;
    if (char === "\\" && quote !== "'") {
      const next = text[++index];
      if (next !== undefined) value += next;
    } else if (char === quote) {
      quote = undefined;
    } else if (!quote && (char === "'" || char === '"')) {
      quote = char;
    } else {
      value += char;
    }
  }

  return tokens;
}

function localPath(filePath: string, cwd: string): string {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/")) return join(homedir(), filePath.slice(2));
  return resolve(cwd, filePath);
}

function imageMimeType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (Buffer.from(bytes.subarray(0, 3)).toString("ascii") === "GIF") return "image/gif";
  if (
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

function sourceUser(filePath: string): string | undefined {
  if (process.env.PI_IMAGE_DROP_SOURCE_USER) return process.env.PI_IMAGE_DROP_SOURCE_USER;
  return filePath.match(/^\/(?:Users|home)\/([^/]+)\//)?.[1] ?? "aviral";
}

async function copyFromSshClient(filePath: string): Promise<string | undefined> {
  const sourceHost = process.env.PI_IMAGE_DROP_SOURCE_HOST ?? process.env.SSH_CONNECTION?.trim().split(/\s+/)[0];
  const user = sourceUser(filePath);
  if (!sourceHost || !user || !filePath.startsWith("/")) return undefined;

  const tempDir = await mkdtemp(join(tmpdir(), "pi-image-drop-"));
  const destination = join(tempDir, basename(filePath));
  const port = process.env.PI_IMAGE_DROP_SOURCE_PORT;
  const args = [
    "-q",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=4",
    "-o",
    "StrictHostKeyChecking=accept-new",
    ...(port ? ["-P", port] : []),
    "--",
    `${user}@${sourceHost}:${filePath}`,
    destination,
  ];

  try {
    await execFileAsync("scp", args, { timeout: 30_000 });
    return destination;
  } catch {
    await unlink(destination).catch(() => undefined);
    await rmdir(tempDir).catch(() => undefined);
    return undefined;
  }
}

async function readImage(filePath: string, cwd: string): Promise<ImageData | undefined> {
  const resolved = localPath(filePath, cwd);
  let readablePath = resolved;

  try {
    await stat(readablePath);
  } catch {
    const copied = await copyFromSshClient(filePath);
    if (!copied) return undefined;
    readablePath = copied;
  }

  try {
    const metadata = await stat(readablePath);
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_IMAGE_BYTES) return undefined;
    const bytes = await readFile(readablePath);
    const mimeType = imageMimeType(bytes);
    if (!mimeType) return undefined;
    const resized = await resizeImage(bytes, mimeType);
    if (!resized) return undefined;
    return {
      data: resized.data,
      mimeType: resized.mimeType,
      hint: formatDimensionNote(resized),
    };
  } finally {
    if (readablePath !== resolved) {
      await unlink(readablePath).catch(() => undefined);
      await rmdir(dirname(readablePath)).catch(() => undefined);
    }
  }
}

function imageLink(title: string, filePath: string, cwd: string, hint?: string): string {
  const linkTitle = hint ? ` "${hint.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ")}"` : "";
  return `[${title}](${pathToFileURL(localPath(filePath, cwd)).href}${linkTitle})`;
}

export default function (pi: ExtensionAPI) {
  const pendingDrops = new Map<string, { path: string; image: Promise<ImageData | undefined> }>();
  let nextImageNumber = 1;
  let pasteBuffer = "";
  let rawPathBuffer = "";
  let rawPathTimer: ReturnType<typeof setTimeout> | undefined;
  let stopListening: (() => void) | undefined;

  const labelImagePaths = (text: string, cwd: string): string | undefined => {
    const tokens = pathTokens(text);
    if (tokens.length === 0) return undefined;

    let replacement = "";
    let cursor = 0;
    for (const token of tokens) {
      const placeholder = `[Image ${nextImageNumber++}]`;
      pendingDrops.set(placeholder, { path: token.path, image: readImage(token.path, cwd) });
      replacement += text.slice(cursor, token.start) + placeholder;
      cursor = token.end;
    }
    return replacement + text.slice(cursor);
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    stopListening?.();
    if (rawPathTimer) clearTimeout(rawPathTimer);
    pasteBuffer = "";
    rawPathBuffer = "";

    const flushRawPath = () => {
      rawPathTimer = undefined;
      const text = rawPathBuffer;
      rawPathBuffer = "";
      if (!text) return;
      ctx.ui.pasteToEditor(labelImagePaths(text, ctx.cwd) ?? text);
    };

    stopListening = ctx.ui.onTerminalInput((data) => {
      if (rawPathBuffer || data === "/") {
        if (/^[^\x00-\x1f\x7f]+$/u.test(data)) {
          rawPathBuffer += data;
          if (rawPathTimer) clearTimeout(rawPathTimer);
          rawPathTimer = setTimeout(flushRawPath, 0);
          return { consume: true };
        }
        if (rawPathTimer) clearTimeout(rawPathTimer);
        flushRawPath();
      }

      const wasBuffered = pasteBuffer.length > 0;
      if (wasBuffered) {
        data = pasteBuffer + data;
        pasteBuffer = "";
      }

      const pasteStart = data.indexOf("\x1b[200~");
      const pasteEnd = data.indexOf("\x1b[201~", pasteStart + 6);
      if (pasteStart < 0) {
        const replacement = labelImagePaths(data, ctx.cwd);
        return replacement === undefined ? (wasBuffered ? { data } : undefined) : { data: replacement };
      }
      if (pasteEnd < 0) {
        pasteBuffer = data;
        return { data: "" };
      }

      const contentStart = pasteStart + 6;
      const content = data.slice(contentStart, pasteEnd);
      const replacement = labelImagePaths(content, ctx.cwd);
      if (replacement === undefined) return wasBuffered ? { data } : undefined;

      return {
        data: data.slice(0, contentStart) + replacement + data.slice(pasteEnd),
      };
    });
  });

  pi.on("input", async (event, ctx) => {
    const tokens = pathTokens(event.text);
    for (const [placeholder, pending] of pendingDrops) {
      let start = event.text.indexOf(placeholder);
      while (start >= 0) {
        tokens.push({
          start,
          end: start + placeholder.length,
          path: pending.path,
          title: placeholder.slice(1, -1),
          image: pending.image,
        });
        start = event.text.indexOf(placeholder, start + placeholder.length);
      }
    }
    pendingDrops.clear();
    nextImageNumber = 1;
    tokens.sort((left, right) => left.start - right.start);
    if (tokens.length === 0) return undefined;

    const images = [...(event.images ?? [])];
    let text = "";
    let cursor = 0;
    let failures = 0;

    for (const token of tokens) {
      const image = await (token.image ?? readImage(token.path, ctx.cwd));
      if (!image) {
        failures++;
        continue;
      }

      text += event.text.slice(cursor, token.start);
      text += imageLink(token.title ?? `Image ${images.length + 1}`, token.path, ctx.cwd, image.hint);
      cursor = token.end;
      images.push({ type: "image", data: image.data, mimeType: image.mimeType });
    }

    if (failures > 0 && process.env.SSH_CONNECTION) {
      ctx.ui.notify(
        "An image path could not be copied from the SSH client. Check Remote Login and key access back to the client, or set PI_IMAGE_DROP_SOURCE_HOST, PI_IMAGE_DROP_SOURCE_USER, and PI_IMAGE_DROP_SOURCE_PORT.",
        "warning",
      );
    }
    if (images.length === (event.images?.length ?? 0)) return undefined;

    return {
      action: "transform",
      text: text + event.text.slice(cursor),
      images,
    };
  });
}
