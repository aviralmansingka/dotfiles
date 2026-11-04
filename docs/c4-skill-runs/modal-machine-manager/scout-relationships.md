Sub-agent "c4-relationships" completed (3m 15s).

RELATIONS

```
id  | from -> to | verb + transport | evidence
e1  | cp -> pgrpc | CreateInstance over private gRPC (allocate an available machine + start launch job) | server/modal_server/instance_manager/machine_manager.py:194
e2  | cp -> pgrpc | DescribeInstances over private gRPC (poll live instances for capacity accounting) | server/modal_server/instance_manager/machine_manager.py:270
e3  | cp -> pgrpc | TerminateInstance over private gRPC (release a machine after worker end) | server/modal_server/instance_manager/machine_manager.py:349
e4  | cp -> pgrpc | RepairInstance over private gRPC, carrying hardware events | server/modal_server/instance_manager/machine_manager.py:374
e5  | cp -> pgrpc | dial private gRPC channel to cfg machine_manager.host/port | server/modal_server/instance_manager/machine_manager.py:143
e6  | pgrpc -> store | SELECT ... FOR UPDATE SKIP LOCKED machine + INSERT instance + state transition over SQL | server/createinstance.go:39
e7  | pgrpc -> river | enqueue LaunchInstance job (in same Postgres tx) | server/createinstance.go:70 -> jobs/launchinstance.go:306
e8  | pgrpc -> river | cancel pending LaunchInstance job (JobCancelTx) when terminate arrives before launch | server/terminateinstance.go:98
e9  | pgrpc -> river | enqueue TerminateInstance job after moving machine to terminating_instance | server/terminateinstance.go:141
e10 | pgrpc -> store | INSERT hardware_event rows from RepairInstance | server/repairinstance.go:78
e11 | pgrpc -> store | ListInstances over SQL for DescribeInstances | server/describe.go:16
e12 | pgrpc -> store | GetInstance / GetPendingLaunchJob / state transitions over SQL | server/terminateinstance.go:60
e13 | pubgrpc -> store | GetMachineBySerialNumber / CreateMachineProvisioning / UpdateMachineNonState over SQL | server/register.go:178
e14 | pubgrpc -> prov | GetMachineDetailsByInstanceID against Gcore API to verify claimed IPs at registration | server/register.go:292 -> providers/gcore/gcore.go:116
e15 | pubgrpc -> river | enqueue RunMachineAudit on first registration or revival from terminated (in tx) | server/register.go:114
e16 | pubgrpc -> store | lookup machine by public IP + UpdateMachineHeartbeat over SQL | server/heartbeat.go:119, 61
e17 | pubgrpc -> river | JobRetry to expedite a snoozed VerifyReimage after a reboot heartbeat gap | server/heartbeat.go:94
e18 | pubgrpc -> store | GetSnoozedVerifyReimageJob over SQL | server/heartbeat.go:85
e19 | boot -> store | GetMachine by id to validate /api/agent/download | boot_api.go:130
e20 | boot -> prov | GetMachineDetailsByInstanceID against Gcore API to validate instance_id download | boot_api.go:145 -> providers/gcore/gcore.go:116
e21 | boot -> obj | presign GET for machine-agent binary in s3://modal-artifacts/machine-agent/machine-agent | boot_api.go:87 -> launch/launch.go:29
e22 | boot -> web | 307 redirect of the agent download to the presigned S3 URL | boot_api.go:89
e23 | mach -> boot | GET /api/agent/download?machine_id=... or ?instance_id=... with curl during cloud-init | cloudinit/scripts/download-machine-agent.sh:39 (URL built at cloudinit/modules.go:93)
e24 | mach -> s3 | wget the presigned bootloader tarball (bootloader-x86_64.tar.gz) | s3boot/args.go:41 (URL minted at s3boot/presign.go:30)
e25 | mach -> s3 | ./install.sh wget the presigned machine image (s3://modal-compute-images) | s3boot/args.go:43 (URL minted at s3boot/presign.go:17)
e26 | mach -> boot | POST /api/boot-callback with serial + sshx link after sshx starts | cloudinit/modules.go:235 (snapshot __snapshots__/TestSSHXModule_1.snap.yaml:9)
e27 | mach -> sshxio | curl -sSf https://sshx.io/get | sh to install sshx into the pre-flash image | cloudinit/scripts/setup-sshx.sh:10
e28 | mach -> agent | machine-agent started by systemd (ExecStart machine-manager-url) | cloudinit/scripts/machine-agent.service:13
e29 | agent -> mach | GET http://169.254.169.254/openstack/latest/meta_data.json for instance UUID | machine-agent/main.go:26, 96
e30 | agent -> mach | dmidecode -s system-serial-number and systemctl show modal-worker (local subprocess) | machine-agent/main.go:70, 236
e31 | agent -> pubgrpc | RegisterMachine over public gRPC with TLS (provider, serial, instance id, private IP) | machine-agent/main.go:169
e32 | agent -> pubgrpc | MachineHeartbeat every 1 minute over public gRPC | machine-agent/main.go:222 (interval at :24)
e33 | river -> mach | LaunchInstance: write /etc/modal/instance_id + /etc/modal/startup.sh then sudo bash startup.sh over SSH | jobs/launchinstance.go:203 -> machine/launch.go:47
e34 | river -> mach | RunMachineAudit: scp machine-audit binary, chmod, sudo run it over SSH | jobs/run_machine_audit.go:115 -> machine/machine_audit.go:145,172
e35 | river -> obj | RunMachineAudit uploads audit JSON to s3://modal-machine-manager-job-logs/<machine>/<ts>.json | jobs/run_machine_audit.go:131
e36 | river -> river | RunMachineAudit enqueues RunS3Boot (FlashAlways / FlashIfNeeded) | jobs/run_machine_audit.go:222
e37 | river -> store | RunMachineAudit writes capabilities/metadata/private_ip via UpdateMachineAuditResults | jobs/run_machine_audit.go:376
e38 | river -> obj | RunS3Boot lists machine-image versions under s3://modal-compute-images | jobs/run_s3_boot.go:215 -> machine-image/machineimage.go:137
e39 | river -> obj | RunS3Boot presigns boot-image and bootloader GET URLs (12h TTL) | jobs/run_s3_boot.go:149 -> s3boot/presign.go:17
e40 | river -> mach | RunS3Boot drives install.sh as root over SSH, writes /root/networkd/*, reboots | jobs/run_s3_boot.go:173 -> s3boot/run.go:51,70,77
e41 | river -> river | RunS3Boot enqueues VerifyReimage (scheduled, in tx) | jobs/run_s3_boot.go:356
e42 | river -> mach | VerifyReimage checks cloud-init status, modal-worker unit, /tmp free space, DNS smokecheck over SSH | jobs/verify_reimage.go:145, 429, 454, 496
e43 | river -> river | VerifyReimage enqueues RunMachineAudit after passing | jobs/verify_reimage.go:365
e44 | river -> river | VerifyReimage enqueues RunBenchmark when hostbench is enabled | jobs/verify_reimage.go:415
e45 | river -> mach | RunBenchmark uploads hostbench wrapper and runs it detached over SSH | jobs/run_benchmark.go:178 -> internal/hostbench/run.go:247,250
e46 | river -> obj | RunBenchmark mints presigned GET/PUT URLs (modal-host-bench, modal-hostbench-upload, modal-artifacts tarball) and writes them to the machine | internal/hostbench/mint.go:43 -> internal/hostbench/run.go:277
e47 | river -> obj | hostbench polls result/log objects via HeadObject + PresignURL | internal/hostbench/run.go:174, 198
e48 | river -> mach | TerminateInstance stops modal-worker-healthcheck.scope and tailscale-up.service over SSH | jobs/terminate_instance.go:136 -> machine/terminate_instance.go:50
e49 | river -> mach | CaptureMachineDiagnostics (lspci, nvidia-smi, journalctl...) over SSH on failure | machine/diagnostics.go:49, 106
e50 | river -> mach | RebootWhitefiberMachine writes NoCloud datasource + user-data and reboots over SSH | jobs/reboot_whitefiber_machine.go:95 -> providers/whitefiber/reboot.go:15,45
e51 | river -> mach | CollectS3BootDiagnose reads /var/log/modal/s3_boot_diagnose_results.json over SSH, polling every 2 min | jobs/collect_s3boot_diagnose.go:52 -> :106
e52 | river -> obj | RunS3BootDiagnose presigns the bootloader URL before re-running install.sh --diagnose | jobs/run_s3_boot_diagnose.go:96
e53 | river -> river | RunS3BootDiagnose enqueues CollectS3BootDiagnose | jobs/run_s3_boot_diagnose.go:126
e54 | river -> janc | launch_failed / s3_boot_failed / terminate_instance_failed / instance_cycling / verify_reimage_failed / state_race diagnostic posts | jobs/launchinstance.go:280, jobs/run_s3_boot.go:257, jobs/terminate_instance.go:163,222,336, jobs/verify_reimage.go:543
e55 | river -> store | River worker state transitions (TransitionMachineState*, WithTx, advisory locks) over SQL | jobs/run_s3_boot.go:340, jobs/terminate_instance.go:104
e56 | river -> store | River itself claims/completes jobs from river_* tables in Postgres | jobs/jobs.go:213
e57 | river -> prov | PollGcoreClusterWorker polls Gcore task state every 30s (create + resize) | jobs/gcore.go:104,137 -> providers/gcore/cluster.go:337
e58 | river -> prov | UpdateGcoreClusterUserData patches cluster servers_settings.user_data | jobs/gcore.go:68 -> providers/gcore/cluster.go:177
e59 | river -> store | PollGcoreClusterWorker writes clusters.external_id | jobs/gcore.go:107
e60 | river -> prov | ImportMachines every 15 min: GET /servers from Latitude API | jobs/import_machines.go:40 -> providers/import.go:78 -> providers/latitude/api.go:87
e61 | river -> store | ImportMachines creates machine rows for unknown Latitude servers (state unknown) | providers/import.go:50
e62 | river -> store | Sweeper every 15 min scans machines stuck in transient states (read only) | jobs/sweeper.go:38
e63 | janc -> store | INSERT janitor_event row before notifying | janitor/client.go:110
e64 | janc -> obj | upload event body to s3://modal-machine-janitor-event-data/<event_id>.json | janitor/client.go:119
e65 | janc -> janitorsvc | POST http://machine-janitor.machine-manager:8080/event with event_id + machine_id | janitor/client.go:136 (URL at janitor/client.go:19)
e66 | janitorsvc -> web | POST http://machine-manager-web.machine-manager:8082/api/janitor_proposed_action with verdict | machine_janitor/janitor/app.py:78
e67 | janitorsvc -> web | GET /api/machines, /api/machines/{id}, /api/clusters/{id}, /api/machines/{id}/audits over HTTPS (tailscale) | machine_janitor/janitor/tools/_machine_manager.py:20
e68 | web -> store | RecordJanitorProposedAction + CreateAnnotation over SQL | webapi/janitor.go:95, :140
e69 | web -> obj | presign GET of the raw janitor event (7 day TTL) | webapi/janitor.go:177
e70 | web -> slackc | PostMessageContext the proposed action into #machine-janitor (C0B069XGDFV) | webapi/janitor.go:205
e71 | slackc -> slackapi | chat.postMessage over HTTPS with the bot token | slack/client.go:49
e72 | slackc -> aws | GetSecretValue {env}/MachineManagerSlackKey for bot_token | slack/auth.go:29
e73 | web -> store | machine/cluster/annotation reads and writes (list, get, create, update, delete) over SQL | webapi/server.go:60
e74 | web -> river | POST /api/machines/{id}/audit enqueues RunMachineAudit | webapi/handlers.go:400
e75 | web -> river | POST /api/diagnose enqueues RunS3BootDiagnose | webapi/handlers.go:450
e76 | web -> river | POST /api/machines/{id}/reprovision enqueues RunMachineAudit (or RebootWhitefiberMachine) in tx | webapi/handlers.go:574,587
e77 | web -> obj | list + presign job-log audit objects for GET /api/machines/{id}/audits | webapi/handlers.go:305, 328
e78 | web -> lat | GetSSHKeyID / UpdateServerDeployConfig / ReinstallServer over Latitude REST from POST /api/machines/{id}/reinstall | webapi/handlers.go:691,697,707 -> providers/latitude/api.go:171,113,127
e79 | web -> bmcs | GET bmc, discover, power, boot, dashboard, config update | webapi/bmc.go:68,92,116,139,159,217
e80 | bmcs -> store | GetMachine/GetCluster/GetBastion + UpdateMachineBMCConfig persistence of discovery | bmc/service.go:224, 281
e81 | bmcs -> sshx | SSH tunnel through the provider/cluster bastion (ssh.DialTunnel) | bmc/redfish.go:52
e82 | bmcs -> mach | Redfish GET /redfish/v1, PATCH boot override, POST ComputerSystem.Reset over HTTPS through the tunnel | bmc/redfish.go:85, 184, 202 (request at :225)
e83 | bmcs -> lat | POST https://api.latitude.sh/servers/{id}/remote_access to mint BMC credentials | bmc/latitude.go:29
e84 | bmcs -> sec | PrivateKey(ctx, provider) for the bastion SSH config | go/machine-manager/main.go:437 (newBMCService) -> ssh/keystore.go:139
e85 | browser -> web | load SPA and JSON API over HTTPS (cloud-init page, machine detail, reprovision buttons) | webapi/server.go:196
e86 | recon -> store | every 1 minute: GetClustersByProvider("gcore") | server/reconciler.go:20 -> cluster-manager/manager.go:158
e87 | recon -> prov | ClusterExists / GetClusterByName on Gcore to diff desired vs actual | cluster-manager/manager.go:196, 246
e88 | recon -> prov | CreateCluster on Gcore when the cluster is absent | cluster-manager/manager.go:209 -> providers/gcore/cluster.go:118
e89 | recon -> prov | ResizeCluster on Gcore when node count < desired | cluster-manager/manager.go:293 -> providers/gcore/cluster.go:203
e90 | recon -> river | enqueue clustermgr_PollGcoreCluster after create or resize | cluster-manager/manager.go:219, 303
e91 | recon -> river | enqueue clustermgr_UpdateGcoreClusterUserData when user-data drifts | cluster-manager/manager.go:262
e92 | prov -> gcore | GPUBaremetal Clusters New/Get/List/Resize/UpdateServersSettings + Tasks.Get over REST (gcore-go) | providers/gcore/cluster.go:118, 177, 203, 244, 267, 337
e93 | prov -> gcore | GPUBaremetal Clusters.List + Clusters.Servers.List for machine details | providers/gcore/gcore.go:78, 94
e94 | sec -> aws | GetSecretValue <env>/MachineManagerSSHPrivateKey, cached 2 minutes | ssh/keystore.go:105
e95 | web/otel -> otelp | OTLP gRPC trace + metric export to the collector | go/telemetry/otel.go:183, metrics/metrics.go:47
e96 | riverui -> store | River UI reads river_* job tables through the River client | jobs/jobs.go:308
e97 | store -> pg | all SQL over the pgx pool to machine-manager Postgres (incl. embedded migrations at boot) | main.go:118, 128
```

INTERNAL vs EXTERNAL

Inside the component (one deployable, `go/machine-manager`):
`pgrpc` (private gRPC, MachineManager), `pubgrpc` (public gRPC, MachineManagerPublic), `boot` (HTTP boot server: boot.ipxe, agent download, boot-callback), `web` (Svelte SPA + `/api` JSON), `riverui` (River admin UI :8081), `river` (River workers + periodic jobs), `recon` (1-minute cluster reconcile loop), `prov` (provider adapters: gcore cluster/machine, latitude API), `sshx` (ssh + s3boot + machine exec drivers), `bmcs` (BMC/Redfish service), `store` (store/sqlc), `obj` (S3 object-store client), `sec` (Secrets Manager keystore), `janc` (janitor event client), `slackc` (Slack client), `otel`.

Neighbours:
`cp` (Modal control-plane instance managers in `server/modal_server/instance_manager/`), `agent` (machine-agent, same repo but a separate binary shipped to hosts), `mach` (the bare-metal host itself — an SSH/HTTPS target, not our code), `janitorsvc` (`machine_janitor/` Python service), `gcore` (Gcore API), `lat` (Latitude API), `pg` (machine-manager Postgres), `s3` (modal-compute-images, modal-machine-manager-job-logs, modal-machine-janitor-event-data, modal-artifacts, modal-host-bench, modal-hostbench-upload), `aws` (Secrets Manager), `slackapi`, `otelp`, `browser` (operator), `sshxio`.

Unsure / boundary calls for the boundary scout:
- `agent` (machine-agent) is built from this repo and shipped in the same OCI image set, but runs on customer hardware — I treated it as a neighbour. Flip it inward if the boundary is "everything we build".
- `janitorsvc` and the `machine-manager-alerts` Modal app are separate deployments; treated as neighbours.
- `browser` and `cp` are both outside; whether the web UI counts as part of the component is a boundary judgement.

CONFLICTS

1. **Who terminates a machine's cloud instance.** `providers/gcore/gcore.go` only exposes read paths (`listClusters`, `getServerDetails`, `GetMachineDetailsByInstanceID`), and `machine/terminate_instance.go:14` terminates via SSH by stopping systemd units. The generated Python stub advertises `TerminateInstance` on the machine-manager side (server/modal_server/proto/machine_manager.proto:158) which reads like a cloud-API delete. The Go code is stronger evidence: terminate is SSH unit-stop + state transition only; no Gcore delete call exists.
2. **Which providers actually reach a cloud API.** `providers/providers.go` lists 10 provider types and `providers/configs.go` configures them all, but only `gcore` (cluster + machine details) and `latitude` (server list, deploy_config, reinstall, remote_access) have live clients. `providers/cirrascale` is imported by nothing (grep for `cirrascale.NewClient` returns only BUILD.bazel), and whitefiber is SSH-only. Config breadth overstates the real call surface.
3. **Janitor URL.** `janitor/client.go:19` reaches the janitor at `http://machine-janitor.machine-manager:8080/event`, while `machine_janitor/janitor/app.py:35` targets machine-manager at `http://machine-manager-web.machine-manager:8082` — two different services and ports, so these are genuinely two opposite-direction relations rather than a mismatch.
4. **Alerting path.** `alerts/client.go` implements an ingest client for `https://modal-labs--machine-manager-alerts-ingest.modal.run` (event → S3 → Modal app → Slack), and `modal_apps/machine_manager_alerts.py` exists, but nothing in `main.go` or `jobs/` constructs `alerts.NewClient`. Only `janitor` is wired. The alerts dependency is dead code on this branch — I did not emit a row for it.

OPEN QUESTIONS

- `GET /` on the boot server (`main.go:531`) serves `static/boot.ipxe`, which points at `https://modal-public-assets.s3.us-east-1.amazonaws.com/ubuntu-live` for kernel/initrd. Nothing in the repo references this URL or a `BootPort` client, and there is no TFTP/DHCP server in this component. Suspected relation `mach -> boot` (iPXE chainload) plus `mach -> modal-public-assets`, but I could not pin a client.
- BMC boot override sets `BootSourceOverrideTarget: Pxe` (`bmc/redfish.go:181`), which implies the machine then PXE-fetches from *somewhere*. That somewhere is not in this repo.
- `machine-agent` also depends on a Modal worker binary and its own TLS trust; `cloudinit/scripts/machine-agent.service` restarts on failure but I did not find retry/metrics plumbing back into machine-manager beyond `MachineHeartbeat`.
- `webapi/auth/callback.go` is a stub that accepts `?code=` and does nothing — the Okta redirect is declared but no token exchange or session relation exists. Suspected `web -> okta` (OIDC token exchange) that is simply unimplemented.
- `agents.sshx` at `https://sshx.io` is invoked from cloud-init, i.e. the *machine* reaches it — but `CaptureMachineDiagnostics` and the janitor's agent also read sshx links out of the boot callback, so there may be a second, indirect read path I could not localise.
- `RunBenchmark`/hostbench also pulls a tarball from `modal-artifacts` and writes 8192 presigned corpus URLs (`internal/hostbench/urls.go:14`); whether the machine or an external bench harness consumes the `modal-hostbench-upload` bucket is not decided anywhere in the Go code I read.
- I did not read `store/` SQL bodies, so "which table" per write is inferred from sqlc query names rather than from the SQL.

Follow up with subagent_message({ name: "c4-relationships", message: "…" })