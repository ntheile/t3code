# Remote Agent Spec

Status: draft

Related:

- Issue `#6` (`feat: Cloud Agents`, opened February 9, 2026)
- Existing remote access notes in `REMOTE.md`

## Summary

T3 Code already has the right high-level split for a Remote Agent feature:

- the web app is a thin client over WebSocket RPC/push
- the server owns provider sessions, orchestration, PTY lifecycle, and persistence
- the current branch has started introducing `targetId` so threads and provider sessions can bind to an execution target instead of assuming `local`

This spec turns that partial `targetId` work into a full Remote Agent design:

- target-aware thread and provider execution
- remote terminal access
- remote port forwarding
- predictable reconnect/resume behavior
- an SSH-first implementation path that can later support hosted/cloud agents without changing the thread model again

## What Exists In This Branch

Uncommitted work already adds execution-target identity in the right places:

- `packages/contracts/src/executionTarget.ts` defines `ExecutionTarget`, `ExecutionTargetId`, target kinds (`local`, `ssh`, `cloud`), capability flags, and health metadata.
- `packages/contracts/src/provider.ts` adds `targetId` to `ProviderSession` and `ProviderSessionStartInput`.
- `packages/contracts/src/orchestration.ts` adds `targetId` to thread/session contracts and `thread.created`.
- `apps/server/src/orchestration/*` now carries `targetId` from command -> event -> projection -> snapshot.
- `apps/server/src/provider/*` now carries `targetId` into provider session startup/resume and persists it in the provider session directory.
- `apps/server/src/persistence/Migrations/014_RemoteTargetColumns.ts` adds `target_id` columns to thread/session/provider runtime tables.

That is the right foundation, but it is still incomplete for a usable Remote Agent feature:

- there is no persisted execution-target registry
- terminals are still implicitly local
- git/project file operations are still implicitly local
- there is no port-forwarding model or transport
- there is no remote connection manager
- there is no web UX for creating/selecting/managing targets

## Goals

- Let a thread run against a non-local execution target.
- Make Codex provider sessions run on that target.
- Give the user a terminal attached to that same target.
- Support remote port forwarding so services started on the target are reachable from the browser.
- Preserve current local behavior with `targetId = "local"` as the default.
- Keep reconnect/resume predictable when the browser disconnects, the SSH link flaps, or the provider session restarts.
- Keep the model generic enough that `ssh` and future `cloud` targets share the same orchestration contract.

## Non-Goals

- Full remote file explorer / sync in v1.
- Multi-user shared remote sessions.
- Arbitrary remote container orchestration in v1.
- Replacing the local server with a fully hosted control plane in this phase.

## Product Model

The core product abstraction should be:

- Project: local metadata owned by the T3 Code server.
- Thread: bound to exactly one `targetId`.
- Provider session: started on the thread target.
- Terminal session: started on the thread target.
- Port forwards: ephemeral resources scoped to a target, optionally attached to a thread.

The important rule is that target choice is made at thread creation time and is then stable for that thread. We should not let a running thread silently migrate between local and remote. If a user wants a different target, create a new thread or explicit clone/fork workflow later.

## Proposed Architecture

### 1. Execution Target Registry

Add a first-class server service and persistence layer for execution targets.

New server module:

- `ExecutionTargetService`

Responsibilities:

- list targets
- create/update/delete targets
- validate target config
- report health/capabilities
- resolve target by id for downstream services
- reserve `local` as a synthetic built-in target

Persistence:

- new `execution_targets` table
- store target metadata, kind, label, connection payload, capabilities override, health cache timestamps, and soft-delete marker if needed

Notes:

- `local` should not require a DB row; expose it as a built-in target returned by the service.
- SSH secrets should not be stored in plaintext in contracts or pushed to the browser. Persist only stable config. Credentials should come from SSH agent, key path, or OS secret storage later.

### 2. Target-Aware Runtime Routing

Introduce a small runtime boundary instead of teaching every subsystem how SSH works.

New server abstraction:

- `ExecutionTargetRuntime`

Methods:

- `startProviderSession(...)`
- `openTerminal(...)`
- `writeTerminal(...)`
- `resizeTerminal(...)`
- `restartTerminal(...)`
- `closeTerminal(...)`
- `openPortForward(...)`
- `closePortForward(...)`
- `checkHealth(...)`

Implementations:

- `LocalExecutionTargetRuntime`
- `SshExecutionTargetRuntime`
- later: `CloudExecutionTargetRuntime`

This keeps orchestration/provider/terminal code target-agnostic. The current branch has already started this pattern for providers by threading `targetId`; this spec extends the same idea to terminals and port forwards.

### 3. SSH Runtime

SSH should be the first non-local target kind.

`SshExecutionTargetRuntime` responsibilities:

- create and maintain a long-lived SSH control connection per target
- execute remote commands for provider startup
- host terminal PTYs on the remote machine
- maintain port-forward tunnels
- surface health and degraded/unreachable states

Recommended implementation direction:

- use OpenSSH (`ssh`) initially, not a bespoke Node SSH stack
- prefer `ControlMaster` / `ControlPath` / `ControlPersist` so provider, terminal, and port-forward operations share one connection
- keep target runtime state server-side and reconnect lazily when needed

Why this direction:

- leverages the user’s existing SSH config and agent setup
- behaves more like “VS Code Remote SSH”
- avoids reimplementing SSH auth, host key handling, and multiplexing in app code

### 4. Remote Codex Provider Execution

Provider startup should become target-routed instead of always local.

For SSH targets, the server should start the remote provider process over SSH and then bridge stdio or a framed stream back into the existing provider adapter path.

Two viable designs:

1. SSH command bridge

- Run `codex app-server` remotely through SSH.
- Tunnel its stdio back to the local T3 Code server.
- Keep orchestration and event logging local.

2. Remote sidecar

- Run a small remote helper process that owns provider and PTY lifecycle remotely.
- The local T3 Code server talks to the helper over a stable RPC channel.

Recommendation:

- start with the SSH command bridge
- introduce a sidecar only if PTY and port-forward lifecycle become too awkward over raw SSH orchestration

This matches the current codebase better because `apps/server` already expects to own provider session state, persistence, and orchestration receipts locally.

### 5. Remote Terminal Execution

The current terminal system is local-only. `TerminalOpenInput` and related WS methods need to become target-aware.

Contract change:

- add `targetId` to terminal input/output/event schemas, defaulting to `local`

Runtime rule:

- terminal routing should follow `targetId`, not just `threadId`
- thread terminal opens should default to the thread target
- ad hoc terminal opens may optionally specify a target explicitly later

Recommended implementation:

- refactor `TerminalManager` into a target-aware router
- preserve the current PTY manager as the local implementation
- add a remote PTY implementation under the SSH runtime

Persistence:

- terminal history can remain local to the T3 Code server even for remote sessions
- this improves reconnect behavior and avoids remote disk coupling

### 6. Port Forwarding

Port forwarding is a first-class feature, not an incidental terminal trick.

Add new contracts:

- `PortForwardId`
- `PortForwardSpec`
- `PortForwardSession`
- `portForward.open`
- `portForward.close`
- `portForward.list`
- push events for opened/closed/error/health-changed

`PortForwardSession` should include:

- `id`
- `targetId`
- `threadId?`
- `remoteHost`
- `remotePort`
- `localPort`
- `protocolHint?` (`http`, `https`, `tcp`)
- `label?`
- `status`
- `createdAt`

Behavior:

- for SSH, use local bind + remote destination forwarding managed by the server
- expose browser-friendly URLs when possible
- auto-reconnect forwards when the SSH transport reconnects
- clean up forwards when the owning target is deleted or explicitly closed

### 7. Git and Workspace Operations

Remote Agent is incomplete if only provider and terminal are remote while git/file actions still hit local disk.

We need a clear rule:

- v1 thread-scoped git and workspace operations should execute against the thread target

That implies adding `targetId` or target resolution to:

- git RPC methods when invoked from a thread/worktree context
- project search/write methods when invoked for a remote-backed thread

Pragmatic v1 boundary:

- keep project registry local
- keep project metadata local
- execute git/file operations remotely only when the user is inside a remote-backed thread rooted at a remote workspace path

This avoids redesigning the whole app around remote projects while still making the main thread workflow coherent.

### 8. Web UX

Add a visible target model to the app.

Required UX:

- target picker on thread creation
- target badge in thread header/sidebar
- target health state
- remote terminal indicator
- port forwards panel with copy/open actions

Recommended initial UX flow:

1. User creates a target from Settings or a lightweight “Add remote” dialog.
2. User creates a thread and selects `Local` or an SSH target.
3. T3 Code starts provider + terminal on that target.
4. If the agent or user starts a dev server remotely, user creates a port forward and opens it from the browser.

Important UX rule:

- make the target explicit everywhere the user could otherwise be confused about where commands are running

## Contract Changes

### Already Started

- `ExecutionTarget` schema
- `targetId` on provider session and orchestration thread/session records

### Still Needed

- execution-target WS methods:
  - `executionTarget.list`
  - `executionTarget.upsert`
  - `executionTarget.remove`
  - `executionTarget.checkHealth`
- execution-target push channel for health/status changes
- `targetId` on terminal contracts and terminal push events
- port-forward contracts and WS methods
- target-aware variants or resolution rules for git/project methods

## Persistence Changes

Already in branch:

- `target_id` added to thread/session/provider runtime tables

Still needed:

- `execution_targets`
- optional `execution_target_health_cache`
- optional `port_forward_sessions` if we want restore/debug visibility across reconnects

We should not store ephemeral SSH process ids as durable truth. Persist intent/config; rebuild runtime state on boot.

## Failure Model

This feature is only worth shipping if failures are predictable.

Expected failure cases:

- browser reconnect
- local server restart
- SSH transport drops
- remote host unreachable
- remote provider process dies
- port forward bind conflict

Required behavior:

- browser reconnect should replay orchestration state and terminal history from the local server
- local server restart should restore target registry and thread target bindings, then lazily recreate remote runtime state
- SSH drop should mark target `degraded` or `unreachable` and move sessions into a recoverable error state
- remote provider death should surface as a provider session error, not a silent stop
- port forward conflicts should fail with explicit local-port errors

## Security

- Treat SSH targets as privileged execution environments.
- Never send private keys over WebSocket.
- Use existing SSH config/agent where possible.
- Respect host key verification; do not silently disable it.
- Keep auth-token requirements for remote browser access as documented in `REMOTE.md`.
- Do not expose forwarded ports beyond localhost by default.

## Implementation Plan

### Phase 0: Normalize Current Branch Work

- keep the `targetId` changes already in contracts/orchestration/provider/persistence
- add tests around thread creation, provider session start/resume, and snapshot decoding with non-local targets
- finish plumbing any remaining server read models so `targetId` is never dropped

### Phase 1: Execution Target Registry

- add persistence + service for execution targets
- add WS methods and basic settings UI
- expose built-in `local` target plus saved SSH targets

### Phase 2: Provider Remote Execution

- implement `ExecutionTargetRuntime`
- route provider startup through local/SSH runtimes
- support remote `codex app-server` over SSH
- keep orchestration/persistence local

### Phase 3: Remote Terminal

- add `targetId` to terminal contracts
- refactor `TerminalManager` into a target-aware router
- implement SSH-backed PTY lifecycle
- preserve local terminal history and push semantics

### Phase 4: Port Forwarding

- add port-forward contracts, runtime manager, and UI
- support open/list/close flows
- surface open-in-browser actions

### Phase 5: Target-Aware Git/File Operations

- route thread-scoped git/project operations through the target runtime
- keep local behavior unchanged for `local`

## Suggested File/Module Shape

Server:

- `apps/server/src/executionTarget/Services/ExecutionTargetService.ts`
- `apps/server/src/executionTarget/Layers/ExecutionTargetService.ts`
- `apps/server/src/executionTarget/Services/ExecutionTargetRuntime.ts`
- `apps/server/src/executionTarget/Layers/LocalExecutionTargetRuntime.ts`
- `apps/server/src/executionTarget/Layers/SshExecutionTargetRuntime.ts`
- `apps/server/src/portForward/*`

Contracts:

- expand `packages/contracts/src/executionTarget.ts`
- add `packages/contracts/src/portForward.ts`
- extend `terminal.ts`, `project.ts`, `git.ts`, and `ws.ts`

Web:

- target settings UI
- target picker in thread creation
- target status badges
- port forwards panel

## Open Questions

1. Should v1 remote git/file operations be fully supported, or do we explicitly scope v1 to remote provider + terminal + manual path knowledge?
2. Do we want remote terminals to require a thread, or allow free-standing target terminals?
3. Is SSH enough for the first ship, with `cloud` kept as schema-only for now? This is the recommended path.
4. Do we want a remote helper/sidecar from the start, or only after proving the SSH bridge is insufficient? The recommended path is bridge first.

## Recommendation

Ship this as an SSH-first Remote Agent feature built on the `targetId` groundwork already in the branch.

The next concrete milestone should be:

1. finish and test the current `targetId` propagation
2. add a real execution target registry
3. route provider startup through an SSH runtime
4. make terminal contracts target-aware
5. add port forwarding after provider + terminal are stable

That keeps the architecture aligned with the existing server-owned orchestration model and avoids a premature hosted-agent redesign.
