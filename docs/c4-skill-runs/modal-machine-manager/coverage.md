# Coverage — every ledger row, counted

Basis: **prioritised (I1–I5)** — no caller scope reduction was asked for.

```
ledger rows:      97
  drawn:          27
  folded:         44   (C2 duplicate call sites)
  omitted:        26   (C1/C2 by class)
  unaccounted:    0
```

## Drawn

| row | level | drawn as |
|---|---|---|
| e24 | L0 | `mach → s3` — boot image |
| e1 | L1 | `cp → pgrpc` — create / terminate / repair |
| e85 | L1 | `ops → web` — http + spa |
| e31 | L1 | `agent → pubgrpc` — register + heartbeat, 1 min |
| e23 | L1 | `mach → boot` — agent download + callback |
| e92 | L1B | `prov → gcore` — cluster + machine api |
| e78 | L1B | `web → lat` — reinstall server |
| e34 | L1 | `sshx → mach` — launch, audit, reimage (ssh) |
| e82 | L1 | `bmcs → bmcout` — redfish power + boot |
| e65 | L0 | `mm → janitorsvc` — diagnostic events |
| e66 | L0 | `janitorsvc → mm` — proposed actions + reads |
| e70 | L1B | `web → slackapi` — confirm + alerts |
| e94 | L1B | `sec → aws` — ssh key + slack token |
| e95 | L1B | `otel → otelp` — traces + metrics |
| e7 | L2 | `pgrpc → riverq` — enqueue launch / terminate |
| e15 | L2 | `pubgrpc → riverq` — enqueue audit / retry |
| e74 | L2 | `web → riverq` — reinstall / reprovision |
| e36 | L2 | `riverw → riverq` — chain follow-up jobs |
| e57 | L2 | `riverw → prov` — poll + patch gcore |
| e14 | L2 | `pubgrpc → prov` — verify claimed ip |
| e88 | L2 | `recon → prov` — cluster create / resize, 1 min |
| e6 | L2B | `pgrpc → store` — machine rows |
| e13 | L2B | `pubgrpc → store` — machine state |
| e73 | L2B | `web → store` — reads + proposed actions |
| e19 | L2B | `boot → store` — validate download |
| e56 | L2B | `riverw → store` — job rows + transitions |
| e97 | L2B | `store → pg` — all sql over pgx |

## Folded

| row | into | class | why |
|---|---|---|---|
| e2 | e1 | C2 | DescribeInstances on the same cp -> private gRPC hop |
| e3 | e1 | C2 | TerminateInstance on the same hop |
| e4 | e1 | C2 | RepairInstance on the same hop |
| e5 | e1 | C2 | dial to machine_manager.host:port: transport of e1-e4 |
| e8 | e7 | C2 | JobCancelTx on the same listener -> queue hop |
| e9 | e7 | C2 | TerminateInstance enqueue on the same hop |
| e10 | e6 | C2 | hardware_event insert, same pgrpc -> store hop |
| e11 | e6 | C2 | ListInstances select, same hop |
| e12 | e6 | C2 | GetInstance select, same hop |
| e16 | e13 | C2 | heartbeat update, same pubgrpc -> store hop |
| e18 | e13 | C2 | snoozed job select, same hop |
| e17 | e15 | C2 | JobRetry to the queue, same pubgrpc -> queue hop |
| e22 | e23 | C2 | 307 redirect is the response half of the download request |
| e26 | e23 | C2 | boot callback, same mach -> boot hop |
| e32 | e31 | C2 | MachineHeartbeat, same agent -> public gRPC hop |
| e33 | e34 | C2 | launch over ssh, same sshx -> mach hop |
| e40 | e34 | C2 | s3boot over ssh, same hop |
| e42 | e34 | C2 | verify reimage over ssh, same hop |
| e45 | e34 | C2 | hostbench over ssh, same hop |
| e48 | e34 | C2 | workload stop over ssh, same hop |
| e49 | e34 | C2 | diagnostics capture over ssh, same hop |
| e50 | e34 | C2 | whitefiber reboot over ssh, same hop |
| e51 | e34 | C2 | diagnose file collection over ssh, same hop |
| e67 | e66 | C2 | janitor read tools, second call on the same janitor -> webapi link |
| e71 | e70 | C2 | chat.postMessage is the wire call behind the Slack confirmation |
| e72 | e94 | C2 | slack token read from the same Secrets Manager hop |
| e75 | e74 | C2 | diagnose enqueue, same webapi -> queue hop |
| e76 | e74 | C2 | reprovision enqueue, same hop |
| e41 | e36 | C2 | VerifyReimage chain, same worker -> queue hop |
| e43 | e36 | C2 | MachineAudit chain, same hop |
| e44 | e36 | C2 | Benchmark chain, same hop |
| e53 | e36 | C2 | CollectDiagnose chain, same hop |
| e58 | e57 | C2 | user-data patch, same worker -> provider hop |
| e60 | e57 | C2 | latitude import poll, same hop |
| e87 | e88 | C2 | ClusterExists check, same reconcile -> provider hop |
| e89 | e88 | C2 | ResizeCluster, same hop |
| e68 | e73 | C2 | janitor proposed-action write, same webapi -> store hop |
| e37 | e56 | C2 | audit results write, same worker -> store hop |
| e55 | e56 | C2 | state transition write, same hop |
| e59 | e56 | C2 | cluster external id write, same hop |
| e61 | e56 | C2 | imported machines write, same hop |
| e62 | e56 | C2 | sweeper scan, same hop |
| e93 | e92 | C2 | machine details list, same provider -> gcore hop |
| e25 | e24 | C4 | second artefact from the same presigned-pull hop |

## Omitted

| row | class | why |
|---|---|---|
| e21 | C1 | boot presigns the agent URL: internal S3-client call behind the drawn download |
| e27 | C1 | sshx.io installer: bootstrap helper run once per host, no protocol or store a reader needs |
| e29 | C1 | IMDS metadata read: host bootstrap detail behind the heartbeat path |
| e28 | C1 | machine-agent runs on the machine: a co-location fact, not a boundary or protocol relation |
| e30 | C1 | dmidecode/systemctl on the same host: local subprocess detail |
| e35 | C1 | audit JSON upload: object-store writer detail behind the worker path |
| e38 | C1 | image version listing: same object-store client |
| e39 | C1 | presign boot URLs: same object-store client |
| e46 | C1 | bench presigns: same object-store client |
| e47 | C1 | bench result polling: same object-store client |
| e52 | C1 | bootloader presign: same object-store client |
| e54 | C1 | worker -> janitor client: the janitor egress is drawn at L1b |
| e63 | C1 | janitor_event insert: store write behind the janitor client |
| e64 | C1 | janitor event body upload: object-store client detail |
| e69 | C1 | raw janitor event presign: object-store client detail |
| e77 | C1 | audit log presign: object-store client detail |
| e79 | C1 | webapi -> BMC service: internal routing behind the BMC route |
| e80 | C1 | BMC config persistence: store write behind the BMC service |
| e81 | C1 | BMC -> SSH tunnel: transport setup inside the BMC element |
| e83 | C1 | BMC credential minting at Latitude: provider client detail |
| e84 | C1 | BMC -> secrets cache: internal key lookup |
| e86 | C1 | reconcile -> store cluster read: internal write leg already drawn as e56/pg |
| e96 | C1 | River UI -> store: read-only surface with no boundary or protocol fact |
| e20 | C2 | boot -> provider instance validation: duplicate of the provider lookup drawn at e14 |
| e90 | C1 | reconcile -> queue poll enqueue: the follow-up of the create/resize relation drawn at e88 |
| e91 | C1 | reconcile -> queue user-data patch: same follow-up dispatch, no boundary fact |

## Per-level counts

| level | arrows |
|---|---|
| L0 | 3 |
| L1 | 6 |
| L1B | 5 |
| L2 | 7 |
| L2B | 6 |
| total | 27 |
