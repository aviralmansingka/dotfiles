Sub-agent "c4-scope" completed (1m 29s).

Scope inventory complete.

```
ANCHOR: go/machine-manager/BUILD.bazel:7-16 — a `modal_oci` target (`machine_manager_oci`) wrapping a single `go_binary` (`:machine-manager`) whose `go_library` (lines 18-70) is the closure of every subpackage below; one image, one binary, one boundary. Corroborated by the Helm chart `ops/kubernetes/machine-manager/Chart.yaml:2-6` ("Service for provisioning and managing bare metal capacity") which deploys exactly that image (templates/machine-manager-deployment.yml:53).

ELEMENTS
id     | label                        | role                                                        | class    | evidence
cp     | Modal control plane          | calls CreateInstance/TerminateInstance/RepairInstance/Describe* over private gRPC | external | server/modal_server/instance_manager/machine_manager.py:144,195,350,375
mag    | machine-agent (on machine)   | drives RegisterMachine + MachineHeartbeat from each bare-metal box | actor | go/machine-manager/machine-agent/main.go:120,173; main.go:59
ops    | Operator (web UI / mmctl)    | human runs reprovision/reinstall/audit/bench, inspects machines | actor | go/machine-manager/webapi/server.go:65-118; cmd/mmctl/cmd/root.go:40
jan    | machine-janitor service      | posts janitor_proposed_action into the web API; receives diagnostic events | external | machine_janitor/janitor/app.py:78; go/machine-manager/janitor/client.go:21-23
priv   | private gRPC server (:50053) | MachineManager service — control-plane → manager API                | member   | go/machine-manager/main.go:513; server/modal_server/proto/machine_manager.proto:154-160
pub    | public gRPC server (:50054)  | MachineManagerPublic service — machine → manager API (register/heartbeat) | member | go/machine-manager/main.go:518; machine_manager.proto:162-164
web    | web/JSON API + SPA (:8082)   | REST API, /auth Okta callback, embedded Svelte UI                 | member   | go/machine-manager/main.go:290; webapi/server.go:171-190
boot   | iPXE boot server (:8080)     | serves boot.ipxe, machine-agent download, boot callback            | member   | go/machine-manager/main.go:525-544
river  | River job queue              | durable job dispatch; queue lives in Postgres, workers run in-process | member | jobs/jobs.go:107-215, 224-238
jobs2  | River workers (12 kinds)     | launch, terminate, reboot, s3-boot, diagnose, verify-reimage, benchmark, audit, gcore cluster poll, import machines, sweeper | member | jobs/jobs.go:85-205
rec    | cluster reconcile loop       | drives desired-vs-actual cluster state                 | member   | main.go:308; server/reconciler.go:16; cluster-manager/manager.go:37
bmcsvc | BMC service                  | bastion-backed Redfish power/boot/console per machine | member   | main.go:300,437-462; bmc/service.go:66
pg     | Postgres "machinemanager"    | machine/cluster/instance/audit/BMC/janitor/river tables | store  | main.go:547-554; migrations/000001_initial.up.sql:14-79
s3     | S3 object store              | machine-agent, machine images, job logs, hostbench, janitor event blobs | store | storage/main.go:35; launch/launch.go:17-18; machine-image/machineimage.go:139
awssm  | AWS Secrets Manager          | SSH provider private keys, Slack + alerts proxy creds  | external | ssh/keystore.go:66-84; slack/auth.go:21; alerts/auth.go:21
gcore  | Gcore API                    | bare-metal cluster + instance details                  | external | providers/gcore/gcore.go:41-77
latit  | Latitude API                 | inventory + import                                     | external | providers/latitude/api.go:195; jobs/import_machines.go
circ   | Cirrascale API               | provider integration                                   | external | providers/cirrascale/cirrascale.go:15
wf     | Whitefiber machines          | reboot via provider-specific path                      | external | jobs/reboot_whitefiber_machine.go; providers/whitefiber/reboot.go
hwl    | Bare-metal machines (SSH)    | salt/bootstrap/benchmark/audit targets over SSH        | external | ssh/ssh.go:67; jobs/jobs.go:130 (factory: ssh.Dial)
slack  | Slack                        | operator notifications                                 | external | slack/client.go:47
alerts | machine-manager-alerts app   | diagnostic event ingest (Modal app)                    | external | alerts/client.go:18,78
envoy  | Envoy gateway (GRPCRoute)    | fronts public gRPC on machines.<domain>                | external | ops/kubernetes/machine-manager/templates/gateway/grpc-route.yaml:1-25
k8s    | machine-manager Deployment   | the one runtime unit; 5 ports, gRPC health probes      | member   | ops/kubernetes/machine-manager/templates/machine-manager-deployment.yml:1-60
oci    | machine_manager_oci image    | distroless static container image                      | member   | go/machine-manager/BUILD.bazel:7-16
audit  | machine-audit binary         | cross-compiled linux/amd64, go:embed'd and shipped to machines | member | go/machine-manager/machine/machine_audit_binary.go; cmd/machine-audit/main.go:18
mmctl  | mmctl CLI                    | operator client for the web API                        | actor    | cmd/mmctl/main.go:1; cmd/mmctl/client/client.go:69
agts   | operator agent skills        | annotate-machine / debug-machine / onboard-* skills living in the package | actor | go/machine-manager/.agents/skills/{debug-machine,onboard-machines,...}

ENTRY POINTS
server/modal_server/proto/machine_manager.proto:155 — gRPC (private) — CreateInstance
server/modal_server/proto/machine_manager.proto:156 — gRPC (private) — DescribeInstances
server/modal_server/proto/machine_manager.proto:157 — gRPC (private) — DescribeMachines
server/modal_server/proto/machine_manager.proto:158 — gRPC (private) — TerminateInstance
server/modal_server/proto/machine_manager.proto:159 — gRPC (private) — RepairInstance
server/modal_server/proto/machine_manager.proto:163 — gRPC (public) — RegisterMachine (from machine-agent)
server/modal_server/proto/machine_manager.proto:164 — gRPC (public) — MachineHeartbeat (1/min per machine)
go/machine-manager/main.go:531 — HTTP — GET / returns boot.ipxe (iPXE chainload for freshly flashed machines)
go/machine-manager/main.go:535 — HTTP — GET /api/agent/download, IP-validated presigned redirect to the machine-agent binary
go/machine-manager/main.go:539 — HTTP — POST /api/boot-callback, unauthenticated cloud-init callback (logged only)
go/machine-manager/webapi/server.go:68-118 — HTTP JSON API — machines/clusters/providers CRUD, BMC discover/power/boot/dashboard, audit, diagnose, reprovision, reinstall, delete, jobs, annotations, janitor_proposed_action, stats
go/machine-manager/webapi/server.go:127 — HTTP — GET /auth/callback (Okta redirect)
go/machine-manager/webapi/server.go:189 — HTTP — embedded SPA (ui/dist) for all non-API paths
go/machine-manager/jobs/jobs.go:224-238 — cron/periodic — River periodic jobs: Sweeper (RunOnStart) and ImportMachines (RunOnStart)
go/machine-manager/main.go:308 — background loop — RunClusterReconcileLoop
go/machine-manager/main.go:310 — HTTP (internal) — River UI on :8081 under /riverui
go/machine-manager/main.go:83-99 — CLI subcommand — `machine-manager migrate-down` (non-prod only)
go/machine-manager/main.go:118 — boot-time task — golang-migrate schema migrations run before any server starts

STORES
Postgres "machinemanager" — owned by machine-manager, its single system of record (machine, cluster, instance, machine_state_audit, hardware_event, liveness_event, annotations, bastion, machine_bmc, bmc_action_audit, issues, janitor_events, machine_hostbench_run, plus River's river_job) — go/machine-manager/main.go:547-554; migrations/000001_initial.up.sql:14-79; schema/river_job.sql
S3 "modal-artifacts" — owned by machine-manager (presigned machine-agent download) — launch/launch.go:15-18,22
S3 machine-images bucket — owned by machine-manager — machine-image/machineimage.go:139
S3 job-logs / hostbench / janitor-event-data buckets — owned by machine-manager — jobs/run_machine_audit.go:132; internal/hostbench/mint.go; storage/main.go (JanitorEventDataBucket)
SQL query surface — sqlc-generated, single choke point for all DB access — go/machine-manager/sqlc.yaml:1-21; store/store.go:14

OPEN QUESTIONS
- alerts package: `alerts.NewClient` (alerts/client.go:78) has no caller inside go/machine-manager — grep for `alerts.NewClient|alerts.Client` over the package returns only its own doc comment. Either dead code, or it belongs to a component other than the in-cluster manager (the target is the Modal app `machine-manager-alerts`). Boundary decision needed.
- machine-janitor and machine-manager-alerts are separate deployables in this repo (machine_janitor/, modal_apps/machine_manager_alerts.py, ops/Dockerfile.machine-janitor, chart `machine-janitor`) that talk to the manager's web API and Modal endpoint. They are modelled as `external` here; if the C4 scope is "the machine lifecycle system", they are siblings-in-scope.
- `machine-janitor` is addressed in-cluster (`http://machine-janitor.machine-manager:8080/event`, janitor/client.go:21-23) but I found no Helm template for it under ops/kubernetes/machine-manager/templates — looked in that dir and at ops/release.py:154. Its chart may live elsewhere.
- The ipxe boot server is served on `bootPort` 8080 in-cluster (values.yaml:28) while mmctl's `defaultBaseURL` is also `http://localhost:8080` (cmd/mmctl/cmd/root.go:22) — those are different listeners (web API is 8082); confirm local-dev port mapping before drawing it.
- Deployment topology: README (go/machine-manager/README.md:57) says the manager is limited to `dev-us-east-1`, but `ops/kubernetes/machine-manager/values-prod-us-east-1.yaml` exists and ops/kubernetes/modal/values-prod.yaml:10 points at a prod internal NLB. README is stale; I did not verify which is live.
- Whether `machine_image` builds are a runtime unit of the manager or an out-of-band pipeline: machine-image/machineimage.go only reads/writes the images bucket; looked for builders under go/machine-manager/machine-image/ and found no build entry point.
- Ports are supplied as raw argv (deployment args: private, public, boot) yet web port comes from `MM_WEB_PORT` (deployment env) — I could not establish from config/config.go alone whether private/public/boot ports have env fallbacks; looked at go/machine-manager/config/config.go:81-121.
```

Follow up with subagent_message({ name: "c4-scope", message: "…" })