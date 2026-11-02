/**
 * Chrome DevTools Protocol client, no dependencies.
 * Works on macOS and Linux. Chrome is spawned with a dedicated profile.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = Number(process.env.CHROME_CDP_PORT || 9222);
export const DEFAULT_PROFILE = process.env.CHROME_PROFILE || join(homedir(), ".chrome-agent");

export interface Page {
	id: string;
	title: string;
	url: string;
	ws: string;
}

function base(port = DEFAULT_PORT) {
	return `http://127.0.0.1:${port}`;
}

export async function running(port = DEFAULT_PORT): Promise<boolean> {
	try {
		const res = await fetch(`${base(port)}/json/version`, { signal: AbortSignal.timeout(1000) });
		return res.ok;
	} catch {
		return false;
	}
}

export async function pages(port = DEFAULT_PORT): Promise<Page[]> {
	const res = await fetch(`${base(port)}/json/list`, { signal: AbortSignal.timeout(5000) });
	const all = (await res.json()) as Array<Record<string, string>>;
	return all
		.filter((t) => t.type === "page")
		.map((t) => ({ id: t.id, title: t.title, url: t.url, ws: t.webSocketDebuggerUrl }));
}

/** Send one CDP command to the page at `index` and resolve its result. */
export async function send(
	method: string,
	params: Record<string, unknown> = {},
	index = 0,
	port = DEFAULT_PORT,
): Promise<Record<string, any>> {
	const list = await pages(port);
	const page = list[index];
	if (!page) throw new Error(`No page at index ${index}. Open one with chrome_open.`);
	const ws = new WebSocket(page.ws);
	await new Promise<void>((resolve, reject) => {
		ws.onopen = () => resolve();
		ws.onerror = () => reject(new Error("Chrome DevTools socket failed. Run chrome_launch."));
	});
	try {
		const reply = await new Promise<Record<string, any>>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 30000);
			ws.onmessage = (event) => {
				let msg: Record<string, any>;
				try {
					msg = JSON.parse(String(event.data));
				} catch {
					return;
				}
				if (msg.id !== 1) return;
				clearTimeout(timer);
				msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
			};
			ws.send(JSON.stringify({ id: 1, method, params }));
		});
		return reply;
	} finally {
		ws.close();
	}
}

/** Evaluate JS in the page and return the value. */
export async function evaluate(expression: string, index = 0, port = DEFAULT_PORT) {
	const out = await send(
		"Runtime.evaluate",
		{ expression, returnByValue: true, awaitPromise: true, userGesture: true },
		index,
		port,
	);
	if (out.exceptionDetails) {
		const d = out.exceptionDetails;
		throw new Error(d.exception?.description || d.text || "Evaluation failed");
	}
	const r = out.result || {};
	return r.value !== undefined ? r.value : r.description;
}

/** Which Chrome binary exists on this host. */
export function binary(): string | null {
	const candidates =
		process.platform === "darwin"
			? [
					"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
					"/Applications/Chromium.app/Contents/MacOS/Chromium",
					join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
				]
			: [
					"/usr/bin/google-chrome",
					"/usr/bin/google-chrome-stable",
					"/usr/bin/chromium",
					"/usr/bin/chromium-browser",
					"/snap/bin/chromium",
					"/opt/google/chrome/chrome",
				];
	return candidates.find((p) => existsSync(p)) ?? null;
}

export interface LaunchOptions {
	port?: number;
	profile?: string;
	headless?: boolean;
	url?: string;
}

/** Start Chrome on the CDP port. No-op when it already listens. */
export async function launch(o: LaunchOptions = {}) {
	const port = o.port ?? DEFAULT_PORT;
	const profile = o.profile ?? DEFAULT_PROFILE;
	if (await running(port)) {
		return { started: false, port, profile, binary: null as string | null, headless: false };
	}
	const bin = binary();
	if (!bin) {
		throw new Error(
			"Chrome or Chromium not found. Install Google Chrome, then retry. " +
				(macOSHint() || ""),
		);
	}
	mkdirSync(profile, { recursive: true });
	// A Linux box with no display can only run headless.
	const headless = o.headless ?? (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY);
	const args = [
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${profile}`,
		"--no-first-run",
		"--no-default-browser-check",
		...(headless ? ["--headless=new", "--disable-gpu"] : []),
		...(o.url ? [o.url] : []),
	];
	const child = spawn(bin, args, { detached: true, stdio: "ignore" });
	child.unref();
	for (let i = 0; i < 80; i++) {
		if (await running(port)) return { started: true, port, profile, binary: bin, headless };
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`Chrome started but port ${port} never opened. Try headless: true.`);
}

function macOSHint() {
	return process.platform === "darwin" ? "Expected it in /Applications." : "";
}

export function shotPath() {
	return join(tmpdir(), `chrome-${Date.now()}.png`);
}
