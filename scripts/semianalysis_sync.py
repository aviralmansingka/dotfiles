#!/usr/bin/env python3
"""Sync new SemiAnalysis posts into the vault.

Two streams:
  posts     /wp-json/wp/v2/posts     newsletter articles, public portion, no auth
  articles  /wp-json/wp/v2/articles  institutional model notes, needs passport cookie

Writes one markdown file per post into the vault and appends a line to
.semianalysis-sync.log. The vault auto-committer handles git.

Cookie refresh (expires every few weeks):
  Sign in at semianalysis.com with the institutional account, copy the
  passport_session_id value from devtools, then write:
      echo 'passport_session_id=<value>' > ~/.config/pi-semianalysis-cookie
      chmod 600 ~/.config/pi-semianalysis-cookie
  A 401/403 on the articles stream means the cookie went stale.
"""

import argparse
import json
import os
import re
import sys
import time
import html
import urllib.error
import urllib.request
from datetime import datetime
from html.parser import HTMLParser

VAULT = "/home/avirus/vault"
BASE = "https://semianalysis.com/wp-json/wp/v2"
COOKIE_FILE = os.path.expanduser("~/.config/pi-semianalysis-cookie")
LOG = os.path.join(VAULT, ".semianalysis-sync.log")
UA = "Mozilla/5.0 (vault-sync)"
PER_PAGE = 20


class Markdown(HTMLParser):
    """Minimal HTML to markdown: headings, paragraphs, lists, links, images."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip, self.href = [], 0, None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("script", "style", "noscript"):
            self.skip += 1
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.out.append("\n\n" + "#" * int(tag[1]) + " ")
        elif tag == "br":
            self.out.append("\n")
        elif tag in ("p", "div", "section", "tr"):
            # Inside a link keep text inline: a blank line breaks the
            # CommonMark link construct and the preview renders the
            # brackets literally.
            self.out.append(" " if self.href else "\n\n")
        elif tag == "li":
            self.out.append(" " if self.href else "\n- ")
        elif tag == "blockquote":
            self.out.append(" " if self.href else "\n\n> ")
        elif tag in ("strong", "b"):
            self.out.append("**")
        elif tag in ("em", "i"):
            self.out.append("*")
        elif tag == "a" and a.get("href"):
            self.href = a["href"]
            self.out.append("[")
        elif tag == "img" and a.get("src"):
            img_md = f"![{a.get('alt', '')}]({a['src']})"
            self.out.append(img_md if self.href else f"\n\n{img_md}\n\n")
        elif tag in ("td", "th"):
            self.out.append(" | ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.skip = max(0, self.skip - 1)
        elif tag in ("strong", "b"):
            self.out.append("**")
        elif tag in ("em", "i"):
            self.out.append("*")
        elif tag == "a" and self.href:
            self.out.append(f"]({self.href})")
            self.href = None
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "ul", "ol", "table"):
            self.out.append(" " if self.href else "\n\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)

    def result(self):
        text = re.sub(r"[ \t]+", " ", "".join(self.out))
        text = re.sub(r"\[ +", "[", text)
        text = re.sub(r" +\]\(", "](", text)
        return re.sub(r"\n{3,}", "\n\n", text).strip()


def log(msg):
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{stamp} {msg}"
    print(line)
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except OSError:  # e.g. --repair run off the sync host
        pass


def cookie_header():
    if not os.path.exists(COOKIE_FILE):
        return None
    raw = open(COOKIE_FILE).read().strip()
    if not raw:
        return None
    pairs = [p.strip() for p in re.split(r"[;\n]", raw) if p.strip()]
    return "; ".join(pairs)


def fetch(stream, cookie=None, tries=3):
    url = (f"{BASE}/{stream}?per_page={PER_PAGE}&orderby=date&order=desc"
           f"&_fields=id,date,slug,link,title,content")
    headers = {"User-Agent": UA}
    if cookie:
        headers["Cookie"] = cookie
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode()), None
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                return None, f"auth {e.code}"
            if e.code == 429:
                time.sleep(15 * (attempt + 1))
                continue
            return None, f"http {e.code}"
        except Exception as e:  # network hiccup, retry
            time.sleep(5 * (attempt + 1))
            last = str(e)
    return None, "network"


def known_ids(directory):
    ids = set()
    if not os.path.isdir(directory):
        return ids
    for name in os.listdir(directory):
        if not name.endswith(".md") or name.startswith("_"):
            continue
        try:
            with open(os.path.join(directory, name)) as f:
                head = f.read(400)
        except Exception:
            continue
        m = re.search(r"^id: sa-(?:art-)?(\d+)$", head, re.M)
        if m:
            ids.add(m.group(1))
    return ids


def write_post(post, directory, stream):
    raw = post["content"]["rendered"]
    parser = Markdown()
    parser.feed(raw)
    body = parser.result()
    title = html.unescape(re.sub(r"<[^>]+>", "", post["title"]["rendered"])).strip()
    date = post["date"][:10]
    words = len(body.split())
    prefix = "sa-art" if stream == "articles" else "sa"
    front = (
        f"---\nid: {prefix}-{post['id']}\ntitle: \"{title.replace(chr(34), chr(39))}\"\n"
        f"date: {date}\nurl: {post['link']}\nstream: {stream}\nwords: {words}\n"
        f"tags: [semianalysis, research, {stream}]\n---\n\n# {title}\n\n"
        f"> Source: {post['link']}\n> Published {date} · {words:,} words\n\n"
    )
    path = os.path.join(directory, f"{date}-{post['slug'][:55]}-id{post['id']}.md")
    with open(path, "w") as f:
        f.write(front + body + "\n")
    return path, words


def sync(stream, directory, label):
    os.makedirs(directory, exist_ok=True)
    cookie = cookie_header() if stream == "articles" else None
    if stream == "articles" and not cookie:
        log(f"{label}: skipped, no cookie at {COOKIE_FILE}")
        return 0
    data, err = fetch(stream, cookie)
    if err:
        log(f"{label}: fetch failed ({err})")
        return 0
    have = known_ids(directory)
    new = [p for p in data if str(p["id"]) not in have]
    if not new:
        log(f"{label}: no new posts ({len(data)} checked)")
        return 0
    written = 0
    for post in new:
        path, words = write_post(post, directory, stream)
        log(f"{label}: NEW {post['date'][:10]} {os.path.basename(path)} ({words} words)")
        written += 1
    return written


def last_unmatched_bracket(line):
    """Index of the last '[' with no matching ']' on the line, else -1."""
    stack = []
    escaped = False
    for k, ch in enumerate(line):
        if escaped:
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == "[":
            stack.append(k)
        elif ch == "]" and stack:
            stack.pop()
    return stack[-1] if stack else -1


def repair_file(path):
    """Collapse links written with newlines or blank lines inside the text.

    The old converter emitted block-level links as '[' + newlines + '](url)'.
    CommonMark rejects a blank line inside link text, so viewers render the
    brackets literally. This rewrites those constructs back onto one line.
    """
    with open(path) as f:
        lines = f.read().split("\n")
    out, i, in_code, changed = [], 0, False, False
    pending = None  # {"prefix", "texts", "start", "orig"} for an open link
    while i < len(lines):
        line = lines[i]
        if not pending and line.lstrip().startswith("```"):
            in_code = not in_code
            out.append(line)
            i += 1
            continue
        if pending is not None:
            if line.lstrip().startswith("```") or i - pending["start"] > 80:
                out.extend(pending["orig"])  # not a link: restore raw lines
                pending = None               # reprocess this line from the top
                continue
            elif "](" in line:
                pre, post = line.split("](", 1)
                pending["texts"].append(pre)
                text = " ".join(t.strip() for t in pending["texts"] if t.strip())
                head = pending["prefix"] + text + "]("
                changed = True
                if not in_code and post.rstrip().endswith("["):
                    # same line opens the next link (chained anchors);
                    # keep it pending so a bail can still flush the raw line
                    pending = {"prefix": head + post.rstrip(), "texts": [""],
                               "start": i, "orig": [line]}
                else:
                    out.append(head + post)
                    pending = None
                i += 1
                continue
            else:
                pending["orig"].append(line)
                pending["texts"].append(line)
                i += 1
                continue
        k = last_unmatched_bracket(line) if not in_code else -1
        if k >= 0:
            pending = {"prefix": line[:k + 1], "texts": [line[k + 1:]],
                       "start": i, "orig": [line]}
            i += 1
            continue
        out.append(line)
        i += 1
    if pending is not None:  # unclosed at EOF: restore raw lines
        out.extend(pending["orig"])
    if changed:
        with open(path, "w") as f:
            f.write("\n".join(out))
    return changed


def repair(vault):
    root = os.path.join(vault, "research/semianalysis")
    fixed = 0
    for dirpath, _, names in os.walk(root):
        for name in sorted(names):
            if not name.endswith(".md"):
                continue
            path = os.path.join(dirpath, name)
            try:
                if repair_file(path):
                    fixed += 1
                    log(f"repair: fixed links in {os.path.relpath(path, vault)}")
            except Exception as e:
                log(f"repair: FAILED {path}: {e}")
    log(f"repair: {fixed} files fixed")
    return fixed


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repair", action="store_true",
                    help="rewrite broken multi-line links in existing files")
    ap.add_argument("--vault", default=VAULT,
                    help="vault root (default: %(default)s)")
    args = ap.parse_args()
    if args.repair:
        return 0 if repair(args.vault) >= 0 else 1
    total = 0
    total += sync("posts", os.path.join(VAULT, "research/semianalysis"), "posts")
    total += sync("articles", os.path.join(VAULT, "research/semianalysis/institutional"),
                  "articles")
    if total == 0:
        log("sync: nothing new")
    return 0


if __name__ == "__main__":
    sys.exit(main())
