// Paths: go/mission/**, pi/.pi/agent/extensions/missions/**, pi/.pi/agent/extensions/interactive-subagents/**, agents/.agents/skills/missions/**
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, realpathSync, rmSync, existsSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTAIN_AGENT, CommanderInbox, FAILED_OUTBOX_LIMIT, MissionBridge, OUTBOX_FAILURE_LIMIT, WORKER_AGENT, askMessage, driverStatus, driverTask, droppableEventError, droppableReportError, isJudge, judgeTask, missionContinues, missionToolBlock, outboxErrorCode, quiescent, setAsideNotice, trackingFailureBlock, trooperLine, trooperName, trooperReport, trooperStatus } from "./core.mjs";
import { actionForKey, buildPanelModel, checkpointArgs } from "./panel.mjs";
import { missionLaunchConfig } from "../interactive-subagents/pi-extension/subagents/mission-launch.mjs";

const exec = promisify(execFile);
const bin = process.env.MISSION_TEST_BIN;
const needsCLI = { skip: !bin && "Run scripts/test-missions.sh for real CLI integration coverage" };
const context = (cwd, file, id="existing-pi") => ({ cwd, sessionManager: { getSessionId:()=>id, getSessionFile:()=>file }, hasPendingMessages:()=>false, isIdle:()=>true });

test("normal turn is quiescent only without queued work and registered waits", () => {
  const ctx=context("/tmp","/tmp/pi");
  const event={aborted:false,outcome:"completed"};
  assert.equal(quiescent(event,ctx),true);
  for(const outcome of ["aborted","error",undefined]) assert.equal(quiescent({aborted:false,outcome},ctx),false);
  assert.equal(quiescent({aborted:true,outcome:"completed"},ctx),false);
  assert.equal(quiescent(event,{...ctx,isIdle:()=>false}),false);
  assert.equal(quiescent(event,{...ctx,hasPendingMessages:()=>true}),false);
  const key=Symbol.for("pi-subagents/running-children-count");
  try {
    globalThis[key]=()=>1;assert.equal(quiescent(event,ctx),false);
    globalThis[key]=()=>{throw Error("unavailable")};assert.equal(quiescent(event,ctx),false);
  } finally {delete globalThis[key]}
});

test("mission tool gate follows status and never blocks inspection", () => {
  const at = (status, attempt) => ({ record: { state: { status } }, attempt });
  for (const status of ["waiting", "review", "done", "failed", "closed"])
    for (const toolName of ["bash", "write", "edit"])
      assert.equal(missionToolBlock({ toolName, current: at(status) }), undefined, `${status} allows ${toolName}`);
  assert.equal(missionToolBlock({ toolName: "bash", current: at("running", { id: "attempt-1" }) }), undefined);
  assert.match(missionToolBlock({ toolName: "bash", current: at("ready") }), /No active mission step/);
  assert.match(missionToolBlock({ toolName: "write", current: null }), /No active mission step/);
  assert.match(missionToolBlock({ toolName: "write", tracked: false, expectedAttachment: true }), /Restore/);
  assert.equal(missionToolBlock({ toolName: "write", tracked: false }), undefined);
  for (const toolName of ["read", "grep", "find", "ls", "tool_search", "mission", "run-command", "mermaid"]) {
    assert.equal(missionToolBlock({ toolName, current: at("ready") }), undefined, `${toolName} inspects a ready mission`);
    assert.equal(missionToolBlock({ toolName, current: null }), undefined, `${toolName} inspects without a step`);
    assert.equal(missionToolBlock({ toolName, current: at("waiting") }), undefined, `${toolName} passes on a held mission`);
    assert.equal(missionToolBlock({ toolName, tracked: false, expectedAttachment: true }), undefined, `${toolName} inspects a broken cache`);
  }
  // A durable worker that owns no active step can still hand the human the
  // exact repair command: printing one inspects nothing and changes nothing.
  assert.equal(
    missionToolBlock({ toolName: "run-command", current: null }),
    undefined,
    "run-command passes the mission gate with no active step",
  );
  // A mission between steps has no attempt, so a diagram tool must still pass.
  assert.equal(
    missionToolBlock({ toolName: "mermaid", current: null }),
    undefined,
    "mermaid passes the mission gate with no active step",
  );
});

test("a waiting review never blocks a worker tool and only stops finish", () => {
  const record = {
    handle: "dotfiles/reviewed",
    mission: { checkpoints: [{ id: "C01", question: "Is the result right?" }] },
    state: { status: "waiting", pending_checkpoint: "C01", checkpoints: { C01: { status: "pending", evidence: "artifacts/001/result.md" } } },
    pending_review: { id: "C01", question: "Is the result right?", evidence: "artifacts/001/result.md" },
    next_command: 'mission checkpoint accept dotfiles/reviewed C01 --note "Reviewed the evidence"',
  };
  const current = { record };
  for (const toolName of ["bash", "edit", "write"])
    assert.equal(missionToolBlock({ toolName, current }), undefined, `${toolName} passes during a review`);
  const blocked = missionToolBlock({ toolName: "mission", action: "finish", current });
  assert.match(blocked, /Review C01 is waiting/);
  assert.match(blocked, /mission checkpoint accept dotfiles\/reviewed C01/);
  assert.equal(missionToolBlock({ toolName: "mission", action: "status", current }), undefined);
  assert.equal(missionToolBlock({ toolName: "mission", action: "finish", current: null }), undefined);
  // A record without the derived field still resolves the stored review.
  const stored = { ...record };
  delete stored.pending_review;
  delete stored.next_command;
  const fallback = missionToolBlock({ toolName: "mission", action: "finish", current: { record: stored } });
  assert.match(fallback, /Review C01 is waiting/);
  assert.match(fallback, /mission checkpoint accept dotfiles\/reviewed C01/);
});

test("a failed tracking record never stops reads and bash", () => {
  // The incident: a delayed hook for an attempt the ledger lost. Every call
  // reports not_found, and bash was blocked with it.
  const lost = "not_found: attempt attempt-3a8986d1ee0156069724aef0 not found";
  for (const toolName of ["bash", "read", "grep", "find", "ls", "mission", "run-command"]) {
    assert.equal(trackingFailureBlock(toolName, lost), undefined, `${toolName} degrades to a warning`);
  }
  for (const toolName of ["write", "edit", "multiedit"]) {
    const reason = trackingFailureBlock(toolName, lost);
    assert.match(reason, /must recover before work continues/, `${toolName} stays blocked`);
    assert.match(reason, /not_found: attempt attempt-3a8986/, `${toolName} names the cause`);
  }
});

test("next-step continuation follows status and pending steps", () => {
  const steps = { S01: { status: "passed" }, S02: { status: "pending" } };
  assert.equal(missionContinues({ status: "ready", steps }), true);
  assert.equal(missionContinues({ status: "ready", steps: { S01: { status: "needs_changes" } } }), true);
  assert.equal(missionContinues({ status: "ready", steps: { S01: { status: "passed" } } }), false);
  assert.equal(missionContinues({ status: "ready", steps, pending_checkpoint: "C01" }), false);
  for (const status of ["done", "failed", "waiting", "review", "running", undefined]) {
    assert.equal(missionContinues({ status, steps }), false, `${status} never continues`);
  }
  assert.equal(missionContinues(undefined), false);
});

/** One finished-subagent steer, exactly as the interactive subagents extension
 *  delivers it: the completion event the missions extension reports. Names are
 *  pinned in rank case, the way the sitrep records them. */
const trooperDone = (name, status = "done", over = {}) => ({ customType: "subagent_result", display: true,
  content: `Sub-agent "${name}" completed (2m).\n\nMapped the lifecycle hooks and listed 12 calls.\n\nFollow up with subagent_message({ name: "${name}", message: "…" })`,
  details: { name, status, exitCode: 0, elapsed: 120, sessionFile: `/tmp/${name}.jsonl`, ...over } });

/** The `content` resolveResultPresentation builds for every way a subagent can
 *  end, copied from the templates in
 *  interactive-subagents/pi-extension/subagents/index.ts. A sitrep row carries
 *  the trooper's own words, never the presentation's headline or narration. */
const PRESENTATIONS = {
  done: [
    `Sub-agent "trooper-S01" completed (2m).\n\nMapped the lifecycle hooks.\n\nFollow up with subagent_message({ name: "trooper-S01", message: "…" })`,
    "Mapped the lifecycle hooks.",
  ],
  "failed exit": [
    `Sub-agent "trooper-S01" failed (exit code 1).\n\nTwo fixtures are left.\n\nFollow up with subagent_message({ name: "trooper-S01", message: "…" })`,
    "Two fixtures are left.",
  ],
  "provider error": [
    `Sub-agent "trooper-S01" failed after 2m (provider/agent error — auto-retry exhausted).\n\nError: provider overload\n\nThe subagent did not produce a result. You can retry by spawning a new subagent or resume the session with subagent_message.\n\nFollow up with subagent_message({ name: "trooper-S01", message: "…" })`,
    "Error: provider overload",
  ],
  killed: [
    `Sub-agent "trooper-S01" pane was closed/killed after 2m before it reported completion.\n\nHalf the fixtures are written.\n\nAsk the user what to do next: resume it with subagent_message, launch a fresh subagent, or ignore it. Do not infer the missing result.\n\nFollow up with subagent_message({ name: "trooper-S01", message: "…" })`,
    "Half the fixtures are written.",
  ],
  // The death paths put a label in the same paragraph as the headline, or ahead
  // of the harvest, so the label is not a report either.
  "timeout with partial": [
    `Sub-agent "trooper-S01" timed out after 2m and its pane was closed at the PI_SUBAGENT_MAX_WAIT_MS deadline. Partial results attached:\n\nHalf the fixtures are written.\n\nDo not wait further: resume the session with subagent_message (it replays\nwhat was already written) or spawn a fresh subagent.\n\nFollow up with subagent_message({ name: "trooper-S01", message: "…" })`,
    "Half the fixtures are written.",
  ],
  "timeout without harvest": [
    `Sub-agent "trooper-S01" timed out after 2m and its pane was closed at the PI_SUBAGENT_MAX_WAIT_MS deadline.\n\nSub-agent timed out after 2m; no output was harvested from its session file.\n\nDo not wait further: resume the session with subagent_message (it replays what was already written) or spawn a fresh subagent.\n\nFollow up with subagent_message({ name: "trooper-S01", message: "…" })`,
    "Sub-agent timed out after 2m; no output was harvested from its session file.",
  ],
  "no agent": [
    `Sub-agent "trooper-S01" never started — no pi process appeared in its pane within the PI_SUBAGENT_STARTUP_GRACE_MS window (the launch itself died; the pane held only a shell).\n\nSub-agent never started — no pi process ever appeared in its pane. No result was saved.\n\nNothing ran, so there is nothing to resume: spawn a fresh subagent instead.\n\nFollow up with subagent_message({ name: "trooper-S01", message: "…" })`,
    "Sub-agent never started — no pi process ever appeared in its pane. No result was saved.",
  ],
  stalled: [
    `Sub-agent "trooper-S01" stalled after 12m — no transcript growth at all within the PI_SUBAGENT_STALL_MS window.\n\nIt is still alive and still owns its tab, pane, and CLI attempt: nothing failed and nothing was released. Last harvest:\n\nHalfway: 2 of 5 fixtures done.\n\nDo not treat this as an error, a timeout, or a completion. Steer it with subagent_message({ name: "trooper-S01" }); if the attempt must be released, that is the human's decision (\`mission reclaim\`), never a settle.`,
    "Halfway: 2 of 5 fixtures done.",
  ],
  // An orphan finalized at parent restart prefixes its own narration.
  "orphan finalize": [
    `Recovered at parent restart — this sub-agent's original watcher died with its parent process; its tab has been closed.\n\nSub-agent "trooper-S01" completed (2m).\n\nRecovered the harvest from its session file.\n\nFollow up with subagent_message({ name: "trooper-S01", message: "…" })`,
    "Recovered the harvest from its session file.",
  ],
};

test("a sitrep line is the trooper's own words, never the presentation around them", () => {
  for (const [shape, [content, line]] of Object.entries(PRESENTATIONS)) assert.equal(trooperLine(content), line, shape);
  // Nothing the trooper wrote means no invented line.
  assert.equal(trooperLine(`Sub-agent "trooper-S01" completed (2m).\n\nFollow up with subagent_message({ name: "trooper-S01", message: "…" })`), "");
  assert.equal(trooperLine(`Adopted sub-agent "trooper-S01" error: pane vanished`), "");
  // A trooper that wrote nothing still says something once it is a report.
  assert.equal(trooperReport({ customType: "subagent_result", details: { name: "trooper-S01" } }).summary, "trooper-S01 finished");
});

test("a finished subagent becomes one trooper report named by itself", () => {
  const report = trooperReport(trooperDone("trooper-S01"));
  assert.equal(report.trooper, "trooper-S01");
  assert.equal(report.status, "ready");
  assert.equal(report.summary, "Mapped the lifecycle hooks and listed 12 calls.");
  assert.equal(report.blocker, undefined);
  assert.match(report.next, /Read the result/);
  assert.match(report.id, /^trooper-[0-9a-f]{24}$/);
  // One ID per completion of one subagent session: the same trooper reported
  // again — adopted at parent restart, or replayed — takes no second ID, while
  // a different trooper, or the same trooper after a resume that ended
  // differently, does.
  assert.equal(trooperReport(trooperDone("trooper-S01", "agent-gone")).id, report.id);
  assert.notEqual(trooperReport(trooperDone("sergeant-S01")).id, report.id);
  assert.notEqual(trooperReport(trooperDone("trooper-S01", "blocked", { errorMessage: "provider overload" })).id, report.id);
  // The rank label is the subagent's own name, and a judge step records the
  // judge that finished, not the worker that spawned it.
  assert.equal(trooperReport(trooperDone("sergeant-S01")).trooper, "sergeant-S01");
  // Only a completion message reports: hooks, prompts, and absent messages do not.
  assert.equal(trooperReport({ customType: "mission-context", content: "x" }), null);
  assert.equal(trooperReport(undefined), null);
  // An agent profile is not the subagent's name: an unnamed completion reports
  // nothing instead of borrowing a second vocabulary.
  assert.equal(trooperReport({ customType: "subagent_result", content: "x", details: { agent: "scout" } }), null);
  assert.equal(trooperName({}), "");
  assert.equal(trooperName({ details: { name: "  trooper-S01  " } }), "trooper-S01");
  // A death is blocked and names its reason, which the CLI requires.
  const failed = trooperReport(trooperDone("trooper-S01", "error", { errorMessage: "provider overload\nretry exhausted" }));
  assert.equal(failed.status, "blocked");
  assert.equal(failed.blocker, "provider overload retry exhausted");
  assert.match(failed.next, /subagent_message\(\{ name: "trooper-S01" \}\)/);
  // A stall is not a death: it parks for a human decision.
  assert.equal(trooperStatus("stalled"), "needs-input");
  assert.equal(trooperReport(trooperDone("trooper-S01", "stalled")).status, "needs-input");
  for (const status of ["killed", "timeout", "no-agent"]) assert.equal(trooperStatus(status), "blocked", status);
  for (const status of ["done", "sentinel", "agent-gone", "completed"]) assert.equal(trooperStatus(status), "ready", status);
  // A report never becomes a wall of text.
  assert.equal(trooperLine("a".repeat(400)).length, 160);
  // Content blocks are flattened the same way: the headline is still not a report.
  assert.equal(trooperLine([{ type: "text", text: `Sub-agent "trooper-S01" completed (2m).` }, { type: "text", text: "Mapped the lifecycle hooks." }]), "Mapped the lifecycle hooks.");
  // A line the record can never take is dropped — a trooper report or a
  // lifecycle hook queued under an attempt the ledger stopped listing — while a
  // transient failure retries. Only the CLI's own codes count, never a substring.
  for (const refusal of ["event_conflict: progress id reused with different content", "stale_attempt: progress needs the active attempt", "attempt_terminal: attempt is settled", "closed: mission dotfiles/x is closed", "not_found: mission dotfiles/x not found", "invalid_handle: handle must be REPO/SLUG"])
    assert.equal(droppableEventError(refusal), true, refusal);
  for (const transient of ["io_error: no such file", "unavailable", "Mission CLI returned invalid JSON", "Mission CLI unavailable: spawn mission ENOENT", "usage: progress needs a stable event-id", "the closed attempt not_found event_conflict", "closed the pane"])
    assert.equal(droppableEventError(transient), false, transient);
});


test("internal mission launch config forwards only non-secret paths", () => {
  const config=missionLaunchConfig({agent:"mission-worker",missionContext:{vault:"/vault",binary:"/bin/mission",stateDir:"/state",MISSION_TOKEN:"secret"}});
  assert.deepEqual(config,{MISSION_VAULT:"/vault",MISSION_BIN:"/bin/mission",MISSION_STATE_DIR:"/state"});
  assert.equal(missionLaunchConfig({agent:"worker",missionContext:{}}),undefined);
  assert.throws(()=>missionLaunchConfig({agent:"mission-worker",missionContext:{vault:"/vault"}}),/Invalid/);
});

async function fixture(t, checkpoint=false) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"pi-mission-integration-")));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,"repo"),vault=join(root,"vault"),cache=join(root,"cache"),worktrees=join(root,"worktrees");
  const {mkdirSync}=await import("node:fs");mkdirSync(repo);
  const git=async(...args)=>(await exec("git",["-C",repo,...args])).stdout;
  await git("init","-b","main");
  await git("-c","user.name=Fixture","-c","user.email=test@example.invalid","-c","commit.gpgsign=false","commit","--allow-empty","-m","Fixture");
  const env={...process.env, MISSION_BIN:bin,MISSION_VAULT:vault,MISSION_STATE_DIR:cache,HERDR_ENV:"1",HERDR_PANE_ID:"repo:p2",HERDR_WORKSPACE_ID:"repo"};
  // These fixtures act as the captain. An ambient subagent identity (the gate
  // runs inside a pi step agent) must not turn launches into a refusal.
  delete env.PI_SUBAGENT_NAME;
  // Parent credentials must not leak into requests or any spawned child.
  env.MISSION_TOKEN="unrelated-parent-token";env.MISSION_ATTEMPT="unrelated-parent-attempt";
  // The launch is the CLI's, so the fake covers what a session still asks
  // Herdr for: the workspaces and panes it binds on, and the desk's own split.
  const f={ env, hookFailures:0, hookIDs:[], reportFailures:0, reportRefusal:null, showFailures:0, reportCalls:[], workspaces:[], calls:[] };
  const run=async(binary,args,options={})=>{
    f.calls.push({binary,args,env:options.env});
    if(binary==="herdr") {
      const common=await f.bridge.common(repo);
      const flag=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
      let result;
      if(args[0]==="workspace") result={workspaces:[{workspace_id:"repo",worktree:{repo_key:common,is_linked_worktree:false}},...f.workspaces]};
      else if(args[0]==="pane" && args[1]==="split") {
        // The mission desk opens here: /missions splits a pane and runs the Go UI in it.
        result={pane:{pane_id:env.HERDR_PANE_ID+"-desk"}};
      }
      else {
        // `pane list` answers for every workspace at once, and for one workspace
        // when it is asked for it. Both the owner pane and a bystander pane ("-b"
        // suffix) sit in the mission checkout, so the fake answers for both even
        // when the caller carries a different HERDR_PANE_ID.
        const workspace=flag("--workspace"), here=!workspace||workspace===(f.paneWorkspace||"repo"), cwd=f.paneCwd||f.cwd;
        const wanted=options?.env?.HERDR_PANE_ID || env.HERDR_PANE_ID;
        result={panes:here?[
          {pane_id:env.HERDR_PANE_ID,workspace_id:workspace||"repo",cwd,foreground_cwd:cwd},
          {pane_id:env.HERDR_PANE_ID+"-b",workspace_id:workspace||"repo",cwd,foreground_cwd:cwd},
          ...(wanted&&wanted!==env.HERDR_PANE_ID&&wanted!==env.HERDR_PANE_ID+"-b"?[{pane_id:wanted,workspace_id:workspace||"repo",cwd,foreground_cwd:cwd}]:[]),
        ]:[]};
      }
      return JSON.stringify({result});
    }
    // A record the CLI cannot answer for: the session still runs, and the read
    // that breaks is the one the gate would otherwise trust.
    if(binary===bin && args.includes("show") && f.showFailures-->0)
      return JSON.stringify({ok:false,error:{code:"not_found",message:"mission vanished"}});
    if(binary===bin && args.includes("hook")) {
      f.hookIDs.push(args[args.indexOf("--event-id")+1]);
      if(f.hookFailures-->0) throw Error("Temporary CLI failure");
    }
    // A trooper report rides `progress --actor`; the fixture can lose one call
    // so the outbox retry is exercised against the real CLI, or refuse every
    // call with one CLI error code so the set-aside path is exercised.
    if(binary===bin && args.includes("progress")) {
      f.reportCalls.push(args);
      if(f.reportRefusal) return JSON.stringify({ok:false,error:{code:f.reportRefusal,message:"a judge progress needs --session-id naming the judge session"}});
      if(f.reportFailures-->0) throw Error("Temporary CLI failure");
    }
    return (await exec(binary,args,{encoding:"utf8",...options})).stdout;
  };
  f.bridge=new MissionBridge({env,run});
  await f.bridge.call(["repo","add","dotfiles","--checkout",repo]);
  const handle="dotfiles/session-progress";
  const args=["new",handle,"--title","Session progress","--goal","Preserve attempts","--kind","implementation","--step","Inspect hooks","--step","Implement recovery"];
  if(checkpoint)args.push("--checkpoint","S01:Review the evidence");
  await f.bridge.call(args);
  const r=await f.bridge.call(["workspace",handle,"--root",worktrees]);
  f.cwd=r.state.runtime.cwd;f.file=join(root,"existing.jsonl");
  writeFileSync(f.file,JSON.stringify({type:"session",id:"existing-pi",cwd:f.cwd})+"\n");
  f.ctx=context(f.cwd,f.file);f.handle=handle;f.repo=repo;f.run=run;f.vault=vault;f.cache=cache;
  return f;
}

test("existing session attaches, reports progress via CLI, and resumes across reload", needsCLI, async t=>{
  const f=await fixture(t,true), b=f.bridge;
  const claim=await b.action(f.ctx,{action:"attach",handle:f.handle});
  assert.ok(claim.artifact.endsWith("step-01.md"));assert.equal(claim.token,undefined);
  writeFileSync(claim.artifact,"Evidence from existing Pi session\n");
  const evidence="artifacts/001/step-01.md";
  await b.action(f.ctx,{action:"progress",status:"working",summary:"Mapped lifecycle hooks",next:"Test resume",evidence:[evidence]},"progress-stable");
  await b.action(f.ctx,{action:"progress",status:"working",summary:"Mapped lifecycle hooks",next:"Test resume",evidence:[evidence]},"progress-stable");
  const before=await b.call(["show",f.handle]);
  assert.equal(before.state.attempts[0].progress.length,1);assert.match(before.state.attempts[0].progress[0].evidence[0].hash,/^sha256:/);
  await b.end(f.ctx,{messages:[{role:"assistant",stopReason:"stop"}]});
  assert.equal((await b.current(f.ctx)).attempt.status,"running");
  await b.action(f.ctx,{action:"finish",summary:"Ready for review"});
  await b.settled(f.ctx,{aborted:true,outcome:"aborted"});
  assert.equal((await b.current(f.ctx)).attempt.status,"reported");
  await b.end(f.ctx,{messages:[{role:"assistant",stopReason:"stop"}]});
  assert.equal((await b.current(f.ctx)).attempt.status,"reported");
  await b.settled(f.ctx,{aborted:false,outcome:"completed"});
  let r=await b.call(["show",f.handle]);
  assert.equal(r.state.status,"waiting");assert.equal(r.state.pending_checkpoint,"C01");assert.equal(r.state.attempts[0].process_exited,false);
  assert.equal(readFileSync(join(f.vault,"6_missions",f.handle,r.state.attempts[0].transcript),"utf8"),readFileSync(f.file,"utf8"));
  await assert.rejects(b.action(f.ctx,{action:"next"}),/review_pending/);
  await b.call(["checkpoint",f.handle,"--id","C01","--decision","accept","--human","--actor","fixture-user","--note","Reviewed","--revision",String(r.state.revision)]);
  const next=await b.action(f.ctx,{action:"next"});assert.equal(next.step.id,"S02");assert.equal(next.cwd,claim.cwd);
  await b.record(f.ctx,{type:"session-end",summary:"Reload fixture"});
  const restored=new MissionBridge({env:f.env,run:f.run});
  await restored.restore(f.ctx);
  assert.equal(restored.hint.attempt,next.attempt);
  const replay=await restored.action(f.ctx,{action:"attach"});assert.equal(replay.attempt,next.attempt);
  const credential=join(f.cache,readdirSync(f.cache)[0]);
  assert.equal(statSync(credential).mode & 0o777,0o600);
  assert.ok(!JSON.stringify(claim).includes(restored.hint.token));
  for(const call of f.calls.filter(c=>c.binary===bin)) {
    assert.ok(!call.args.includes(restored.hint.token));assert.equal(call.env.MISSION_ATTEMPT,undefined);
  }
});

test("unacknowledged lifecycle outbox retries the original ID without duplication", needsCLI,async t=>{
  const f=await fixture(t);await f.bridge.action(f.ctx,{action:"attach",handle:f.handle});
  f.hookFailures=1;
  await assert.rejects(f.bridge.record(f.ctx,{type:"tool-start",tool:"bash",summary:"Call fixture"}),/unavailable/);
  const failedID=f.hookIDs.at(-1);
  const restored=new MissionBridge({env:f.env,run:f.run});await restored.restore(f.ctx);
  const r=await restored.call(["show",f.handle]);
  assert.equal(r.state.attempts[0].events.filter(e=>e.id===failedID).length,1);assert.equal(f.hookIDs.at(-1),failedID);
  assert.equal(restored.hint.outbox.length,0);
  await Promise.all([restored.record(f.ctx,{type:"tool-start",tool:"read",summary:"Call A"}),restored.record(f.ctx,{type:"tool-end",tool:"read",summary:"Call B"})]);
  const events=(await restored.call(["show",f.handle])).state.attempts[0].events;
  assert.equal(events.filter(e=>["Call A","Call B"].includes(e.summary)).length,2);
});

test("a finished subagent leaves one report and a reload adds no duplicate",needsCLI,async t=>{
  const f=await fixture(t);
  const factory=await loadFactory();
  const events={},tools={};
  const pi={on:(name,fn)=>{events[name]=fn},registerTool:tool=>{tools[tool.name]=tool},registerCommand:()=>{},sendMessage:()=>{}};
  const ctx={...f.ctx,hasUI:true,ui:{notify:()=>{},setStatus:()=>{}}};
  factory(pi,{env:f.env,run:f.run});
  await events.session_start({},ctx);
  const claim=await tools.mission.execute("attach",{action:"attach",handle:f.handle},null,null,ctx);
  assert.equal(claim.isError,undefined,claim.content?.[0]?.text);
  await events.message_end({message:trooperDone("trooper-S01")},ctx);
  let r=await f.bridge.call(["show",f.handle]);
  let reports=r.state.attempts[0].reports;
  assert.equal(reports.length,1);
  // The recorded name is the subagent's own, in rank case.
  assert.equal(reports[0].trooper,"trooper-S01");assert.equal(reports[0].status,"ready");
  assert.equal(reports[0].summary,"Mapped the lifecycle hooks and listed 12 calls.");
  assert.match(reports[0].at,/Z$/);
  // The completion reached the CLI as one progress call carrying the trooper.
  assert.equal(f.reportCalls[0][f.reportCalls[0].indexOf("--actor")+1],"trooper-S01");
  // Every other message in the session reports nothing.
  await events.message_end({message:{customType:"mission-context",content:"x"}},ctx);
  // The same trooper reported again — adopted at parent restart, or re-steered
  // into this session — is the same report, never a second row.
  await events.message_end({message:trooperDone("trooper-S01")},ctx);
  await events.message_end({message:trooperDone("trooper-S01","agent-gone")},ctx);
  r=await f.bridge.call(["show",f.handle]);
  assert.equal(r.state.attempts[0].reports.length,1);
  // A reload replays the record and appends nothing, including for a completion
  // the outbox already delivered.
  const restored=new MissionBridge({env:f.env,run:f.run});
  await restored.restore(ctx);
  assert.equal(restored.hint.outbox.length,0);
  await events.message_end({message:trooperDone("trooper-S01")},ctx);
  r=await f.bridge.call(["show",f.handle]);
  assert.equal(r.state.attempts[0].reports.length,1);
  // A judge step records the judge that finished, not the worker that spawned it.
  await events.message_end({message:trooperDone("sergeant-S01")},ctx);
  // A dead trooper is blocked and names its reason.
  await events.message_end({message:trooperDone("trooper-S02","error",{errorMessage:"provider overload"})},ctx);
  r=await f.bridge.call(["show",f.handle]);
  assert.deepEqual(r.state.attempts[0].reports.map(x=>[x.trooper,x.status]),[["trooper-S01","ready"],["sergeant-S01","ready"],["trooper-S02","blocked"]]);
  // The mission tool carries the actor too, so one call reports the trooper.
  const progress=await tools.mission.execute("progress-call",{action:"progress",status:"working",summary:"Reading the diff",actor:"trooper-S01"},null,null,ctx);
  assert.equal(progress.isError,undefined,progress.content?.[0]?.text);
  assert.equal(f.reportCalls.at(-1)[f.reportCalls.at(-1).indexOf("--actor")+1],"trooper-S01");
  r=await f.bridge.call(["show",f.handle]);
  // One row per trooper: the later call replaced trooper-S01's row in place.
  assert.deepEqual(r.state.attempts[0].reports.map(x=>[x.trooper,x.status]),[["trooper-S01","working"],["sergeant-S01","ready"],["trooper-S02","blocked"]]);
  await events.session_shutdown({},ctx);
});

test("a resumed trooper's report replaces the state it left behind",needsCLI,async t=>{
  const f=await fixture(t);
  const factory=await loadFactory();
  const events={},tools={};
  const pi={on:(name,fn)=>{events[name]=fn},registerTool:tool=>{tools[tool.name]=tool},registerCommand:()=>{},sendMessage:()=>{}};
  const ctx={...f.ctx,hasUI:true,ui:{notify:()=>{},setStatus:()=>{}}};
  factory(pi,{env:f.env,run:f.run});
  await events.session_start({},ctx);
  await tools.mission.execute("attach",{action:"attach",handle:f.handle},null,null,ctx);
  // The trooper dies of a provider error, then the human resumes the same
  // subagent session and it finishes the step.
  const blocked=trooperDone("trooper-S01","error",{errorMessage:"provider overload"});
  blocked.content=`Sub-agent "trooper-S01" failed after 2m (provider/agent error — auto-retry exhausted).\n\nError: provider overload\n\nThe subagent did not produce a result. You can retry by spawning a new subagent or resume the session with subagent_message.\n\nFollow up with subagent_message({ name: "trooper-S01", message: "…" })`;
  await events.message_end({message:blocked},ctx);
  let r=await f.bridge.call(["show",f.handle]);
  assert.deepEqual(r.state.attempts[0].reports.map(x=>[x.trooper,x.status]),[["trooper-S01","blocked"]]);
  const blockedID=f.reportCalls.at(-1)[f.reportCalls.at(-1).indexOf("--event-id")+1];
  // The resume is a second completion of the same trooper: a new report ID, so
  // the CLI records it instead of refusing it as a conflict, and the attempt
  // keeps one row holding the final state.
  await events.message_end({message:trooperDone("trooper-S01")},ctx);
  r=await f.bridge.call(["show",f.handle]);
  assert.deepEqual(r.state.attempts[0].reports.map(x=>[x.trooper,x.status,x.summary]),[["trooper-S01","ready","Mapped the lifecycle hooks and listed 12 calls."]]);
  assert.notEqual(f.reportCalls.at(-1)[f.reportCalls.at(-1).indexOf("--event-id")+1],blockedID);
  // The replaced row is not lost history: both completions stay in the
  // append-only progress stream.
  assert.deepEqual(r.state.attempts[0].progress.map(x=>x.status),["blocked","ready"]);
  await events.session_shutdown({},ctx);
});

test("an unacknowledged trooper report retries its original ID once",needsCLI,async t=>{
  const f=await fixture(t);
  await f.bridge.action(f.ctx,{action:"attach",handle:f.handle});
  f.reportFailures=1;
  await assert.rejects(f.bridge.report(f.ctx,trooperDone("trooper-S01")),/unavailable/);
  assert.equal(f.bridge.hint.outbox.length,1);
  const id=f.bridge.hint.outbox[0].report.id;
  const restored=new MissionBridge({env:f.env,run:f.run});
  await restored.restore(f.ctx);
  const r=await restored.call(["show",f.handle]);
  assert.equal(r.state.attempts[0].reports.length,1);
  assert.equal(r.state.attempts[0].reports[0].id,id);
  assert.equal(restored.hint.outbox.length,0);
  // Two delivery attempts, one report: the retry reused the original ID.
  assert.equal(f.reportCalls.filter(args=>args.includes(id)).length,2);
  assert.equal(f.reportCalls.at(-1)[f.reportCalls.at(-1).indexOf("--actor")+1],"trooper-S01");
});

test("a trooper that finishes after its attempt settled leaves no wedged outbox",needsCLI,async t=>{
  const f=await fixture(t);
  const c=await f.bridge.action(f.ctx,{action:"attach",handle:f.handle});
  writeFileSync(c.artifact,"Step evidence");
  await f.bridge.action(f.ctx,{action:"finish"});
  await f.bridge.settled(f.ctx,{aborted:false,outcome:"completed"});
  assert.equal((await f.bridge.call(["show",f.handle])).state.attempts[0].status,"succeeded");
  // The subagent finishes after the attempt closed: there is no attempt left to
  // report on, so the CLI refuses and the report leaves the outbox instead of
  // retrying forever.
  await f.bridge.report(f.ctx,trooperDone("trooper-S01-late"));
  assert.equal(f.bridge.hint.outbox.length,0);assert.equal(f.bridge.error,null);
  const r=await f.bridge.call(["show",f.handle]);
  assert.equal(r.state.attempts[0].reports,undefined);
});

/** A bridge over a fake CLI: no vault, no mux, no session, no live call. It
 *  records the argv one outbox item sends and answers with one canned reply, so
 *  the delivery rules are testable without a mission record. */
function outboxFixture(t, answer=()=>JSON.stringify({ok:true,data:{}})) {
  const dir=realpathSync(mkdtempSync(join(tmpdir(),"pi-mission-outbox-")));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const env={...process.env,MISSION_VAULT:join(dir,"vault"),MISSION_STATE_DIR:dir,MISSION_BIN:"/bin/mission"};
  delete env.PI_SUBAGENT_NAME;
  const calls=[];
  const bridge=new MissionBridge({env,run:async(binary,args)=>{calls.push({binary,args});return answer(args);}});
  const ctx={...context(join(dir,"work"),join(dir,"pi.jsonl")),cwd:join(dir,"work")};
  bridge.hint={handle:"dotfiles/judge-report",attempt:"attempt-1",token:"token",session:"existing-pi",vault:bridge.vault,outbox:[]};
  // The queue source is the ledger's answer, not the attach hint: a fake-CLI
  // bridge performs no ledger read, so the fixture states the one attempt the
  // ledger would list. `hint.attempt` alone queues nothing — that is the rule
  // a report must not escape.
  bridge.ledgerAttempt="attempt-1";
  return {bridge,ctx,calls,file:bridge.key(ctx)};
}

const USAGE_REFUSAL=()=>JSON.stringify({ok:false,error:{code:"usage",message:"a judge progress needs --session-id naming the judge session"}});

test("a judge report carries its own session; every other report keeps today's argv", async t => {
  const f=outboxFixture(t);
  // The CLI's rule, matched on both sides: a name with the judge prefix is a
  // judge, whatever its case, and nothing else is one.
  assert.equal(isJudge("judge-S02"),true);assert.equal(isJudge("Judge-S02"),true);assert.equal(isJudge("  judge-S02  "),true);
  for(const name of ["trooper-S01","sergeant-S01","",undefined,"adjudicator"]) assert.equal(isJudge(name),false,String(name));
  const summary="Mapped the lifecycle hooks and listed 12 calls.",next="Read the result in this session";
  const judgeMessage=trooperDone("judge-S02","done",{sessionId:"pi-judge-1",sessionFile:"/tmp/judge-S02.jsonl"});
  const judge=trooperReport(judgeMessage);
  // The identity the ID was hashed from travels with the report.
  assert.equal(judge.session,"pi-judge-1");assert.equal(judge.session_file,"/tmp/judge-S02.jsonl");
  await f.bridge.report(f.ctx,judgeMessage);
  assert.equal(f.bridge.hint.outbox.length,0);assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0].args,["--json","--vault",f.bridge.vault,"progress","dotfiles/judge-report","--attempt","attempt-1",
    "--event-id",judge.id,"--actor","judge-S02","--session-id","pi-judge-1","--session-file","/tmp/judge-S02.jsonl",
    "--status","ready","--summary",summary,"--next",next]);
  // A name without the judge prefix flushes exactly as it always did: no session
  // flags, so its fingerprint against the CLI does not change.
  const plainMessage=trooperDone("trooper-S01"),plain=trooperReport(plainMessage);
  assert.equal(plain.session,undefined);assert.equal(plain.session_file,"/tmp/trooper-S01.jsonl");
  await f.bridge.report(f.ctx,plainMessage);
  assert.deepEqual(f.calls[1].args,["--json","--vault",f.bridge.vault,"progress","dotfiles/judge-report","--attempt","attempt-1",
    "--event-id",plain.id,"--actor","trooper-S01","--status","ready","--summary",summary,"--next",next]);
});

test("a judge report with no session id is never queued and warns once", async t => {
  const f=outboxFixture(t,USAGE_REFUSAL);
  const nameless=trooperDone("judge-S02-final");
  assert.equal(trooperReport(nameless).session,undefined);
  await f.bridge.report(f.ctx,nameless);
  // The CLI refuses this report by design, so it never reaches the outbox ...
  assert.equal(f.bridge.hint.outbox.length,0);
  assert.equal(f.calls.length,0,"an undeliverable judge report makes no CLI call");
  // ... and the next tool result names the trooper, once.
  assert.deepEqual(f.bridge.takeNotices(),["1 report could not be recorded: judge-S02-final (usage)"]);
  assert.deepEqual(f.bridge.takeNotices(),[]);
  await f.bridge.report(f.ctx,nameless);
  assert.deepEqual(f.bridge.takeNotices(),[],"a replayed completion warns once");
});

test("a report refused three times leaves the outbox for the failed list", async t => {
  const f=outboxFixture(t,USAGE_REFUSAL);
  assert.equal(OUTBOX_FAILURE_LIMIT,3);assert.equal(FAILED_OUTBOX_LIMIT,20);
  assert.equal(outboxErrorCode("usage: a judge progress needs --session-id"),"usage");
  assert.equal(outboxErrorCode("Mission CLI returned invalid JSON"),"Mission CLI returned invalid JSON");
  const report=trooperReport(trooperDone("trooper-S01"));
  f.bridge.hint.outbox.push({attempt:"attempt-1",report});
  // A failure the extension has no rule for still retries while it may pass.
  for(let i=1;i<OUTBOX_FAILURE_LIMIT;i++) await assert.rejects(f.bridge.flush(f.ctx),/usage: a judge progress/);
  // The flush that sets it aside returns instead of failing the tool call.
  await f.bridge.flush(f.ctx);
  assert.equal(f.bridge.hint.outbox.length,0);
  const saved=JSON.parse(readFileSync(f.file,"utf8"));
  assert.equal(saved.outbox.length,0);assert.equal(saved.failed.length,1);
  assert.equal(saved.failed[0].report.trooper,"trooper-S01");assert.equal(saved.failed[0].failures,OUTBOX_FAILURE_LIMIT);
  assert.match(saved.failed[0].error,/^usage: /);
  assert.deepEqual(f.bridge.takeNotices(),["1 report could not be recorded: trooper-S01 (usage)"]);
  // The list is bounded: only the newest entries survive.
  for(let i=0;i<FAILED_OUTBOX_LIMIT+5;i++) f.bridge.setAside({attempt:"attempt-1",report:{...report,id:"trooper-"+i}},`io_error: ${i}`);
  assert.equal(f.bridge.hint.failed.length,FAILED_OUTBOX_LIMIT);
  assert.equal(f.bridge.hint.failed.at(-1).error,"io_error: 24");
});

test("a hook refused three times leaves the outbox and says a hook was lost", async t => {
  const io=()=>JSON.stringify({ok:false,error:{code:"io_error",message:"no such file"}});
  const f=outboxFixture(t,io);
  f.bridge.hint.outbox.push({attempt:"attempt-1",event:{id:"event-1",type:"tool-start",session_id:"existing-pi",
    session_file:"/tmp/pi.jsonl",summary:"Tool call call-1"}});
  for(let i=1;i<OUTBOX_FAILURE_LIMIT;i++) await assert.rejects(f.bridge.flush(f.ctx),/io_error: /);
  await f.bridge.flush(f.ctx);
  assert.equal(f.bridge.hint.outbox.length,0);
  const saved=JSON.parse(readFileSync(f.file,"utf8"));
  assert.equal(saved.failed.length,1);assert.equal(saved.failed[0].event.type,"tool-start");
  // A lost hook is never dropped silently: the ledger needed it, so it surfaces.
  assert.deepEqual(f.bridge.takeNotices(),["1 hook could not be recorded: tool-start (io_error)"]);
});

test("the tool call that sets an item aside succeeds and carries one line",needsCLI,async t=>{
  const f=await fixture(t);
  const factory=await loadFactory();
  const events={},tools={};
  const pi={on:(name,fn)=>{events[name]=fn},registerTool:tool=>{tools[tool.name]=tool},registerCommand:()=>{},sendMessage:()=>{}};
  const ctx={...f.ctx,hasUI:true,ui:{notify:()=>{},setStatus:()=>{}}};
  factory(pi,{env:f.env,run:f.run});
  await events.session_start({},ctx);
  const claim=await tools.mission.execute("attach",{action:"attach",handle:f.handle},null,null,ctx);
  assert.equal(claim.isError,undefined,claim.content?.[0]?.text);
  // The CLI refuses this report every time with an error the extension has no
  // rule for: the incident's own `usage` refusal.
  f.reportRefusal="usage";
  await events.message_end({message:trooperDone("trooper-S01")},ctx);
  const state=()=>JSON.parse(readFileSync(join(f.cache,readdirSync(f.cache).filter(n=>n.endsWith(".json"))[0]),"utf8"));
  assert.equal(state().outbox.length,1);
  // Two failed flushes still fail the editing tool call, exactly as before.
  assert.equal((await events.tool_call({toolName:"write"},ctx)).block,true);
  // The third sets the item aside, so the tool call runs.
  assert.equal(await events.tool_call({toolName:"write"},ctx),undefined);
  const flushed=state();
  assert.equal(flushed.outbox.length,0);
  assert.deepEqual(flushed.failed.map(x=>x.report.trooper),["trooper-S01"]);
  // Its result keeps what the tool returned and adds the one line, once.
  const result=await events.tool_result({toolCallId:"write-1",toolName:"write",isError:false,content:[{type:"text",text:"wrote"}],details:{path:"x"}},ctx);
  assert.equal(result.content[0].text,"wrote");
  // The patch names only the content: an omitted field keeps its value, so the
  // tool's own details still reach the transcript.
  assert.deepEqual(Object.keys(result),["content"]);
  assert.equal(result.content.at(-1).text,"1 report could not be recorded: trooper-S01 (usage)");
  assert.equal(await events.tool_result({toolCallId:"read-1",toolName:"read",isError:false,content:[{type:"text",text:"read"}]},ctx),undefined);
  await events.session_shutdown({},ctx);
});

test("failed checks retain ownership and successful correction settles it",needsCLI,async t=>{
  const f=await fixture(t);const c=await f.bridge.action(f.ctx,{action:"attach",handle:f.handle});
  await f.bridge.action(f.ctx,{action:"finish"});
  await assert.rejects(f.bridge.settled(f.ctx,{aborted:false,outcome:"completed"}),/missing_artifact/);
  assert.equal((await f.bridge.current(f.ctx)).attempt.id,c.attempt);
  writeFileSync(c.artifact,"Corrected output");
  await f.bridge.settled(f.ctx,{aborted:false,outcome:"completed"});
  const r=await f.bridge.call(["show",f.handle]);assert.equal(r.state.attempts[0].status,"succeeded");assert.equal(r.state.status,"ready");
});

test("the judge task hands the judge the artifact, the checks, and one capability path", () => {
  const task = judgeTask({ handle: "dotfiles/session-progress", attempt: "attempt-9", step: "S02",
    artifact: "/vault/6_missions/dotfiles/session-progress/artifacts/002/step-02.md", evidence: "artifacts/002/step-02.md",
    acceptance: "The verdict carries reasons.", checks: ["nonempty-artifact", "go-test"],
    capability: "/state/judges/h/attempt-9.token", vault: "/vault", binary: "/bin/mission", cwd: "/work" });
  // The judge is independent, and it is told what the step asks for.
  assert.match(task, /independent of the work subagent/);
  assert.match(task, /Artifact: \/vault\/6_missions\/dotfiles\/session-progress\/artifacts\/002\/step-02\.md/);
  assert.match(task, /Acceptance criteria: The verdict carries reasons\./);
  assert.match(task, /Check list: nonempty-artifact, go-test/);
  // The judge runs the CLI check run itself, through mission verify.
  assert.match(task, /"\/bin\/mission" --json --vault "\/vault" verify dotfiles\/session-progress --attempt attempt-9/);
  // The verdict lands in the existing progress fields with the artifact as evidence,
  // and a failed verdict takes the blocker branch.
  assert.match(task, /--event-id judge-attempt-9 --status ready --summary "verdict: pass/);
  assert.match(task, /--evidence artifacts\/002\/step-02\.md/);
  assert.match(task, /--status blocked --blocker/);
  assert.match(task, /do not call finish/);
  // The credential reaches the judge as a file path only.
  assert.match(task, /--token "\$\(cat '\/state\/judges\/h\/attempt-9\.token'\)"/);
  assert.doesNotMatch(task, /sha256/);
});

test("a judge subagent runs the checks itself and records its verdict in existing fields",needsCLI,async t=>{
  const f=await fixture(t),b=f.bridge;
  const claim=await b.action(f.ctx,{action:"attach",handle:f.handle});
  writeFileSync(claim.artifact,"Lifecycle hooks are attached.\n");
  // No active step, no judge: the task belongs to an attached attempt.
  const empty=new MissionBridge({env:f.env,run:f.run});
  await assert.rejects(empty.action(f.ctx,{action:"judge",handle:f.handle}),/Attach this session/);
  // The driver mints one judge task: the artifact, the criteria, the checks, and
  // a capability path. The attempt token is not in the result.
  const j=await b.action(f.ctx,{action:"judge",handle:f.handle});
  assert.equal(j.attempt,claim.attempt);assert.equal(j.step,"S01");
  assert.ok(j.artifact.endsWith("artifacts/001/step-01.md"));assert.equal(j.evidence,undefined);
  assert.deepEqual(j.checks,["nonempty-artifact"]);assert.equal(typeof j.acceptance,"string");
  assert.match(j.task,/Acceptance criteria: /);assert.match(j.task,/Check list: nonempty-artifact/);
  assert.equal(statSync(j.capability).mode & 0o777,0o600);
  assert.ok(!JSON.stringify(j).includes(b.hint.token));assert.ok(!j.task.includes(b.hint.token));
  assert.ok(j.task.includes(j.capability));assert.equal(j.name,"judge-S01");
  // The judge runs the CLI itself with that capability: the check run, then the
  // verdict with reasons, citing the artifact it read.
  const token=readFileSync(j.capability,"utf8").trim();
  assert.equal(token,b.hint.token);
  const cli=async(...args)=>(await exec(bin,["--json","--vault",f.vault,...args],{cwd:f.cwd,encoding:"utf8"})).stdout;
  const verify=JSON.parse(await cli("verify",f.handle,"--attempt",j.attempt,"--token",token));
  assert.equal(verify.data.passed,true);
  await cli("progress",f.handle,"--attempt",j.attempt,"--token",token,"--event-id","judge-"+j.attempt,
    "--status","ready","--summary","verdict: pass — the artifact states the hooks and it is not empty",
    "--evidence","artifacts/001/step-01.md");
  const a=(await b.call(["show",f.handle])).state.attempts[0];
  const verification=a.verifications.at(-1),verdict=a.progress.at(-1);
  // The finished step's record carries the verdict text with reasons plus the
  // check evidence the judge read.
  assert.match(verdict.summary,/verdict: pass — the artifact states the hooks/);
  assert.equal(verdict.evidence[0].path,"artifacts/001/step-01.md");
  assert.equal(verification.results[0].verdict,"passed");
  assert.ok(verification.results[0].evidence.length>=2);
  assert.match(verification.runner,/^mission\/checks@/);
  // The record keeps its shape: the judge fills existing fields only.
  assert.deepEqual(Object.keys(verification).sort(),["definition_hash","ended_at","id","results","runner","started_at","subject_hash"]);
  for(const c of verification.results) for(const key of Object.keys(c)) assert.ok(["at","check","evidence","summary","verdict","version"].includes(key),key);
  for(const key of Object.keys(verdict)) assert.ok(["at","evidence","id","next","status","summary","blocker"].includes(key),key);
  // state.md still carries that record and parses through the unchanged schema.
  const state=readFileSync(join(f.vault,"6_missions",f.handle,"state.md"),"utf8");
  assert.match(state,/^\s+verifications:/m);assert.match(state,/subject_hash:/);
  assert.deepEqual(Object.keys((await b.call(["show",f.handle])).state.attempts[0].verifications.at(-1)),Object.keys(verification));
  // The driver's own verify confirms that run and releases the one-shot capability.
  const confirmed=await b.action(f.ctx,{action:"verify",handle:f.handle});
  assert.equal(confirmed.verification.results[0].verdict,"passed");assert.equal(existsSync(j.capability),false);
  await b.action(f.ctx,{action:"finish",summary:"Judge recorded a pass with reasons"});
  await b.settled(f.ctx,{aborted:false,outcome:"completed"});
  const done=(await b.call(["show",f.handle])).state.attempts[0];
  assert.equal(done.status,"succeeded");assert.equal(done.progress.at(-1).id,"judge-"+done.id);
});

test("the driver's status answer is built from the ledger alone", () => {
  const record = { handle: "dotfiles/session-progress",
    mission: { title: "Session progress", steps: [{ id: "S01", title: "Inspect hooks" }, { id: "S02", title: "Implement recovery" }],
      checkpoints: [{ id: "C01", after: "S04", question: "Take over the touchpoint" }] },
    state: { status: "running", current_step: "S01", active_attempt: "attempt-1",
      steps: { S01: { status: "running" }, S02: { status: "pending" } },
      attempts: [{ id: "attempt-1", step: "S01", progress: [{ status: "working", summary: "Mapped hooks" }] }] } };
  const lines = driverStatus(record);
  assert.equal(lines[0], "Mission dotfiles/session-progress is running.");
  assert.equal(lines[1], "Running step S01 (Inspect hooks) under attempt attempt-1; last report: Mapped hooks.");
  assert.equal(lines[2], "Nothing has passed yet.");
  assert.equal(lines[3], "Next: S02 (Implement recovery).");
  // A held mission reads its review, its passed steps, and its blocker.
  const held = driverStatus({ ...record, state: { ...record.state, status: "waiting", active_attempt: "", pending_checkpoint: "C01",
    steps: { S01: { status: "passed" }, S02: { status: "passed" } },
    attempts: [{ id: "attempt-1", step: "S01", progress: [{ status: "blocked", summary: "Stopped", blocker: "The Herdr pane closed" }] }] } }).join("\n");
  assert.match(held, /Passed: S01 \(Inspect hooks\), S02 \(Implement recovery\)\./);
  assert.match(held, /Review C01 waits after S04: Take over the touchpoint/);
  assert.match(held, /Next: no step is left to run\./);
  assert.match(held, /Blocker: The Herdr pane closed/);
  assert.deepEqual(driverStatus(null), ["No mission record to report."]);
});

test("the driver answers a status prompt from the ledger and steers a step edit mid-flight",needsCLI,async t=>{
  const f=await fixture(t),b=f.bridge;
  const claim=await b.action(f.ctx,{action:"attach",handle:f.handle});
  writeFileSync(claim.artifact,"Lifecycle hooks are attached.\n");
  await b.action(f.ctx,{action:"progress",status:"working",summary:"Mapped lifecycle hooks",next:"Write the artifact"},"driver-status-report");
  // A scripted status prompt: every line is read from the ledger.
  const running=await b.action(f.ctx,{action:"status",handle:f.handle});
  const said=running.summary.join("\n");
  assert.equal(running.summary[0],`Mission ${f.handle} is ${running.state.status}.`);
  assert.equal(running.state.active_attempt,claim.attempt);
  assert.match(said,new RegExp(`Running step S01 \\(Inspect hooks\\) under attempt ${claim.attempt}; last report: Mapped lifecycle hooks\\.`));
  assert.match(said,/Next: S02 \(Implement recovery\)\./);
  // An edit while the attempt runs is refused, never forced: the driver must end
  // the attempt before the human's change can land.
  await assert.rejects(b.action(f.ctx,{action:"edit",handle:f.handle,step:"S02",acceptance:"Reviewed mid-flight"},"edit-busy"),/busy/);
  assert.equal((await b.call(["steps",f.handle])).find(v=>v.step.id==="S02").step.acceptance??"","");
  // The driver passes the running step, then reads the mission as ready.
  await b.action(f.ctx,{action:"finish",summary:"Hooks attached"});
  await b.settled(f.ctx,{aborted:false,outcome:"completed"});
  const ready=await b.action(f.ctx,{action:"status",handle:f.handle});
  assert.equal(ready.state.status,"ready");
  assert.match(ready.summary.join("\n"),/Passed: S01 \(Inspect hooks\)\./);
  assert.match(ready.summary.join("\n"),/Next: S02 \(Implement recovery\)\./);
  // The passed step is not reported as the current one.
  assert.doesNotMatch(ready.summary.join("\n"),/Current step/);
  // The human's mid-flight change lands through the existing edit command, and it
  // appears in the step list the driver reports back.
  const revision=ready.state.revision;
  const edited=await b.action(f.ctx,{action:"edit",handle:f.handle,step:"S02",acceptance:"Reviewed mid-flight",revision});
  assert.equal(edited.state.revision,revision+1);
  assert.equal((await b.action(f.ctx,{action:"steps",handle:f.handle})).find(v=>v.step.id==="S02").step.acceptance,"Reviewed mid-flight");
  // A stale revision is refused instead of overwriting the newer write.
  await assert.rejects(b.action(f.ctx,{action:"edit",handle:f.handle,step:"S02",acceptance:"Overwritten by a stale write",revision},"edit-stale"),/revision_conflict/);
  assert.equal((await b.action(f.ctx,{action:"steps",handle:f.handle})).find(v=>v.step.id==="S02").step.acceptance,"Reviewed mid-flight");
  // Admin: a failed step goes back to pending through the existing retry command.
  assert.equal((await b.action(f.ctx,{action:"next"})).step.id,"S02");
  await b.action(f.ctx,{action:"fail",summary:"Recovery needs a different approach"});
  await b.settled(f.ctx,{aborted:false,outcome:"completed"});
  const failed=await b.action(f.ctx,{action:"status",handle:f.handle});
  assert.equal(failed.state.status,"failed");
  assert.match(failed.summary.join("\n"),/Current step S02 \(Implement recovery\) is failed\./);
  assert.equal((await b.action(f.ctx,{action:"retry",handle:f.handle})).state.status,"ready");
  assert.equal((await b.call(["steps",f.handle])).find(v=>v.step.id==="S02").status,"pending");
});

test("an attached seat is a captain when it answers a launch intent", needsCLI, async t=>{
  const f=await fixture(t);
  // A session that attaches on its own is a trooper.
  const manual=await f.bridge.attach(f.ctx,f.handle,undefined,undefined);
  assert.equal(manual.handle,f.handle);
  const attachArgs=()=>f.calls.filter(c=>c.binary===bin&&c.args.includes("attach")).at(-1).args;
  assert.equal(attachArgs()[attachArgs().indexOf("--agent")+1],WORKER_AGENT,"a self-attached session is a trooper");
  // A launch intent means the brief this session answers is the captain brief,
  // so the attempt records the captain, not the trooper whose body it would
  // contradict.
  const launched=await fixture(t);
  await launched.bridge.attach(launched.ctx,launched.handle,"launch-fixture-1",undefined);
  const la=launched.calls.filter(c=>c.binary===bin&&c.args.includes("attach")).at(-1).args;
  assert.equal(la[la.indexOf("--agent")+1],CAPTAIN_AGENT);
  assert.equal((await launched.bridge.call(["show",launched.handle])).state.attempts[0].agent,CAPTAIN_AGENT);
});

test("a launch asks the CLI to deploy for this mux and adopts the runtime it records", async () => {
  // Seating has one owner now: the CLI. This session's job is to say which mux
  // it runs in, hand the launch over, and read the runtime back from
  // `mission show` — no Herdr worktree, tab, agent, or prompt of its own.
  const launch = async env => {
    const calls=[];
    const spawned=[];
    const runtime={launch_id:"launch-1",session_file:"/sessions/captain.jsonl",pane:"w1:p2",workspace:"w1"};
    const bridge=new MissionBridge({env:{MISSION_VAULT:"/vault",...env},
      // Any subprocess is a failure: a launch owns no mux command, so nothing
      // but the CLI may be spawned, and even that is stubbed through call().
      run:async binary=>{spawned.push(binary);throw Error(`a launch spawned ${binary}`)}});
    bridge.call=async args=>{
      calls.push(args);
      if(args[0]==="show") return {mission:{repo:"dotfiles"},state:{runtime}};
      if(args[0]==="repo") return [{slug:"dotfiles",checkouts:{[hostname()]:"/checkout"}}];
      if(args[0]==="workspace") return {state:{runtime:{cwd:"/checkout"}}};
      if(args[0]==="deploy") return {handle:"dotfiles/x",mux:args[args.indexOf("--mux")+1],focused:false,pane:"w1:p2"};
      throw Error(`the launch asked the CLI for ${args[0]}`);
    };
    const r=await bridge.start(context("/checkout","/checkout/s.jsonl"),"dotfiles/x");
    return {r,calls,spawned};
  };
  const herdr=await launch({HERDR_ENV:"1",HERDR_PANE_ID:"w1:p1",HERDR_WORKSPACE_ID:"w1"});
  const rex=await launch({REX_SESSION:"army",REX_BLOCK:"block:1"});
  // The mux is the environment's, and the deploy call names it.
  const deploy=calls=>calls.find(a=>a[0]==="deploy");
  assert.deepEqual(deploy(herdr.calls),["deploy","dotfiles/x","--mux","herdr"]);
  assert.deepEqual(deploy(rex.calls),["deploy","dotfiles/x","--mux","rex"]);
  // The launch is the CLI's: no reservation, no plan read, and no mux subprocess.
  for(const {calls,spawned} of [herdr,rex]) {
    assert.deepEqual(spawned,[],"a launch spawned a mux");
    for(const gone of ["launch","plan"]) assert.equal(calls.some(a=>a[0]===gone),false,`the extension still calls ${gone}`);
    assert.deepEqual(calls.map(a=>a[0]),["show","repo","workspace","deploy","show"]);
  }
  // The runtime is the record's, not one the launch guessed: `mission show` is
  // the read the seat reports back through.
  for(const {r} of [herdr,rex]) {
    assert.equal(r.launched,true);
    assert.equal(r.runtime.launch_id,"launch-1");
    assert.equal(r.session_file,"/sessions/captain.jsonl");
    assert.equal(r.pane,"w1:p2");assert.equal(r.workspace,"w1");
  }
});

test("a launch that found the captain already seated reports no second seat", async () => {
  // A repeat press focuses the live captain in the CLI. The extension reports it
  // as not launched, so the desk receipt says "already seated" instead of
  // claiming a launch that did not happen.
  const runtime={launch_id:"launch-1"};
  const bridge=new MissionBridge({env:{MISSION_VAULT:"/vault",HERDR_ENV:"1",HERDR_PANE_ID:"w1:p1"},
    run:async binary=>{throw Error(`a launch spawned ${binary}`)}});
  bridge.call=async args=>{
    if(args[0]==="show") return {mission:{repo:"dotfiles"},state:{runtime}};
    if(args[0]==="repo") return [{slug:"dotfiles",checkouts:{[hostname()]:"/checkout"}}];
    if(args[0]==="workspace") return {state:{runtime:{cwd:"/checkout"}}};
    if(args[0]==="deploy") return {handle:"dotfiles/x",focused:true};
    throw Error(`the launch asked the CLI for ${args[0]}`);
  };
  const r=await bridge.start(context("/checkout","/checkout/s.jsonl"),"dotfiles/x");
  assert.equal(r.launched,false);
  assert.match(r.reason,/already live/);
  assert.equal(r.runtime.launch_id,"launch-1");
});

test("a Rex block is a mission seat when it runs in the mission checkout", async t => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"pi-mission-rex-")));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const calls=[];
  // A Rex captain carries no Herdr pane, so any Herdr or Rex call would need a
  // live session: the cwd the block reports is the whole binding.
  const bridge=new MissionBridge({env:{REX_SESSION:"rex-session",REX_BLOCK:"block-1"},
    run:async binary=>{calls.push(binary);throw Error("no live session in a test")}});
  bridge.seatCwd=async()=>root;
  assert.deepEqual(await bridge.assertSurface(context(root,join(root,"session.jsonl"),"rex-pi")),{workspace:"rex-session",pane:"block-1"});
  assert.equal(bridge.surfaceSession,"rex-pi");assert.deepEqual(calls,[]);
});

test("a Rex block outside the mission checkout is refused with both paths", async t => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"pi-mission-rex-")));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const mission=join(root,"mission"),other=join(root,"other");mkdirSync(mission);mkdirSync(other);
  // A captain was refused in 57 ms and one sentence covered three causes; the
  // refusal now names the block, the directory it reports, and the session's.
  const bridge=new MissionBridge({env:{REX_SESSION:"rex-session",REX_BLOCK:"block-1"},
    run:async binary=>{
      if(binary==="rex") return JSON.stringify({pwd:"file://host"+other});
      throw Error(`a reported pwd needs no ${binary}`);
    }});
  await assert.rejects(bridge.assertSurface(context(mission,join(mission,"session.jsonl"))),(e)=>{
    assert.match(e.message,/Rex block block-1 reports/);
    assert.ok(e.message.includes(other),`names the block's directory: ${e.message}`);
    assert.ok(e.message.includes(mission),`names the session cwd: ${e.message}`);
    return true;
  });
  assert.equal(bridge.surfaceSession,null);
});

test("a session in no seat names both missing inputs and asks nothing", async () => {
  const calls=[];
  const bridge=new MissionBridge({env:{},run:async binary=>{calls.push(binary);throw Error("no seat to ask")}});
  await assert.rejects(bridge.assertSurface(context("/tmp",null)),(e)=>{
    assert.match(e.message,/no Herdr pane \(HERDR_PANE_ID empty\)/);
    assert.match(e.message,/no Rex block \(REX_BLOCK empty\)/);
    return true;
  });
  // Neither seat exists, so no probe runs: the environment is the whole answer.
  assert.deepEqual(calls,[]);
});

test("a Rex seat behind the login wrapper reads the cwd of the process it starts", async t => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"pi-mission-rex-login-")));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const calls=[];
  // `mission deploy` starts a captain through `/usr/bin/login`, and Rex reports
  // only two levels: both are the wrapper, so neither carries a cwd. The seat is
  // the process the wrapper starts, and only a process probe can name it.
  const bridge=new MissionBridge({env:{REX_SESSION:"rex-session",REX_BLOCK:"block-1"},run:async(binary,args)=>{
    calls.push([binary,...args]);
    // An older Rex, a dead block, or a block that refuses pwd: the process
    // probe is still the answer, and this one is behind the login wrapper.
    if(binary==="rex") {
      if(args.at(-1)==="pwd") throw Error("block call pwd refused");
      return JSON.stringify({foreground:{pid:34975,user:"root",name:"login",path:"/usr/bin/login"},child:{pid:34975,user:"root",name:"login",path:"/usr/bin/login"},home:"/Users/aviral"});
    }
    if(binary==="pgrep") return "34977\n";
    if(binary==="lsof") return `p34977\nfcwd\nn${root}\n`;
    if(binary==="readlink") return root+"\n";
    throw Error(`unexpected ${binary} in a Rex seat`);
  }});
  assert.equal(await bridge.seatCwd(),root);
  assert.deepEqual(await bridge.assertSurface(context(root,join(root,"session.jsonl"),"rex-pi")),{workspace:"rex-session",pane:"block-1"});
  assert.equal(bridge.surfaceSession,"rex-pi");
  // The probe asks the block for its pwd, then walks one level down to the
  // process the login wrapper started: nothing else is needed to bind the seat.
  assert.deepEqual([...new Set(calls.map(c=>JSON.stringify(c)))].sort(), [
    JSON.stringify(["pgrep","-P","34975"]),
    JSON.stringify(["rex","block","call","-b","block-1","pwd"]),
    JSON.stringify(["rex","block","call","-b","block-1","process"]),
    JSON.stringify(process.platform==="darwin"
      ? ["lsof","-a","-p","34977","-d","cwd","-Fn"]
      : ["readlink","/proc/34977/cwd"]),
  ].sort());
});

test("a login wrapper with no readable child cwd leaves the Rex seat unbound", async t => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"pi-mission-rex-login-")));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bridge=new MissionBridge({env:{REX_SESSION:"rex-session",REX_BLOCK:"block-1"},run:async(binary)=>{
    if(binary==="rex") return JSON.stringify({foreground:{pid:34975,name:"login"},child:{pid:34975,name:"login"}});
    if(binary==="pgrep") return "34977\n";
    // A process that names no cwd (or cannot be read) answers nothing at all.
    if(binary==="lsof"||binary==="readlink") return "";
    throw Error(`unexpected ${binary} in a Rex seat`);
  }});
  assert.equal(await bridge.seatCwd(),null);
  await assert.rejects(bridge.assertSurface(context(root,join(root,"session.jsonl"))),
    /Rex block block-1 reports no cwd, and this session runs in /);
  assert.equal(bridge.surfaceSession,null);
});

test("a block's own pwd answers the seat cwd and needs no process probe", async t => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"pi-mission-rex-pwd-")));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const calls=[];
  const bridge=new MissionBridge({env:{REX_SESSION:"rex-session",REX_BLOCK:"block-1"},run:async(binary,args)=>{
    calls.push([binary,...args]);
    // Rex reports the path on the block's own host, never a bare path.
    if(binary==="rex") return JSON.stringify({pwd:"file://captain-mac.local"+root});
    throw Error(`a reported pwd needs no ${binary} probe`);
  }});
  assert.equal(await bridge.seatCwd(),root);
  // One call, no `process`, no pgrep, no lsof: the block answered for itself.
  assert.deepEqual(calls,[["rex","block","call","-b","block-1","pwd"]]);
  assert.deepEqual(await bridge.assertSurface(context(root,join(root,"session.jsonl"),"rex-pi")),{workspace:"rex-session",pane:"block-1"});
});

test("a block whose pwd fails still binds through the process probe", async t => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"pi-mission-rex-pwd-fail-")));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const calls=[];
  const bridge=new MissionBridge({env:{REX_SESSION:"rex-session",REX_BLOCK:"block-1"},run:async(binary,args)=>{
    calls.push([binary,...args]);
    if(binary==="rex") {
      if(args.at(-1)==="pwd") throw Error("block call pwd failed");
      return JSON.stringify({foreground:{pid:75520,name:"node",cwd:root}});
    }
    throw Error(`a reported cwd needs no ${binary}`);
  }});
  assert.equal(await bridge.seatCwd(),root);
  assert.deepEqual(calls,[["rex","block","call","-b","block-1","pwd"],["rex","block","call","-b","block-1","process"]]);
  assert.deepEqual(await bridge.assertSurface(context(root,join(root,"session.jsonl"),"rex-pi")),{workspace:"rex-session",pane:"block-1"});
});

test("a seat cwd reads lsof on macOS and /proc on Linux, never both", async () => {
  const root="/repo/mission";
  const darwin=process.platform==="darwin",seen=[];
  const bridge=new MissionBridge({env:{REX_SESSION:"rex-session",REX_BLOCK:"block-1"},run:async(binary,args)=>{
    seen.push(binary);
    if(binary==="rex") {
      // This stub predates `pwd`: it answers every Rex call with the process
      // report, which names no pwd, so the walk below is what reads the seat.
      return JSON.stringify({foreground:{pid:10,name:"login"}});
    }
    if(binary==="pgrep") return "11\n";
    if(binary==="lsof") { assert.deepEqual(args,["-a","-p","11","-d","cwd","-Fn"]); return `p11\nfcwd\nn${root}\n`; }
    if(binary==="readlink") { assert.deepEqual(args,["/proc/11/cwd"]); return root+"\n"; }
    throw Error(`unexpected ${binary} in a Rex seat`);
  }});
  assert.equal(await bridge.seatCwd(),root);
  assert.equal(seen.includes("lsof"),darwin);
  assert.equal(seen.includes("readlink"),!darwin);
});

test("a Herdr pane still binds by pane cwd and never asks Rex", async t => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"pi-mission-herdr-")));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const calls=[];
  const bridge=new MissionBridge({env:{HERDR_ENV:"1",HERDR_PANE_ID:"repo:p2",REX_BLOCK:"block-1"},run:async(binary,args)=>{
    calls.push(binary);
    if(binary!=="herdr") throw Error(`unexpected ${binary} in a Herdr seat`);
    // One pane list covers every workspace, and the pane names its own: a
    // captain in the shared army workspace binds exactly as one in a worktree
    // workspace does.
    const result={panes:[{pane_id:"repo:p2",workspace_id:"army",cwd:root,foreground_cwd:root}]};
    return JSON.stringify({result});
  }});
  bridge.seatCwd=async()=>{throw Error("a Herdr seat never asks Rex")};
  assert.deepEqual(await bridge.assertSurface(context(root,join(root,"session.jsonl"),"herdr-pi")),{workspace:"army",pane:"repo:p2"});
  assert.equal(bridge.surfaceSession,"herdr-pi");assert.equal(calls.includes("rex"),false);
  assert.deepEqual(calls,["herdr"],"the binding is one pane list and no workspace walk");
});

test("a Herdr pane outside the mission checkout is refused by its own seat", async t => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"pi-mission-herdr-other-")));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const mission=join(root,"mission"),repo=join(root,"repo");mkdirSync(mission);mkdirSync(repo);
  const bridge=new MissionBridge({env:{HERDR_ENV:"1",HERDR_PANE_ID:"repo:p2",REX_BLOCK:"block-1"},run:async(binary,args)=>{
    if(binary!=="herdr") throw Error(`unexpected ${binary} in a Herdr seat`);
    const result={panes:[{pane_id:"repo:p2",workspace_id:"repo",cwd:repo,foreground_cwd:repo}]};
    return JSON.stringify({result});
  }});
  bridge.seatCwd=async()=>{throw Error("a Herdr seat never asks Rex")};
  await assert.rejects(bridge.assertSurface(context(mission,join(mission,"session.jsonl"))),(e)=>{
    assert.match(e.message,/Herdr pane repo:p2 reports/);
    assert.ok(e.message.includes(repo)&&e.message.includes(mission),`names both paths: ${e.message}`);
    assert.doesNotMatch(e.message,/Rex block/,`a Herdr refusal never reads as a Rex one: ${e.message}`);
    return true;
  });
  assert.equal(bridge.surfaceSession,null);
});

/** The seat one hook event reports, recorded without the CLI. The attempt the
 *  event names is the one the last ledger read listed, so the fixture sets that
 *  read's answer and not the persisted hint. */
async function recordedSeat(bridge, ctx, event = { type: "session-start", summary: "Pi session attached" }) {
  bridge.hint = { handle: "dotfiles/seat", attempt: "attempt-1", token: "token", outbox: [] };
  bridge.ledgerAttempt = "attempt-1";
  bridge.flush = async () => {};
  await bridge.record(ctx, event);
  const { pane_id, workspace_id } = bridge.hint.outbox.at(-1).event;
  return { pane_id, workspace_id };
}

test("a Rex seat reports its own workspace and block on every hook event", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-mission-event-rex-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bridge = new MissionBridge({ env: { REX_SESSION: "army", REX_BLOCK: "block:x", MISSION_STATE_DIR: join(root, "state") },
    run: async () => { throw Error("no live session in a test") } });
  bridge.seatCwd = async () => root;
  const ctx = context(root, join(root, "session.jsonl"), "rex-pi");
  assert.deepEqual(await bridge.assertSurface(ctx), { workspace: "army", pane: "block:x" });
  // The incident: Herdr variables are undefined in a Rex seat, so the CLI
  // refused every event with workspace_mismatch.
  assert.deepEqual(await recordedSeat(bridge, ctx), { pane_id: "block:x", workspace_id: "army" });
});

test("a Herdr seat keeps recording its own pane and workspace", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-mission-event-herdr-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bridge = new MissionBridge({ env: { HERDR_ENV: "1", HERDR_PANE_ID: "repo:p2", HERDR_WORKSPACE_ID: "w-mission",
    REX_SESSION: "army", REX_BLOCK: "block:x", MISSION_STATE_DIR: join(root, "state") },
    run: async () => { throw Error("no live session in a test") } });
  assert.deepEqual(await recordedSeat(bridge, context(root, join(root, "session.jsonl"), "herdr-pi")),
    { pane_id: "repo:p2", workspace_id: "w-mission" });
});

test("a hook event before any attach still names the Rex seat", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-mission-event-before-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // A moved session records before this process attaches: the environment is
  // the only seat there is, and it must not report an empty workspace.
  const bridge = new MissionBridge({ env: { REX_SESSION: "army", REX_BLOCK: "block:x", MISSION_STATE_DIR: join(root, "state") },
    run: async () => { throw Error("no live session in a test") } });
  assert.equal(bridge.surface, null);
  assert.deepEqual(await recordedSeat(bridge, context(root, join(root, "session.jsonl"), "rex-pi")),
    { pane_id: "block:x", workspace_id: "army" });
});

test("a caller-supplied seat field still wins over the default", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-mission-event-caller-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bridge = new MissionBridge({ env: { REX_SESSION: "army", REX_BLOCK: "block:x", MISSION_STATE_DIR: join(root, "state") },
    run: async () => { throw Error("no live session in a test") } });
  bridge.seatCwd = async () => root;
  const ctx = context(root, join(root, "session.jsonl"), "rex-pi");
  await bridge.assertSurface(ctx);
  assert.deepEqual(await recordedSeat(bridge, ctx, { type: "tool-start", workspace_id: "caller-workspace" }),
    { pane_id: "block:x", workspace_id: "caller-workspace" });
});

/** A captain environment: an ambient subagent identity (this suite can run
 *  inside a pi step agent) must not turn a launch into a refusal. */
const captainEnv = extra => { const env={...process.env,...extra}; delete env.PI_SUBAGENT_NAME; return env; };

/** The desk writes this file: one pending request per mission handle. */
function launchRequest(cache, handle, repo, extra={}) {
  const dir=join(cache,"launches");
  mkdirSync(dir,{recursive:true});
  const file=join(dir,handle.replaceAll("/","--")+".json");
  writeFileSync(file,JSON.stringify({handle,repo,requested_at:"2026-01-01T00:00:00Z",state:"pending",...extra},null,2)+"\n");
  return file;
}
test("a launch request is claimed once and started once", async t => {
  const cache=realpathSync(mkdtempSync(join(tmpdir(),"mission-launch-")));
  t.after(()=>rmSync(cache,{recursive:true,force:true}));
  const bridge=new MissionBridge({env:captainEnv({MISSION_STATE_DIR:cache}),run:async()=>"[]"});
  bridge.sessionRepo=async()=>"dotfiles";
  const starts=[];
  bridge.start=async(_ctx,handle)=>{starts.push(handle);return {launched:true,runtime:{launch_id:"launch-1"}}};
  const file=launchRequest(cache,"dotfiles/desk-launch","dotfiles");
  const pending=bridge.pendingLaunches();
  assert.equal(pending.length,1);assert.equal(pending[0].handle,"dotfiles/desk-launch");
  // Two sessions race the same request: the file moves out of "pending" once.
  assert.equal(bridge.claimLaunch(pending[0],"session-a"),true);
  assert.equal(bridge.claimLaunch(pending[0],"session-b"),false);
  assert.equal(bridge.pendingLaunches().length,0);
  // A claimed request is never swept, so the loser cannot start a worker.
  await bridge.sweepLaunches(context("/tmp","/tmp/pi"));
  assert.deepEqual(starts,[]);
  assert.equal(JSON.parse(readFileSync(file,"utf8")).claimed_by,"session-a");
});

test("one sweep starts one worker and leaves a started receipt", async t => {
  const cache=realpathSync(mkdtempSync(join(tmpdir(),"mission-launch-")));
  t.after(()=>rmSync(cache,{recursive:true,force:true}));
  const bridge=new MissionBridge({env:captainEnv({MISSION_STATE_DIR:cache}),run:async()=>"[]"});
  bridge.sessionRepo=async()=>"dotfiles";
  const starts=[];
  bridge.start=async(_ctx,handle)=>{starts.push(handle);return {launched:true,runtime:{launch_id:"launch-1"}}};
  const file=launchRequest(cache,"dotfiles/desk-launch","dotfiles");
  const ctx=context("/tmp","/tmp/pi");
  await bridge.sweepLaunches(ctx);
  await bridge.sweepLaunches(ctx);
  assert.deepEqual(starts,["dotfiles/desk-launch"]);
  const receipt=JSON.parse(readFileSync(file,"utf8"));
  assert.equal(receipt.state,"started");assert.equal(receipt.launch_id,"launch-1");
  // A second press after the receipt is a fresh request, and a fresh request
  // starts a second worker only when the desk asks for one.
  assert.equal(bridge.pendingLaunches().length,0);
});

test("a failing launch leaves a durable failed receipt and no retry", async t => {
  const cache=realpathSync(mkdtempSync(join(tmpdir(),"mission-launch-")));
  t.after(()=>rmSync(cache,{recursive:true,force:true}));
  const bridge=new MissionBridge({env:captainEnv({MISSION_STATE_DIR:cache}),run:async()=>"[]"});
  bridge.sessionRepo=async()=>"dotfiles";
  let calls=0;
  bridge.start=async()=>{calls++;throw Error("Herdr is not running")};
  const file=launchRequest(cache,"dotfiles/desk-launch","dotfiles");
  await bridge.sweepLaunches(context("/tmp","/tmp/pi"));
  await bridge.sweepLaunches(context("/tmp","/tmp/pi"));
  assert.equal(calls,1);
  const receipt=JSON.parse(readFileSync(file,"utf8"));
  assert.equal(receipt.state,"failed");assert.match(receipt.error,/Herdr is not running/);
});

test("a sweep leaves another repository's request alone", async t => {
  const cache=realpathSync(mkdtempSync(join(tmpdir(),"mission-launch-")));
  t.after(()=>rmSync(cache,{recursive:true,force:true}));
  const bridge=new MissionBridge({env:captainEnv({MISSION_STATE_DIR:cache}),run:async()=>"[]"});
  bridge.sessionRepo=async()=>"dotfiles";
  const starts=[];
  bridge.start=async(_ctx,handle)=>{starts.push(handle);return {launched:true,runtime:{}}};
  launchRequest(cache,"vault/other-work","vault");
  await bridge.sweepLaunches(context("/tmp","/tmp/pi"));
  assert.deepEqual(starts,[]);
  assert.equal(bridge.pendingLaunches().length,1);
});

/** A Herdr seat and a checkout family, the two values the desk records. */
function launchFixture(t, env) {
  const cache=realpathSync(mkdtempSync(join(tmpdir(),"mission-launch-")));
  t.after(()=>rmSync(cache,{recursive:true,force:true}));
  const bridge=new MissionBridge({env:{MISSION_STATE_DIR:cache,...env},run:async()=>"[]"});
  bridge.sessionRepo=async()=>"dotfiles";
  bridge.common=async()=>"/git/dotfiles";
  const starts=[];
  bridge.start=async(_ctx,handle)=>{starts.push(handle);
    return {launched:true,runtime:{launch_id:"launch-1"},workspace:"w42",pane:"w42:p1",session_file:"/tmp/worker.jsonl"}};
  return {bridge,cache,starts};
}
const seat=w=>({HERDR_ENV:"1",HERDR_WORKSPACE_ID:w,HERDR_PANE_ID:w+":p1"});

test("a request addressed to this workspace is claimed here", async t => {
  const f=launchFixture(t,seat("w67"));
  const file=launchRequest(f.cache,"dotfiles/desk-launch","dotfiles",
    {owner_workspace:"w67",owner_label:"w67:p1",owner_common:"/git/dotfiles"});
  await f.bridge.sweepLaunches(context("/tmp","/tmp/pi"));
  assert.deepEqual(f.starts,["dotfiles/desk-launch"]);
  const receipt=JSON.parse(readFileSync(file,"utf8"));
  assert.equal(receipt.state,"started");
  // The receipt names the Herdr agent the launch created, so the desk can show it.
  assert.equal(receipt.workspace,"w42");assert.equal(receipt.pane,"w42:p1");
});

test("a request addressed to a live workspace elsewhere waits for it", async t => {
  const f=launchFixture(t,seat("w67"));
  f.bridge.workspaceLive=async id=>id==="w9";
  launchRequest(f.cache,"dotfiles/desk-launch","dotfiles",{owner_workspace:"w9",owner_common:"/git/dotfiles"});
  await f.bridge.sweepLaunches(context("/tmp","/tmp/pi"));
  assert.deepEqual(f.starts,[]);
  assert.equal(f.bridge.pendingLaunches().length,1);
});

test("a dead address is adopted only inside the same checkout family", async t => {
  const f=launchFixture(t,seat("w67"));
  f.bridge.workspaceLive=async()=>false;
  launchRequest(f.cache,"dotfiles/foreign-family","dotfiles",{owner_workspace:"w9",owner_common:"/git/other"});
  launchRequest(f.cache,"dotfiles/own-family","dotfiles",{owner_workspace:"w9",owner_common:"/git/dotfiles"});
  await f.bridge.sweepLaunches(context("/tmp","/tmp/pi"));
  assert.deepEqual(f.starts,["dotfiles/own-family"]);
  assert.deepEqual(f.bridge.pendingLaunches().map(r=>r.handle),["dotfiles/foreign-family"]);
});

test("a captain that owns a mission still serves its workspace's request", async t => {
  const f=launchFixture(t,seat("w67"));
  f.bridge.hint={handle:"dotfiles/missions-desk-ui",attempt:"attempt-1",token:"token",outbox:[]};
  launchRequest(f.cache,"dotfiles/start-a-timer","dotfiles",{owner_workspace:"w67",owner_common:"/git/dotfiles"});
  await f.bridge.sweepLaunches(context("/tmp","/tmp/pi"));
  assert.deepEqual(f.starts,["dotfiles/start-a-timer"]);
});

test("a worker never launches another mission", async t => {
  const f=launchFixture(t,{...seat("w67"),PI_SUBAGENT_NAME:"mission-worker"});
  launchRequest(f.cache,"dotfiles/desk-launch","dotfiles",{owner_workspace:"w67",owner_common:"/git/dotfiles"});
  await f.bridge.sweepLaunches(context("/tmp","/tmp/pi"));
  assert.deepEqual(f.starts,[]);
  assert.equal(f.bridge.pendingLaunches().length,1);
});

/** Load the missions extension factory through jiti, exactly as pi does. */
async function loadFactory() {
  const {createRequire,default:Module}=await import("node:module");
  const {resolveJiti}=await import("../test-lib/jiti.mjs");const {jitiPath,nodePath}=resolveJiti();
  process.env.NODE_PATH=nodePath;Module._initPaths();
  const {createJiti}=createRequire(import.meta.url)(jitiPath);
  const imported=createJiti(import.meta.url,{interopDefault:true})("./index.ts");
  return imported.default || imported;
}

test("Pi factory callbacks use final settlement and block only finish at a review",needsCLI,async t=>{
  const f=await fixture(t,true);
  f.env.PI_SUBAGENT_AGENT="mission-worker";
  const factory=await loadFactory();
  const events={},tools={},commands={},notifications=[],statuses=new Map(),picks=[];
  const pi={on:(name,fn)=>{events[name]=fn},registerTool:t=>{tools[t.name]=t},registerCommand:(name,c)=>{commands[name]=c},sendMessage:()=>{throw Error("A review must not continue automatically")}};
  const ctx={...f.ctx,hasUI:true,ui:{notify:(s)=>notifications.push(s),setStatus:(k,v)=>statuses.set(k,v),select:async(_title,options)=>{picks.push(options);return options[0]}}};
  factory(pi,{env:f.env,run:f.run});
  assert.equal(tools.mission.exposure,"deferred");assert.ok(commands.missions);assert.ok(commands.mission);
  await events.session_start({},ctx);
  const c=await tools.mission.execute("attach-call",{action:"attach",handle:f.handle},null,null,ctx);
  assert.equal(c.isError,undefined);writeFileSync(c.details.artifact,"Factory integration evidence");
  const before=await events.before_agent_start({},ctx);
  assert.ok(before.message.content.includes("Inspect hooks"));
  assert.ok(!before.message.content.includes(JSON.parse(readFileSync(join(f.cache,readdirSync(f.cache)[0]),"utf8")).token));
  await events.agent_start({},ctx);
  await events.tool_execution_start({toolName:"write",toolCallId:"write-call"},ctx);
  await events.tool_execution_end({toolName:"write",toolCallId:"write-call",isError:false},ctx);
  await tools.mission.execute("finish-call",{action:"finish",summary:"Ready"},null,null,ctx);
  await events.agent_end({messages:[{role:"assistant",stopReason:"stop"}]},ctx);
  assert.equal((await f.bridge.call(["show",f.handle])).state.attempts[0].status,"reported");
  await events.agent_before_settle({outcome:"completed"},ctx);
  await events.agent_settled({aborted:false},ctx);
  const r=await f.bridge.call(["show",f.handle]);assert.equal(r.state.pending_checkpoint,"C01");assert.equal(r.state.attempts[0].settled,true);
  // A waiting review holds progression, not tools. Status decides, not the
  // active attempt: no attempt is active, yet every worker tool still passes.
  assert.equal(await events.tool_call({toolName:"bash"},ctx),undefined);
  assert.equal(await events.tool_call({toolName:"write"},ctx),undefined);
  assert.equal(await events.tool_call({toolName:"mission"},ctx),undefined);
  assert.equal(await events.tool_call({toolName:"grep"},ctx),undefined);
  // Only finish is refused, and the refusal names the review and the command.
  const finishBlock=await events.tool_call({toolName:"mission",input:{action:"finish"}},ctx);
  assert.equal(finishBlock.block,true);
  assert.match(finishBlock.reason,/Review C01 is waiting/);
  assert.match(finishBlock.reason,/mission checkpoint accept /);
  assert.equal(await events.tool_call({toolName:"mission",input:{action:"status"}},ctx),undefined);
  // /missions opens the Go desk in a Herdr pane and draws no picker of its own,
  // even while a review is waiting: the desk, not this pop-up, selects missions.
  await commands.missions.handler("",ctx);
  assert.ok(notifications.some(n=>n.includes("Mission desk opened in ")));
  assert.ok(f.calls.some(c=>c.binary==="herdr"&&c.args[0]==="pane"&&c.args[1]==="split"));
  assert.ok(f.calls.some(c=>c.binary==="herdr"&&c.args[1]==="run"&&c.args[3]===bin&&c.args.includes("ui")));
  assert.equal(picks.length,0);
  await events.session_shutdown({},ctx);
  assert.ok(statuses.get("mission").includes("waiting"));
  // A corrupted local cache must not silently turn an owned session into an
  // untracked writer on reload.
  writeFileSync(join(f.cache,readdirSync(f.cache)[0]),"invalid JSON");
  await events.session_start({},ctx);
  assert.equal((await events.tool_call({toolName:"write"},ctx)).block,true);
});

/** The driver contract: a launched seat attaches first, every seat carries the
 *  same duties, and a seat that answers no launch intent invents no id. Duty 3
 *  keeps the judge for every step and drops it only for a step whose cmd: check
 *  is the verdict; Duty 4 keeps the driver moving without a human nudge. */
test("the driver contract carries the advance duty and no empty launch id", () => {
  const launched = driverTask("dotfiles/contract", "launch-7");
  const attached = driverTask("dotfiles/contract");
  assert.match(launched, /launch_id=launch-7/);
  // A hand attach answers no launch intent: no attach line and no empty id.
  assert.doesNotMatch(attached, /launch_id/);
  assert.doesNotMatch(attached, /undefined/);
  for (const task of [launched, attached]) {
    assert.match(task, /Duty 1 — hold the claim/);
    assert.match(task, /Duty 2 — subagents do all step work/);
    // A step with no cmd: check still carries the judge duty.
    assert.match(task, /Duty 3 — subagents judge/);
    assert.match(task, /spawn one judge subagent/);
    assert.match(task, /When the step's checks include a cmd: check, the passed check is the verdict, so spawn no judge\./);
    assert.match(task, /Duty 4 — advance in the same turn: after a judge records a pass, spawn the next step's work subagent in that same turn/);
    assert.match(task, /A pending checkpoint is the only reason to stop between steps\./);
  }
});

/** A mission CLI and a Herdr pane that answer without a binary: the attach path
 *  reads `show`, replays `attach`, and records one `hook`, and the seat is one
 *  pane in this session's cwd. A replayed attach recovers the same attempt,
 *  exactly as the CLI does, so a second attach starts no second writer. */
function attachFixture(t) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"pi-mission-attach-")));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const cwd=join(root,"worktree");mkdirSync(cwd,{recursive:true});
  const file=join(root,"pi.jsonl");writeFileSync(file,"");
  const handle="dotfiles/attached";
  const session="attach-pi";
  const record={handle,mission:{title:"Attached",steps:[{id:"S01",title:"Inspect hooks"}]},
    state:{status:"ready",current_step:"S01",active_attempt:"",runtime:null,attempts:[]}};
  // The CLI renders the injected context from the ledger on every read: the step
  // brief, then the attempt line for the attempt the ledger lists now, and no id
  // at all when it lists none. This fixture renders the same text, so a test
  // asserts on what the extension injects and not on what it remembers.
  const attemptLine=()=>{
    const a=record.state.attempts.find(x=>x.id===record.state.active_attempt);
    return a ? `Attempt ${a.id} on step ${a.step} is ${a.status}.` : "No active attempt: the ledger lists none. Claim the step before editing.";
  };
  const driver=["Mission "+handle+" is ready."];
  const rendered=()=>`# Assigned step: S01 — Inspect hooks\n\nInspect the lifecycle hooks.\n\n${attemptLine()}\n`;
  const claimOf=a=>({handle,step:a.step,attempt:a,context:rendered(),driver,
    environment:{MISSION_ARTIFACT:join(root,"vault","artifact.md"),MISSION_BRIEF:join(root,"brief.md"),MISSION_ATTEMPT:a.id}});
  const env={MISSION_BIN:"mission-fake",MISSION_VAULT:join(root,"vault"),MISSION_STATE_DIR:join(root,"cache"),
    HERDR_ENV:"1",HERDR_PANE_ID:"pane-1",HERDR_WORKSPACE_ID:"ws-1"};
  const run=async(binary,args)=>{
    if(binary==="herdr") return JSON.stringify({result:{panes:[{pane_id:"pane-1",workspace_id:"ws-1",cwd,foreground_cwd:cwd}]}});
    const verb=args.find(a=>["show","attach","hook"].includes(a));
    if(verb==="show") return JSON.stringify({ok:true,data:{...record,context:rendered(),driver}});
    if(verb==="attach") {
      if(!record.state.active_attempt) {
        const a={id:"attempt-"+(record.state.attempts.length+1),step:"S01",status:"running",session_id:session,brief_snapshot:"Inspect the lifecycle hooks.",cwd};
        record.state.attempts.push(a);record.state.active_attempt=a.id;
      }
      record.state.runtime={session_id:session,cwd,session_file:file};
      return JSON.stringify({ok:true,data:claimOf(record.state.attempts.at(-1))});
    }
    if(verb==="hook") return JSON.stringify({ok:true,data:{}});
    throw Error("the attach path asked the CLI for "+args.slice(2).join(" "));
  };
  const ctx={cwd,sessionManager:{getSessionId:()=>session,getSessionFile:()=>file},
    hasUI:true,isIdle:()=>true,hasPendingMessages:()=>false,ui:{notify:()=>{},setStatus:()=>{}}};
  return {env,run,ctx,handle,record};
}

test("an attach carries the whole driver contract once and keeps later turns short",async t=>{
  const f=attachFixture(t);
  const factory=await loadFactory();
  const events={},tools={};
  const pi={on:(name,fn)=>{events[name]=fn},registerTool:tool=>{tools[tool.name]=tool},registerCommand:()=>{},sendMessage:()=>{}};
  factory(pi,{env:f.env,run:f.run});
  await events.session_start({},f.ctx);
  const attached=await tools.mission.execute("attach-call",{action:"attach",handle:f.handle},null,null,f.ctx);
  assert.equal(attached.isError,undefined,attached.content?.[0]?.text);
  // A seat that attached by hand hears the driver contract, not one fixed line:
  // every duty arrives with the attempt line and the step brief.
  const first=await events.before_agent_start({},f.ctx);
  assert.equal(first.message.customType,"mission-context");assert.equal(first.message.display,false);
  assert.match(first.message.content,/Inspect the lifecycle hooks\./);
  assert.match(first.message.content,/Duty 1 — hold the claim/);
  assert.match(first.message.content,/Duty 2 — subagents do all step work/);
  assert.match(first.message.content,/Duty 3 — subagents judge/);
  // A hand attach answers no launch intent, so no launch id is ever invented.
  assert.doesNotMatch(first.message.content,/launch_id/);
  // The following turn keeps the attempt line and the brief and repeats no duty.
  const next=await events.before_agent_start({},f.ctx);
  assert.match(next.message.content,/Inspect the lifecycle hooks\./);
  assert.doesNotMatch(next.message.content,/Duty 1 — hold the claim/);
  // A second attach replays the same attempt, so the contract is not stacked.
  await tools.mission.execute("attach-again",{action:"attach",handle:f.handle},null,null,f.ctx);
  const again=await events.before_agent_start({},f.ctx);
  assert.doesNotMatch(again.message.content,/Duty 1 — hold the claim/);
});

/** The contract rides the attach, once per attempt, and a waiting review is the
 *  one thing that stops the advance: the same settled ready state emits mission
 *  action=next only when no checkpoint waits. */
test("an attach carries the contract once and a waiting review stops the advance",async t=>{
  const f=attachFixture(t);
  const factory=await loadFactory();
  const events={},tools={},sent=[],notes=[];
  const pi={on:(name,fn)=>{events[name]=fn},registerTool:tool=>{tools[tool.name]=tool},registerCommand:()=>{},sendMessage:(message,options)=>sent.push({message,options})};
  f.ctx.ui={notify:(text,tone)=>notes.push({text,tone}),setStatus:()=>{}};
  factory(pi,{env:f.env,run:f.run});
  await events.session_start({},f.ctx);
  const attached=await tools.mission.execute("attach-call",{action:"attach",handle:f.handle},null,null,f.ctx);
  assert.equal(attached.isError,undefined,attached.content?.[0]?.text);
  // 1. An attach to a ready mission emits the whole contract, Duty 1 to Duty 4.
  const turn=async()=>{const r=await events.before_agent_start({},f.ctx);assert.equal(r.message.customType,"mission-context");return r.message.content};
  const contents=[await turn()];
  assert.match(contents[0],/Inspect the lifecycle hooks\./);
  for(const duty of ["Duty 1 — hold the claim","Duty 2 — subagents do all step work","Duty 3 — subagents judge","Duty 4 — advance in the same turn"])
    assert.match(contents[0],new RegExp(duty));
  assert.match(contents[0],/A pending checkpoint is the only reason to stop between steps\./);
  // 2. A second attach replays the same attempt, so the contract arrives once.
  const again=await tools.mission.execute("attach-again",{action:"attach",handle:f.handle},null,null,f.ctx);
  assert.equal(again.isError,undefined,again.content?.[0]?.text);
  contents.push(await turn());
  assert.match(contents[1],/Inspect the lifecycle hooks\./);
  assert.equal(contents.filter(c=>/Duty 1 — hold the claim/.test(c)).length,1,"the contract arrives one time");
  // 3. A mission with a pending checkpoint emits no advance instruction, even
  // though its state is ready and one step is still eligible to run.
  f.record.mission.steps.push({id:"S02",title:"Attach the hooks"});
  f.record.state.status="ready";
  f.record.state.steps={S01:{status:"passed"},S02:{status:"pending"}};
  f.record.state.pending_checkpoint="C01";
  await events.agent_settled({aborted:false,outcome:"completed"},f.ctx);
  assert.equal(sent.filter(s=>s.message?.customType==="mission-next").length,0,"a waiting review emits no advance instruction");
  // The same state without the waiting review does advance, so the silence above
  // is the checkpoint and not a settle path that never ran.
  delete f.record.state.pending_checkpoint;
  await events.agent_settled({aborted:false,outcome:"completed"},f.ctx);
  const advance=sent.filter(s=>s.message?.customType==="mission-next");
  assert.equal(advance.length,1);
  assert.match(advance[0].message.content,/Call mission action=next to pick up the next eligible step/);
  assert.deepEqual(notes,[]);
});

/** The injected context is the text the CLI rendered from the ledger for this
 *  read, so a re-claim is named by its new attempt id on the very next turn and
 *  a ledger that lists no attempt produces no attempt id at all — the two halves
 *  of the 2026-11-05 incident, where a captured attempt id outlived its claim. */
test("a re-claim is named by the new attempt and no turn names an unlisted one",async t=>{
  const f=attachFixture(t);
  const factory=await loadFactory();
  const events={},tools={};
  const pi={on:(name,fn)=>{events[name]=fn},registerTool:tool=>{tools[tool.name]=tool},registerCommand:()=>{},sendMessage:()=>{}};
  factory(pi,{env:f.env,run:f.run});
  await events.session_start({},f.ctx);
  await tools.mission.execute("attach-call",{action:"attach",handle:f.handle},null,null,f.ctx);
  const turn=async()=>{const r=await events.before_agent_start({},f.ctx);assert.equal(r.message.customType,"mission-context");return r.message.content};
  const first=await turn();
  assert.match(first,/Attempt attempt-1 on step S01 is running\./);
  // The owner dies and the step is claimed again: the ledger names attempt-2.
  f.record.state.attempts.at(-1).status="failed";
  f.record.state.active_attempt="";
  f.record.state.attempts.push({id:"attempt-2",step:"S01",status:"running",session_id:"attach-pi",cwd:f.ctx.cwd});
  f.record.state.active_attempt="attempt-2";
  const second=await turn();
  assert.match(second,/Attempt attempt-2 on step S01 is running\./,second);
  assert.doesNotMatch(second,/attempt-1/,second);
  // The incident shape: active_attempt survives, the attempt record does not.
  f.record.state.attempts=[];
  f.record.state.active_attempt="attempt-2";
  const lost=await turn();
  assert.doesNotMatch(lost,/attempt-\d/,lost);
  assert.match(lost,/No active attempt/,lost);
});

/** A queued line whose attempt the ledger stopped listing is dropped instead of
 *  wedging the outbox: the incident's outbox kept every later event behind one
 *  hook the CLI could never accept. The attempt a hook names is the one the last
 *  ledger read listed, never the value the persisted hint captured. */
test("a hook the ledger cannot take is dropped and a transient failure retries",async t=>{
  const f=attachFixture(t);
  const b=new MissionBridge({env:f.env,run:f.run});
  await b.restore(f.ctx);
  b.hint={handle:f.handle,token:"t",session:f.ctx.sessionManager.getSessionId(),vault:b.vault,attempt:"attempt-999",outbox:[]};
  b.surfaceSession=f.ctx.sessionManager.getSessionId();
  b.ledgerAttempt="attempt-1";
  b.call=async()=>{throw new Error("not_found: attempt attempt-1 not found")};
  await b.record(f.ctx,{type:"agent-start",summary:"Pi turn started"});
  assert.equal(b.hint.outbox.length,0,"the undeliverable hook is dropped");
  // The hint's captured id is never what a line names.
  b.call=async(_args)=>{throw new Error("io_error: the CLI is busy")};
  b.hint.outbox.push({attempt:"attempt-1",event:{id:"e1",type:"agent-start",summary:"Pi turn started"}});
  await assert.rejects(b.flush(f.ctx),/io_error/);
  assert.equal(b.hint.outbox.length,1,"a transient failure retries");
  assert.equal(b.hint.outbox[0].attempt,"attempt-1","the queued line names the ledger attempt");
  // A ledger that lists no attempt queues nothing at all.
  b.ledgerAttempt=null;
  await b.record(f.ctx,{type:"agent-start",summary:"Pi turn started"});
  assert.equal(b.hint.outbox.length,1,"nothing is queued without a listed attempt");
});

test("a broken tracking record blocks edits and warns on reads",needsCLI,async t=>{
  const f=await fixture(t);
  const factory=await loadFactory();
  const events={},tools={},notifications=[];
  const pi={on:(name,fn)=>{events[name]=fn},registerTool:t=>{tools[t.name]=t},registerCommand:()=>{},sendMessage:()=>{}};
  const ctx={...f.ctx,hasUI:true,ui:{notify:(text,tone)=>notifications.push({text,tone}),setStatus:()=>{}}};
  factory(pi,{env:f.env,run:f.run});
  await events.session_start({},ctx);
  await tools.mission.execute("attach-call",{action:"attach",handle:f.handle},null,null,ctx);
  // One lost hook leaves its retry in the outbox; the record this session reads
  // never recovers, so every tool call reports the break.
  f.hookFailures=1;
  await events.tool_execution_start({toolName:"read",toolCallId:"lost"},ctx);
  assert.ok(notifications.some(n=>/Mission tracking: /.test(n.text)),"the lost hook is reported");
  f.showFailures=99;
  for(const toolName of ["bash","read","grep"]) assert.equal(await events.tool_call({toolName},ctx),undefined,`${toolName} runs while tracking is broken`);
  assert.ok(notifications.some(n=>n.tone==="warning"&&/Mission tracking: /.test(n.text)));
  for(const toolName of ["write","edit"]) {
    const blocked=await events.tool_call({toolName},ctx);
    assert.equal(blocked.block,true,`${toolName} stays blocked`);assert.match(blocked.reason,/Mission tracking must recover before work continues/);
  }
  // A recovered record restores every tool again.
  f.showFailures=0;
  assert.equal(await events.tool_call({toolName:"write"},ctx),undefined);
  await events.session_shutdown({},ctx);
});

test("a closed mission still passes the session bash and edit tools",needsCLI,async t=>{
  const f=await fixture(t);
  const factory=await loadFactory();
  const events={},tools={},messages=[];
  const pi={on:(name,fn)=>{events[name]=fn},registerTool:tool=>{tools[tool.name]=tool},registerCommand:()=>{},sendMessage:(message,options)=>messages.push({message,options})};
  const ctx={...f.ctx,hasUI:true,ui:{notify:()=>{},setStatus:()=>{},select:async()=>undefined}};
  factory(pi,{env:f.env,run:f.run});
  await events.session_start({},ctx);
  // The attempt ends and settles, so the record holds no active attempt.
  const claim=await tools.mission.execute("attach-call",{action:"attach",handle:f.handle},null,null,ctx);
  writeFileSync(claim.details.artifact,"Closeout evidence");
  const finish=await tools.mission.execute("finish",{action:"finish",summary:"Ready for closeout"},null,null,ctx);
  assert.equal(finish.isError,undefined,finish.content?.[0]?.text);
  await events.agent_before_settle({outcome:"completed"},ctx);
  await events.agent_settled({aborted:false},ctx);
  const settled=await f.bridge.call(["show",f.handle]);
  assert.equal(settled.state.status,"ready");
  // The ship path closes the record before the worker reports its closeout.
  const closed=await f.bridge.call(["close",f.handle,"--force","--note","worktree retired by /cleanup"]);
  assert.equal(closed.status,"closed");
  // Lifecycle hooks still record on a retired mission, so tracking never turns
  // into a second block after the close.
  await events.tool_execution_start({toolName:"bash",toolCallId:"bash-after-close"},ctx);
  await events.tool_execution_end({toolName:"bash",toolCallId:"bash-after-close",isError:false},ctx);
  // Status alone decides: with no attempt left, every worker tool still passes.
  // A gate that reads "closed" as an open mission blocks bash here, and the
  // worker cannot clean up or report the mission it just shipped.
  for(const toolName of ["bash","edit","write","read","mission"])
    assert.equal(await events.tool_call({toolName},ctx),undefined,`${toolName} passes after close`);
  // The gate never guards the vault record; the CLI does. A closed record takes
  // no new work, so the mission stays retired after the worker cleans up.
  await assert.rejects(f.bridge.call(["claim",f.handle,"--agent","scout"]),/closed: mission/);
  assert.equal((await f.bridge.call(["show",f.handle])).state.status,"closed");
  await events.session_shutdown({},ctx);
});

test("preview launcher preserves this checkout's config and skill without global installation",needsCLI,async t=>{
  const root=mkdtempSync(join(tmpdir(),"mission-preview-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,"pi"),"#!/usr/bin/env node\nconsole.log(JSON.stringify({args:process.argv.slice(2),binary:process.env.MISSION_BIN,config:process.env.PI_CODING_AGENT_DIR}))\n",{mode:0o755});
  const script=fileURLToPath(new URL("../../../../../scripts/pi-missions",import.meta.url));
  const config=join(root,"private-config");
  const r=JSON.parse((await exec("bash",[script,"--session","/tmp/existing.jsonl"],{env:{...process.env,PATH:root+":"+process.env.PATH,MISSION_BIN:bin,MISSION_PREVIEW_DIR:config}})).stdout);
  assert.equal(r.binary,bin);assert.equal(r.config,config);assert.equal(statSync(config).mode&0o777,0o700);
  assert.ok(realpathSync(join(config,"extensions")).endsWith("/pi/.pi/agent/extensions"));
  assert.ok(JSON.parse(readFileSync(join(config,"settings.json"),"utf8")).defaultModel);
  assert.equal(r.args[0],"--skill");assert.ok(r.args[1].endsWith("/missions/SKILL.md"));assert.deepEqual(r.args.slice(2),["--session","/tmp/existing.jsonl"]);
});

test("owners continue eligible steps after attach; a foreign binding stays explicit",needsCLI,async t=>{
  const factory=await loadFactory();
  // Autonomy follows ownership, not launch identity: a session that attaches and
  // holds the binding continues eligible steps, whatever path brought it here.
  for(const mode of ["attached","launched","legacy"]) {
    const f=await fixture(t);delete f.env.PI_SUBAGENT_AGENT;if(mode==="legacy")f.env.PI_SUBAGENT_AGENT="mission-worker";
    const events={},tools={},messages=[];
    factory({on:(k,v)=>events[k]=v,registerTool:v=>tools[v.name]=v,registerCommand:()=>{},sendMessage:(message,options)=>messages.push({message,options})},{env:f.env,run:f.run});
    const ctx={...f.ctx,ui:{notify:()=>{},setStatus:()=>{}}};
    const params={action:"attach",handle:f.handle,...(mode==="launched"?{launch_id:"launch-1"}:{})};
    const claim=await tools.mission.execute("attach",params,null,null,ctx);
    // The factory builds its own bridge; read the persisted hint it wrote.
    const hintName=readdirSync(f.cache).find(n=>n.endsWith(".json")&&n!==""&&!n.startsWith("launch"));
    const hintFile=readFileSync(join(f.cache,hintName),"utf8");
    assert.equal(JSON.parse(hintFile).autoContinue,true,`${mode} owns the binding and continues`);
    writeFileSync(claim.details.artifact,"Step evidence");
    await tools.mission.execute("finish",{action:"finish"},null,null,ctx);
    await events.agent_before_settle({outcome:"completed"},ctx);
    await events.agent_settled({aborted:false},ctx);
    assert.equal(messages.length,1,`${mode} continues after a verified step`);
    assert.equal(messages[0].message.customType,"mission-next");
    assert.equal(messages[0].options.triggerTurn,true);
    assert.equal((await f.bridge.call(["show",f.handle])).state.status,"ready");
  }
  // A session that attaches while another session owns the binding never arms:
  // the refused attach sends no continuation.
  const f=await fixture(t);
  const squatter=new MissionBridge({env:f.env,run:f.run});
  writeFileSync(f.file+"-b",JSON.stringify({type:"session",id:"bystander-pi",cwd:f.cwd})+"\n");
  // The first attach takes the binding and arms, whatever path brought it here.
  const taken=await squatter.attach(context(f.cwd,f.file+"-b","bystander-pi"),f.handle);
  assert.equal(squatter.hint.autoContinue,true,"the first attach owns and arms");
  void taken;
  // A later session is refused and never arms.
  const stranger=new MissionBridge({env:f.env,run:f.run});
  writeFileSync(f.file+"-c",JSON.stringify({type:"session",id:"stranger-pi",cwd:f.cwd})+"\n");
  await assert.rejects(
    stranger.attach(context(f.cwd,f.file+"-c","stranger-pi"),f.handle),
    /Resume the existing Pi owner/,
  );
  assert.equal(stranger.hint?.autoContinue ?? false, false, "a refused attach never arms");
});

test("finished missions release every tool and stop the next-step prompt",needsCLI,async t=>{
  const factory=await loadFactory();
  const drive=async()=>{
    const f=await fixture(t);f.env.PI_SUBAGENT_AGENT="mission-worker";
    const events={},tools={},messages=[];
    factory({on:(k,v)=>events[k]=v,registerTool:v=>tools[v.name]=v,registerCommand:()=>{},sendMessage:(message,options)=>messages.push({message,options})},{env:f.env,run:f.run});
    const ctx={...f.ctx,ui:{notify:()=>{},setStatus:()=>{}}};
    return {f,events,tools,messages,ctx};
  };
  // A settled step leaves the mission "ready": changes wait for the next step.
  const a=await drive();
  const first=await a.tools.mission.execute("attach",{action:"attach",handle:a.f.handle},null,null,a.ctx);
  writeFileSync(first.details.artifact,"Step one evidence");
  await a.tools.mission.execute("finish",{action:"finish"},null,null,a.ctx);
  await a.events.agent_before_settle({outcome:"completed"},a.ctx);
  await a.events.agent_settled({aborted:false},a.ctx);
  assert.equal((await a.f.bridge.call(["show",a.f.handle])).state.status,"ready");
  assert.equal(a.messages.length,1);
  assert.match((await a.events.tool_call({toolName:"bash"},a.ctx)).reason,/No active mission step/);
  assert.equal(await a.events.tool_call({toolName:"grep"},a.ctx),undefined);
  // Picking up the next step authorizes changes again.
  const second=await a.tools.mission.execute("next",{action:"next"},null,null,a.ctx);
  assert.equal(await a.events.tool_call({toolName:"bash"},a.ctx),undefined);
  writeFileSync(second.details.artifact,"Step two evidence");
  await a.tools.mission.execute("finish",{action:"finish"},null,null,a.ctx);
  await a.events.agent_before_settle({outcome:"completed"},a.ctx);
  await a.events.agent_settled({aborted:false},a.ctx);
  // The last step ends the mission: every tool passes and nothing continues.
  assert.equal((await a.f.bridge.call(["show",a.f.handle])).state.status,"done");
  assert.equal(a.messages.length,1);
  assert.equal(await a.events.tool_call({toolName:"bash"},a.ctx),undefined);
  assert.equal(await a.events.tool_call({toolName:"write"},a.ctx),undefined);
  // A failed mission releases the gate the same way.
  const b=await drive();
  await b.tools.mission.execute("attach",{action:"attach",handle:b.f.handle},null,null,b.ctx);
  await b.tools.mission.execute("fail",{action:"fail",summary:"Blocked"},null,null,b.ctx);
  await b.events.agent_before_settle({outcome:"completed"},b.ctx);
  await b.events.agent_settled({aborted:false},b.ctx);
  assert.equal((await b.f.bridge.call(["show",b.f.handle])).state.status,"failed");
  assert.equal(b.messages.length,0);
  assert.equal(await b.events.tool_call({toolName:"bash"},b.ctx),undefined);
});

// The panel's view model is pure data: these fixtures need no CLI and no TUI.
const panelRecord = (handle, over = {}) => ({
  handle,
  mission: { title: "Mission panel", goal: "Render a mission inside Pi", kind: "implementation",
    steps: [{ id: "S01", title: "Build the panel" }, { id: "S02", title: "Wire the command" }],
    checkpoints: [{ id: "C01", after: "S01", kind: "human", question: "Is the layout right?" }] },
  state: { status: "ready", revision: 4, current_step: "S01", steps: { S01: { status: "pending" }, S02: { status: "pending" } },
    checkpoints: { C01: { status: "not_reached" } }, attempts: [] },
  ...over,
});
/** A mission held at C01: one attempt ended, the human is deciding. */
const waitingRecord = () => panelRecord("dotfiles/mission-panel", {
  state: { status: "waiting", revision: 6, current_step: "S01", pending_checkpoint: "C01",
    steps: { S01: { status: "passed" }, S02: { status: "pending" } }, checkpoints: { C01: { status: "pending" } },
    attempts: [{ id: "attempt-1352c80c9551e20f0c7f24c7", agent: "scout", status: "succeeded", step: "S01", started_at: "2026-01-01T00:00:00Z" }] },
});
/** A mission with a worker running for three minutes. */
const runningRecord = () => panelRecord("dotfiles/mission-panel", {
  state: { status: "running", revision: 5, current_step: "S01", active_attempt: "attempt-eeb113ecd3f57be11b04ca55",
    steps: { S01: { status: "running" }, S02: { status: "pending" } }, checkpoints: {},
    attempts: [{ id: "attempt-eeb113ecd3f57be11b04ca55", agent: "worker", status: "running", step: "S01",
      started_at: "2026-01-01T10:00:00Z", progress: [{ status: "working", blocker: "Waiting on the CI log" }] }] },
});
/** A mission whose last step passed. */
const doneRecord = () => panelRecord("dotfiles/mission-panel", {
  state: { status: "done", revision: 9, current_step: "S02", steps: { S01: { status: "passed" }, S02: { status: "passed" } },
    checkpoints: { C01: { status: "accepted" } },
    attempts: [{ id: "attempt-99c0ffee11223344556677", agent: "worker", status: "succeeded", step: "S02", started_at: "2026-01-01T09:00:00Z" }] },
});
const rowsOf = model => model.rows.map(row => [row.label, row.value, row.status]);
const keysOf = model => Object.fromEntries(model.keys.map(key => [key.action, key.enabled]));

test("the panel shows a pending review as a waiting row", () => {
  const model = buildPanelModel({ record: waitingRecord(), now: Date.parse("2026-01-01T00:05:00Z") });
  assert.equal(model.statusLine, "waiting · rev 6");
  assert.deepEqual(rowsOf(model), [
    ["Goal", "Render a mission inside Pi", ""],
    ["Step", "S01 · Build the panel", "passed"],
    ["Attempt", "attempt-1352 · scout", "succeeded"],
    ["Review", "C01 · Is the layout right?", "waiting"],
    ["Blocker", "none", ""],
  ]);
  // A hold on a checkpoint leaves the human one decision and no launch.
  assert.deepEqual(keysOf(model), { accept: true, revise: true, start: false, retry: false, open: true, close: true });
  assert.match(model.keys.find(key => key.action === "start").reason, /review is waiting/);
});

test("the panel shows a running attempt with its run time", () => {
  const model = buildPanelModel({ record: runningRecord(), now: Date.parse("2026-01-01T10:03:00Z") });
  assert.equal(model.statusLine, "running · rev 5");
  assert.deepEqual(rowsOf(model), [
    ["Goal", "Render a mission inside Pi", ""],
    ["Step", "S01 · Build the panel", "in progress"],
    ["Attempt", "attempt-eeb1 · worker", "running 3m"],
    ["Blocker", "Waiting on the CI log", ""],
  ]);
  // A live attempt disables every other action, and the key row stays whole.
  assert.deepEqual(keysOf(model), { accept: false, revise: false, start: false, retry: false, open: true, close: true });
  assert.match(model.keys.find(key => key.action === "retry").reason, /attempt is running/);
});

test("the panel shows a finished mission without empty rows", () => {
  const model = buildPanelModel({ record: doneRecord(), now: Date.parse("2026-01-01T10:03:00Z") });
  assert.equal(model.statusLine, "done · rev 9");
  assert.deepEqual(rowsOf(model), [
    ["Goal", "Render a mission inside Pi", ""],
    ["Step", "S02 · Wire the command", "passed"],
    ["Attempt", "attempt-99c0 · worker", "succeeded"],
    ["Blocker", "none", ""],
  ]);
  assert.deepEqual(keysOf(model), { accept: false, revise: false, start: false, retry: false, open: true, close: true });
  assert.match(model.keys.find(key => key.action === "start").reason, /no step to start/);
  // Every row states something: no labelled empty value ever reaches the panel.
  assert.ok(model.rows.every(row => row.label && row.value.length > 0));
});

test("an invalid action key is disabled, never hidden", () => {
  const model = buildPanelModel({ record: doneRecord(), now: Date.parse("2026-01-01T10:03:00Z") });
  const accept = model.keys.find(key => key.action === "accept");
  assert.equal(accept.enabled, false);
  assert.match(accept.reason, /no pending review/);
  assert.deepEqual(model.keys.map(key => key.key), ["a", "v", "s", "t", "o", "esc"]);
  assert.equal(actionForKey("a"), "accept");
  assert.equal(actionForKey("esc"), "close");
  assert.equal(actionForKey("z"), undefined);
  // The retry key stays visible and dim while the current step is not failed.
  assert.match(model.keys.find(key => key.action === "retry").reason, /not failed/);
});

test("a missing handle yields the error row instead of a throw", () => {
  const model = buildPanelModel({});
  assert.deepEqual(model.rows, []);
  assert.match(model.error, /handle is required/);
  assert.equal(model.keys.find(key => key.action === "accept").enabled, false);
  assert.equal(model.keys.find(key => key.action === "close").enabled, true);
  // A failed CLI call keeps its reason and the handle the human asked for.
  const missing = buildPanelModel({ handle: "dotfiles/ghost", error: "not_found: mission dotfiles/ghost not found" });
  assert.equal(missing.handle, "dotfiles/ghost");
  assert.match(missing.error, /not_found/);
  // A record with no mission and no state renders no labelled empty row.
  const bare = buildPanelModel({ record: { handle: "dotfiles/bare" } });
  assert.deepEqual(bare.rows.map(row => row.label), ["Blocker"]);
  assert.equal(bare.status, "unknown");
});

test("a review decision carries one stable command with no revision", () => {
  const record = waitingRecord();
  assert.deepEqual(checkpointArgs("dotfiles/mission-panel", record, { decision: "accept", note: "Layout reviewed" }),
    ["checkpoint", "accept", "dotfiles/mission-panel", "C01", "--note", "Layout reviewed"]);
  // The panel's own note names the surface that recorded the decision.
  const revise = checkpointArgs("dotfiles/mission-panel", record, { decision: "revise" });
  assert.match(revise[revise.indexOf("--note") + 1], /Revision requested in the Pi mission panel/);
  assert.throws(() => checkpointArgs("dotfiles/mission-panel", doneRecord(), { decision: "accept" }), /no pending review/);
  assert.throws(() => checkpointArgs("", record, { decision: "accept" }), /handle/);
  assert.throws(() => checkpointArgs("dotfiles/mission-panel", record, { decision: "reject" }), /accept or revise/);
});

test("the panel opens the mission desk in a Herdr pane", async () => {
  const calls = [];
  const bridge = new MissionBridge({ env: { ...process.env, HERDR_ENV: "1", MISSION_VAULT: "/tmp/panel-vault" },
    run: async (bin, args) => {
      calls.push({ bin, args });
      if (args[0] === "pane" && args[1] === "split") return JSON.stringify({ result: { pane: { pane_id: "w1:p9" } } });
      // `pane run` answers with no JSON, so the desk launch must not parse it.
      if (args[0] === "pane" && args[1] === "run") return "";
      throw Error("unexpected " + args.join(" "));
    } });
  assert.equal(await bridge.openDesk(), "w1:p9");
  assert.deepEqual(calls[0].args, ["pane", "split", "--current", "--direction", "right"]);
  assert.deepEqual(calls[1].args, ["pane", "run", "w1:p9", bridge.binary, "--vault", bridge.vault, "ui"]);
  // Outside Herdr the desk has no pane, so the caller notifies instead.
  const outside = new MissionBridge({ env: { ...process.env, HERDR_ENV: "0" } });
  await assert.rejects(outside.openDesk(), /Herdr pane/);
});

// The ask channel's fixtures: a vault with ask files, and a Rex seat that answers
// the role probe. No live mux and no mission CLI takes part.
function askVault(root, asks) {
  const vault = join(root, "vault");
  for (const ask of asks) {
    const dir = join(vault, "6_missions", ask.handle, "asks");
    mkdirSync(dir, { recursive: true });
    const { stamp = "20261105T191938.000000000Z", ...fields } = ask;
    writeFileSync(join(dir, `${stamp}-${ask.id}.json`), JSON.stringify({
      id: ask.id, handle: ask.handle, step: "S01", kind: "blocked", text: "A question.", at: "2026-11-05T19:19:38Z", ...fields,
    }, null, 2) + "\n");
  }
  return vault;
}
const rexSeat = windows => async (binary, args) => {
  assert.equal(binary, "rex", "the role probe reaches Rex, not the mission CLI");
  if (args[0] === "block" && args[1] === "inspect") return JSON.stringify({ block: { block_id: args[2], window_id: "window:cmd" } });
  if (args[0] === "window" && args[1] === "ls") return JSON.stringify({ windows });
  throw Error("unexpected rex call: " + args.join(" "));
};
function storedAsks(vault, handle) {
  const dir = join(vault, "6_missions", handle, "asks");
  return readdirSync(dir).map(name => JSON.parse(readFileSync(join(dir, name), "utf8")));
}

test("the commander drains each ask once and a second drain sends nothing", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-mission-asks-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = askVault(root, [
    { id: "ask-a", handle: "dotfiles/x", stamp: "20261105T191938.000000000Z", step: "S02", attempt: "attempt-1", kind: "blocked", text: "CI cannot reach the registry." },
    { id: "ask-b", handle: "dotfiles/y", stamp: "20261105T192000.000000000Z", step: "S01", kind: "question", text: "Which remote should I push to?" },
  ]);
  const sent = [];
  const inbox = new CommanderInbox({
    vault, env: { REX_SESSION: "session:army", REX_BLOCK: "block:cmd" },
    run: rexSeat([{ window_id: "window:cmd", label: "commander" }]),
    send: (message, options) => sent.push({ message, options }), now: () => "2026-11-05T19:21:00.000000000Z",
  });
  const delivered = await inbox.drain("commander-session");
  assert.deepEqual(delivered.map(ask => ask.id), ["ask-a", "ask-b"], "oldest first");
  // Two handles, two messages, each naming the handle, the step and the kind.
  assert.equal(sent.length, 2);
  assert.equal(sent[0].message.content, "[mission dotfiles/x · S02 · blocked] CI cannot reach the registry.");
  assert.equal(sent[1].message.content, "[mission dotfiles/y · S01 · question] Which remote should I push to?");
  assert.equal(sent[0].options.deliverAs, "followUp");
  // Delivery is recorded in the same file, so no restart can deliver it twice.
  for (const [handle, id] of [["dotfiles/x", "ask-a"], ["dotfiles/y", "ask-b"]]) {
    const ask = storedAsks(vault, handle).find(value => value.id === id);
    assert.equal(ask.delivered_at, "2026-11-05T19:21:00.000000000Z");
    assert.equal(ask.delivered_to, "commander-session");
    assert.equal(ask.step, id === "ask-a" ? "S02" : "S01", "delivery keeps the rest of the ask");
  }
  assert.deepEqual(await inbox.drain("commander-session"), []);
  assert.equal(sent.length, 2, "a delivered ask is never sent twice");
});

// Consecutive asks from one handle arrive as one message, so a captain that asks
// three things at once is one interruption rather than three.
test("consecutive asks from one handle arrive as one message", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-mission-asks-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = askVault(root, [
    { id: "ask-a", handle: "dotfiles/x", stamp: "20261105T191938.000000000Z", text: "Which branch?" },
    { id: "ask-b", handle: "dotfiles/x", stamp: "20261105T191939.000000000Z", text: "Which remote?" },
    { id: "ask-c", handle: "dotfiles/y", stamp: "20261105T191940.000000000Z", text: "Is the registry up?" },
  ]);
  const sent = [];
  const inbox = new CommanderInbox({
    vault, env: { REX_SESSION: "session:army", REX_BLOCK: "block:cmd" },
    run: rexSeat([{ window_id: "window:cmd", label: "commander" }]),
    send: message => sent.push(message.content),
  });
  assert.equal((await inbox.drain("commander-session")).length, 3);
  assert.equal(sent.length, 2);
  assert.equal(sent[0], "[mission dotfiles/x · S01 · blocked] Which branch?\n[mission dotfiles/x · S01 · blocked] Which remote?");
  assert.equal(sent[1], "[mission dotfiles/y · S01 · blocked] Is the registry up?");
});

// A captain's own pane is not the commander, so nothing is delivered there.
test("a session that is not the commander drains nothing", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-mission-asks-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = askVault(root, [{ id: "ask-a", handle: "dotfiles/x", text: "Which branch?" }]);
  const sent = [];
  const inbox = new CommanderInbox({
    vault, env: { REX_SESSION: "session:army", REX_BLOCK: "block:captain" },
    run: rexSeat([{ window_id: "window:captain", label: "captain-x" }]),
    send: message => sent.push(message.content),
  });
  assert.deepEqual(await inbox.drain("captain-session"), []);
  assert.deepEqual(sent, []);
  assert.equal(storedAsks(vault, "dotfiles/x")[0].delivered_at, undefined);
  // A Herdr session is never the Rex commander, and it probes no Rex at all.
  const herdr = new CommanderInbox({
    vault, env: { HERDR_ENV: "1", HERDR_PANE_ID: "w:p1", REX_SESSION: "session:army", REX_BLOCK: "block:cmd" },
    run: async () => { throw Error("a Herdr session must not probe Rex for the commander seat"); },
    send: message => sent.push(message.content),
  });
  assert.deepEqual(await herdr.drain("herdr-session"), []);
  assert.deepEqual(sent, []);
});

// A decision ask carries the exact checkpoint command that answers it.
test("a decision ask renders the checkpoint command", () => {
  assert.equal(askMessage([{ handle: "dotfiles/x", step: "S02", kind: "decision", text: "Accept the migration plan?" }]),
    "[mission dotfiles/x · S02 · decision] Accept the migration plan?\n" +
    'Answer with: mission checkpoint accept|revise dotfiles/x C01 --note "…"');
  assert.doesNotMatch(askMessage([{ handle: "dotfiles/x", step: "S02", kind: "blocked", text: "Stuck." }]), /checkpoint/);
});
