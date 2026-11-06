/**
 * nvim-editor — run pi's prompt inside an embedded Neovim.
 *
 * The prompt area becomes a live Neovim instance, driven over `nvim --embed`
 * msgpack-rpc with the `ext_linegrid` UI protocol. Keys go to Neovim, the grid
 * comes back as styled terminal lines, and the buffer is a markdown draft:
 *
 *   Enter in normal mode  submit the prompt, then clear the buffer
 *   i / a / o …           normal Vim insertion, Enter there is a newline
 *   ctrl+c in normal mode interrupt / clear the prompt (pi's action)
 *
 * `/nvim-editor` toggles it off and restores the previous editor. If Neovim is
 * missing or exits, the default editor comes back with a notice.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, type EditorTheme, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";

const DEBUG_LOG = "/tmp/nvim-editor.log";
function debug(message: string): void {
  if (!process.env.PI_NVIM_EDITOR_DEBUG) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("node:fs").appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // logging is never fatal
  }
}

// ---------------------------------------------------------------------------
// msgpack (encode + incremental decode) — the nvim rpc wire format
// ---------------------------------------------------------------------------

function encode(value: unknown): Buffer {
  const parts: Buffer[] = [];
  const write = (x: unknown): void => {
    if (x === null || x === undefined) parts.push(Buffer.from([0xc0]));
    else if (x === true) parts.push(Buffer.from([0xc3]));
    else if (x === false) parts.push(Buffer.from([0xc2]));
    else if (typeof x === "number") {
      if (Number.isInteger(x)) {
        if (x >= 0 && x < 128) parts.push(Buffer.from([x]));
        else if (x < 0 && x >= -32) parts.push(Buffer.from([0x100 + x]));
        else if (x >= 0 && x < 256) parts.push(Buffer.from([0xcc, x]));
        else if (x >= 0 && x < 65536) {
          const b = Buffer.alloc(3);
          b[0] = 0xcd;
          b.writeUInt16BE(x, 1);
          parts.push(b);
        } else if (x >= 0 && x < 4294967296) {
          const b = Buffer.alloc(5);
          b[0] = 0xce;
          b.writeUInt32BE(x, 1);
          parts.push(b);
        } else {
          const b = Buffer.alloc(9);
          b[0] = 0xd3;
          b.writeBigInt64BE(BigInt(x), 1);
          parts.push(b);
        }
      } else {
        const b = Buffer.alloc(9);
        b[0] = 0xcb;
        b.writeDoubleBE(x, 1);
        parts.push(b);
      }
    } else if (typeof x === "string") {
      const s = Buffer.from(x, "utf8");
      if (s.length < 32) parts.push(Buffer.from([0xa0 | s.length]));
      else if (s.length < 256) parts.push(Buffer.from([0xd9, s.length]));
      else {
        const b = Buffer.alloc(3);
        b[0] = 0xda;
        b.writeUInt16BE(s.length, 1);
        parts.push(b);
      }
      parts.push(s);
    } else if (Array.isArray(x)) {
      if (x.length < 16) parts.push(Buffer.from([0x90 | x.length]));
      else {
        const b = Buffer.alloc(3);
        b[0] = 0xdc;
        b.writeUInt16BE(x.length, 1);
        parts.push(b);
      }
      for (const item of x) write(item);
    } else if (typeof x === "object") {
      const keys = Object.keys(x as Record<string, unknown>);
      if (keys.length < 16) parts.push(Buffer.from([0x80 | keys.length]));
      else {
        const b = Buffer.alloc(3);
        b[0] = 0xde;
        b.writeUInt16BE(keys.length, 1);
        parts.push(b);
      }
      for (const key of keys) {
        write(key);
        write((x as Record<string, unknown>)[key]);
      }
    } else throw new Error(`cannot msgpack-encode ${typeof x}`);
  };
  write(value);
  return Buffer.concat(parts);
}

type MsgpackValue = null | boolean | number | string | Buffer | MsgpackValue[] | { [key: string]: MsgpackValue };

class Decoder {
  private buf = Buffer.alloc(0);

  push(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
  }

  /** Next complete value, or undefined when the frame is not complete yet. */
  next(): MsgpackValue | undefined {
    const parsed = this.parseAt(0);
    if (!parsed) return undefined;
    this.buf = this.buf.subarray(parsed.next);
    return parsed.value;
  }

  private parseAt(pos: number): { value: MsgpackValue; next: number } | null {
    if (pos >= this.buf.length) return null;
    const b = this.buf[pos];
    const fixed = (value: MsgpackValue, next: number) => ({ value, next });
    const u16 = (o: number) => this.buf.readUInt16BE(o);
    const u32 = (o: number) => this.buf.readUInt32BE(o);

    if (b <= 0x7f) return fixed(b, pos + 1);
    if (b >= 0xe0) return fixed(b - 256, pos + 1);
    if (b >= 0x80 && b <= 0x8f) return this.mapBody(b & 0x0f, pos + 1);
    if (b >= 0x90 && b <= 0x9f) return this.arrBody(b & 0x0f, pos + 1);
    if (b >= 0xa0 && b <= 0xbf) return this.strBody(b & 0x1f, pos + 1);
    if (b === 0xc0) return fixed(null, pos + 1);
    if (b === 0xc2) return fixed(false, pos + 1);
    if (b === 0xc3) return fixed(true, pos + 1);
    if (b === 0xca) return pos + 5 <= this.buf.length ? fixed(this.buf.readFloatBE(pos + 1), pos + 5) : null;
    if (b === 0xcb) return pos + 9 <= this.buf.length ? fixed(this.buf.readDoubleBE(pos + 1), pos + 9) : null;
    if (b === 0xcc) return pos + 2 <= this.buf.length ? fixed(this.buf[pos + 1], pos + 2) : null;
    if (b === 0xcd) return pos + 3 <= this.buf.length ? fixed(u16(pos + 1), pos + 3) : null;
    if (b === 0xce) return pos + 5 <= this.buf.length ? fixed(u32(pos + 1), pos + 5) : null;
    if (b === 0xd0) return pos + 2 <= this.buf.length ? fixed(this.buf.readInt8(pos + 1), pos + 2) : null;
    if (b === 0xd1) return pos + 3 <= this.buf.length ? fixed(this.buf.readInt16BE(pos + 1), pos + 3) : null;
    if (b === 0xd2) return pos + 5 <= this.buf.length ? fixed(this.buf.readInt32BE(pos + 1), pos + 5) : null;
    if (b === 0xd3) return pos + 9 <= this.buf.length ? fixed(Number(this.buf.readBigInt64BE(pos + 1)), pos + 9) : null;
    if (b === 0xd9) return pos + 2 <= this.buf.length ? this.strBody(this.buf[pos + 1], pos + 2) : null;
    if (b === 0xda) return pos + 3 <= this.buf.length ? this.strBody(u16(pos + 1), pos + 3) : null;
    if (b === 0xdb) return pos + 5 <= this.buf.length ? this.strBody(u32(pos + 1), pos + 5) : null;
    if (b === 0xdc) return pos + 3 <= this.buf.length ? this.arrBody(u16(pos + 1), pos + 3) : null;
    if (b === 0xdd) return pos + 5 <= this.buf.length ? this.arrBody(u32(pos + 1), pos + 5) : null;
    if (b === 0xde) return pos + 3 <= this.buf.length ? this.mapBody(u16(pos + 1), pos + 3) : null;
    if (b === 0xdf) return pos + 5 <= this.buf.length ? this.mapBody(u32(pos + 1), pos + 5) : null;
    if (b === 0xc7) return pos + 2 <= this.buf.length ? this.extBody(this.buf[pos + 1], pos + 2) : null;
    if (b === 0xc8) return pos + 3 <= this.buf.length ? this.extBody(u16(pos + 1), pos + 3) : null;
    if (b === 0xc9) return pos + 5 <= this.buf.length ? this.extBody(u32(pos + 1), pos + 5) : null;
    if (b >= 0xd4 && b <= 0xd8) {
      const len = 1 << (b - 0xd4);
      return pos + 2 + len <= this.buf.length ? this.extBody(len, pos + 1) : null;
    }
    throw new Error(`msgpack: unsupported tag 0x${b.toString(16)}`);
  }

  private strBody(len: number, hdr: number) {
    const end = hdr + len;
    if (end > this.buf.length) return null;
    return { value: this.buf.subarray(hdr, end).toString("utf8") as MsgpackValue, next: end };
  }

  private extBody(len: number, hdr: number) {
    const end = hdr + 1 + len;
    if (end > this.buf.length) return null;
    // nvim sends Buffer/Window/Tabpage handles as ext types 0/1/2.
    const value = this.buf[hdr] <= 2 && len === 4 ? this.buf.readUInt32BE(hdr + 1) : null;
    return { value, next: end };
  }

  private arrBody(len: number, pos: number): { value: MsgpackValue; next: number } | null {
    const out: MsgpackValue[] = [];
    let p = pos;
    for (let i = 0; i < len; i++) {
      const item = this.parseAt(p);
      if (!item) return null;
      out.push(item.value);
      p = item.next;
    }
    return { value: out, next: p };
  }

  private mapBody(len: number, pos: number): { value: MsgpackValue; next: number } | null {
    const out: { [key: string]: MsgpackValue } = {};
    let p = pos;
    for (let i = 0; i < len; i++) {
      const key = this.parseAt(p);
      if (!key) return null;
      const value = this.parseAt(key.next);
      if (!value) return null;
      out[String(key.value)] = value.value;
      p = value.next;
    }
    return { value: out, next: p };
  }
}

// ---------------------------------------------------------------------------
// keys: terminal bytes -> nvim key notation
// ---------------------------------------------------------------------------

const CSI_KEYS: Record<string, string> = {
  "\x1b[A": "<Up>",
  "\x1b[B": "<Down>",
  "\x1b[C": "<Right>",
  "\x1b[D": "<Left>",
  "\x1bOA": "<Up>",
  "\x1bOB": "<Down>",
  "\x1bOC": "<Right>",
  "\x1bOD": "<Left>",
  "\x1bOH": "<Home>",
  "\x1bOF": "<End>",
  "\x1b[H": "<Home>",
  "\x1b[F": "<End>",
  "\x1b[1~": "<Home>",
  "\x1b[4~": "<End>",
  "\x1b[7~": "<Home>",
  "\x1b[8~": "<End>",
  "\x1b[2~": "<Insert>",
  "\x1b[3~": "<Del>",
  "\x1b[5~": "<PageUp>",
  "\x1b[6~": "<PageDown>",
  "\x1b[Z": "<S-Tab>",
  "\x1bOP": "<F1>",
  "\x1bOQ": "<F2>",
  "\x1bOR": "<F3>",
  "\x1bOS": "<F4>",
  "\x1b[15~": "<F5>",
  "\x1b[17~": "<F6>",
  "\x1b[18~": "<F7>",
  "\x1b[19~": "<F8>",
  "\x1b[20~": "<F9>",
  "\x1b[21~": "<F10>",
  "\x1b[23~": "<F11>",
  "\x1b[24~": "<F12>",
  "\x1b[1;2A": "<S-Up>",
  "\x1b[1;2B": "<S-Down>",
  "\x1b[1;2C": "<S-Right>",
  "\x1b[1;2D": "<S-Left>",
  "\x1b[1;5A": "<C-Up>",
  "\x1b[1;5B": "<C-Down>",
  "\x1b[1;5C": "<C-Right>",
  "\x1b[1;5D": "<C-Left>",
  "\x1b[1;3C": "<A-Right>",
  "\x1b[1;3D": "<A-Left>",
  "\x1b[13;2u": "<CR>",
  "\x1b\r": "<CR>",
};

/** Translate one chunk of terminal bytes into nvim_input() notation. */
export function toNvimKeys(data: string): string {
  let out = "";
  let i = 0;
  while (i < data.length) {
    const rest = data.slice(i);
    const csi = Object.keys(CSI_KEYS).find((seq) => rest.startsWith(seq));
    if (csi) {
      out += CSI_KEYS[csi];
      i += csi.length;
      continue;
    }
    const ch = data[i];
    const code = ch.codePointAt(0) ?? 0;
    // Alt+letter arrives as ESC followed by a printable character.
    if (code === 0x1b && i + 1 < data.length && data[i + 1] !== "[") {
      out += `<A-${data[i + 1]}>`;
      i += 2;
      continue;
    }
    if (code === 0x1b) {
      out += "<Esc>";
      i += 1;
    } else if (code === 0x0d) {
      out += "<CR>";
      i += 1;
    } else if (code === 0x09) {
      out += "<Tab>";
      i += 1;
    } else if (code === 0x7f) {
      out += "<BS>";
      i += 1;
    } else if (code === 0x0a) {
      out += "<NL>";
      i += 1;
    } else if (code < 0x20) {
      // ctrl+letter and other C0 keys.
      const name = code === 0 ? "@" : String.fromCharCode(code + 96);
      out += `<C-${name}>`;
      i += 1;
    } else {
      out += ch;
      i += ch.length > 1 ? ch.length : 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// session: one embedded nvim, one screen grid
// ---------------------------------------------------------------------------

interface Cell {
  text: string;
  hl: number;
}

export interface NvimSessionOptions {
  command: string;
  cols: number;
  rows: number;
  onRender: () => void;
  onSync: () => void;
  onSubmit: () => void;
  onExit: (reason: string) => void;
}

export class NvimSession {
  private child: ChildProcess;
  private decoder = new Decoder();
  private pending = new Map<number, { resolve: (v: MsgpackValue) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private cells: Cell[][] = [];
  private attrs = new Map<number, Record<string, number>>();
  private sgr = new Map<number, string>();
  private cursor = { row: 0, col: 0 };
  private commandsSent = false;
  readonly ready: Promise<void>;
  mode = "normal";
  text = "";
  width: number;
  height: number;

  constructor(private options: NvimSessionOptions) {
    this.width = options.cols;
    this.height = options.rows;
    const [cmd, ...args] = options.command.split(" ").filter(Boolean);
    this.child = spawn(cmd ?? "nvim", [...args, "--embed", "-n"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.on("error", (error: Error) => options.onExit(`cannot start ${options.command}: ${error.message}`));
    this.child.on("exit", (code) => options.onExit(`nvim exited (${code ?? "signal"})`));
    this.child.stderr.on("data", () => {});
    this.child.stdout.on("data", (chunk: Buffer) => this.read(chunk));
    this.ready = this.start();
  }

  private async start(): Promise<void> {
    await this.request("nvim_ui_attach", [this.width, this.height, { ext_linegrid: true, rgb: true }]);
    await this.request("nvim_command", ["enew"]).catch(() => {});
    // No chrome: prompt text only. Re-applied on every enter because colourscheme,
    // lualine and breadcrumb plugins set statusline and winbar back on BufEnter.
    await this.request("nvim_exec_lua", [
      `local function strip()
         vim.opt.laststatus = 0
         vim.opt.showtabline = 0
         vim.opt.cmdheight = 0
         vim.opt.ruler = false
         vim.opt.showmode = false
         vim.opt.shortmess:append("F")
         vim.wo.winbar = ""
         vim.wo.number = false
         vim.wo.relativenumber = false
         vim.wo.signcolumn = "no"
         vim.wo.foldcolumn = "0"
         vim.wo.list = false
       end
       pcall(function() vim.bo.filetype = "markdown" end)
       pcall(function() vim.bo.buftype = "nofile" end)
       pcall(function() vim.bo.bufhidden = "wipe" end)
       strip()
       vim.api.nvim_create_autocmd({ "BufEnter", "BufWinEnter", "WinEnter", "UIEnter" }, { callback = strip })
       vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI", "InsertLeave", "ModeChanged" }, {
         callback = function() pcall(vim.rpcnotify, 0, "pi-sync") end,
       })
       -- Neovim decides when Enter submits, so an insert-mode Enter is always a
       -- newline even when pi's cached mode is a keystroke behind.
       vim.keymap.set("n", "<CR>", function() pcall(vim.rpcnotify, 0, "pi-submit") end, { buffer = 0, silent = true })
       vim.keymap.set({ "i", "n" }, "<C-s>", function() pcall(vim.rpcnotify, 0, "pi-submit") end, { buffer = 0, silent = true })`,
      [],
    ]).catch((error: Error) => this.options.onExit(`nvim setup failed: ${error.message}`));
    this.commandsSent = true;
    if (process.env.PI_NVIM_EDITOR_DEBUG) {
      const map = await this.request("nvim_eval", ["maparg('<CR>', 'n')"]).catch(() => "ERR");
      debug(`ready maparg_CR_n=${JSON.stringify(map)}`);
    }
    this.options.onRender();
  }

  private read(chunk: Buffer): void {
    this.decoder.push(chunk);
    for (;;) {
      const message = this.decoder.next();
      if (message === undefined) return;
      if (!Array.isArray(message)) continue;
      const [kind, id, error, result] = message as [number, number, MsgpackValue, MsgpackValue, MsgpackValue];
      if (kind === 1) {
        const entry = this.pending.get(id);
        this.pending.delete(id);
        if (!entry) continue;
        if (error) entry.reject(new Error(JSON.stringify(error)));
        else entry.resolve((message[3] as MsgpackValue) ?? null);
      } else if (kind === 2) {
        if (message[1] === "redraw") this.applyRedraw(message[2] as MsgpackValue[][]);
        else if (message[1] === "pi-sync") this.options.onSync();
        else if (message[1] === "pi-submit") {
          debug("notification pi-submit");
          this.options.onSubmit();
        } else debug(`notification ${String(message[1])}`);
      }
    }
  }

  private applyRedraw(events: MsgpackValue[][]): void {
    for (const event of events) {
      const name = String(event[0]);
      const batch = event.length > 1 ? event.slice(1) : [[]];
      for (const args of batch) this.applyEvent(name, args as MsgpackValue[]);
    }
    this.options.onRender();
  }

  private applyEvent(name: string, args: MsgpackValue[]): void {
    if (name === "grid_resize") this.resetGrid(Number(args[1]), Number(args[2]));
    else if (name === "grid_clear") this.resetGrid(this.width, this.height);
    else if (name === "grid_line") {
      const row = Number(args[1]);
      let col = Number(args[2]);
      let hl = 0;
      for (const cell of args[3] as MsgpackValue[][]) {
        const text = String(cell[0] ?? "");
        if (cell.length > 1) hl = Number(cell[1]);
        const repeat = cell.length > 2 ? Number(cell[2]) : 1;
        for (let n = 0; n < repeat; n++) {
          if (this.cells[row] && col < this.width) this.cells[row][col] = { text, hl };
          col++;
        }
      }
    } else if (name === "grid_scroll") {
      const [, top, bottom, , , rows] = args.map(Number);
      const blank = () => Array.from({ length: this.width }, () => ({ text: " ", hl: 0 }) as Cell);
      if (rows > 0) {
        for (let r = top; r < bottom - rows; r++) this.cells[r] = this.cells[r + rows];
        for (let r = bottom - rows; r < bottom; r++) this.cells[r] = blank();
      } else if (rows < 0) {
        for (let r = bottom - 1; r >= top - rows; r--) this.cells[r] = this.cells[r + rows];
        for (let r = top; r < top - rows; r++) this.cells[r] = blank();
      }
    } else if (name === "grid_cursor_goto") {
      this.cursor = { row: Number(args[1]), col: Number(args[2]) };
    } else if (name === "hl_attr_define") {
      const id = Number(args[0]);
      this.attrs.set(id, (args[1] ?? {}) as Record<string, number>);
      this.sgr.delete(id);
    } else if (name === "mode_change") {
      this.mode = String(args[0] ?? "normal");
    }
  }

  private resetGrid(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.cells = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => ({ text: " ", hl: 0 }) as Cell),
    );
  }

  private styleOf(hl: number): string {
    const cached = this.sgr.get(hl);
    if (cached !== undefined) return cached;
    const attr = this.attrs.get(hl);
    const codes: string[] = [];
    if (attr) {
      if (attr.reverse) codes.push("7");
      if (attr.bold) codes.push("1");
      if (attr.italic) codes.push("3");
      if (attr.underline || attr.undercurl || attr.underdouble) codes.push("4");
      if (attr.strikethrough) codes.push("9");
      // Default fg/bg are left alone so the prompt keeps pi's background.
      if (hl !== 0 && attr.foreground != null) {
        const fg = attr.foreground;
        codes.push(`38;2;${(fg >> 16) & 255};${(fg >> 8) & 255};${fg & 255}`);
      }
      if (hl !== 0 && attr.background != null) {
        const bg = attr.background;
        codes.push(`48;2;${(bg >> 16) & 255};${(bg >> 8) & 255};${bg & 255}`);
      }
    }
    const sgr = codes.length ? `\x1b[${codes.join(";")}m` : "";
    this.sgr.set(hl, sgr);
    return sgr;
  }

  /** Grid rows as styled lines, exactly `this.width` cells wide. */
  renderLines(): string[] {
    return this.cells.map((row, rowIndex) => {
      let out = "";
      let current = -1;
      let used = 0;
      for (let col = 0; col < row.length; col++) {
        const cell = row[col];
        const atCursor = rowIndex === this.cursor.row && col === this.cursor.col;
        if (atCursor) out += CURSOR_MARKER;
        if (cell.hl !== current) {
          out += "\x1b[0m" + this.styleOf(cell.hl);
          current = cell.hl;
        }
        if (cell.text === "") continue; // continuation cell of a wide character
        out += cell.text;
        used += visibleWidth(cell.text);
      }
      if (this.cursor.row === rowIndex && this.cursor.col >= row.length) out += CURSOR_MARKER;
      const tail = row[row.length - 1]?.hl ?? 0;
      if (used < this.width) out += this.styleOf(tail) + " ".repeat(this.width - used);
      return out + "\x1b[0m";
    });
  }

  request(method: string, params: MsgpackValue[]): Promise<MsgpackValue> {
    const id = this.nextId++;
    this.child.stdin.write(encode([0, id, method, params]));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  input(keys: string): void {
    void this.request("nvim_input", [keys]).catch(() => {});
  }

  paste(text: string): void {
    void this.request("nvim_paste", [text, true, -1]).catch(() => {});
  }

  async getLines(): Promise<string[]> {
    const result = await this.request("nvim_buf_get_lines", [0, 0, -1, false]);
    return Array.isArray(result) ? result.map((line) => String(line)) : [];
  }

  async setText(text: string): Promise<void> {
    const lines = text.split("\n");
    await this.request("nvim_buf_set_lines", [0, 0, -1, false, lines]).catch(() => {});
    await this.request("nvim_win_set_cursor", [0, [lines.length, Math.max(1, lines[lines.length - 1].length + 1)]]).catch(() => {});
  }

  /** Display rows the draft needs, wrapping included. */
  async displayHeight(): Promise<number> {
    const result = (await this.request("nvim_exec_lua", [
      "local ok, h = pcall(vim.api.nvim_win_text_height, 0, {}) return ok and h.all or vim.fn.line('$')",
      [],
    ]).catch(() => null)) as number | null;
    return Math.max(1, Math.round(Number(result ?? 1)));
  }

  resize(cols: number, rows: number): void {
    if (cols === this.width && rows === this.height) return;
    void this.request("nvim_ui_try_resize", [cols, rows]).catch(() => {});
  }

  async gotoInsert(): Promise<void> {
    await this.request("nvim_command", ["startinsert"]).catch(() => {});
  }

  kill(): void {
    this.child.kill();
  }
}

// ---------------------------------------------------------------------------
// editor component
// ---------------------------------------------------------------------------

export interface NvimEditorHost {
  tui: TUI;
  theme: EditorTheme;
  keybindings: KeybindingsManager;
  command: string;
  onFatal: (reason: string) => void;
}

export class NvimEditor extends CustomEditor {
  private session: NvimSession;
  private cachedText = "";
  private attached = false;
  private lastWidth = 0;
  private lastHeight = 0;
  private pendingRender = false;
  private disposed = false;

  constructor(private host: NvimEditorHost) {
    super(host.tui, host.theme, host.keybindings);
    this.session = this.createSession(2);
  }

  private createSession(rows: number): NvimSession {
    const session = new NvimSession({
      command: this.host.command,
      cols: 80,
      rows,
      onRender: () => this.scheduleRender(),
      onSync: () => void this.syncFromNvim(),
      onSubmit: () => void this.submit(),
      onExit: (reason) => {
        if (this.disposed) return;
        this.host.onFatal(reason);
      },
    });
    session.ready
      .then(async () => {
        this.attached = true;
        if (this.cachedText) await session.setText(this.cachedText);
        this.scheduleRender();
      })
      .catch((error: Error) => this.host.onFatal(`nvim ui attach failed: ${error.message}`));
    return session;
  }

  private scheduleRender(): void {
    if (this.pendingRender || this.disposed) return;
    this.pendingRender = true;
    // Coalesce the burst of redraw notifications inside one frame.
    setTimeout(() => {
      this.pendingRender = false;
      this.invalidate();
      this.host.tui.requestRender();
    }, 2);
  }

  private async syncFromNvim(): Promise<void> {
    if (!this.attached) return;
    try {
      const lines = await this.session.getLines();
      const text = lines.join("\n").replace(/\n+$/, "");
      if (text !== this.cachedText) {
        this.cachedText = text;
        this.onChange?.();
      }
      const height = Math.min(14, Math.max(1, await this.session.displayHeight()));
      if (height !== this.lastHeight) {
        this.lastHeight = height;
        this.session.resize(this.lastWidth || 80, height);
        this.scheduleRender();
      }
    } catch {
      // nvim is going away; the exit handler reports it.
    }
  }

  override render(width: number): string[] {
    this.lastWidth = width;
    if (!this.attached) return [""];
    // The grid can trail one resize behind, so fit every line to the width here.
    this.session.resize(width, this.lastHeight || this.session.height);
    return this.session
      .renderLines()
      .slice(0, Math.max(1, this.lastHeight || this.session.height))
      .map((line) => {
      const fitted = truncateToWidth(line, width, "");
      const missing = width - visibleWidth(fitted);
      return missing > 0 ? fitted + " ".repeat(missing) : fitted;
    });
  }

  override handleInput(data: string): void {
    // Bracketed paste: hand the payload to nvim_paste so marks and undo work.
    const paste = data.match(/^\x1b\[200~([\s\S]*)\x1b\[201~$/);
    if (paste) {
      this.session.paste(paste[1]);
      return;
    }
    const mode = this.session.mode;
    // ctrl+c in normal mode is pi's interrupt/clear, not vim's escape.
    if (mode.startsWith("normal") && data === "\x03") {
      super.handleInput(data);
      return;
    }
    this.session.input(toNvimKeys(data));
  }

  private async submit(): Promise<void> {
    try {
      const lines = await this.session.getLines();
      const text = lines.join("\n").replace(/\n+$/, "");
      if (process.env.PI_NVIM_EDITOR_DEBUG) {
        debug(`submit text=${JSON.stringify(text)} onSubmit=${typeof this.onSubmit} fn=${this.onSubmit?.toString().slice(0, 90)}`);
      }
      this.cachedText = "";
      await this.session.setText("");
      await this.session.gotoInsert();
      if (text.trim() === "") return;
      this.onChange?.();
      this.onSubmit?.(text);
    } catch {
      // ignore: nvim reports its own exit
    }
  }

  override getText(): string {
    return this.cachedText;
  }

  override setText(text: string): void {
    if (text === this.cachedText) return;
    this.cachedText = text;
    if (!this.attached) return;
    void this.session.setText(text).catch(() => {});
  }

  override getExpandedText(): string {
    return this.cachedText;
  }

  override insertTextAtCursor(text: string): void {
    this.session.paste(text);
  }

  override getCursor(): { line: number; col: number } {
    return { line: this.session.cursor.row, col: this.session.cursor.col };
  }

  override dispose(): void {
    this.disposed = true;
    this.session.kill();
  }
}

// ---------------------------------------------------------------------------
// extension wiring
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  let current: NvimEditor | undefined;
  let previous: ReturnType<NonNullable<Parameters<ExtensionAPI["on"]>[1]>> | undefined;
  let myFactory: unknown;

  pi.registerCommand("nvim-editor", {
    description: "Toggle the embedded Neovim prompt",
    handler: async (_args, ctx) => {
      if (current) {
        current = undefined;
        ctx.ui.setEditorComponent(previous as never);
        ctx.ui.notify("nvim editor off", "info");
        return;
      }
      enable(ctx);
    },
  });

  function enable(ctx: { ui: { setEditorComponent: (f: unknown) => void; notify: (m: string, l: string) => void } }) {
    const factory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
      const editor = new NvimEditor({
        tui,
        theme,
        keybindings,
        command: process.env.PI_NVIM_EDITOR_COMMAND || "nvim",
        onFatal: (reason) => {
          if (current !== editor) return;
          current = undefined;
          ctx.ui.setEditorComponent(previous as never);
          ctx.ui.notify(`nvim editor off: ${reason}`, "error");
        },
      });
      current = editor;
      return editor;
    };
    myFactory = factory;
    ctx.ui.setEditorComponent(factory);
  }

  /** Other extensions also replace the editor on session_start; claim it last. */
  function claim(ctx: Parameters<typeof enable>[0] & { ui: { getEditorComponent: () => unknown } }) {
    if (current && ctx.ui.getEditorComponent() === myFactory) return;
    if (current) return; // a live nvim editor was replaced by someone else; do not fight it
    enable(ctx);
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    previous = ctx.ui.getEditorComponent() as never;
    // Let every other session_start handler install its editor first.
    setTimeout(() => claim(ctx), 0);
    setTimeout(() => claim(ctx), 500);
  });

  pi.on("session_shutdown", () => {
    current?.dispose();
    current = undefined;
  });
}
