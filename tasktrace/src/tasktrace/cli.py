"""Command line: serve the socket, emit from a hook, bridge rex, dump spans."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Sequence

from . import agent, hooks, probe, rex, stitch, waterfall
from .client import Client, ClientError, send
from .schema import KINDS
from .server import Collector, default_socket
from .store import DEFAULT_HOME, Store


def _home(args: argparse.Namespace) -> Path:
    return Path(args.home) if getattr(args, "home", None) else DEFAULT_HOME


def _socket(args: argparse.Namespace) -> Path:
    explicit = getattr(args, "socket", None) or os.environ.get("TASKTRACE_SOCK")
    return Path(explicit) if explicit else default_socket(_home(args))


def _emit(args: argparse.Namespace, event) -> int:
    answer = send(event, _socket(args))
    print(json.dumps(answer, separators=(",", ":")))
    return 0 if answer.get("ok") else 2


def cmd_serve(args: argparse.Namespace) -> int:
    collector = Collector(_home(args), _socket(args))
    print(f"tasktrace: socket={collector.socket_path} db={collector.store.db_path}", flush=True)
    collector.serve_forever()
    return 0


def cmd_hook(args: argparse.Namespace) -> int:
    name = args.entry
    context: dict[str, str | None] = {"app": None, "bundle": None, "ws": None, "title": None}
    if not args.no_probe:
        context = probe.focus_context()
    idle = probe.idle_seconds() if not args.no_idle else None
    try:
        event = hooks.build_event(
            name,
            os.environ,
            frontmost=(context["app"], context["bundle"]),
            ws=context["ws"],
            title=context.get("title"),
            idle_s=idle,
            label=args.label,
        )
    except KeyError as exc:
        print(f"tasktrace: {exc}", file=sys.stderr)
        return 2
    return _emit(args, event)


def cmd_send(args: argparse.Namespace) -> int:
    detail = json.loads(args.detail) if args.detail else {}
    event = {
        "kind": args.kind,
        "app": args.app,
        "bundle": args.bundle,
        "ws": args.ws,
        "idle_s": args.idle,
        "source": args.source or "cli",
        "detail": detail,
    }
    return _emit(args, event)


def cmd_rex(args: argparse.Namespace) -> int:
    idle = probe.idle_seconds() if not args.no_idle else None
    client = Client(_socket(args)).connect()
    seen = 0
    try:
        if args.stdin:
            for event in rex.events_from_lines(sys.stdin, idle_s=idle):
                client.send_line(event)
                seen += 1
        else:
            pass_through = list(args.rex_args)
            if args.session:
                pass_through = ["--session", args.session, *pass_through]
            if args.all:
                pass_through = ["--all", *pass_through]
            for event in rex.bridge(pass_through, idle_s=idle):
                client.send_line(event)
                seen += 1
    finally:
        client.close()
    print(json.dumps({"ok": True, "rows": seen}, separators=(",", ":")))
    return 0


def cmd_app_agent(args: argparse.Namespace) -> int:
    try:
        agent.launch(_home(args), _socket(args))
    except agent.AgentError as exc:
        print(f"tasktrace: {exc}", file=sys.stderr)
        return 2
    return 0  # pragma: no cover - exec replaces the process


def cmd_spans(args: argparse.Namespace) -> int:
    store = Store(_home(args))
    try:
        rows = store.rows(limit=args.limit, kind=args.kind)
    finally:
        store.close()
    if args.json:
        for row in rows:
            print(json.dumps(row, separators=(",", ":"), ensure_ascii=False))
        return 0
    print("id\tts\tmono\tkind\tapp\tbundle\tws\tidle_s\tsource\tdetail")
    for row in rows:
        detail = json.dumps(row["detail"], separators=(",", ":"), ensure_ascii=False)
        print(
            "\t".join(
                str(row[key] if row[key] is not None else "")
                for key in ("id", "ts", "mono", "kind", "app", "bundle", "ws", "idle_s", "source")
            )
            + "\t"
            + detail
        )
    return 0


def cmd_traces(args: argparse.Namespace) -> int:
    store = Store(_home(args))
    try:
        rows = store.rows()
    finally:
        store.close()
    if args.limit:
        rows = rows[-args.limit :]  # the newest spans, so a dump stays about now
    tasks = stitch.stitch(rows)
    if args.json:
        for task in tasks:
            print(json.dumps(task.dump(), separators=(",", ":"), ensure_ascii=False))
        return 0
    print("tasks:")
    print("\t".join(("key", "task_id", "spans", "traces", "wall_s")))
    for task in tasks:
        print(f"{task.key}\t{task.task_id}\t{task.span_count}\t{len(task.traces)}\t{task.wall_s}")
    print()
    print("traces:")
    print("\t".join(("key", "trace", "start", "end", "spans", "wall_s", "apps")))
    for task in tasks:
        for trace in task.traces:
            apps = ",".join(trace.apps) or "-"
            print(
                f"{trace.key}\t{trace.index}\t{trace.start}\t{trace.end}"
                f"\t{trace.span_count}\t{trace.wall_s}\t{apps}"
            )
    return 0


def cmd_waterfall(args: argparse.Namespace) -> int:
    store = Store(_home(args))
    try:
        rows = store.rows()
    finally:
        store.close()
    view = waterfall.window(
        days=args.days,
        since=args.since,
        until=args.until,
        everything=args.all,
    )
    found = waterfall.build(rows, view=view)
    if args.json:
        print(json.dumps(found.dump(), separators=(",", ":"), ensure_ascii=False))
        return 0
    print(waterfall.render(found, bar_width=args.bar_width))
    return 0


def cmd_idle(args: argparse.Namespace) -> int:
    print(probe.idle_seconds())
    return 0


def cmd_frontmost(args: argparse.Namespace) -> int:
    name, bundle = probe.frontmost_app()
    print(json.dumps({"app": name, "bundle": bundle}, separators=(",", ":")))
    return 0


def cmd_hooks(args: argparse.Namespace) -> int:
    if args.json:
        print(
            json.dumps(
                [hook.__dict__ for hook in hooks.HOOKS.values()],
                separators=(",", ":"),
                indent=2,
            )
        )
        return 0
    for hook in hooks.HOOKS.values():
        print(f"{hook.name}\t{hook.surface}")
        print(f"    {hook.line}")
        if hook.note:
            print(f"    # {hook.note}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tasktrace", description=__doc__)
    parser.add_argument("--home", help="collector home (default: $TASKTRACE_HOME)")
    parser.add_argument("--socket", help="unix socket path (default: $TASKTRACE_SOCK)")
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="listen on the unix socket and write spans")
    serve.set_defaults(func=cmd_serve)

    hook = sub.add_parser("hook", help="emit one span from an AeroSpace hook")
    hook.add_argument("entry", choices=sorted(hooks.HOOKS))
    hook.add_argument("label", nargs="?", help="optional label, such as a binding key")
    hook.add_argument("--no-probe", action="store_true", help="skip the frontmost app probe")
    hook.add_argument("--no-idle", action="store_true", help="skip the idle probe")
    hook.set_defaults(func=cmd_hook)

    sender = sub.add_parser("send", help="emit one span from any producer")
    sender.add_argument("--kind", required=True, choices=KINDS)
    sender.add_argument("--app")
    sender.add_argument("--bundle")
    sender.add_argument("--ws")
    sender.add_argument("--idle", type=float)
    sender.add_argument("--source")
    sender.add_argument("--detail", help="JSON object")
    sender.set_defaults(func=cmd_send)

    bridge = sub.add_parser("rex", help="bridge `rex events --json` into spans")
    bridge.add_argument("-s", "--session")
    bridge.add_argument("--all", action="store_true", help="follow every server event")
    bridge.add_argument("--stdin", action="store_true", help="replay rex lines from stdin")
    bridge.add_argument("--no-idle", action="store_true", help="skip the idle probe")
    bridge.add_argument("rex_args", nargs="*", help="extra args passed to `rex events`")
    bridge.set_defaults(func=cmd_rex)

    app_agent = sub.add_parser("app-agent", help="build and run the NSWorkspace agent")
    app_agent.set_defaults(func=cmd_app_agent)

    spans = sub.add_parser("spans", help="dump span rows from sqlite")
    spans.add_argument("--limit", type=int)
    spans.add_argument("--kind", choices=KINDS)
    spans.add_argument("--json", action="store_true")
    spans.set_defaults(func=cmd_spans)

    traces = sub.add_parser("traces", help="stitch spans into task traces and dump them")
    traces.add_argument("--limit", type=int, help="only the newest N spans")
    traces.add_argument("--json", action="store_true")
    traces.set_defaults(func=cmd_traces)

    fall = sub.add_parser("waterfall", help="render the task waterfall from sqlite")
    fall.add_argument(
        "--days",
        type=float,
        default=waterfall.DEFAULT_DAYS,
        help=f"window width in days (default {waterfall.DEFAULT_DAYS:g})",
    )
    fall.add_argument("--since", help="window start, ISO 8601 (overrides --days)")
    fall.add_argument("--until", help="window end, ISO 8601 (default: now)")
    fall.add_argument("--all", action="store_true", help="ignore the window")
    fall.add_argument(
        "--bar-width",
        type=int,
        default=waterfall.BAR_WIDTH,
        help=f"widest bar in cells (default {waterfall.BAR_WIDTH})",
    )
    fall.add_argument("--json", action="store_true")
    fall.set_defaults(func=cmd_waterfall)

    idle = sub.add_parser("idle", help="print seconds since the last user input")
    idle.set_defaults(func=cmd_idle)

    front = sub.add_parser("frontmost", help="print the frontmost app name and bundle")
    front.set_defaults(func=cmd_frontmost)

    table = sub.add_parser("hooks", help="list the nine hook entry points and their paste lines")
    table.add_argument("--json", action="store_true")
    table.set_defaults(func=cmd_hooks)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    try:
        return int(args.func(args))
    except ClientError as exc:
        print(f"tasktrace: {exc}", file=sys.stderr)
        return 2


def hook_main(argv: Sequence[str] | None = None) -> int:
    """Entry point for the `tasktrace-hook` shim AeroSpace calls."""
    rest = list(argv) if argv is not None else sys.argv[1:]
    if not rest or rest[0].startswith("-"):
        rest = ["focus", *rest]
    return main(["hook", *rest])


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
