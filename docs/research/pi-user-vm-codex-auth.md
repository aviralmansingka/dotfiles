# Isolated Codex authentication for User VMs

Research date: 2026-07-23  
Ticket: [#60](https://github.com/aviralmansingka/dotfiles/issues/60)  
Map: [#47](https://github.com/aviralmansingka/dotfiles/issues/47)

## Finding

The requested arrangement is **not deployable with Aviral's personal ChatGPT Plus/Pro account**. OpenAI permits one person to use their account on multiple devices, but says the account is for the individual who created it, another person must create their own account, and account credentials/account access may not be shared. Four VMs operated by Aviral, Taruni, Ranga, and Mom are four users, not four devices used by Aviral.

The isolation-preserving contract must therefore share billing/workspace entitlement, if OpenAI offers a suitable plan, **not Aviral's login**: each User VM must be authorized by its intended user's own OpenAI identity/seat. Do not authorize Aviral's personal account in another user's VM. OpenAI documents Codex on Business and per-seat limits, but Pi 0.81.1's provider documentation explicitly promises only ChatGPT Plus/Pro; verify the selected multi-user plan with OpenAI and Pi before deployment.

This corrects the current `Shared Model Entitlement` assumption: a shared external billing/workspace boundary can coexist with independent deployments; a shared personal account cannot.

## Deployment contract

### Authorization ceremony

For each User VM, independently:

1. Start from an identity-empty Golden Image. It must contain no Pi auth file, sessions, model token, account identifier, browser profile, or other integration state.
2. Create a distinct OS user/home and VM-local Pi directory (`$PI_CODING_AGENT_DIR`, default `~/.pi/agent`). Do not mount or sync another deployment's Pi directory.
3. The intended user signs in with their own approved OpenAI account/seat from Pi using `/login openai-codex`. On a headless VM, select **Device code login (headless)**; OpenAI requires device-code login to be enabled in ChatGPT security/workspace settings. The user opens the displayed OpenAI URL, signs in, and enters the one-time code. Browser login is an alternative, but Pi's callback is localhost port 1455 and is less convenient remotely.
4. Pi writes the resulting OAuth credential locally. The one-time code, authorization URL parameters, access token, and refresh token must never enter bootstrap data, logs, tickets, Git, shell history, the Onboarding Coordinator, or another VM.
5. Run the non-secret structural and live model checks below, then restart Pi and the VM and repeat the live check.

Aviral may perform the ceremony on multiple machines only when he is the actual user of each machine. That documented multiple-device allowance does not authorize Taruni, Ranga, or Mom to operate his account through their Agent Instances.

### Files and isolation boundary

| State | Contract |
| --- | --- |
| Pi model credential | `$PI_CODING_AGENT_DIR/auth.json` (normally `~/.pi/agent/auth.json`), entry `openai-codex`. Pi stores an OAuth access token, refresh token, expiry, and opaque ChatGPT account ID. Treat the complete file as a password. Parent directory `0700`; file `0600`; VM user-owned. |
| Other Pi provider credentials | Pi uses the same `auth.json` for all providers. Never copy the whole file to distribute model access; doing so can also copy unrelated provider credentials. Prefer an `auth.json` containing only that VM's own provider grants. |
| Pi sessions | `$PI_CODING_AGENT_DIR/sessions/` by default. Session JSONL contains prompts, responses, tool calls/results, and working-directory metadata. It is not part of Codex authorization and must remain VM-local. |
| Codex CLI cache | OpenAI Codex CLI uses `~/.codex/auth.json` or an OS keyring. It is a different product path/schema and is not an import source for Pi's `~/.pi/agent/auth.json`. |
| MCP/integration credentials | Remain in each integration's VM-local store. They are never added to a model-auth seed or shared directory merely because Codex billing is shared. |
| Images, snapshots, and backups | Golden Images contain none of the above. Prepared-VM backups containing OAuth state must be encrypted, access-controlled as credentials, and included in destruction/revocation procedures. |

Pi's documented `PI_CODING_AGENT_DIR` override and SDK `authPath` make the location configurable; the deployment must pick exactly one VM-local path so daemons and interactive Pi do not accidentally use different auth/session roots.

### Portability constraints

- **Required path: fresh authorization per VM and per intended user.** No centralized token broker, shared filesystem, shared `auth.json`, or token distribution service.
- OpenAI documents copying the official Codex CLI's `~/.codex/auth.json` to a trusted headless machine as a fallback for the *same user*. That does not document Pi cache portability and does not override the account-sharing policy.
- Pi's installed implementation stores bearer OAuth material without an evident machine-binding field, so a copied Pi entry may appear to work. This is observed implementation detail, not a supported deployment contract. A copied refresh token also creates an unverified refresh-rotation/concurrency failure mode.
- A separate OAuth login on every VM avoids shared refresh-token bytes, but separate logins to Aviral's personal account still do not make use by other people permissible.
- All VMs consume the limits/credits of whatever workspace/account grants access; independent VM state does not create independent model quotas.

### Refresh, logout, and revocation

- Pi automatically refreshes an expired access token using the stored refresh token and rewrites `auth.json` under a file lock. The file must remain writable and `0600`; a read-only secret mount will eventually fail.
- Pi `/logout` removes only the selected provider's local `auth.json` entry. The installed OpenAI Codex provider has no revocation call, and OpenAI describes client logout as clearing current credentials. Therefore `/logout` is **local removal, not proven server-side revocation**.
- For normal VM retirement: stop Pi, run `/logout` (or delete only the `openai-codex` entry through Pi), verify it is absent, verify a Codex request fails, then destroy credential-bearing snapshots/backups according to retention policy.
- For suspected compromise: use ChatGPT **Log out all**, allow OpenAI's documented propagation window of up to 30 minutes, change the password where applicable, review sign-in methods, enable MFA, and contact OpenAI Support. Then verify every affected Pi credential fails before reauthorizing approved VMs.
- OpenAI's Active Sessions UI explicitly does not show or manage Codex CLI sessions, and no authoritative source found a per-Pi/per-CLI OAuth-grant revocation control. Whether ChatGPT **Log out all** invalidates Pi's third-party refresh token is an unknown that must be tested safely or confirmed by OpenAI before it is used as the recovery guarantee.
- Removing one user/seat from a future managed workspace should be tested to prove that the removed VM can no longer refresh or call Codex while other users continue normally.

## Validation gates

Checks must report only pass/fail, paths, ownership/mode, provider names, counts, and hashes used solely for equality comparison—never token values or full credential JSON.

### Golden Image

- `auth.json` is absent or empty; no `openai-codex` entry exists.
- No Pi session JSONL, private vault, MCP token store, transport token, browser profile, or deployment identity exists.
- Repository and image secret scans pass.

### Each prepared VM

- `$PI_CODING_AGENT_DIR` resolves inside that VM's private home; no bind mount, network share, or host symlink reaches another deployment.
- `auth.json` is owned by the VM user, mode `0600`, and structurally contains a non-empty `openai-codex` OAuth record with access, refresh, numeric expiry, and account ID fields. Validation must inspect types/field presence only.
- The authorized identity/seat is the intended user's, confirmed during the OpenAI ceremony; it is not inferred solely from an opaque token claim.
- A no-session, no-tools, fixed-model smoke request succeeds through provider `openai-codex`. Repeat after Pi restart and VM reboot.
- After a natural access-token expiry, another smoke request succeeds and `auth.json` remains valid, user-owned, and `0600`. Do not force expiry by editing a production credential.

### Four-VM isolation

- The four Pi directories and session stores are distinct. Creating/resetting a session in VM A does not alter session counts or files in B/C/D.
- Credential fingerprints created locally for comparison show no identical access or refresh token across VMs. The fingerprints themselves are not exported or committed.
- A structural inventory proves no non-model credential/token fingerprint is shared across VMs. Shared source code and model workspace/billing identifiers are the only allowed common values.
- Stop each VM in turn and prove the other three continue model calls independently.
- Exhaustion/rate-limit tests, if performed, are expected to demonstrate shared workspace/account capacity without coupling local sessions.

### Revocation

- `/logout` in one VM removes its local `openai-codex` entry and makes its next model request fail without deleting its sessions or any other VM's credential.
- Managed-seat removal (if selected) blocks only that user after propagation.
- A rehearsed compromise procedure proves the documented global action and recovery behavior before production reliance; until then, treat server-side Pi refresh-token revocation as unverified.

## Evidence classification

### Documented facts

- Pi supports ChatGPT Plus/Pro Codex via `/login`, stores and refreshes OAuth credentials in `~/.pi/agent/auth.json`, creates that file as `0600`, and stores sessions separately in `~/.pi/agent/sessions/`.
- Pi provides browser and headless device-code login; the installed 0.81.1 flow requests `openid profile email offline_access` and stores `type`, `access`, `refresh`, `expires`, and `accountId`.
- OpenAI permits an individual's account on multiple devices but prohibits use of that account by other people.
- OpenAI says cached auth files contain access tokens and must be treated like passwords; ChatGPT-login tokens refresh automatically.
- OpenAI's Active Sessions UI excludes Codex CLI sessions; global logout can take up to 30 minutes.

### Safe local observations (no secret values read or printed)

On this workstation with Pi and `@earendil-works/pi-ai` 0.81.1:

- `~/.pi/agent/auth.json` exists, is owned by the local user, and is mode `0600`.
- Its only provider key is `openai-codex`; that entry has exactly the documented OAuth field names and passed type/presence checks.
- Its access-token expiry was in the future at inspection time.
- Pi sessions are separate files under `~/.pi/agent/sessions/`.

### Unknowns requiring confirmation or a safe experiment

1. Which compliant multi-user OpenAI plan/workspace should provide shared billing, and whether Pi 0.81.1's `openai-codex` OAuth path supports it without relying on undocumented behavior.
2. Whether separate successful Pi logins create independently revocable grants and whether refresh-token rotation affects copied credentials. The contract avoids copying regardless.
3. Whether ChatGPT **Log out all** or managed-seat removal invalidates Pi's refresh token, and the actual propagation time.
4. Whether Pi can expose enough non-secret identity/workspace metadata to automate intended-seat verification; today the ceremony must confirm it directly.

## Sources

- [Pi Providers: subscriptions, auth file, permissions, resolution](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/providers.md)
- [Pi README: config directory, sessions, and login/logout](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/README.md)
- [Pi Security and Containerization](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/security.md)
- Installed Pi 0.81.1 implementation: `dist/core/auth-storage.js`, `@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js`, and `@earendil-works/pi-ai/dist/auth/resolve.js`
- [OpenAI Codex authentication](https://developers.openai.com/codex/auth)
- [OpenAI Codex pricing](https://developers.openai.com/codex/pricing)
- [OpenAI Account Sharing Policy](https://help.openai.com/en/articles/10471989-openai-account-sharing-policy)
- [OpenAI Terms of Use, Registration](https://openai.com/policies/terms-of-use/)
- [Managing active sessions in ChatGPT](https://help.openai.com/en/articles/20001257-managing-active-sessions-in-chatgpt)
- [Log out of all devices](https://help.openai.com/en/articles/9243857-how-do-i-log-out-of-all-of-my-devices)
- Project context and ADRs: `/Users/aviral/vault/projects/pi-agent/CONTEXT.md`, ADRs 0001, 0002, 0009, and 0010
