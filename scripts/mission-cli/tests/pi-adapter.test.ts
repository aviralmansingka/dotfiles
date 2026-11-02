import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("optional Pi adapter preserves lifecycle evidence through the real CLI", () => {
  const vault = mkdtempSync(join(tmpdir(), "mission-hook-contract-"));
  const bin = resolve(import.meta.dir, "../bin/mission");
  const call = (...args: string[]) => {
    const result = spawnSync(bin, ["--vault", vault, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stdout + result.stderr);
    expect(result.stdout).not.toContain("\x1b");
    return JSON.parse(result.stdout).data;
  };
  try {
    const headless = spawnSync(bin, ["--vault", vault, "new"], { encoding: "utf8", timeout: 3000 });
    expect(headless.status).toBe(2);
    expect(JSON.parse(headless.stdout).error.code).toBe("usage");
    call("repo", "add", "dotfiles", "--checkout", vault);
    call("new", "dotfiles/hook-contract", "--title", "Hook contract", "--goal", "Preserve hook evidence", "--step", "Record events");
    const r = call("run", "dotfiles/hook-contract", "--agent", "fixture", "--", process.execPath, resolve(import.meta.dir, "mock-pi.ts"));
    const a = r.state.attempts[0];
    expect(r.state.status).toBe("done");
    expect(a.session_id).toBe("mock-pi-contract");
    expect(a.process_exited).toBe(true);
    expect(a.events.map((e: any) => e.type)).toEqual(expect.arrayContaining([
      "process-start", "session-start", "agent-start", "tool-start", "tool-end", "agent-end", "session-end", "process-exit", "attempt-finished",
    ]));
    unlinkSync(join(vault, "mock-session.jsonl"));
    const preserved = join(vault, "6_missions/dotfiles/hook-contract", a.transcript);
    expect(readFileSync(preserved, "utf8")).toContain("mock-pi-contract");
    const projection = readFileSync(join(vault, "6_missions/dotfiles/hook-contract/attempts/001.events.jsonl"), "utf8");
    expect(projection.trim().split("\n").map(JSON.parse).length).toBe(a.events.length);
  } finally { rmSync(vault, { recursive: true, force: true }); }
});

test("agents create title-only steps, customize checks, and preserve failed evidence", () => {
  const vault = mkdtempSync(join(tmpdir(), "mission-step-cli-"));
  const bin = resolve(import.meta.dir, "../bin/mission");
  let context: Record<string, string> = {};
  const call = (args: string[], status = 0) => {
    const r = spawnSync(bin, ["--vault", vault, ...args], { encoding: "utf8", env: { ...process.env, ...context } });
    expect(r.status, r.stdout + r.stderr).toBe(status);
    expect(r.stdout).not.toContain("\x1b");
    return JSON.parse(r.stdout);
  };
  try {
    call(["repo", "add", "dotfiles", "--checkout", vault]);
    const handle = "dotfiles/json-events";
    call(["new", handle, "--title", "JSON event map", "--goal", "Preserve valid event metadata", "--step", "Map the events", "--step", "Summarize gaps"]);
    let steps = call(["steps", handle]).data;
    expect(steps[0].step).toMatchObject({ id: "S01", agent: "any", output: "step-01.md", checks: ["nonempty-artifact"] });
    call(["step", "edit", handle, "S01", "--instructions", "Map session and tool events", "--acceptance", "Include shutdown", "--output", "events.json", "--checks", "json-valid"]);
    steps = call(["step", "list", handle]).data;
    expect(steps[0].step.checks).toEqual(["nonempty-artifact", "json-valid"]);
    expect(call(["checks"]).data.map((c: any) => c.name)).toContain("go-test");
    const claimed = call(["claim", handle, "--agent", "scout"]).data;
    context = claimed.environment;
    writeFileSync(context.MISSION_ARTIFACT, "invalid JSON");
    const failed = call(["verify"], 1);
    expect(failed.error.code).toBe("checks_failed");
    expect(failed.data.verification.results[1].verdict).toBe("failed");
    call(["finish"], 1);
    writeFileSync(context.MISSION_ARTIFACT, '{"events":["session-start","session-end"]}\n');
    expect(call(["verify"]).data.passed).toBe(true);
    const finished = call(["finish"]).data;
    expect(finished.state.steps.S01.status).toBe("passed");
    expect(finished.state.steps.S02.status).toBe("pending");
    expect(finished.state.attempts[0].verifications.length).toBe(3);
    expect(finished.state.attempts[0].step_definition.acceptance).toBe("Include shutdown");
    expect(call(["step", "edit", handle, "S01", "--acceptance", "Include restarts"], 1).error.code).toBe("step_started");
    const reset = call(["step", "edit", handle, "S01", "--acceptance", "Include restarts", "--reset"]).data;
    expect(reset.state.steps.S01.status).toBe("pending");
    expect(reset.state.attempts[0].step_definition.acceptance).toBe("Include shutdown");
  } finally { rmSync(vault, { recursive: true, force: true }); }
});

test("--json bypasses human views and returns structured success and errors", () => {
  const vault = mkdtempSync(join(tmpdir(), "mission-json-mode-"));
  const bin = resolve(import.meta.dir, "../bin/mission");
  const call = (args: string[], status = 0) => {
    const r = spawnSync(bin, ["--vault", vault, ...args], { encoding: "utf8", timeout: 3000 });
    expect(r.status, r.stdout + r.stderr).toBe(status);
    expect(r.stdout).not.toContain("\x1b");
    return JSON.parse(r.stdout);
  };
  try {
    call(["--json", "repo", "add", "dotfiles", "--checkout", vault]);
    const handle = "dotfiles/json-interface";
    call(["--json", "new", handle, "--title", "Agent interface", "--goal", "Return structured work", "--step", "Inspect JSON output"]);
    const baseline = call(["list", "--json"]);
    expect(baseline.ok).toBe(true);
    expect(call([])).toEqual(baseline);
    expect(call(["--json"])).toEqual(baseline);
    expect(call(["ui", "--json"])).toEqual(baseline);
    expect(call(["render", "--view", "create", "--color", "--json"])).toEqual(baseline);
    expect(call(["--json", "ui", "--handle", handle]).data.handle).toBe(handle);
    expect(call(["render", "--view", "edit", "--handle", handle, "--json"]).data.handle).toBe(handle);
    expect(call(["steps", handle, "--json"]).data[0].step.id).toBe("S01");
    expect(call(["step", "show", handle, "S01", "--json"]).data.step.title).toBe("Inspect JSON output");
    call(["step", "edit", handle, "S01", "--checks", "json-valid", "--output", "result.json", "--json"]);
    expect(call(["help", "--json"]).data.output).toBe("json");
    expect(call(["--json", "--help"]).data.default_command).toBe("list");
    expect(call(["new", "--json"], 2).error.code).toBe("usage");
    expect(call(["--json", "unknown-command"], 2).error.code).toBe("usage");
    expect(call(["--json", "--unknown-option"], 2).error.code).toBe("usage");
    expect(call(["show", "dotfiles/missing-mission", "--json"], 2).error.code).toBe("not_found");
  } finally { rmSync(vault, { recursive: true, force: true }); }
});
