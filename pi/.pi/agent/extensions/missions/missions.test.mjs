// Paths: go/mission/**, pi/.pi/agent/extensions/missions/**, pi/.pi/agent/extensions/interactive-subagents/**, agents/.agents/skills/missions/**
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MissionBridge, agentCollisionReport, herdrError, missionContinues, missionToolBlock, quiescent, repositoryWorkspaces, takenAgentName, trackingFailureBlock, workerAgentName } from "./core.mjs";
import { actionForKey, buildPanelModel, checkpointArgs } from "./panel.mjs";
import { missionLaunchConfig } from "../interactive-subagents/pi-extension/subagents/mission-launch.mjs";

const exec = promisify(execFile);
/** The handle hash the launch appends to a taken agent name. */
const hashOf = text => createHash("sha256").update(text).digest("hex");
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

test("workspace lookup keeps every workspace of one repository lineage", () => {
  const records=[{workspace_id:"repo",worktree:{repo_key:"/git/repo",is_linked_worktree:false}}, {workspace_id:"mission-a",worktree:{repo_key:"/git/repo",is_linked_worktree:true}}, {workspace_id:"other",worktree:{repo_key:"/git/other",is_linked_worktree:false}}];
  assert.deepEqual(repositoryWorkspaces(records,"/git/repo").map(w=>w.workspace_id),["repo","mission-a"]);
  assert.deepEqual(repositoryWorkspaces(records,"/git/absent"),[]);
  assert.deepEqual(repositoryWorkspaces(undefined,"/git/repo"),[]);
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

test("agent-name helpers read the Herdr collision and stay inside the name limits", () => {
  const message='launch_failed: herdr agent: {"error":{"code":"agent_name_taken","message":"agent name pi is already used; candidates: pane_id=w8N:p1"},"id":"cli:agent:start"}';
  assert.equal(takenAgentName(message),"pi");
  assert.equal(takenAgentName("Acknowledgement lost"),null);
  assert.equal(takenAgentName(undefined),null);
  assert.equal(takenAgentName('herdr failed: {"code":"agent_pane_busy"}'),null);
  // A worker name comes from the mission handle, and Herdr accepts only 32
  // characters of [a-z0-9_-] that start with a letter.
  const name=workerAgentName("dotfiles/fix-review-ergonomics-stable-decisions-no-tool-lockout");
  assert.equal(name,"mission-fix-review-ergonomics-st");assert.equal(name.length,32);
  assert.equal(workerAgentName("dotfiles/"+ "x".repeat(80)),"mission-"+"x".repeat(24));
  assert.equal(workerAgentName(""),"mission-mission");
  const hashed=workerAgentName("dotfiles/fix-review","a1b2c3d4e5f6");
  assert.equal(hashed,"mission-fix-review-a1b2c3");assert.match(hashed,/^[a-z][a-z0-9_-]*$/);
  assert.match(agentCollisionReport("pi",{pane_id:"w8N:p1",agent_status:"working",cwd:"/w/mission-a"},"Act."),/name "pi" is held by pane w8N:p1 \(status working, cwd \/w\/mission-a\)\. Act\./);
  assert.match(agentCollisionReport("pi",null,"Act."),/unknown pane/);
  // A failed Herdr call keeps its code and message without the process noise.
  assert.equal(herdrError('Command failed: herdr agent wait\n{"error":{"code":"timeout","message":"agent did not match"}}'),"timeout: agent did not match");
  assert.equal(herdrError("Herdr is not running"),"Herdr is not running");
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
  const f={ env, hookFailures:0, hookIDs:[], tabs:[], worktrees:[], workspaces:[], calls:[], agents:[], agentCalls:[], started:[], taken:new Set(), startErrors:[], prompts:[], waitError:null, promptError:null, sessionFile:null, paneAgents:{} };
  /** The Herdr failure envelope herdr prints on stderr when a call fails. */
  const herdrFails=(code,message)=>Error(`Command failed: herdr agent\n${JSON.stringify({error:{code,message},id:"cli:agent:start"})}`);
  const takenErr=name=>herdrFails("agent_name_taken",`agent name ${name} is already used; candidates: pane_id=w-other:p1 workspace_id=w-other status=working`);
  const run=async(binary,args,options={})=>{
    f.calls.push({binary,args,env:options.env});
    if(binary==="herdr") {
      const common=await f.bridge.common(repo);
      const flag=name=>args[args.indexOf(name)+1];
      let result;
      if(args[0]==="workspace") result={workspaces:[{workspace_id:"repo",worktree:{repo_key:common,is_linked_worktree:false}},...f.workspaces]};
      else if(args[0]==="worktree") {
        f.worktrees.push(args);
        const path=flag("--path");
        let ws=f.workspaces.find(w=>w.worktree.checkout_path===path);
        const already_open=Boolean(ws);
        if(!ws) { ws={workspace_id:"w-mission",worktree:{repo_key:common,is_linked_worktree:true,checkout_path:path}}; f.workspaces.push(ws); }
        result={type:"worktree_opened",already_open,workspace:ws,worktree:{path},root_pane:{pane_id:ws.workspace_id+":p1",workspace_id:ws.workspace_id}};
      }
      else if(args[0]==="tab") { f.tabs.push(args); const workspace=flag("--workspace"); result={root_pane:{pane_id:workspace+":p2",workspace_id:workspace}}; }
      else if(args[0]==="agent") {
        f.agentCalls.push(args);
        const target=args[2];
        if(args[1]==="start") {
          if(f.startErrors.length) throw f.startErrors.shift();
          if(f.taken.has(target)) throw takenErr(target);
          f.started.push(target); result={agent:{name:target,pane_id:target}};
        }
        else if(args[1]==="wait") { if(f.waitError) throw f.waitError; result={agent:{agent_status:"idle",pane_id:target}}; }
        else if(args[1]==="prompt") { if(f.promptError) throw f.promptError; f.prompts.push({pane:target,text:args[3]}); result={agent:{agent_status:"working",pane_id:target}}; }
        else if(args[1]==="get") result={agent:{name:f.started.at(-1),agent_status:"working",pane_id:target,agent_session:{value:f.sessionFile}} };
        else if(args[1]==="list") result={agents:f.agents};
        else result={agent:{name:target}};
      }
      else if(args[0]==="pane" && args[1]==="get") {
        result={pane:{pane_id:args[2],agent:f.paneAgents[args[2]]??null}};
      }
      else if(args[0]==="pane" && args[1]==="split") {
        // The mission desk opens here: /missions splits a pane and runs the Go UI in it.
        result={pane:{pane_id:env.HERDR_PANE_ID+"-desk"}};
      }
      else {
        const workspace=flag("--workspace"), here=workspace===(f.paneWorkspace||"repo"), cwd=f.paneCwd||f.cwd;
        result={panes:here?[{pane_id:env.HERDR_PANE_ID,cwd,foreground_cwd:cwd}]:[]};
      }
      return JSON.stringify({result});
    }
    if(binary===bin && args.includes("hook")) {
      f.hookIDs.push(args[args.indexOf("--event-id")+1]);
      if(f.hookFailures-->0) throw Error("Temporary CLI failure");
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
  // The launched worker writes its own session file; the fixture reports this
  // one from `agent get`.
  f.sessionFile=f.file;
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

test("failed checks retain ownership and successful correction settles it",needsCLI,async t=>{
  const f=await fixture(t);const c=await f.bridge.action(f.ctx,{action:"attach",handle:f.handle});
  await f.bridge.action(f.ctx,{action:"finish"});
  await assert.rejects(f.bridge.settled(f.ctx,{aborted:false,outcome:"completed"}),/missing_artifact/);
  assert.equal((await f.bridge.current(f.ctx)).attempt.id,c.attempt);
  writeFileSync(c.artifact,"Corrected output");
  await f.bridge.settled(f.ctx,{aborted:false,outcome:"completed"});
  const r=await f.bridge.call(["show",f.handle]);assert.equal(r.state.attempts[0].status,"succeeded");assert.equal(r.state.status,"ready");
});

test("a launch starts one full agent in the mission pane",needsCLI,async t=>{
  const f=await fixture(t);
  // The launch needs no subagent extension: the worker is a full Pi agent.
  assert.equal(globalThis.__pi_interactive_subagents,undefined);
  const r=await f.bridge.start(context(f.repo,f.file),f.handle);assert.equal(r.launched,true);
  const launch=(await f.bridge.call(["show",f.handle])).state.runtime.launch_id;
  // The whole worker launch: a mission-derived name, one readiness wait, one
  // task prompt, and one session read.
  assert.deepEqual(f.agentCalls,[
    ["agent","start","mission-session-progress","--kind","pi","--pane","w-mission:p1"],
    ["agent","wait","w-mission:p1","--until","idle","--timeout","60000"],
    ["agent","prompt","w-mission:p1",`Work on mission ${f.handle}. Before reading or editing repository files, call mission with action=attach, handle=${f.handle}, launch_id=${launch}. Then follow the returned step brief and the missions skill. Report structured progress. Write the required artifact and call finish when the step is ready. Stop at checkpoints; keep this session and worktree for later steps.`],
    ["agent","get","w-mission:p1"],
  ]);
  // The agent session file is recorded on the launch.
  assert.equal(r.session_file,f.file);
  assert.equal((await f.bridge.call(["show",f.handle])).state.runtime.session_file,realpathSync(f.file));
  // No subagent environment and no loadout travels to the worker.
  const sent=JSON.stringify(f.calls.filter(c=>c.binary==="herdr").map(c=>c.args));
  assert.equal(sent.includes("PI_SUBAGENT"),false);assert.equal(sent.includes("loadout"),false);
});

test("no subagent extension is needed to start a mission",needsCLI,async t=>{
  const f=await fixture(t);
  const saved=globalThis.__pi_interactive_subagents;delete globalThis.__pi_interactive_subagents;
  try {
    const r=await f.bridge.start(context(f.repo,f.file),f.handle);
    assert.equal(r.launched,true);assert.deepEqual(f.started,["mission-session-progress"]);
  } finally {if(saved!==undefined)globalThis.__pi_interactive_subagents=saved}
});

test("mission launch registers a Herdr worktree and adopts its workspace",needsCLI,async t=>{
  const f=await fixture(t);
  const r=await f.bridge.start(context(f.repo,f.file),f.handle);assert.equal(r.launched,true);
  // The worker inherits the pane environment, so no parent credential travels
  // in any Herdr argument.
  assert.equal(JSON.stringify(f.calls.filter(c=>c.binary==="herdr").map(c=>c.args)).includes("unrelated-parent-token"),false);
  // One launch keeps one reservation, one worktree open, and one agent.
  assert.equal(f.calls.filter(c=>c.binary===bin&&c.args.includes("launch")&&!c.args.includes("--session-file")).length,1);
  assert.equal(f.worktrees.length,1);assert.equal(f.started.length,1);
  // The mission branch is mission/<slug>, and Herdr owns that checkout as its
  // own linked worktree workspace, anchored on the primary checkout.
  const runtime=(await f.bridge.call(["show",f.handle])).state.runtime;
  assert.equal(runtime.branch,"mission/session-progress");
  assert.deepEqual(f.worktrees[0].slice(0,3),["worktree","open","--cwd"]);
  assert.equal(f.worktrees[0][3],f.repo);assert.equal(f.worktrees[0][f.worktrees[0].indexOf("--path")+1],f.cwd);
  assert.ok(f.worktrees[0].includes("--no-focus"));
  // A fresh worktree workspace hosts the worker in its first tab — no extra tab.
  assert.equal(f.tabs.length,0);assert.equal(f.agentCalls[0][6],"w-mission:p1");assert.equal(r.workspace,"w-mission");
  // The mission session is accepted as a pane of that worktree workspace, and
  // still refused when its cwd is not the mission checkout.
  f.paneWorkspace="w-mission";
  assert.deepEqual(await f.bridge.assertSurface(f.ctx),{workspace:"w-mission",pane:f.env.HERDR_PANE_ID});
  await assert.rejects(f.bridge.assertSurface({...f.ctx,cwd:f.repo}),/mission worktree/);
  f.paneWorkspace="repo";
  const again=await f.bridge.start(context(f.repo,f.file),f.handle);assert.equal(again.launched,false);assert.equal(f.started.length,1);
});

test("an already open mission workspace gets its own launch tab",needsCLI,async t=>{
  const f=await fixture(t);
  // The human already opened the mission worktree as a workspace: relanding on
  // its parked first tab could take over that pane, so a launch takes a new tab.
  f.workspaces.push({workspace_id:"w-open",worktree:{repo_key:await f.bridge.common(f.repo),is_linked_worktree:true,checkout_path:f.cwd}});
  const r=await f.bridge.start(context(f.repo,f.file),f.handle);assert.equal(r.launched,true);
  assert.equal(f.worktrees.length,1);assert.equal(f.agentCalls[0][6],"w-open:p2");
  assert.deepEqual(f.tabs[0].slice(0,4),["tab","create","--workspace","w-open"]);
  assert.equal(f.tabs[0][f.tabs[0].indexOf("--cwd")+1],f.cwd);
  assert.ok(f.tabs[0].includes("--no-focus"));
});

test("a taken name takes a hashed name once and never renames the holder",needsCLI,async t=>{
  const f=await fixture(t);
  // Herdr keeps one name per server. Another mission's session can hold the
  // plain name, so the launch takes a hashed name instead of renaming it.
  const holder={name:"mission-session-progress",pane_id:"w-other:p1",workspace_id:"w-other",agent_status:"working"};
  f.agents.push(holder);f.taken.add(holder.name);
  const r=await f.bridge.start(context(f.repo,f.file),f.handle);assert.equal(r.launched,true);
  const retry=f.started[0];
  assert.equal(retry,workerAgentName(f.handle,hashOf(f.handle)));
  assert.match(retry,/^mission-session-progress-[0-9a-f]{6}$/);
  assert.deepEqual(f.agentCalls.slice(0,2),[
    ["agent","start","mission-session-progress","--kind","pi","--pane","w-mission:p1"],
    ["agent","start",retry,"--kind","pi","--pane","w-mission:p1"],
  ]);
  // The holder keeps its name and the launch continues on the same pane.
  assert.equal(f.agentCalls.some(a=>a[1]==="rename"),false);
  assert.equal(f.agentCalls[2][1],"wait");assert.equal(f.prompts.length,1);
  assert.equal((await f.bridge.call(["show",f.handle])).state.runtime.session_file,realpathSync(f.file));
});

test("a name taken twice reports the holder and stays launchable",needsCLI,async t=>{
  const f=await fixture(t);
  const plain="mission-session-progress",retry=workerAgentName(f.handle,hashOf(f.handle));
  f.agents.push({name:plain,pane_id:"w-other:p1",workspace_id:"w-other",agent_status:"working"});
  f.agents.push({name:retry,pane_id:"w-other:p2",workspace_id:"w-other",agent_status:"done"});
  f.taken.add(plain);f.taken.add(retry);
  await assert.rejects(f.bridge.start(context(f.repo,f.file),f.handle),e=>{
    // The report names the holder pane, its status, and the next step.
    assert.match(e.message,/agent_name_taken/);
    assert.match(e.message,/held by pane w-other:p2 \(status done/);
    assert.match(e.message,/herdr agent rename <pane> <new name>/);
    assert.match(e.message,/The launch intent is released/);
    return true;
  });
  // Exactly one start per name, no third attempt and no rename.
  assert.deepEqual(f.started,[]);assert.equal(f.prompts.length,0);
  assert.equal(f.agentCalls.filter(a=>a[1]==="start").length,2);
  assert.equal(f.agentCalls.some(a=>a[1]==="rename"),false);
  // The failed launch released its intent, so the next press reserves again and
  // starts the worker under the plain name.
  assert.ok(!(await f.bridge.call(["show",f.handle])).state.runtime.launch_id);
  f.taken.clear();
  const again=await f.bridge.start(context(f.repo,f.file),f.handle);assert.equal(again.launched,true);
  assert.deepEqual(f.started,[plain]);
  assert.equal(f.agentCalls.filter(a=>a[1]==="start").length,3);
});

test("a launch that never reaches its prompt fails cleanly and releases its intent",needsCLI,async t=>{
  const f=await fixture(t);
  f.waitError=Error('Command failed: herdr agent wait\n'+JSON.stringify({error:{code:"timeout",message:"agent wait timed out after 60000ms"},id:"cli:agent:wait"}));
  await assert.rejects(f.bridge.start(context(f.repo,f.file),f.handle),e=>{
    assert.match(e.message,/Herdr agent mission-session-progress did not become ready: timeout: agent wait timed out/);
    assert.match(e.message,/The launch intent is released/);
    return true;
  });
  // A worker that never reached its prompt is never prompted, and its intent
  // returns to the vault so the next press can launch.
  assert.equal(f.started.length,1);assert.equal(f.prompts.length,0);
  assert.ok(!(await f.bridge.call(["show",f.handle])).state.runtime.launch_id);
});

test("a failed launch stays retryable when no worker can own it",needsCLI,async t=>{
  const f=await fixture(t);
  f.startErrors.push(Error("Acknowledgement lost"),Error("Acknowledgement lost"));
  await assert.rejects(f.bridge.start(context(f.repo,f.file),f.handle),/Acknowledgement lost/);
  assert.equal(f.started.length,0);assert.equal(f.prompts.length,0);
  // The launch pane hosts no agent, so the intent was released: the same
  // press works again without a hand edit of the record.
  assert.ok(!(await f.bridge.call(["show",f.handle])).state.runtime.launch_id);
  await assert.rejects(f.bridge.start(context(f.repo,f.file),f.handle),/Acknowledgement lost/);
  assert.equal(f.startErrors.length,0);
});

test("a launch keeps its intent while the launch pane hosts an agent",needsCLI,async t=>{
  const f=await fixture(t);
  f.paneAgents["w-mission:p1"]="pi";
  f.startErrors.push(Error("Acknowledgement lost"),Error("Acknowledgement lost"));
  await assert.rejects(f.bridge.start(context(f.repo,f.file),f.handle),/Acknowledgement lost/);
  // A worker may own the pane, so the intent stays and no second worker starts.
  const again=await f.bridge.start(context(f.repo,f.file),f.handle);assert.equal(again.launched,false);
  assert.equal(f.started.length,0);assert.equal(f.startErrors.length,1);
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

test("the desk's request starts the mission through the start path", needsCLI, async t => {
  const f=await fixture(t);
  const file=launchRequest(f.cache,f.handle,"dotfiles");
  assert.deepEqual(await f.bridge.sessionRepo(context(f.repo,f.file)),"dotfiles");
  await f.bridge.sweepLaunches(context(f.repo,f.file));
  // The request and the panel key share one launch path: one full agent, one
  // prompt, and one session file recorded.
  assert.deepEqual(f.started,["mission-session-progress"]);assert.equal(f.prompts.length,1);
  const receipt=JSON.parse(readFileSync(file,"utf8"));
  assert.equal(receipt.state,"started");
  const runtime=(await f.bridge.call(["show",f.handle])).state.runtime;
  assert.equal(receipt.launch_id,runtime.launch_id);
  assert.equal(receipt.pane,"w-mission:p1");assert.equal(receipt.workspace,"w-mission");
  assert.equal(receipt.session_file,realpathSync(f.file));
  // The same press, twice: the claim is gone, so no second worker appears.
  await f.bridge.sweepLaunches(context(f.repo,f.file));
  assert.equal(f.started.length,1);assert.equal(f.prompts.length,1);
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

test("a broken tracking record blocks edits and warns on reads",needsCLI,async t=>{
  const f=await fixture(t);
  const factory=await loadFactory();
  const events={},tools={},notifications=[];
  const pi={on:(name,fn)=>{events[name]=fn},registerTool:t=>{tools[t.name]=t},registerCommand:()=>{},sendMessage:()=>{}};
  const ctx={...f.ctx,hasUI:true,ui:{notify:(text,tone)=>notifications.push({text,tone}),setStatus:()=>{}}};
  factory(pi,{env:f.env,run:f.run});
  await events.session_start({},ctx);
  await tools.mission.execute("attach-call",{action:"attach",handle:f.handle},null,null,ctx);
  // One lost hook leaves its retry in the outbox; every later flush fails, so
  // the record this session reads never recovers.
  f.hookFailures=1;
  await events.tool_execution_start({toolName:"read",toolCallId:"lost"},ctx);
  assert.ok(notifications.some(n=>/Mission tracking: /.test(n.text)),"the lost hook is reported");
  f.hookFailures=99;
  for(const toolName of ["bash","read","grep"]) assert.equal(await events.tool_call({toolName},ctx),undefined,`${toolName} runs while tracking is broken`);
  assert.ok(notifications.some(n=>n.tone==="warning"&&/Mission tracking: /.test(n.text)));
  for(const toolName of ["write","edit"]) {
    const blocked=await events.tool_call({toolName},ctx);
    assert.equal(blocked.block,true,`${toolName} stays blocked`);assert.match(blocked.reason,/Mission tracking must recover before work continues/);
  }
  // A recovered record restores every tool again.
  f.hookFailures=0;
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

test("started mission owners continue eligible steps; attached sessions remain explicit",needsCLI,async t=>{
  const factory=await loadFactory();
  // A launched worker carries its launch id, a manual attach carries none, and
  // a worker from the old spawn path reports itself through PI_SUBAGENT_AGENT.
  for(const mode of ["attached","launched","legacy"]) {
    const f=await fixture(t);delete f.env.PI_SUBAGENT_AGENT;if(mode==="legacy")f.env.PI_SUBAGENT_AGENT="mission-worker";
    const events={},tools={},messages=[];
    factory({on:(k,v)=>events[k]=v,registerTool:v=>tools[v.name]=v,registerCommand:()=>{},sendMessage:(message,options)=>messages.push({message,options})},{env:f.env,run:f.run});
    const ctx={...f.ctx,ui:{notify:()=>{},setStatus:()=>{}}};
    const params={action:"attach",handle:f.handle,...(mode==="launched"?{launch_id:"launch-1"}:{})};
    const claim=await tools.mission.execute("attach",params,null,null,ctx);
    writeFileSync(claim.details.artifact,"Step evidence");
    await tools.mission.execute("finish",{action:"finish"},null,null,ctx);
    await events.agent_before_settle({outcome:"completed"},ctx);
    await events.agent_settled({aborted:false},ctx);
    const continues=mode!=="attached";
    assert.equal(messages.length,continues?1:0,`${mode} continues: ${continues}`);
    if(continues){assert.equal(messages[0].message.customType,"mission-next");assert.equal(messages[0].options.triggerTurn,true);}
    assert.equal((await f.bridge.call(["show",f.handle])).state.status,"ready");
  }
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
