Sub-agent "c4-levels" completed (1m 34s).

```
L0 ELEMENTS
Component (one box): `mm`

Actors:
  `ops-operator`            Modal engineer/on-call — web UI, River UI, Slack review buttons

Externals (control-plane end):
  `modal-server`            Modal server control plane; Python `instance_manager/machine_manager.py`
                            is the private-gRPC client
  `janitor-svc`             machine-janitor FastAPI service, in-namespace, both directions
  `alerts-app`             `machine-manager-alerts` Modal app (webhook ingest + Claude agent loop)
  `slack`                   Slack API (bot token from Secrets Manager)
  `datadog-api`             Datadog log-search API, used only by alerts-app
  `anthropic`               Claude API, used by alerts-app and janitor-svc
  `aws-secrets-manager`     SSH provider keys, Slack key, alerts proxy auth
  `otel-collector`          OTLP/Datadog telemetry sink

Externals (fleet end):
  `fleet-node`              A bare-metal host + the machine-agent systemd unit on it
  `provider-apis`           Bare-metal/cloud provider control APIs
                            (gcore, cirrascale, latitude, whitefiber, hyperbolic,
                             ornn, rackdog, civo, hydrahost, sfcompute)
  `bmc-redfish`             Per-machine BMC Redfish endpoint, reached through the provider bastion
  `aws-s3`                  modal-artifacts, modal-machine-manager-job-logs,
                            modal-machine-janitor-event-data

External-to-external relations that belong at L0:
  `alerts-app → slack`        post_event chat_postMessage
  `alerts-app → datadog-api`  SEARCH_LOGS_TOOL
  `alerts-app → anthropic`    run_agent_loop
  `alerts-app → aws-s3`       fetch_from_s3
  `janitor-svc → anthropic`   janitor/agent.py Anthropic client
  `janitor-svc → aws-s3`      EVENT_DATA_BUCKET + boto3
  `fleet-node → provider-apis`  (only the gcore link-local metadata service is evidenced;
                              treat as an optional dashed arrow, not a solid one)

L0 COARSE ARROWS (summaries, not relations)
  `modal-server → mm`   "provision bare metal"  covers L1: CreateInstance, DescribeInstances,
                        DescribeMachines, TerminateInstance, RepairInstance over private gRPC
  `mm → modal-server`   "report instance + machine state"  covers: DescribeInstances/
                        DescribeMachines responses, per-machine readiness/liveness
  `fleet-node → mm`     "boot + enroll + heartbeat"  covers: /boot iPXE, /api/agent/download,
                        /api/boot-callback, RegisterMachine, MachineHeartbeat
  `mm → fleet-node`     "reflash, audit, benchmark, terminate"  covers: SSH-driven s3-boot,
                        verify-reimage, machine-audit, hostbench, terminate
  `mm → provider-apis`  "create/resize/poll clusters, inspect machines"  covers: gcore cluster
                        CRUD, GetMachineDetailsByInstanceID, latitude import
  `mm → bmc-redfish`    "power/boot-control + BMC discovery through bastion"  covers all of
                        bmc.Service
  `mm ⇄ janitor-svc`    "post diagnostic event / post proposed action"  covers janitor.Client
                        PostEvent and the /api/janitor_proposed_action handler
  `mm → alerts-app`     "ingest diagnostic event"  covers alerts.Client.Post
  `mm → slack`          "post/update operator message"  covers slack.Client and webapi janitor path
  `mm ⇄ aws-s3`         "stage boot objects, job logs, event payloads, presign agent"  covers
                        storage.S3ObjectStore, s3boot staging, launch.PresignMachineAgentURL
  `ops-operator → mm`   "inspect/reprovision machines, watch queue"  covers web API + River UI
  `mm → aws-secrets-manager` "fetch SSH/Slack/alerts secrets"  covers ssh.NewSecretsManagerKeyStore,
                        alerts proxy auth, slack.fetchSlackSecret
  `mm → otel-collector` "traces/metrics"  covers telemetry.SetupOTelSDK + metrics.NewOtelMetrics

L1 MEMBERS
One Kubernetes Deployment, one Go process (ops/kubernetes/machine-manager/templates/
machine-manager-deployment.yml:44). Runtime units inside the container box:

  process/listener units
    `mm-grpc-private`  private gRPC listener :50053 — MachineManager service       (main.go:245, 513)
    `mm-grpc-public`   public gRPC listener :50054 — MachineManagerPublic service   (main.go:245, 518)
    `mm-boot`          boot HTTP listener :8080 — /, /api/agent/download,          (main.go:262, 525)
                       /api/boot-callback
    `mm-web`           operator HTTP listener :8082 — JSON API + embedded Svelte   (main.go:290)
                       bundle
    `mm-riverui`       River queue UI listener :8081                               (main.go:310)

  core units
    `mm-jobs`          in-process River worker fleet (default queue 16 workers,   (main.go:228;
                       low-priority queue): LaunchInstance, TerminateInstance,     jobs/jobs.go:105-243)
                       VerifyReimage, RunBenchmark, RunMachineAudit, RunS3Boot,
                       S3BootDiagnose, CollectS3BootDiagnose, RebootWhitefiber,
                       PollGcoreCluster, UpdateGcoreClusterUserData, Sweeper,
                       ImportMachines
    `mm-reconcile`     cluster reconcile goroutine                                (main.go:308)

  data store unit (machine-manager's own, provisioned in its Pulumi stack)
    `mm-pg`            RDS Postgres `machinemanager` — application schema
                       (migrated at startup, main.go:118) + River queue tables

L1 EXTERNALS
  `modal-server`, `fleet-node`, `provider-apis`, `bmc-redfish`, `aws-s3`,
  `aws-secrets-manager`, `janitor-svc`, `alerts-app`, `slack`, `datadog-api`,
  `anthropic`, `otel-collector`, `ops-operator`
  (all of the above stay outside; Postgres is the only new inside element)

L1b MEMBERS / EXTERNALS
SPLIT. Two slices, sharing the `mm-jobs` + `mm-pg` spine.

  L1b-A "control-plane end" (peered VPC / Tailscale)
    members:   `mm-grpc-private`, `mm-web`, `mm-riverui`, `mm-jobs`, `mm-pg`
    externals: `modal-server`, `ops-operator`, `janitor-svc`, `alerts-app`,
               `slack`, `datadog-api`, `anthropic`, `aws-secrets-manager`,
               `aws-s3`, `otel-collector`

  L1b-B "fleet end" (public internet, machines.<domain>)
    members:   `mm-grpc-public`, `mm-boot`, `mm-jobs`, `mm-pg`, `mm-reconcile`
    externals: `fleet-node`, `provider-apis`, `bmc-redfish`, `aws-s3`

L2 SLICE A — request → state → queue
members: `mm-grpc-private`, `mm-grpc-public`, `mm-web`, `mm-riverui`, `mm-pg`, `mm-jobs`
internal relations:
  `mm-grpc-private → mm-pg`      instance/machine rows read+write in one tx
  `mm-grpc-private → mm-jobs`    StartLaunchInstanceJob / TerminateInstanceArgs enqueued
                                 inside the same tx
  `mm-grpc-public → mm-pg`       RegisterMachine creates/looks-up machine, MachineHeartbeat
                                 updates last_heartbeat_at
  `mm-grpc-public → mm-jobs`     heartbeat snoozes an in-flight VerifyReimage job
  `mm-web → mm-pg`               operator CRUD, audits, annotations, BMC metadata reads
  `mm-web → mm-jobs`             RunMachineAuditArgs / RunS3BootDiagnoseArgs /
                                 RebootWhitefiberMachineArgs enqueued
  `mm-riverui → mm-pg`           queue introspection (riverui.NewEndpoints(client))
  `mm-jobs → mm-pg`              River job rows, state transitions, quarantine-on-race
  `mm-reconcile → mm-pg`         GetClustersByProvider (desired cluster state)
  `mm-reconcile → mm-jobs`       SetRiverClient → PollGcoreCluster /
                                 UpdateGcoreClusterUserData enqueued

L2b SLICE B — actuation / dispatch
members: `mm-jobs`, `mm-reconcile` (+ the fleet-end externals as endpoints)
internal/external relations:
  `mm-jobs → fleet-node`         SSH: s3-boot install, verify-reimage smoke check,
                                 machine-audit, hostbench, whitefiber reboot, terminate
  `mm-jobs → provider-apis`      gcore machine details, cluster create/resize/poll,
                                 latitude machine import
  `mm-reconcile → provider-apis` CreateCluster / GetCluster / ResizeCluster /
                                 GenerateClusterUserData / UpdateClusterUserData
  `mm-jobs → aws-s3`             boot object staging, job logs, diagnose dumps, presign
  `mm-web → bmc-redfish`         Redfish power/boot/discovery through the bastion tunnel
  `mm-jobs → janitor-svc`        PostEvent (S3 event doc + POST /event)
  `mm-jobs → alerts-app`         alerts.Client ingest
  `mm-web → slack`               janitor verdict message post/update
  `mm-jobs → aws-secrets-manager` per-provider SSH key fetch inside each SSH worker

SPLIT EVIDENCE
L1b split — the two ends are on physically different networks and different
listeners, so one L1 forces every fleet arrow to cross the control-plane band:
  - ops/kubernetes/machine-manager/templates/machine-manager-internal-nlb-service.yml:1-12,37-40
    — "allowing pods in peered VPCs to reach machine-manager without going over the
    public internet", port = privateGrpcPort. Only `modal-server` uses this.
  - ops/kubernetes/machine-manager/templates/gateway/grpc-route.yaml:19-26
    — hostname `machines.<domain>`, service `modal.machine_manager.MachineManagerPublic`
    → publicGrpcPort. Only `fleet-node` uses this.
  - ops/kubernetes/machine-manager/templates/gateway/http-route.yaml:26-52
    — hostname `machines.<domain>`, paths /boot, /api/agent/download,
    /api/boot-callback → bootPort. Only `fleet-node` uses this.
  - server/modal_server/proto/machine_manager.proto:154-164
    — two services with disjoint method sets (5 control-plane RPCs vs 2 fleet RPCs).
  - go/machine-manager/main.go:245-300 — four independently bound listeners
    (private gRPC, public gRPC, boot, web) plus the River UI on a fifth.
  Conclusion: L1-A and L1-B share no external. A single L1 would put `modal-server`,
  `ops-operator`, `janitor-svc` (control-plane) and `fleet-node`, `provider-apis`,
  `bmc-redfish` (fleet) in one ring around the same box, and every `fleet-node`
  arrow would have to cross the `modal-server`/`ops-operator` band.

L2b split — `mm-jobs` is the single source of both stories, and `mm-pg` is a hub in
one and absent from the other:
  - Slice A is a star: every relation in it terminates at `mm-pg`
    (server/createinstance.go:34-80, server/terminateinstance.go:64, server/repairinstance.go,
     server/heartbeat.go:61, webapi/handlers.go:363-600, jobs/jobs.go:199-243,
     cluster-manager/manager.go:40-43).
    `mm-pg` in one rank, `mm-grpc-private`, `mm-grpc-public`, `mm-web`, `mm-riverui`,
    `mm-jobs`, `mm-reconcile` around it.
  - Slice B has no `mm-pg` in it at all: every relation is `mm-jobs`/`mm-reconcile` →
    a distinct remote endpoint (s3boot/run.go:31-60, jobs/jobs.go:105-181,
    cluster-manager/manager.go:23-33, bmc/service.go + bmc/redfish.go,
    janitor/client.go:35-56, alerts/client.go:18-45, webapi/janitor.go:207,
    ssh/keystore.go + main.go:150-175).
  - Together `mm-jobs` would carry 10 out-edges and `mm-pg` would be simultaneously a
    peer of `mm-jobs` (Slice A) and unconnected (Slice B), so the state-write star and
    the dispatch fan-out compete for the same rank around `mm-jobs` and the 6 remote
    endpoints get pushed to ranks that route back across `mm-pg`.
    Draw them apart.

CONTIGUITY
  Ingress band (all inbound-only, no outbound except to core):
    `mm-grpc-private`, `mm-web`, `mm-riverui`   — control-plane side
    `mm-grpc-public`, `mm-boot`                 — fleet side
  Core band:  `mm-jobs`, `mm-reconcile`
  Store band: `mm-pg`

  Cannot sit next to the others — need their own container box:
    - `mm-boot` and `mm-grpc-public`. They are reachable only from `machines.<domain>`
      (gateway http-route.yaml:26-52, grpc-route.yaml:19-26). `mm-grpc-private` and
      `mm-web`/`mm-riverui` are reachable only from the peered VPC / operator tailnet
      (internal-nlb-service.yml:37-40, frontend/.env.production:3,
      ops/kubernetes/modal/templates/machine-manager/machine-manager-external-service.yml).
      Adjacent placement implies a shared ingress plane that does not exist.
    - `mm-riverui` must not sit adjacent to `mm-boot`/`mm-grpc-public`: it is
      operator-only, has no hostname on `machines.<domain>`, and its listener is
      hard-coded to :8081 with no gateway route (jobs/jobs.go StartRiverUIServer).

Elements I could not place, and why:
  - `mm-migrations` (golang-migrate at startup, main.go:118) — folded into `mm-pg`; it is
    a one-shot startup step, not a runtime unit, so it has no L1 node and no L2 relation
    (its only edge, mm-jobs? no — the binary → mm-pg, duplicates `mm-jobs → mm-pg`).
  - `providers.Registry` / `cloudinit`, `machine-image`, `launch`, `store`, `sqlc` — these
    are packages inside the container, not containers. They are the substance of the
    Slice A and Slice B relations above, not elements of their own at L1 or L2.
  - `machine-audit` binary (cross-compiled, embedded via //go:embed, executed over SSH on
    the machine) — it lives on `fleet-node` at runtime; it is already covered by
    `mm-jobs → fleet-node`. Listing it as a node would double-count that edge.
```

## Summary

I scouted `go/machine-manager` (Go, single binary, one k8s Deployment) and its deployment rails, and produced the C4 level assignment.

Key findings:
- **L1 is 8 runtime units in one process**: private gRPC :50053, public gRPC :50054, boot HTTP :8080, operator web + API :8082, River queue UI :8081, the in-process River worker fleet, the cluster reconcile goroutine, and RDS Postgres (the only new inside element — provisioned in machine-manager's own Pulumi stack).
- **L1 must split (L1b)**: the externals are genuinely disjoint. `machines.<domain>` (gateway http-route + grpc-route) serves only the fleet; the internal NLB on privateGrpcPort serves only `modal-server`. The proto itself has two services with disjoint method sets. Control-plane externals (modal-server, operator, janitor, alerts, Slack, Datadog, Anthropic, Secrets Manager) and fleet externals (fleet-node, provider APIs, BMC Redfish) share nothing.
- **L2 must split (L2b)**: Slice A is a star with `mm-pg` as the hub (every state-write edge terminates there). Slice B contains no `mm-pg` at all — it is `mm-jobs`/`mm-reconcile` fanning out to distinct remote endpoints. `mm-jobs` is the shared source of both, so drawing them together starves the rank around it.
- **Contiguity hazard**: `mm-boot` + `mm-grpc-public` must be boxed away from `mm-grpc-private`/`mm-web`/`mm-riverui`, since they have no shared ingress plane.
- Three element classes could not be placed as nodes (`mm-migrations`, internal packages, the embedded `machine-audit` binary) and I stated why rather than dropping them.

Follow up with subagent_message({ name: "c4-levels", message: "…" })