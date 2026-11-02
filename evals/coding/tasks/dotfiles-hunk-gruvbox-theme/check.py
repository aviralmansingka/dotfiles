#!/usr/bin/env python3
"""Property check for the hunk gruvbox theme task.

The brief says: create a hunk colorscheme that uses the gruvbox colours of the
Neovim setup. No test exists for a TOML theme, so this check asserts the
properties the brief implies and accepts any gruvbox-consistent palette:

  * the theme lands on the stow path hunk/.config/hunk/config.toml;
  * it parses as TOML and selects one theme table by default;
  * that table carries >= 25 colour roles plus a syntax_scopes table with
    >= 10 entries, all as 6-digit hex;
  * the background is dark (luminance < 0.25) and the text light (> 0.6);
  * at least 12 distinct colours are used, so a stub cannot pass.
"""
import pathlib
import re
import sys
import tomllib

PATH = pathlib.Path("hunk/.config/hunk/config.toml")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def luminance(colour: str) -> float:
    r, g, b = (int(colour[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def fail(msg: str) -> None:
    print(f"CHECK FAIL: {msg}")
    sys.exit(1)


if not PATH.is_file():
    fail(f"{PATH} does not exist")

try:
    data = tomllib.loads(PATH.read_text())
except tomllib.TOMLDecodeError as exc:
    fail(f"{PATH} is not valid TOML: {exc}")

name = data.get("theme")
if not isinstance(name, str) or not name:
    fail("no default 'theme' key")

themes = data.get("themes") or {}
if name not in themes or not isinstance(themes[name], dict):
    fail(f"theme {name!r} is not defined under [themes.{name}]")

theme = themes[name]
roles = {k: v for k, v in theme.items() if isinstance(v, str) and v.startswith("#")}
if len(roles) < 25:
    fail(f"only {len(roles)} colour roles, need at least 25")
for key, value in roles.items():
    if not HEX.match(value):
        fail(f"role {key} is not a 6-digit hex colour: {value!r}")

scopes = theme.get("syntax_scopes") or {}
if len(scopes) < 10:
    fail(f"only {len(scopes)} syntax scopes, need at least 10")
for key, value in scopes.items():
    if not HEX.match(value):
        fail(f"syntax scope {key} is not a 6-digit hex colour: {value!r}")

bg, fg = theme.get("background"), theme.get("text")
if not isinstance(bg, str) or luminance(bg) >= 0.25:
    fail(f"background {bg!r} is not a dark gruvbox background")
if not isinstance(fg, str) or luminance(fg) <= 0.60:
    fail(f"text {fg!r} is not a light foreground")

distinct = {v.lower() for v in roles.values()} | {v.lower() for v in scopes.values()}
if len(distinct) < 12:
    fail(f"only {len(distinct)} distinct colours, need at least 12")

print(f"CHECK PASS: theme {name!r}, {len(roles)} roles, {len(scopes)} scopes, "
      f"{len(distinct)} distinct colours, bg {bg} / fg {fg}")
