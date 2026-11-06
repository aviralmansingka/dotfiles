// verify: burst keystrokes, insert-Enter newline, normal-Enter submit, no race
import { NvimEditor } from "./nvim-editor.ts";

const style = (s: string) => s;
const theme = { borderColor: style, selectList: new Proxy({} as any, { get: () => style }) } as any;
const tui = new Proxy({ requestRender: () => {} }, { get: (t: any, k) => (k in t ? t[k] : () => 0) }) as any;
const submitted: string[] = [];
const editor = new NvimEditor({ tui, theme, keybindings: { matches: () => false } as any, command: "nvim", onFatal: (r: string) => console.log("FATAL", r) }) as any;
editor.onSubmit = (text: string) => submitted.push(text);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const peek = async (label: string) =>
  console.log(label, { lines: await editor.session.getLines(), rows: editor.render(40).length, mode: editor.session.mode });

await wait(900);
editor.handleInput("ihello world");
editor.handleInput("\r");
editor.handleInput("second line");
await wait(400);
await peek("typed (no waits between keys)");
editor.handleInput("\x1b");
await wait(200);
editor.handleInput("\r");
await wait(400);
console.log("submitted:", JSON.stringify(submitted));
await peek("after submit");
editor.dispose();
process.exit(0);
