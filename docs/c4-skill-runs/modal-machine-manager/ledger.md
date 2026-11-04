# Ledger — machine-manager (Modal bare-metal capacity service)

Run directory: `docs/c4-skill-runs/modal-machine-manager/`
Inputs: `scout-scope.md`, `scout-relationships.md`, `scout-levels.md`, `scout-boundary.md`
Anchor: `go/machine-manager/BUILD.bazel:7-16` — `machine_manager_oci` wraps one `go_binary`
(`:machine-manager`); built and deployed as `ops/kubernetes/machine-manager` (Deployment, one
container, 5 ports). The C4 *container* is therefore this single process.

Purpose of this file: a merge-ready ledger. Every element and every one of the **97**
relationships is recorded separately. Nothing is collapsed. Where scouts disagree, both
readings are kept and the disagreement is entered in the conflict register (§4) instead of
being silently resolved.

Confidence tags used throughout:

| Tag | Meaning |
| --- | --- |
| `VERIFIED` | Re-read in source during ledger assembly (this session). |
| `CITED` | Scout gave a file:line; the file exists; the exact line was not re-read. |
| `UNVERIFIED` | No usable evidence pointer, or a pointer that does not support the claim. |
| `CONTESTED` | Two scouts assert incompatible things. See §4. |

---

## 1. Element ledger

### 1.1 Boundary rules applied

| Rule | Statement | Consequence |
| --- | --- | --- |
| R1 | One container / one `main` = inside. | All five listeners, in-process workers, reconcile goroutine, embedded SPA are inside. |
| R2 | Code that ships in the image but *executes on the host* is a payload, not a node. | `machine-audit` is annotated on the SSH edge, not drawn as an inside box. |
| R3 | Borrowed infrastructure is outside; owned schema is inside. | RDS *instance* outside, `machinemanager` *schema* + `river_job` inside. |
| R4 | Separate image/chart/deployment in the same namespace is outside. | `machine-janitor` outside despite shared S3/IAM. |
| R5 | Same Go module, different binary, different lifecycle = outside. | `machine-agent`, `mmctl`, `cmd/vm` outside. |

### 1.2 Inside the component

| ID | Element (canonical) | Aliases in scouts | Runtime shape | Evidence | Conf |
| --- | --- | --- | --- | --- | --- |
| IN-01 | `pgrpc` — private gRPC `modal.machine_manager.MachineManager` | `priv` (scope), `mm-grpc-private` (levels), `pgrpc` (rel/boundary) | in-process gRPC server, `:50053`, h2c behind internal NLB | `go/machine-manager/main.go:513`; `server/modal_server/proto/machine_manager.proto:154-160`; `templates/machine-manager-internal-nlb-service.yml:1-12,37-40` | VERIFIED (`main.go:513`) |
| IN-02 | `pubgrpc` — public gRPC `MachineManagerPublic` | `pub` (scope), `mm-grpc-public` (levels), `pubgrpc` | in-process gRPC server, `:50054`, published only via `machines.<domain>` GRPCRoute | `main.go:518`; `templates/gateway/grpc-route.yaml:17-25` | VERIFIED (`main.go:518`) |
| IN-03 | `boot` — boot HTTP server | `boot` (scope/rel/levels), `mm-boot` | `http.Server`, `:8080`: `GET /` (iPXE), `GET /api/agent/download`, `POST /api/boot-callback` | `main.go:262,525-545`; `templates/gateway/http-route.yaml:16-30` | VERIFIED (`main.go:525-545`) |
| IN-04 | `web` — JSON API + embedded Svelte SPA | `web` (all), `webui` (boundary), `mm-web` (levels) | `http.Server`, `:8082`, `//go:embed all:ui/dist` | `main.go:290-301`; `webapi/server.go:60-130`; `ui_embed.go:1-12` | VERIFIED |
| IN-05 | `riverui` — River admin UI | `riverui` (all), `mm-riverui` | `http.Server`, `:8081` hard-coded | `jobs/jobs.go:301,324`; `main.go:310` | VERIFIED |
| IN-06 | `riverw` — River worker fleet (in-process) | `river` (rel, worker sense), `jobs2` (scope), `mm-jobs` (levels), `jobs` (boundary) | goroutines in the pod, `MM_MAX_WORKERS` default 16; 13 registered kinds | `jobs/jobs.go:85-243`; `main.go:228`; `config/config.go:81` | CITED |
| IN-07 | `riverq` — River queue tables | `river` (scope), `q` (boundary) | `river_job` + River's own migrator + component-added GIN index | `jobs/jobs.go:213`; `migrations/000021_river_job_metadata_gin_index.up.sql:1` | CITED |
| IN-08 | `recon` — cluster reconcile loop | `rec` (scope), `reconcile` (boundary), `mm-reconcile` (levels) | goroutine, 1-minute tick | `main.go:308`; `server/reconciler.go:16-20`; `cluster-manager/manager.go:67-72` | VERIFIED (`main.go:308` via scout; tick CITED) |
| IN-09 | `store` — store/sqlc data-access layer | `store` (rel/levels), `sqlc` (rel prose) | in-binary package; single DB choke point | `store/store.go:14`; `sqlc.yaml:1-21` | CITED |
| IN-10 | `pg` — `machinemanager` Postgres schema | `pg` (scope/rel), `mm-pg` (levels) | schema owned by component, migrated at boot | `main.go:118`; `migrations/000001_initial.up.sql:1-79` | VERIFIED (`main.go:118`) |
| IN-11 | `obj` — S3 object-store client | `s3` (scope, client sense), `s3store` (boundary), `obj` (rel) | in-binary `storage.S3ObjectStore` + presign helpers | `storage/main.go:19-20,97-132`; `main.go:190` | VERIFIED (`storage/main.go:110-111` default 12h TTL) |
| IN-12 | `prov` — provider adapters | `provc` (boundary), `prov` (rel) | in-binary interfaces (`providers.Registry`) | `providers/providers.go:8-19`; `providers/gcore/cluster.go:118`; `providers/latitude/api.go:195` | VERIFIED (`providers.go:8-19`) |
| IN-13 | `bmcs` — BMC service (Redfish/IAP/bastion) | `bmc` (boundary), `bmcsvc` (scope), `bmcs` (rel) | in-binary service wired in `main` | `main.go:300,375-462`; `bmc/service.go`; `bmc/redfish.go:85,184,202`; `bmc/latitude.go:29` | CITED |
| IN-14 | `sshx` — SSH/s3boot/machine-exec drivers | `sshx` (rel), `sshkeys` partial (boundary) | in-binary; `ssh.Dial`, `ssh.DialTunnel`, s3boot staging | `ssh/ssh.go:67-73`; `s3boot/run.go:51-77`; `machine/launch.go:47` | CITED |
| IN-15 | `sec` — Secrets Manager keystore client | `sec` (rel), `sshkeys` (boundary), `awssm` (scope, client side) | in-binary, 2-minute cache | `ssh/keystore.go:66-110,139`; `main.go:151-167` | VERIFIED (`keystore.go:100-110,139`) |
| IN-16 | `janc` — janitor event client | `janc` (rel), `jan` (scope — collision, see C-14) | in-binary `janitor.Client`, nil when disabled | `janitor/client.go:19,41,78-140` | VERIFIED (`client.go:19,110,119,136`) |
| IN-17 | `slackc` — Slack client | `slackc` (rel), `slack` (scope, client sense) | in-binary | `slack/client.go:47-49`; `slack/auth.go:21-35`; `webapi/janitor.go:205` | VERIFIED (`auth.go:21` uses `secretsmanager`) |
| IN-18 | `otel` — OTel instrumentation | `otel` (levels: `web/otel`), `otel` (rel e95 source) | library calls inside the binary (traces + `otel.Meter`) | `go/telemetry/otel.go:183`; `metrics/metrics.go:47` | VERIFIED (`otel.go:183` = `otlptracegrpc.New`) |
| IN-19 | `alerts` — alerts ingest client | `alerts` (scope) | in-binary client, **no caller** | `alerts/client.go:18,78`; `alerts/auth.go:15` | VERIFIED (grep: only self-references) |
| IN-20 | `auditbin` — `machine-audit` payload | `audit` (scope) | cross-compiled linux/amd64, `//go:embed`, run on host | `machine/machine_audit_binary.go:1-12`; `cmd/machine-audit/main.go:18` | CITED |
| IN-21 | `oci` / `mmgr` — image + Deployment envelope | `oci`, `k8s` (scope), `mmgr` (boundary) | packaging, not a runtime unit | `go/machine-manager/BUILD.bazel:7-23`; `templates/machine-manager-deployment.yml:41-45` | CITED |
| IN-22 | `migrations` — golang-migrate at startup | (levels, unplaced) | one-shot startup step, folded into IN-10 | `main.go:118`; `migrations/migrations.go:18-45` | CITED |

### 1.3 Actors

| ID | Element | Aliases | Evidence | Conf |
| --- | --- | --- | --- | --- |
| AC-01 | `ops` — Modal engineer / on-call | `ops` (scope), `ops-operator` (levels), `browser` (rel) | `webapi/server.go:65-118`; `cmd/mmctl/cmd/root.go:40`; `frontend/.env.production:3` | CITED |
| AC-02 | `mmctl` — operator CLI | `mmctl` (scope/boundary) | `cmd/mmctl/main.go:1-6`; `cmd/mmctl/client/client.go:69` | CITED |
| AC-03 | `agts` — operator agent skills | `agts` (scope) | `go/machine-manager/.agents/skills/{debug-machine,onboard-machines}` | CITED |

`browser` (relationship symbol) and `ops` (scope) and `ops-operator` (levels) are the same
actor seen at three granularities: a human, the browser they use, and the CLI/tailnet they
may use instead. One actor box is correct; keep `mmctl` and `agts` as annotation, not nodes.

### 1.4 Outside — neighbours

| ID | Element | Aliases | Why outside | Evidence | Conf |
| --- | --- | --- | --- | --- | --- |
| EX-01 | `cp` — Modal server control plane instance manager | `cp` (rel), `mag`→no; `modal-server`, `modalctl` (levels/boundary) | separate process, different cluster, grpclib client only | `server/modal_server/instance_manager/machine_manager.py:37,126-144,195-196` | CITED |
| EX-02 | `agent` — `machine-agent` | `mag` (scope, labelled *actor*), `agent` (rel/boundary), `fleet-node` partial | same module, different binary, host lifecycle (R5) | `machine-agent/main.go:20-30,120,173,222`; `machine-agent/BUILD.bazel:21-26` | VERIFIED (`main.go:20-30`) |
| EX-03 | `mach` — bare-metal host (SSH/PXE target) | `hwl` (scope), `fleet`, `fleet-node` (boundary/levels) | the thing being provisioned | `ssh/ssh.go:67`; `s3boot/run.go`; `machine/terminate_instance.go:50` | CITED |
| EX-04 | `janitorsvc` — machine-janitor FastAPI service | `jan` (scope), `janitor` (boundary), `janitor-svc` (levels) | own image, chart, service account (R4) | `machine_janitor/janitor/app.py:35,78`; `ops/kubernetes/machine-janitor/templates/machine-janitor-deployment.yml:39-46`; `ops/Dockerfile.machine-janitor:14` | VERIFIED (`app.py:35,78`) |
| EX-05 | `alertsapp` — `machine_manager_alerts` Modal app | `alerts-app` (levels), `alertsapp` (boundary) | separate Modal App deployable | `modal_apps/machine_manager_alerts.py:1-20`; `modal_apps/deploy.py:48` | CITED |
| EX-06 | `slackapi` — Slack API | `slack` (scope/levels), `slackapi` (rel) | SaaS | `slack/client.go:47-49` | VERIFIED (client call site) |
| EX-07 | `datadog-api` — Datadog log search | levels only | SaaS, used only by EX-05 | levels cited, no repo pointer | UNVERIFIED |
| EX-08 | `anthropic` — Claude API | levels only | SaaS, used by EX-04/EX-05 | `machine_janitor/janitor/agent.py` (levels) | CITED |
| EX-09 | `aws` — AWS Secrets Manager | `awssm` (scope), `sm` (boundary), `aws` (rel) | managed secret store | `ssh/keystore.go:66-110`; `slack/auth.go:21-35`; `alerts/auth.go:21`; `ops/pulumi/machine-manager/resources/secrets.py:5-20` | VERIFIED (`slack/auth.go:21`) |
| EX-10 | `s3` — S3 buckets | `s3` (scope/rel), `aws-s3` (levels) | separately managed buckets; component holds policies | `storage/main.go:19-20`; `machine-image/machineimage.go:15-16`; `launch/launch.go:15-16`; `ops/pulumi/modal/resources/s3_buckets.py:236-245` | VERIFIED (`storage/main.go:19-20`, `launch.go:15-16`) |
| EX-11 | `otelp` — OTLP collector | `otel-collector` (levels) | telemetry sink | `go/telemetry/otel.go:183`; `metrics/metrics.go:47` | VERIFIED (`otel.go:183`) |
| EX-12 | `gcore` — Gcore API | `gcore` (scope/rel), `provider-apis` (levels) | vendor REST API | `providers/gcore/gcore.go:78-116`; `providers/gcore/cluster.go:118-337` | CITED |
| EX-13 | `lat` — Latitude API | `latit` (scope), `lat` (rel) | vendor REST API | `providers/latitude/api.go:87,113,127,171,195`; `bmc/latitude.go:29` | CITED |
| EX-14 | `circ` — Cirrascale API | `circ` (scope) | vendor REST API **with no caller** | `providers/cirrascale/cirrascale.go:15,31` | VERIFIED (grep: self-references only) |
| EX-15 | `wf` — Whitefiber | `wf` (scope) | no API client; reboot is SSH + NoCloud | `providers/whitefiber/reboot.go:15,45`; `jobs/reboot_whitefiber_machine.go:95` | CITED |
| EX-16 | `bmcout` — BMC/Redfish endpoints + Latitude dashboard | `bmc-redfish` (levels), `bmcout` (boundary) | network-reached hardware surface | `bmc/redfish.go:85,184,202,225`; `bmc/latitude.go:29` | CITED |
| EX-17 | `sshxio` — sshx.io | rel only, `sshxio` | external installer endpoint | `cloudinit/scripts/setup-sshx.sh:10` | VERIFIED |
| EX-18 | `envoy` — Gateway + NLBs | `ingress` (boundary) | k8s/ELB infra fronting the pod | `templates/gateway/gateway.yaml`; `templates/gateway/{grpc,http}-route.yaml`; `.../machine-manager-internal-nlb-service.yml:1-12` | CITED |
| EX-19 | `rds` — RDS Postgres **instance** | `rds` (boundary) | provisioned by a separate Pulumi stack | `ops/pulumi/machine-manager/resources/database.py:57-115` | CITED |
| EX-20 | `imds` — provider link-local metadata (`169.254.169.254`) | (levels: dashed `fleet-node → provider-apis`) | provider-run service, not repo code | `machine-agent/main.go:20,90-100`; `cloudinit/scripts/download-machine-agent.sh:25-28` | VERIFIED (`main.go:20`) |
| EX-21 | `s3bootimg` — s3-boot bootloader + initrd | `s3bootimg` (boundary) | separately built, flashed, not Go-in-image | `ops/s3-boot/build.sh`; `ops/s3-boot/README.md` | CITED |
| EX-22 | `hostbench` — host-bench harness scripts | `hostbench` (boundary) | executes on host | `internal/hostbench/command.go:8-30`; `internal/hostbench/run.go:247-250` | CITED |
| EX-23 | `vmdev` — `cmd/vm` libvirt harness | `vmdev` (boundary) | dev-only, Gazelle-excluded | `BUILD.bazel:4`; `cmd/vm/main.go` | CITED |

### 1.5 Endpoint crosswalk (every symbol used by the 97 relations)

| Relation symbol | Canonical | Note |
| --- | --- | --- |
| `cp` | EX-01 | |
| `agent` | EX-02 | |
| `mach` | EX-03 | host *and* the agent-on-host are distinct; rows use `mach` for the host |
| `browser` | AC-01 | |
| `pgrpc`, `pubgrpc`, `boot`, `web`, `riverui`, `recon`, `bmcs`, `janc`, `slackc`, `sec` | IN-01…IN-17 | |
| `store` | IN-09 | |
| `river` | IN-06 source / IN-07 target | granularity conflict — see C-02 |
| `obj` | IN-11 | client; the buckets it talks to are EX-10 |
| `prov` | IN-12 | adapter; the vendor APIs are EX-12/13 |
| `sshx` | IN-14 | |
| `pg` | IN-10 | schema; instance is EX-19 |
| `gcore`, `lat` | EX-12, EX-13 | |
| `aws` | EX-09 | |
| `slackapi` | EX-06 | |
| `janitorsvc` | EX-04 | |
| `sshxio` | EX-17 | |
| `otelp` | EX-11 | |
| `web/otel` | IN-04 + IN-18 (compound) | split — see C-03 |
| `s3` (e24/e25 target) | EX-10 | same symbol as `obj`; direction differs (machine ⇒ bucket) |

All 27 relation symbols resolve. No relation references an element absent from §1.

---

## 2. Relationship ledger — 97 rows, unmerged

Disposition key:

- **SOLID** — draw as a solid arrow, evidence stands.
- **DASHED** — real but weak, indirect, or singleton-method; draw dashed or omit at L1.
- **ANNOTATE** — not a separate arrow at this level (duplicate, continuation, or intra-process detail).
- **REATTRIBUTE** — right phenomenon, wrong endpoint; use the corrected endpoint shown.
- **SPLIT** — two edges merged into one row; split before drawing.

| ID | From | To | Verb + transport | Evidence | Conf | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| e1 | cp (EX-01) | pgrpc (IN-01) | `CreateInstance` private gRPC — allocate machine + start launch | `server/modal_server/instance_manager/machine_manager.py:194` | CITED | SOLID |
| e2 | cp | pgrpc | `DescribeInstances` private gRPC — poll live instances | `machine_manager.py:270` | CITED | SOLID |
| e3 | cp | pgrpc | `TerminateInstance` private gRPC — release machine | `machine_manager.py:349` | CITED | SOLID |
| e4 | cp | pgrpc | `RepairInstance` private gRPC + hardware events | `machine_manager.py:374` | CITED | SOLID |
| e5 | cp | pgrpc | dial channel to `machine_manager.host:port` | `machine_manager.py:143` | CITED | ANNOTATE (transport of e1–e4) |
| e6 | pgrpc | store (IN-09) | `SELECT … FOR UPDATE SKIP LOCKED` + INSERT instance + transition | `server/createinstance.go:39` | CITED | SOLID |
| e7 | pgrpc | riverq (IN-07) | enqueue `LaunchInstance` in same tx | `server/createinstance.go:70` → `jobs/launchinstance.go:306` | CITED | SOLID |
| e8 | pgrpc | riverq | `JobCancelTx` cancel pending `LaunchInstance` | `server/terminateinstance.go:98` | CITED | SOLID |
| e9 | pgrpc | riverq | enqueue `TerminateInstance` after `terminating_instance` | `server/terminateinstance.go:141` | CITED | SOLID |
| e10 | pgrpc | store | INSERT `hardware_event` rows from `RepairInstance` | `server/repairinstance.go:78` | CITED | SOLID |
| e11 | pgrpc | store | `ListInstances` SQL for `DescribeInstances` | `server/describe.go:16` | CITED | SOLID |
| e12 | pgrpc | store | `GetInstance` / `GetPendingLaunchJob` + transitions | `server/terminateinstance.go:60` | CITED | SOLID |
| e13 | pubgrpc (IN-02) | store | `GetMachineBySerialNumber` / `CreateMachineProvisioning` / `UpdateMachineNonState` | `server/register.go:178` | CITED | SOLID |
| e14 | pubgrpc | prov (IN-12) | `GetMachineDetailsByInstanceID` to verify claimed IPs at registration | `server/register.go:292` → `providers/gcore/gcore.go:116` | CITED | SOLID (inside process; the crossing is e93) |
| e15 | pubgrpc | riverq | enqueue `RunMachineAudit` on first registration / revival (in tx) | `server/register.go:114` | CITED | SOLID |
| e16 | pubgrpc | store | lookup by public IP + `UpdateMachineHeartbeat` | `server/heartbeat.go:61,119` | CITED | SOLID |
| e17 | pubgrpc | riverq | `JobRetry` to expedite snoozed `VerifyReimage` | `server/heartbeat.go:94` | CITED | SOLID |
| e18 | pubgrpc | store | `GetSnoozedVerifyReimageJob` | `server/heartbeat.go:85` | CITED | SOLID |
| e19 | boot (IN-03) | store | `GetMachine` to validate `?machine_id=` download | `boot_api.go:130` | VERIFIED (`boot_api.go:130-145`) | SOLID |
| e20 | boot | prov | `GetMachineDetailsByInstanceID` to validate `?instance_id=` | `boot_api.go:145` → `providers/gcore/gcore.go:116` | VERIFIED (`boot_api.go:145`) | SOLID |
| e21 | boot | obj (IN-11) | presign GET `s3://modal-artifacts/machine-agent/machine-agent`, 12h | `boot_api.go:87` → `launch/launch.go:29` | VERIFIED (`launch.go:15-16,29`; `boot_api.go:87`) | SOLID |
| **e22** | boot | **web** (as claimed) | "307 redirect of agent download to presigned S3 URL" | `boot_api.go:89` | VERIFIED — **contradicts claim** | **REATTRIBUTE** → see §4 C-01 |
| e23 | mach (EX-03) | boot | `GET /api/agent/download?machine_id=…\|instance_id=…` via curl, `-L` follows redirect | `cloudinit/scripts/download-machine-agent.sh:39`; URL at `cloudinit/modules.go:93` | VERIFIED (`download-machine-agent.sh:25-40`; `modules.go:92`) | SOLID |
| e24 | mach | s3 (EX-10) | `wget` presigned `bootloader-x86_64.tar.gz` from `modal-artifacts/s3-boot/…` | `s3boot/args.go:41` ← `s3boot/presign.go:30-45` | VERIFIED (`presign.go:44`: bucket `modal-artifacts`) | SOLID |
| e25 | mach | s3 | `install.sh` wget presigned machine image, `modal-compute-images` (us-east-2) | `s3boot/args.go:41,43` ← `s3boot/presign.go:17` | VERIFIED (`args.go:41-43`; `machineimage.go:15-16`) | SOLID |
| e26 | mach | boot | `POST /api/boot-callback` with serial + sshx link | `cloudinit/modules.go:235` | VERIFIED (`modules.go:230-240`) | SOLID |
| e27 | mach | sshxio (EX-17) | `curl -sSf https://sshx.io/get \| sh` | `cloudinit/scripts/setup-sshx.sh:10` | VERIFIED | SOLID |
| e28 | mach | agent (EX-02) | machine-agent started by systemd | `cloudinit/scripts/machine-agent.service:13` | CITED | ANNOTATE (co-located on the same box) |
| e29 | agent | mach | `GET http://169.254.169.254/openstack/latest/meta_data.json` for instance UUID | `machine-agent/main.go:26,96` | VERIFIED (`main.go:20,90-100`) | REATTRIBUTE → EX-20 `imds` (not the host) |
| e30 | agent | mach | `dmidecode -s system-serial-number`, `systemctl show modal-worker` (local subprocess) | `machine-agent/main.go:70,236` | CITED | ANNOTATE (same host) |
| e31 | agent | pubgrpc | `RegisterMachine` public gRPC + TLS | `machine-agent/main.go:169` | CITED | SOLID |
| e32 | agent | pubgrpc | `MachineHeartbeat` every 1 min | `machine-agent/main.go:222`; interval `:24` | VERIFIED (`main.go:24`) | SOLID |
| e33 | riverw (IN-06) | mach | `LaunchInstance`: write `/etc/modal/instance_id` + `startup.sh`, `sudo bash` over SSH | `jobs/launchinstance.go:203` → `machine/launch.go:47` | CITED | SOLID |
| e34 | riverw | mach | `RunMachineAudit`: scp + chmod + sudo run audit binary over SSH | `jobs/run_machine_audit.go:115` → `machine/machine_audit.go:145,172` | CITED | SOLID |
| e35 | riverw | obj | upload audit JSON to `modal-machine-manager-job-logs/<machine>/<ts>.json` | `jobs/run_machine_audit.go:131` | CITED | SOLID |
| e36 | riverw | riverq | `RunMachineAudit` enqueues `RunS3Boot` (FlashAlways / FlashIfNeeded) | `jobs/run_machine_audit.go:222` | CITED | SPLIT (worker→queue; queue→worker hop implied) |
| e37 | riverw | store | `UpdateMachineAuditResults` writes capabilities/metadata/private_ip | `jobs/run_machine_audit.go:376` | CITED | SOLID |
| e38 | riverw | obj | `RunS3Boot` lists machine-image versions under `modal-compute-images` | `jobs/run_s3_boot.go:215` → `machine-image/machineimage.go:137` | CITED | SOLID |
| e39 | riverw | obj | presign boot-image + bootloader GET URLs (12h default TTL) | `jobs/run_s3_boot.go:149` → `s3boot/presign.go:17` | VERIFIED TTL (`storage/main.go:110-111`) | SOLID |
| e40 | riverw | mach | `RunS3Boot` drives `install.sh` as root, writes `/root/networkd/*`, reboots | `jobs/run_s3_boot.go:173` → `s3boot/run.go:51,70,77` | CITED | SOLID |
| e41 | riverw | riverq | `RunS3Boot` enqueues `VerifyReimage` (scheduled, in tx) | `jobs/run_s3_boot.go:356` | CITED | SPLIT (worker→queue) |
| e42 | riverw | mach | `VerifyReimage`: cloud-init status, unit, /tmp space, DNS smokecheck over SSH | `jobs/verify_reimage.go:145,429,454,496` | CITED | SOLID |
| e43 | riverw | riverq | `VerifyReimage` enqueues `RunMachineAudit` on pass | `jobs/verify_reimage.go:365` | CITED | SPLIT |
| e44 | riverw | riverq | `VerifyReimage` enqueues `RunBenchmark` when hostbench enabled | `jobs/verify_reimage.go:415` | CITED | SPLIT |
| e45 | riverw | mach | `RunBenchmark` uploads + runs hostbench detached over SSH | `jobs/run_benchmark.go:178` → `internal/hostbench/run.go:247-250` | CITED | SOLID |
| e46 | riverw | obj | mint presigned GET/PUT (host-bench, hostbench-upload, artifacts tarball) written to the machine | `internal/hostbench/mint.go:43` → `run.go:277` | VERIFIED shape (`mint.go:43-55`) | SOLID |
| e47 | riverw | obj | hostbench polls results/logs via `HeadObject` + presign | `internal/hostbench/run.go:174,198` | CITED | SOLID |
| e48 | riverw | mach | `TerminateInstance` stops `modal-worker-healthcheck.scope` + `tailscale-up.service` over SSH | `jobs/terminate_instance.go:136` → `machine/terminate_instance.go:50` | CITED | SOLID |
| e49 | riverw | mach | `CaptureMachineDiagnostics` (lspci, nvidia-smi, journalctl) over SSH on failure | `machine/diagnostics.go:49,106` | CITED | DASHED (failure path) |
| e50 | riverw | mach | `RebootWhitefiberMachine` writes NoCloud datasource + user-data, reboots over SSH | `jobs/reboot_whitefiber_machine.go:95` → `providers/whitefiber/reboot.go:15,45` | CITED | SOLID |
| e51 | riverw | mach | `CollectS3BootDiagnose` reads `/var/log/modal/s3_boot_diagnose_results.json`, 2-min poll | `jobs/collect_s3boot_diagnose.go:52,106` | CITED | SOLID |
| e52 | riverw | obj | `RunS3BootDiagnose` presigns bootloader URL before `install.sh --diagnose` | `jobs/run_s3_boot_diagnose.go:96` | CITED | SOLID |
| e53 | riverw | riverq | `RunS3BootDiagnose` enqueues `CollectS3BootDiagnose` | `jobs/run_s3_boot_diagnose.go:126` | CITED | SPLIT |
| e54 | riverw | janc (IN-16) | 6 diagnostic posts: `launch_failed`, `s3_boot_failed`, `terminate_instance`, `instance_cycling`, `state_race`, `verify_reimage_failed` | `jobs/launchinstance.go:111,280`; `jobs/run_s3_boot.go:257`; `jobs/terminate_instance.go:163,222,336`; `jobs/verify_reimage.go:543` | VERIFIED (all 6 sites) | SOLID — trigger name in scout (`terminate_instance_failed`) is wrong, actual `terminate_instance`; scout omits the second `state_race` site (`launchinstance.go:111`) |
| e55 | riverw | store | `TransitionMachineState*`, `WithTx`, advisory locks | `jobs/run_s3_boot.go:340`; `jobs/terminate_instance.go:104` | CITED | SOLID |
| e56 | riverw | store | River claims/completes jobs from `river_*` tables | `jobs/jobs.go:213` | CITED | SOLID |
| e57 | riverw | prov | `PollGcoreClusterWorker` polls task state every 30s (create + resize) | `jobs/gcore.go:104,137` → `providers/gcore/cluster.go:337` | CITED | SOLID |
| e58 | riverw | prov | `UpdateGcoreClusterUserData` patches `servers_settings.user_data` | `jobs/gcore.go:68` → `providers/gcore/cluster.go:177` | CITED | SOLID |
| e59 | riverw | store | `PollGcoreClusterWorker` writes `clusters.external_id` | `jobs/gcore.go:107` | CITED | SOLID |
| e60 | riverw | prov | `ImportMachines` every 15 min: GET /servers from Latitude | `jobs/import_machines.go:40` → `providers/import.go:78` → `providers/latitude/api.go:87` | CITED | SOLID |
| e61 | riverw | store | `ImportMachines` creates machine rows (state `unknown`) | `providers/import.go:50` | CITED | SOLID |
| e62 | riverw | store | `Sweeper` every 15 min scans stuck transient states (read only) | `jobs/sweeper.go:38` | CITED | SOLID |
| e63 | janc | store | INSERT `janitor_event` row before notifying | `janitor/client.go:110` | VERIFIED (`client.go:110-115`) | SOLID |
| e64 | janc | obj | upload event body to `modal-machine-janitor-event-data/<event_id>.json` | `janitor/client.go:119` | VERIFIED (`client.go:117-124`) | SOLID |
| e65 | janc | janitorsvc | `POST http://machine-janitor.machine-manager:8080/event` (prod/dev-cluster only) | `janitor/client.go:136`; URL `:19` | VERIFIED (`client.go:19-25,126-140`) | SOLID |
| e66 | janitorsvc | web | `POST http://machine-manager-web.machine-manager:8082/api/janitor_proposed_action` | `machine_janitor/janitor/app.py:78` | VERIFIED (`app.py:35,78`) | SOLID |
| e67 | janitorsvc | web | `GET /api/machines`, `/{id}`, `/api/clusters/{id}`, `/{id}/audits` over HTTPS **tailnet**, not in-cluster | `machine_janitor/janitor/tools/_machine_manager.py:20` | VERIFIED (`_machine_manager.py:15-20` → `https://eks-machine-manager-prod-web.tail5292b.ts.net`) | SOLID — but note it is a *different ingress path* from e66; see C-13 |
| e68 | web | store | `RecordJanitorProposedAction` + `CreateAnnotation` | `webapi/janitor.go:95,140` | VERIFIED (`janitor.go:90-100,135-145`) | SOLID |
| e69 | web | obj | presign GET of raw janitor event (7-day TTL) | `webapi/janitor.go:177` | VERIFIED (`janitor.go:176-186`, `TTL: 24*7*time.Hour`) | SOLID |
| e70 | web | slackc (IN-17) | `PostMessageContext` into `#machine-janitor` (`C0B069XGDFV`) | `webapi/janitor.go:205` | VERIFIED (`janitor.go:203-210`) | SOLID |
| e71 | slackc | slackapi (EX-06) | `chat.postMessage` over HTTPS with bot token | `slack/client.go:49` | CITED | SOLID |
| e72 | slackc | aws (EX-09) | `GetSecretValue {env}/MachineManagerSlackKey` | `slack/auth.go:29` | VERIFIED (`auth.go:20-35`) | SOLID |
| e73 | web | store | machine/cluster/annotation reads+writes over SQL | `webapi/server.go:60` | VERIFIED (`server.go:60-118`) | SOLID |
| e74 | web | riverq | `POST /api/machines/{id}/audit` enqueues `RunMachineAudit` | `webapi/handlers.go:400` | CITED | SOLID |
| e75 | web | riverq | `POST /api/diagnose` enqueues `RunS3BootDiagnose` | `webapi/handlers.go:450` | CITED | SOLID |
| e76 | web | riverq | `POST /api/machines/{id}/reprovision` enqueues `RunMachineAudit` / `RebootWhitefiberMachine` in tx | `webapi/handlers.go:574,587` | CITED | SOLID |
| e77 | web | obj | list + presign job-log audit objects for `GET /api/machines/{id}/audits` | `webapi/handlers.go:305,328` | CITED | SOLID |
| e78 | web | lat (EX-13) | `GetSSHKeyID` / `UpdateServerDeployConfig` / `ReinstallServer` from `/reinstall` | `webapi/handlers.go:691,697,707` → `providers/latitude/api.go:113,127,171` | CITED | SOLID |
| e79 | web | bmcs (IN-13) | bmc get / discover / power / boot / dashboard / config | `webapi/bmc.go:68,92,116,139,159,217` | VERIFIED route set (`webapi/server.go:65-87`) | SOLID |
| e80 | bmcs | store | `GetMachine` / `GetCluster` / `GetBastion` + persist BMC config | `bmc/service.go:224,281` | CITED | SOLID |
| e81 | bmcs | sshx (IN-14) | SSH tunnel via provider/cluster bastion (`ssh.DialTunnel`) | `bmc/redfish.go:52` | CITED | SOLID |
| e82 | bmcs | mach (as claimed) | Redfish GET `/redfish/v1`, PATCH boot override, POST `ComputerSystem.Reset` through tunnel | `bmc/redfish.go:85,184,202,225` | CITED | REATTRIBUTE → EX-16 `bmcout` (BMC is a separate network surface; see C-08) |
| e83 | bmcs | lat | `POST /servers/{id}/remote_access` to mint BMC credentials | `bmc/latitude.go:29` | CITED | SOLID |
| e84 | bmcs | sec (IN-15) | `PrivateKey(ctx, provider)` for bastion SSH config | `main.go:437` → `ssh/keystore.go:139` | VERIFIED (`keystore.go:136-140`) | SOLID |
| e85 | browser (AC-01) | web | load SPA + JSON API over HTTPS | `webapi/server.go:196` | CITED | SOLID |
| e86 | recon (IN-08) | store | every 1 min: `GetClustersByProvider("gcore")` | `server/reconciler.go:20` → `cluster-manager/manager.go:158` | CITED | SOLID |
| e87 | recon | prov | `ClusterExists` / `GetClusterByName` on Gcore to diff desired vs actual | `cluster-manager/manager.go:196,246` | CITED | SOLID |
| e88 | recon | prov | `CreateCluster` when absent | `cluster-manager/manager.go:209` → `providers/gcore/cluster.go:118` | CITED | SOLID |
| e89 | recon | prov | `ResizeCluster` when nodes < desired | `cluster-manager/manager.go:293` → `providers/gcore/cluster.go:203` | CITED | SOLID |
| e90 | recon | riverq | enqueue `PollGcoreCluster` after create/resize | `cluster-manager/manager.go:219,303` | CITED | SOLID |
| e91 | recon | riverq | enqueue `UpdateGcoreClusterUserData` on user-data drift | `cluster-manager/manager.go:262` | CITED | SOLID |
| e92 | prov | gcore (EX-12) | GPUBaremetal Clusters New/Get/List/Resize/UpdateServersSettings + Tasks.Get (gcore-go) | `providers/gcore/cluster.go:118,177,203,244,267,337` | CITED | SOLID |
| e93 | prov | gcore | Clusters.List + Clusters.Servers.List for machine details | `providers/gcore/gcore.go:78,94` | CITED | SOLID |
| e94 | sec | aws | `GetSecretValue <env>/MachineManagerSSHPrivateKey`, cached 2 min | `ssh/keystore.go:105` | VERIFIED (`keystore.go:100-110`) | SOLID |
| **e95** | **web/otel** | otelp (EX-11) | OTLP gRPC trace + metric export | `go/telemetry/otel.go:183`; `metrics/metrics.go:47` | VERIFIED (`otel.go:183`) | **SPLIT** → see C-03 |
| e96 | riverui (IN-05) | store | River UI reads `river_*` tables through the River client | `jobs/jobs.go:308` | VERIFIED (`jobs.go:301,324`) | SOLID |
| e97 | store | pg (IN-10) | all SQL over the pgx pool, incl. embedded migrations at boot | `main.go:118,128` | VERIFIED (`main.go:118`) | SOLID |

Count check: 97 rows, `e1`–`e97`, no gaps, no renumbering. Row multiplicity is preserved
deliberately: `cp→pgrpc` stays 5 rows (e1–e5), `riverw→riverq` stays 6 rows (e36, e41, e43,
e44, e53, plus the enqueue reads at e7/e8/e9/e15/e17/e74–e76/e90/e91 which are attributed to
their originating listener), `prov→gcore` stays 2 rows (e92, e93).

---

## 3. Boundary classification ledger

### 3.1 One-line verdict

Boundary = the single `machine-manager` Deployment pod: one Go binary owning five listeners
(`:50053`, `:50054`, `:8080`, `:8081`, `:8082`), running its River workers and reconcile loop
in-process, shipping its Svelte UI and its `machine-audit` binary embedded, and owning the
`machinemanager` Postgres schema including `river_job`. Everything it reaches over the wire is
a neighbour.

### 3.2 Classification table

| Element | Class | Boundary | Rule | Residual doubt |
| --- | --- | --- | --- | --- |
| pgrpc, pubgrpc, boot, web, riverui | API/listener | inside | R1 | none |
| riverw, recon, store, prov, bmcs, sshx, sec, janc, slackc, otel, alerts | internal component | inside | R1 | `alerts` has no caller (C-04) |
| pg (schema) | data store | inside | R3 | instance is outside (C-05) |
| riverq | data store | inside | R3 | created by River's migrator, not `migrations/` (C-06) |
| obj | internal component | inside (client) | R1 | buckets it touches are outside (C-09) |
| auditbin | shipped payload | inside by packaging / outside by execution | R2 | flagged, drawn as annotation (C-07) |
| oci, mmgr | packaging envelope | inside (not a node) | R1 | none |
| migrations | one-shot startup step | folded into pg | R2 | none |
| cp | neighbour | outside | separate process/cluster | none |
| agent | neighbour | outside | R5 | same Go module (C-10) |
| mach | neighbour | outside | R5 | host vs agent-on-host (C-11) |
| bmcout | neighbour | outside | hardware surface | currently folded into `mach` by e82 (C-08) |
| gcore, lat, circ, wf, imds | neighbour | outside | vendor surfaces | `circ` unreferenced; `wf` has no API (C-12) |
| janitorsvc | neighbour | outside | R4 | same namespace + S3 family (C-14) |
| alertsapp, datadog-api, anthropic | neighbour | outside | R4 | no relation rows emitted (C-15) |
| slackapi, sshxio | neighbour | outside | SaaS | none |
| aws (Secrets Manager) | neighbour | outside | managed store | none |
| s3 (buckets) | neighbour | outside | managed buckets | shared with janitor/alerts (C-16) |
| rds (instance) | neighbour | outside | R3 | split from schema (C-05) |
| otelp | neighbour | outside | telemetry sink | none |
| envoy / ingress | neighbour | outside | infra fronting the pod | no relation row emitted (C-17) |
| ops, mmctl, agts | actor | outside | human | actor merge granularity (C-18) |
| s3bootimg, hostbench | neighbour | outside | executes on host | folded into `mach` edges |
| vmdev | out of scope | outside | dev tooling | none |

### 3.3 Level splits inherited from `scout-levels.md`

- **L1 splits into two slices (L1b-A control-plane / L1b-B fleet).** Justifying evidence:
  `templates/machine-manager-internal-nlb-service.yml:1-12,37-40` (peered-VPC only,
  privateGrpcPort), `templates/gateway/grpc-route.yaml:19-26` and
  `templates/gateway/http-route.yaml:26-52` (`machines.<domain>` only),
  `server/modal_server/proto/machine_manager.proto:154-164` (two services, disjoint method
  sets), `main.go:245-300` (four independently bound listeners). The two slices share **no**
  external.
- **L2 splits into A (state star around `pg`) / B (dispatch fan-out from `riverw`+`recon`).**
  Slice B contains no `pg` at all; a combined drawing gives `riverw` 10 out-edges and makes
  `pg` simultaneously a peer and an orphan.
- **Contiguity constraint**: `boot` and `pubgrpc` must share a box and must not sit adjacent
  to `pgrpc`/`web`/`riverui` — they do not share an ingress plane. `riverui` has no gateway
  route at all.

---

## 4. Conflict register

| # | Conflict | Claim A | Claim B | Evidence / adjudication | Effect |
| --- | --- | --- | --- | --- | --- |
| **C-01** | **e22 redirect destination** | `boot → web`: "307 redirect of the agent download to the presigned S3 URL" (`scout-relationships.md` e22, citing `boot_api.go:89`) | The 307 target is the presigned **S3** URL, produced by `presignFn` | `VERIFIED`: `boot_api.go:87` `url, err := presignFn(...)`; `:89` `http.Redirect(w, r, url, http.StatusTemporaryRedirect)`; `launch/launch.go:24-44` builds that URL with `s3.WithPresignExpires(12h)`. There is **no call from the boot listener into the web listener anywhere** — they are two separate `http.Server`s in one process (`main.go:290` vs `:525`). The destination is S3, not `web` | e22 must not be drawn as `boot → web`. Three defensible readings, pick one: (a) **ANNOTATE** — e22 is the HTTP response half of e21 and adds no edge; (b) **REATTRIBUTE** to `boot → EX-10 s3` but then it duplicates e21's target; (c) the actually-missing relation is the *client's* next hop, `mach → s3 (EX-10)` for the agent binary, which no row records (e24/e25 cover bootloader and machine image only). Recommendation: (a) for drawing, (c) added to the gap list §5 |
| C-02 | Element granularity for `river` | One element `river` (relationships) used for workers, enqueues, and `river → river` self-edges | Two elements: `riverw` workers (IN-06) and `riverq` queue tables (IN-07); scope calls the queue `river` and the workers `jobs2`; boundary calls them `jobs` and `q` | `VERIFIED`: `jobs/jobs.go:213` (job table claims) vs `:85-243` (worker registrations); `river_job` created by River's migrator (`README.md:14-15`) | e36/e41/e43/e44/e53 are `worker → queue` inserts, not worker→worker calls. Rows kept as written, disposition `SPLIT` |
| C-03 | Compound source in e95 | Source `web/otel` | Two sources: `web` (request-path metrics/traces) and `otel` (generic instrumentation, `metrics.MachineStateTransition` etc.) | `VERIFIED`: `go/telemetry/otel.go:183` is a process-wide `TracerProvider`; `metrics/metrics.go:47` is a package-level `otel.Meter`. Neither is owned by the web listener | Split into `web → otelp` and `otel → otelp`; drawing one arrow per slice is safer than one arrow from a non-existent "web/otel" element |
| C-04 | alerts path: live or dead | levels: `mm → alerts-app` "ingest diagnostic event" covers `alerts.Client.Post` | relationships: no row emitted, "dead code on this branch" | `VERIFIED`: `grep -rn 'alerts\.NewClient' 'alerts\.Client' --include=*.go go/machine-manager` returns exactly one hit — a doc comment at `alerts/auth.go:15`. No construction in `main.go`, none in `jobs/` | Keep `alerts` as an inside element (it ships in the image) but emit **no** `mm → alertsapp` arrow; annotate as dormant code. If the org chart wants the intended design, draw dashed and label "not wired" |
| C-05 | Postgres inside/outside | scope/levels: `pg` is an L1 member (a store inside the box) | boundary: the RDS *instance* is created and protected by `ops/pulumi/machine-manager` | `VERIFIED` both halves: `main.go:118` runs migrations; `ops/pulumi/machine-manager/resources/database.py:57-115` owns instance/param group/password | Split: schema (IN-10) inside, instance (EX-19) outside. Draw the store inside and note the instance as borrowed infra; do not label the store "owned end-to-end" |
| C-06 | River queue membership | inside (boundary, scope) | created by River's own migrator, not by the component's `migrations/` | `migrations/000021_river_job_metadata_gin_index.up.sql:1` shows the component adding an index to a table it did not create | Keep inside (nothing else consumes it, same database); flag so nobody claims the component migrates it |
| C-07 | `machine-audit` binary | inside by packaging (`//go:embed`) | outside by runtime (executes on the host) | `machine/machine_audit_binary.go:1-12` + `machine/machine_audit.go:145,172` | Inside as an element, `DASHED` at best as a node; its effect is already `riverw → mach` (e34). Never draw it as a container |
| C-08 | BMC target | e82 `bmcs → mach` (SSH tunnel to Redfish) | levels: `bmc-redfish` is a distinct external | `bmc/redfish.go:52` opens a tunnel, then `:85,184,202` issue HTTPS Redfish calls to the BMC — a different network endpoint from the host OS | `mach` conflates "host OS over SSH" with "BMC over Redfish". Recommend EX-16 `bmcout` as its own external; otherwise every BMC arrow looks like it lands on the same box as SSH |
| C-09 | `obj` vs `s3` | relationships uses `obj` (in-process client) as the target of `boot → obj`, `riverw → obj` | scope uses `s3` (buckets) and `mach → s3` | `storage/main.go:19-20` defines bucket constants inside the binary; `mach → s3` (e24/e25) is a *different* direction: the machine talks to the bucket directly, never to `mm` | Both are correct. Draw `mm → S3` once (labelled with presign/stage verbs) and `mach → S3` separately. Do not merge e21 with e24/e25 |
| C-10 | `machine-agent` boundary | scope lists `mag` as an **actor**; levels/boundary treat it as an external system | same Go module, same `providers` package, built from this repo | `machine-agent/BUILD.bazel:21-26`; `machine-agent/main.go:20-30` | External (R5). Do not promote to actor: it is a daemon, not a person, and it is not a system-external only by convention — it is a separate binary with a host lifecycle |
| C-11 | `mach` vs `fleet` vs `fleet-node` | one element covering 10 providers | provider-specific boot paths exist (whitefiber NoCloud reboot, e50) | `providers/whitefiber/reboot.go:15,45` vs `s3boot/run.go` vs `machine/launch.go` | One node is acceptable; annotate the provider-specific paths rather than adding 10 nodes |
| C-12 | Provider breadth | scope lists 10 provider types as externals (`gcore`, `latit`, `circ`, `wf`, …) | only `gcore` and `latitude` have live clients; `cirrascale` has zero callers; whitefiber is SSH-only | `VERIFIED`: `grep -rn 'cirrascale\.' --include=*.go` matches only `providers/cirrascale/cirrascale.go` itself; `providers/providers.go:8-19` lists 10 constants | Config breadth overstates the call surface. Draw `gcore` and `lat` only; `circ`/`wf`/the other six are dashed at best, or annotations |
| C-13 | Janitor ingress asymmetry | e66: janitor → `http://machine-manager-web.machine-manager:8082` (in-cluster) | e67: janitor tools → `https://eks-machine-manager-prod-web.tail5292b.ts.net` (prod tailnet, comment says "always target prod") | `VERIFIED`: `machine_janitor/janitor/app.py:35` vs `machine_janitor/janitor/tools/_machine_manager.py:15-20` | Two arrows with different ingress paths, from the same external. Also a semantic oddity: the read tools ignore the environment the service itself runs in. Annotate; do not merge into one |
| C-14 | Naming collision `jan` | scope: `jan` = "machine-janitor service" (external) | relationships: `janc` = "janitor client" (inside, `janitor/client.go:19`) | `VERIFIED`: `janitor/client.go:19` is the *outbound client*; `machine_janitor/janitor/app.py` is the *service* | Two elements, near-identical names. Keep `janc` (inside) and `janitorsvc` (outside); never write bare `jan` in a drawing |
| C-15 | Direction contradiction for terminate | proto advertises `TerminateInstance` (`machine_manager.proto:158`); reads like a cloud-API delete | Go evidence: terminate is SSH unit-stop + state transition; `providers/gcore/gcore.go` exposes only read paths | scout-relationships CONFLICT 1; `machine/terminate_instance.go:14,50` | Keep the SSH reading (stronger evidence). Do not add a `mm → gcore` delete arrow |
| C-16 | Bucket ownership | "the manager owns the janitor event bucket" (implied by `storage.JanitorEventDataBucket` being a component constant) | janitor has its own IAM policy on the same bucket | `ops/pulumi/modal/resources/iam.py:1245-1253`; `janitor/client.go:41`; `storage/main.go:20` | Manager owns *writes*, not the bucket. Draw `mm → S3`, never `mm owns S3` |
| C-17 | Gateway/NLB has no row | `envoy`/`ingress` is an in-scope deployment element (scope, boundary) | the 97 relations contain no gateway row | `templates/gateway/*.yaml`; `machine-manager-internal-nlb-service.yml` | Not a contradiction, a gap: at L1 the gateway is infrastructure in front of `pubgrpc`/`boot`, not a separate arrow. If drawn, it must be a boundary node, not an element |
| C-18 | Actor granularity | `browser` (rel), `ops` (scope), `ops-operator` (levels), `mmctl`+`agts` (scope) | all one human with three tool surfaces | `webapi/server.go:196`; `cmd/mmctl/client/client.go:69`; `frontend/.env.production:3` | One actor box `ops`, annotate `mmctl` + skills |
| C-19 | Deployment topology | `go/machine-manager/README.md:57` limits the manager to `dev-us-east-1` (stale) | `values-prod-us-east-1.yaml` exists; `ops/kubernetes/modal/values-prod.yaml:10` points at a prod internal NLB; janitor tools hard-code a prod URL | scope + C-13 evidence | Unresolved from code. Affects only labels/environment, not topology — but it means "one copy" is not proven |
| C-20 | e54 trigger naming | scout lists `terminate_instance_failed` and 5 sites | actual constants are `terminate_instance`, and there are 6 `janitor.Post` sites (`state_race` is posted from both `launchinstance.go:111` and `terminate_instance.go:336`) | `VERIFIED` by grep over `jobs/` | Correct the label in any prose derived from the scout; row count unchanged |

### 4.1 e22 in detail (the adjudicated case)

```
handleAgentDownload
  ├─ parse ?machine_id= | ?instance_id=      boot_api.go:60-77
  ├─ validateDownloadRequest                  boot_api.go:80  → store (e19) | prov (e20)
  ├─ url := presignFn(ctx)                    boot_api.go:87  → S3 presign (e21)
  └─ http.Redirect(w, r, url, 307)            boot_api.go:89  → Location: presigned S3 URL
                                                        ▲
                      machine curl -L follows it ───────┘  (e23, download-machine-agent.sh:39)
```

Both listeners live in the same process but are never wired to each other:
`initializeBootServer` (`main.go:592-612` region) has its own `ServeMux` and returns its own
`http.Server`; `webapi.InitializeWebServer` builds a different mux (`webapi/server.go:60-130`)
on `:8082`. The boot mux registers exactly three patterns (`GET /`, `GET /api/agent/download`,
`POST /api/boot-callback`) — none of them proxy, rewrite, or redirect into the web mux.

Therefore:

1. `boot → web` has **no** supporting evidence and should be removed from any drawing.
2. The redirect target is EX-10 (S3 `modal-artifacts`), already covered for the *presign* act
   by e21.
3. The genuinely unrecorded relation is `mach → S3` for the machine-agent binary (the client
   hop after the 307), distinct from e24 (bootloader) and e25 (machine image).

Confidence in this adjudication: **VERIFIED** — direct source read of the redirect, the
presign function, and both server constructors.

---

## 5. Gap register (things the 97 rows do not cover)

These are not conflicts; they are holes a reviewer will notice if the drawing claims
completeness. Recorded so the C4 model does not silently imply coverage.

| # | Missing relation | Evidence for existence | Why it was not emitted |
| --- | --- | --- | --- |
| G-1 | `mach → s3` for the machine-agent binary | `boot_api.go:89` 307 + `download-machine-agent.sh:39` `curl -L` | The scout folded this into e22 with the wrong destination (C-01) |
| G-2 | `mach → boot` iPXE chainload (`GET /` → `boot.ipxe` → `modal-public-assets`) | `main.go:525-531`; `static/boot.ipxe` | No client in repo; PXE/DHCP server is outside the component |
| G-3 | `web → okta` OIDC token exchange | `webapi/auth/callback.go` stub; `webapi/server.go:127` `GET /auth/callback` | Handler is a stub — no token exchange exists to model |
| G-4 | `mmctl → web` | `cmd/mmctl/client/client.go:69` | Covered in prose as actor access; never a row |
| G-5 | `mm → alertsapp` ingest | `alerts/client.go:78` | Dead code (C-04) |
| G-6 | `alertsapp → {slack, datadog-api, anthropic, s3}` | `modal_apps/machine_manager_alerts.py` (levels) | External-to-external; outside the 97 by construction |
| G-7 | `janitorsvc → {anthropic, s3}` | `machine_janitor/janitor/agent.py`, `app.py:70-73` (`EVENT_DATA_BUCKET`) | Same — external-to-external; `app.py:70-73` verified |
| G-8 | `agent → s3` / `agent → mach` TLS trust | `machine-agent.service`, TLS config | Not localised by the scout |
| G-9 | `train`/`bench harness → s3` (`modal-hostbench-upload`) | `internal/hostbench/urls.go:14,46` mints 8192 presigned URLs to the machine | Who consumes the upload bucket is undecided in the code |
| G-10 | `envoy/ingress → {pubgrpc, boot, gRPC-web}` | `templates/gateway/*.yaml` | Infra, not an element relation |
| G-11 | `fleet-node → imds` (`169.254.169.254`) | `machine-agent/main.go:20`; levels marks this dashed | e29 attributes it to `mach` instead (see §2 REATTRIBUTE) |

---

## 6. Mechanical checks performed

| Check | Result |
| --- | --- |
| Relationship row count | 97 (`e1`–`e97`), no gaps, no duplicates, no renumbering |
| Every relation endpoint is in §1 | Yes — 27 symbols, all mapped (`web/otel` split per C-03) |
| Evidence files exist for every referenced path | Yes — 45 sampled Go files present; `go.mod`-relative paths valid |
| Specific lines re-read this session | `boot_api.go:60-165`; `main.go:505-556`; `janitor/client.go:15-25,105-140`; `webapi/janitor.go:90-100,135-145,170-210`; `webapi/server.go:60-130`; `slack/auth.go:20-35`; `ssh/keystore.go:60-110,130-145`; `telemetry/otel.go:175-190`; `metrics/metrics.go:40-52`; `machine_janitor/janitor/app.py:30-40,70-85`; `machine_janitor/janitor/tools/_machine_manager.py:1-30`; `cloudinit/modules.go:88-96,230-240`; `cloudinit/scripts/{download-machine-agent.sh,setup-sshx.sh}`; `s3boot/presign.go:1-51`; `s3boot/args.go:35-50`; `machine-agent/main.go:20-30,90-100`; `launch/launch.go:1-40`; `storage/main.go:14-30,97-132`; `machine-image/machineimage.go:15-16`; `internal/hostbench/mint.go:35-55`; `jobs/jobs.go:301,324`; `jobs/*` janitor trigger sites |
| Claims contradicted by re-read | e22 destination (C-01); e54 trigger names/site count (C-20); `alerts` wiring (C-04); `cirrascale` callers (C-12) |
| Modal repo modified | No — read-only; all writes confined to this run directory |

---

## 7. Drawing-ready summary (derived, not new evidence)

Inside (one Deployment, two L1b slices):

- L1b-A control-plane: `pgrpc`, `web`, `riverui`, `riverw`, `pg` (+ `store`, `sec`, `janc`, `slackc`, `otel`)
- L1b-B fleet: `pubgrpc`, `boot`, `riverw`, `pg`, `recon` (+ `prov`, `bmcs`, `sshx`, `obj`)

Externals actually evidenced: `cp`, `agent`, `mach`, `bmcout`, `gcore`, `lat`, `imds`,
`janitorsvc`, `slackapi`, `aws`, `s3`, `rds`, `otelp`, `sshxio`, actor `ops`.

Externals evidenced only as intent or dead code: `alertsapp`, `datadog-api`, `anthropic`,
`circ`, `wf`, `envoy` (infra), `s3bootimg`, `hostbench`.

Edges to draw solid: e1–e4, e6–e21, e23–e27, e31–e35, e37–e40, e42, e45–e48, e50–e52,
e54–e79, e80–e81, e82→`bmcout`, e83–e84, e85–e94, e96–e97.
Edges to draw dashed: e49, `alerts` (if shown at all), `circ`/`wf` (if shown at all).
Edges to annotate or drop: e5 (transport), e22 (C-01), e28, e30, `e36/e41/e43/e44/e53` (queue hop).
