#!/usr/bin/env python3
"""Daily merged-PR digest over every owned GitHub repo, sent via Telegram.

Discovers all repos owned by PR_DIGEST_OWNER with one `gh search prs` call,
covers PRs merged in the last PR_DIGEST_HOURS hours, writes a 2-3 line
summary per PR, and sends the digest with the Telegram Bot API.

Env (via ~/.config/pi-telegram.env, loaded by pr-digest.service):
  PI_TELEGRAM_BOT_TOKEN   bot token from @BotFather
  PI_TELEGRAM_ALLOWED_CHATS  comma-separated chat IDs; first entry is the default
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENV_FILE = Path.home() / ".config/pi-telegram.env"
TELEGRAM_API = "https://api.telegram.org"
MAX_MESSAGE = 3800  # Telegram hard cap is 4096; leave headroom for the header
FIRST_SENTENCE_MAX = 140


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def load_env_file() -> None:
    """Apply KEY=VALUE lines from ENV_FILE for unset variables (manual runs)."""
    if not ENV_FILE.is_file():
        return
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"'))


def run_gh(args: list[str]) -> str:
    proc = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)} failed: {proc.stderr.strip()}")
    return proc.stdout


def find_merged_prs(owner: str, since_iso: str) -> list[dict]:
    out = run_gh(
        [
            "search", "prs",
            "--owner", owner,
            "--merged",
            f"--merged-at=>={since_iso}",
            "--limit", "200",
            "--json", "repository,number,title",
        ]
    )
    return json.loads(out)


def pr_details(repo: str, number: int) -> dict:
    out = run_gh(
        [
            "pr", "view", str(number),
            "-R", repo,
            "--json", "title,body,additions,deletions,changedFiles,mergedAt,author,url",
        ]
    )
    return json.loads(out)


def first_sentence(body: str) -> str:
    """First meaningful sentence of the PR body, or ''."""
    if not body:
        return ""
    text = re.sub(r"\s+", " ", body.strip())
    text = re.sub(
        r"^#{1,6}\s*(intent|what|why|summary|bug and fix|context|problem|change)s?\s*:?\s*",
        "",
        text,
        count=1,
        flags=re.IGNORECASE,
    )
    if not text:
        return ""
    match = re.match(r".{10,%d}?(?<=[.!?])\s" % FIRST_SENTENCE_MAX, text)
    if match:
        sentence = match.group(0).strip()
    else:
        sentence = text[:FIRST_SENTENCE_MAX].rstrip() + ("…" if len(text) > FIRST_SENTENCE_MAX else "")
    return sentence


def summarize_pr(repo: str, number: int, title: str) -> str:
    details = pr_details(repo, number)
    merged_at = (details.get("mergedAt") or "")[11:16] or "?"
    author = (details.get("author") or {}).get("login", "?")
    stats = f"+{details.get('additions', 0)} −{details.get('deletions', 0)} in {details.get('changedFiles', 0)} files"
    lines = [
        f"{repo} #{number} — {title}",
        f"{stats} · merged {merged_at}Z by {author}",
    ]
    sentence = first_sentence(details.get("body", ""))
    if sentence:
        lines.append(sentence)
    return "\n".join(lines)


def chunk_message(text: str, limit: int) -> list[str]:
    parts, current = [], ""
    for block in text.split("\n\n"):
        candidate = f"{current}\n\n{block}" if current else block
        if len(candidate) > limit and current:
            parts.append(current)
            current = block
        else:
            current = candidate
    if current:
        parts.append(current)
    return parts


def send_telegram(token: str, chat: str, text: str) -> None:
    data = urllib.parse.urlencode(
        {
            "chat_id": chat,
            "text": text,
            "disable_web_page_preview": "true",
        }
    ).encode()
    req = urllib.request.Request(f"{TELEGRAM_API}/bot{token}/sendMessage", data=data)
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read())
        if not body.get("ok"):
            raise RuntimeError(f"telegram sendMessage failed: {body}")


def default_chat() -> str:
    chats = [c.strip() for c in os.environ.get("PI_TELEGRAM_ALLOWED_CHATS", "").split(",") if c.strip()]
    return chats[0] if chats else ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", default=os.environ.get("PR_DIGEST_OWNER", "aviralmansingka"))
    parser.add_argument("--hours", type=float, default=float(os.environ.get("PR_DIGEST_HOURS", "24")))
    parser.add_argument("--chat", default=os.environ.get("PR_DIGEST_CHAT") or default_chat())
    parser.add_argument("--dry-run", action="store_true", help="print the digest, do not send it")
    args = parser.parse_args()

    load_env_file()
    token = os.environ.get("PI_TELEGRAM_BOT_TOKEN", "")
    if not args.dry_run and (not token or not args.chat):
        log("error: PI_TELEGRAM_BOT_TOKEN or chat ID missing")
        return 2

    since_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - args.hours * 3600))
    prs = find_merged_prs(args.owner, since_iso)
    log(f"found {len(prs)} merged PRs since {since_iso}")

    repo_names = sorted({pr["repository"]["nameWithOwner"] for pr in prs})
    header = (
        f"📦 Merged PR digest — {time.strftime('%a %b %d')}\n"
        f"{len(prs)} PRs merged in the last {args.hours:g}h"
        + (f" across {len(repo_names)} repos: {', '.join(repo_names)}" if repo_names else "")
    )

    if not prs:
        message = header + "\nNo PRs merged. Nothing to summarize."
        if args.dry_run:
            print(message)
            return 0
        send_telegram(token, args.chat, message)
        log(f"sent zero-PR notice to chat {args.chat}")
        return 0

    summaries = []
    for pr in sorted(prs, key=lambda p: (p["repository"]["nameWithOwner"], p["number"])):
        try:
            summaries.append(summarize_pr(pr["repository"]["nameWithOwner"], pr["number"], pr["title"]))
        except Exception as exc:
            log(f"warning: summary failed for {pr['repository']['nameWithOwner']} #{pr['number']}: {exc}")
            summaries.append(f"{pr['repository']['nameWithOwner']} #{pr['number']} — {pr['title']}")

    digest = header + "\n\n" + "\n\n".join(summaries)
    messages = chunk_message(digest, MAX_MESSAGE)
    for index, part in enumerate(messages, start=1):
        if len(messages) > 1:
            part = f"({index}/{len(messages)})\n{part}"
        if args.dry_run:
            print(part, end="\n--- message boundary ---\n")
        else:
            send_telegram(token, args.chat, part)
            log(f"sent message {index}/{len(messages)} ({len(part)} chars) to chat {args.chat}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
