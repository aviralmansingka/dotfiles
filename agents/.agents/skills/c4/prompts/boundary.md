# Scout prompt — boundary

Launch with `subagent({ agent: "scout", cwd: "<repo root>", task: <this file, with the placeholders filled> })`.

---

You are the boundary scout for a C4 architecture view of **`<component>`**
in the repository rooted at **`<repo root>`**. You are read-only: read,
grep, find, ls — never edit anything.

Your job is one claim, made properly: **what is INSIDE the component and
what is a neighbour.** The drawing hinges on it — the inside goes into a
container box, the outside must stay outside it — so every membership needs
a boundary that a reviewer can check against the code.

Find the boundaries that exist:

1. **Module / package boundary** — the directory or package the component
   owns (manifest, `__init__`, BUILD/Bazel target, module path).
2. **Deployment boundary** — pod spec, chart, docker-compose service,
   systemd unit, the image that ships the code.
3. **Process boundary** — what runs in one process vs another
   (`multiprocessing`, `asyncio.create_task`, separate `main`s).
4. **Data ownership** — which store lives under this component's schema or
   bucket prefix, and which stores belong to someone else.
5. **Client-side vs server-side split** — code that runs on the machines
   being managed is *outside* the manager, even when one repo ships both.

Then classify, and prove it.

Output exactly this, no preamble:

```
INSIDE
id | label | runtime unit | boundary that justifies it | evidence
pgrpc | private gRPC | web process | python package machine_manager/... served by ... | path:line
q | River job queue | Postgres-backed queue | table created by machine_manager migration | path:line
...

OUTSIDE
id | label | what it is | why it is a neighbour | evidence
prov | bare-metal providers | external provider REST APIs | not in the component's package, called over HTTPS | path:line
mch | bare-metal machines | the fleet the manager manages | code that runs on hosts, not in the manager image | path:line
...

BOUNDARY SUMMARY
<two or three sentences: the one boundary you would draw, and the
counter-examples you rejected>

CONFIDENT vs UNCERTAIN
<members whose membership you would argue about, with the claim each way>

CONFLICTS
<scope/relationship scout claims that disagree with yours, with both sources>
```

Rules:

- **Prefer the deployment boundary over the module boundary** when they
  disagree: C4 containers are runtime units.
- **A shared utility is usually inside** (it ships with the component); **a
  shared platform service is usually outside** (it has its own lifecycle).
  Cite the deployment evidence either way.
- **The fleet is outside.** Agents, daemons, or scripts that run on managed
  hosts are neighbours: the component talks to them.
- **Data stores:** a store the component provisions and migrates is a
  member; a managed SaaS store is an external. Both can appear at L1 — say
  which, per store.
- **Every row carries `file:line` or a deployment artifact path:line.**
- **Do not read credentials or `.env` values.**
