# Remote Agent Checklist

Status: draft

Related:

- [Remote Agent Spec](/home/clawd/code/t3code/docs/remote-agent-spec.md)
- Issue `#6`

## Usage

This is the execution checklist for the Remote Agent spec. It is ordered to preserve local behavior while incrementally introducing remote execution.

Task status markers:

- `[ ]` not started
- `[~]` in progress
- `[x]` complete

## Phase 0: Stabilize `targetId` Foundation

Goal: finish the current branch’s target plumbing so `local` remains the default and non-local targets can flow through the system without type/runtime gaps.

### Contracts

- [x] Keep `ExecutionTarget` definitions in [packages/contracts/src/executionTarget.ts](/home/clawd/code/t3code/packages/contracts/src/executionTarget.ts).
- [x] Keep `targetId` on provider/orchestration thread and session contracts in [packages/contracts/src/provider.ts](/home/clawd/code/t3code/packages/contracts/src/provider.ts) and [packages/contracts/src/orchestration.ts](/home/clawd/code/t3code/packages/contracts/src/orchestration.ts).
- [ ] Decide final contract strictness:
  - Option A: keep `targetId` optional at input/fixture boundaries with server-side defaulting.
  - Option B: make `targetId` fully required everywhere after all callers are migrated.

### Server

- [x] Ensure thread creation defaults to `local` in [apps/server/src/orchestration/decider.ts](/home/clawd/code/t3code/apps/server/src/orchestration/decider.ts).
- [x] Ensure projections default missing target ids to `local` in [apps/server/src/orchestration/projector.ts](/home/clawd/code/t3code/apps/server/src/orchestration/projector.ts) and [apps/server/src/orchestration/Layers/ProjectionPipeline.ts](/home/clawd/code/t3code/apps/server/src/orchestration/Layers/ProjectionPipeline.ts).
- [x] Ensure provider session routing defaults to `local` in [apps/server/src/provider/Layers/ProviderService.ts](/home/clawd/code/t3code/apps/server/src/provider/Layers/ProviderService.ts), [apps/server/src/codexAppServerManager.ts](/home/clawd/code/t3code/apps/server/src/codexAppServerManager.ts), [apps/server/src/orchestration/Layers/ProviderCommandReactor.ts](/home/clawd/code/t3code/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts), and [apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts](/home/clawd/code/t3code/apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts).
- [ ] Audit remaining server test fixtures for implicit-local assumptions and either add `targetId` explicitly or rely on the optional-contract path consistently.

### Web

- [x] Add `targetId` to in-memory thread/session types in [apps/web/src/types.ts](/home/clawd/code/t3code/apps/web/src/types.ts).
- [x] Map read model target ids into UI state in [apps/web/src/store.ts](/home/clawd/code/t3code/apps/web/src/store.ts).
- [x] Update draft thread creation paths to pass the active target in [apps/web/src/components/ChatView.tsx](/home/clawd/code/t3code/apps/web/src/components/ChatView.tsx).
- [ ] Add a visible-but-minimal target badge to thread UI so non-local behavior is never invisible.

### Exit Criteria

- [x] `bun fmt`
- [x] `bun lint`
- [x] `bun typecheck`
- [ ] A non-local `thread.create` command can round-trip through command -> event -> projection -> snapshot without dropping `targetId`.

## Phase 1: Execution Target Registry

Goal: add a first-class target registry before implementing remote execution.

### Contracts

- [ ] Expand [packages/contracts/src/executionTarget.ts](/home/clawd/code/t3code/packages/contracts/src/executionTarget.ts) with:
  - persisted target metadata shape
  - create/update input schemas
  - target health check result schema
- [ ] Extend [packages/contracts/src/ws.ts](/home/clawd/code/t3code/packages/contracts/src/ws.ts) with:
  - `executionTarget.list`
  - `executionTarget.upsert`
  - `executionTarget.remove`
  - `executionTarget.checkHealth`
  - push channel for target health/status updates
- [ ] Export new schemas from [packages/contracts/src/index.ts](/home/clawd/code/t3code/packages/contracts/src/index.ts).

### Persistence

- [ ] Add migration for `execution_targets` under [apps/server/src/persistence/Migrations](/home/clawd/code/t3code/apps/server/src/persistence/Migrations).
- [ ] Add repository service under:
  - [apps/server/src/persistence/Services](/home/clawd/code/t3code/apps/server/src/persistence/Services)
  - [apps/server/src/persistence/Layers](/home/clawd/code/t3code/apps/server/src/persistence/Layers)
- [ ] Decide whether health cache is embedded in the main table or split into a secondary table.

### Server

- [ ] Create `ExecutionTargetService`:
  - `apps/server/src/executionTarget/Services/ExecutionTargetService.ts`
  - `apps/server/src/executionTarget/Layers/ExecutionTargetService.ts`
- [ ] Implement synthetic built-in `local` target that does not require DB persistence.
- [ ] Validate SSH target config without storing secrets in the browser-facing contract.
- [ ] Wire the service into [apps/server/src/serverLayers.ts](/home/clawd/code/t3code/apps/server/src/serverLayers.ts).
- [ ] Add WS handlers in [apps/server/src/wsServer.ts](/home/clawd/code/t3code/apps/server/src/wsServer.ts).

### Web

- [ ] Add native API calls in [apps/web/src/wsNativeApi.ts](/home/clawd/code/t3code/apps/web/src/wsNativeApi.ts).
- [ ] Add target query helpers under [apps/web/src/lib](/home/clawd/code/t3code/apps/web/src/lib).
- [ ] Add a settings UI surface, likely via [apps/web/src/routes/\_chat.settings.tsx](/home/clawd/code/t3code/apps/web/src/routes/_chat.settings.tsx).
- [ ] Support:
  - list targets
  - create SSH target
  - rename/delete target
  - trigger health check

### Exit Criteria

- [ ] User can create an SSH target and see it in settings.
- [ ] `local` always appears even with an empty DB.
- [ ] Health check results are visible and survive snapshot refreshes.

## Phase 2: Target Runtime Abstraction

Goal: introduce a runtime boundary so remote execution logic does not leak into orchestration, provider, terminal, and WS layers.

### Server

- [ ] Add `ExecutionTargetRuntime` service:
  - [apps/server/src/executionTarget/Services/ExecutionTargetRuntime.ts](/home/clawd/code/t3code/apps/server/src/executionTarget/Services/ExecutionTargetRuntime.ts)
- [ ] Add implementations:
  - [apps/server/src/executionTarget/Layers/LocalExecutionTargetRuntime.ts](/home/clawd/code/t3code/apps/server/src/executionTarget/Layers/LocalExecutionTargetRuntime.ts)
  - [apps/server/src/executionTarget/Layers/SshExecutionTargetRuntime.ts](/home/clawd/code/t3code/apps/server/src/executionTarget/Layers/SshExecutionTargetRuntime.ts)
- [ ] Add runtime lookup/resolution based on `targetId`.
- [ ] Keep `LocalExecutionTargetRuntime` as a thin adapter over current local provider/PTY/process behavior.
- [ ] Wire the runtime service into [apps/server/src/serverLayers.ts](/home/clawd/code/t3code/apps/server/src/serverLayers.ts).

### Design Decision

- [ ] Decide whether `ExecutionTargetRuntime` owns:
  - provider only in phase 2, terminal later
  - or provider + terminal from the start

Recommendation:

- start with provider routing first
- add terminal routing in phase 3

### Exit Criteria

- [ ] Local behavior is unchanged when `targetId = local`.
- [ ] Provider startup path resolves a runtime by target instead of assuming local execution.

## Phase 3: SSH Provider Execution

Goal: start Codex provider sessions remotely over SSH while keeping orchestration and persistence local.

### SSH Transport

- [ ] Implement OpenSSH-based connection management in [apps/server/src/executionTarget/Layers/SshExecutionTargetRuntime.ts](/home/clawd/code/t3code/apps/server/src/executionTarget/Layers/SshExecutionTargetRuntime.ts).
- [ ] Use `ssh` with control socket multiplexing:
  - `ControlMaster`
  - `ControlPath`
  - `ControlPersist`
- [ ] Decide control socket storage path under the server state dir.
- [ ] Add health probes:
  - initial connect
  - reconnect after drop
  - unreachable host classification

### Provider Integration

- [ ] Refactor [apps/server/src/provider/Layers/CodexAdapter.ts](/home/clawd/code/t3code/apps/server/src/provider/Layers/CodexAdapter.ts) so provider startup can be delegated through the target runtime.
- [ ] Refactor [apps/server/src/codexAppServerManager.ts](/home/clawd/code/t3code/apps/server/src/codexAppServerManager.ts) to support remote app-server stdio bridging.
- [ ] Preserve:
  - resume cursor handling
  - event logging
  - runtime payload persistence
  - restart semantics

### Failure Handling

- [ ] Mark session state predictably when SSH drops mid-session.
- [ ] Distinguish:
  - target unreachable
  - remote process exit
  - local bridge failure

### Exit Criteria

- [ ] A thread bound to an SSH target can start a Codex session.
- [ ] Existing local provider tests still pass.
- [ ] Remote failure surfaces as explicit session error state.

## Phase 4: Target Selection UX

Goal: expose target selection in the thread lifecycle before terminal and port-forward features deepen the experience.

### Web

- [ ] Add target picker to new-thread flow in [apps/web/src/components/ChatView.tsx](/home/clawd/code/t3code/apps/web/src/components/ChatView.tsx).
- [ ] Show target badge in:
  - [apps/web/src/components/Sidebar.tsx](/home/clawd/code/t3code/apps/web/src/components/Sidebar.tsx)
  - [apps/web/src/components/ChatView.tsx](/home/clawd/code/t3code/apps/web/src/components/ChatView.tsx)
- [ ] Add target health indicator where thread/session state is already shown.
- [ ] Prevent silent target changes for existing threads.

### Store / Queries

- [ ] Add target list cache/query utilities.
- [ ] Store selected target for draft-thread creation.
- [ ] Ensure thread creation dispatch includes `targetId` consistently.

### Exit Criteria

- [ ] User can create a thread against `local` or a saved SSH target.
- [ ] Thread UI always makes the execution target visible.

## Phase 5: Remote Terminal

Goal: make terminal lifecycle target-aware and support SSH-backed PTYs.

### Contracts

- [ ] Extend [packages/contracts/src/terminal.ts](/home/clawd/code/t3code/packages/contracts/src/terminal.ts) with `targetId` on:
  - open/restart inputs
  - session snapshot
  - terminal events
- [ ] Extend [packages/contracts/src/ws.ts](/home/clawd/code/t3code/packages/contracts/src/ws.ts) if any terminal RPC payloads need explicit target resolution.

### Server

- [ ] Split the current local PTY orchestration into:
  - target-aware router in [apps/server/src/terminal/Layers/Manager.ts](/home/clawd/code/t3code/apps/server/src/terminal/Layers/Manager.ts)
  - local PTY implementation that reuses current logic
- [ ] Route terminal operations by `targetId`.
- [ ] Implement SSH PTY lifecycle under the SSH runtime.
- [ ] Preserve local terminal history persistence on the T3 Code server.

### Web

- [ ] Include `targetId` when opening thread terminals from [apps/web/src/components/ThreadTerminalDrawer.tsx](/home/clawd/code/t3code/apps/web/src/components/ThreadTerminalDrawer.tsx).
- [ ] Show remote/local indicator in terminal UI.
- [ ] Ensure reconnect behavior still hydrates terminal history and activity state.

### Exit Criteria

- [ ] Terminal opens against the thread target.
- [ ] Browser reconnect restores terminal history for remote sessions.
- [ ] Local terminal behavior is unchanged.

## Phase 6: Port Forwarding

Goal: add explicit, stable port-forwarding instead of forcing users to manage tunnels manually.

### Contracts

- [ ] Add [packages/contracts/src/portForward.ts](/home/clawd/code/t3code/packages/contracts/src/portForward.ts) with:
  - `PortForwardId`
  - `PortForwardSession`
  - open/list/close schemas
  - port-forward event schemas
- [ ] Export from [packages/contracts/src/index.ts](/home/clawd/code/t3code/packages/contracts/src/index.ts).
- [ ] Add RPC methods and push channels in [packages/contracts/src/ws.ts](/home/clawd/code/t3code/packages/contracts/src/ws.ts).

### Server

- [ ] Add `apps/server/src/portForward/Services/PortForwardManager.ts`
- [ ] Add `apps/server/src/portForward/Layers/PortForwardManager.ts`
- [ ] Add SSH-backed implementation for opening local bind -> remote destination tunnels.
- [ ] Optionally persist session metadata if reconnect visibility is needed.
- [ ] Add WS handlers/push fanout in [apps/server/src/wsServer.ts](/home/clawd/code/t3code/apps/server/src/wsServer.ts).

### Web

- [ ] Add native API methods in [apps/web/src/wsNativeApi.ts](/home/clawd/code/t3code/apps/web/src/wsNativeApi.ts).
- [ ] Add a port-forward panel in the main thread UI or terminal drawer.
- [ ] Support:
  - open forward
  - list active forwards
  - close forward
  - open forwarded URL in browser
  - copy local URL

### Exit Criteria

- [ ] User can open a forward from a remote thread.
- [ ] Forward reconnects or fails explicitly after SSH interruptions.
- [ ] Local ports bind to localhost by default.

## Phase 7: Target-Aware Git and Workspace Ops

Goal: make thread-scoped git/file actions execute where the thread actually lives.

### Git

- [ ] Audit RPC shapes in [packages/contracts/src/git.ts](/home/clawd/code/t3code/packages/contracts/src/git.ts).
- [ ] Decide whether to add explicit `targetId` or infer it from `threadId` / thread context.
- [ ] Route server-side git operations through target runtime when acting on remote-backed thread worktrees.
- [ ] Preserve current local performance path for local threads.

### Project / Files

- [ ] Audit [packages/contracts/src/project.ts](/home/clawd/code/t3code/packages/contracts/src/project.ts).
- [ ] Route search/write operations through target runtime when invoked in remote thread context.
- [ ] Keep project registry itself local.

### Exit Criteria

- [ ] Thread-scoped git status/branch/worktree flows operate on the correct machine.
- [ ] File writes/searches from remote thread workflows do not accidentally hit local disk.

## Phase 8: Hardening

Goal: make failure and reconnect behavior predictable under real-world conditions.

### Reliability

- [ ] Add tests for:
  - SSH unreachable on startup
  - SSH drop mid-provider-session
  - SSH drop mid-terminal
  - port-forward local port collision
  - server restart with saved targets
  - browser reconnect during active remote work
- [ ] Add structured logging around target connect/disconnect and tunnel lifecycle.
- [ ] Add metrics or at least counters for:
  - target health transitions
  - reconnect attempts
  - provider remote startup failures
  - port-forward failures

### Security

- [ ] Audit target create/update flows for secret leakage.
- [ ] Ensure SSH host key verification remains enabled.
- [ ] Ensure remote browser exposure still requires auth token when configured as documented in [REMOTE.md](/home/clawd/code/t3code/REMOTE.md).

### Exit Criteria

- [ ] Remote agent sessions degrade visibly instead of failing silently.
- [ ] Recovery paths are tested, not assumed.

## Recommended First Milestone

If the goal is to start building immediately with the best leverage, do this sequence first:

1. [ ] Finish Phase 1 execution target registry.
2. [ ] Introduce `ExecutionTargetRuntime` with local + SSH stubs.
3. [ ] Route provider startup through the runtime.
4. [ ] Add target picker to thread creation.
5. [ ] Defer remote terminal and port forwarding until remote provider startup is stable.

## File Hotspots

These are the highest-value files to touch first:

- [packages/contracts/src/executionTarget.ts](/home/clawd/code/t3code/packages/contracts/src/executionTarget.ts)
- [packages/contracts/src/orchestration.ts](/home/clawd/code/t3code/packages/contracts/src/orchestration.ts)
- [packages/contracts/src/ws.ts](/home/clawd/code/t3code/packages/contracts/src/ws.ts)
- [apps/server/src/serverLayers.ts](/home/clawd/code/t3code/apps/server/src/serverLayers.ts)
- [apps/server/src/wsServer.ts](/home/clawd/code/t3code/apps/server/src/wsServer.ts)
- [apps/server/src/provider/Layers/ProviderService.ts](/home/clawd/code/t3code/apps/server/src/provider/Layers/ProviderService.ts)
- [apps/server/src/provider/Layers/CodexAdapter.ts](/home/clawd/code/t3code/apps/server/src/provider/Layers/CodexAdapter.ts)
- [apps/server/src/codexAppServerManager.ts](/home/clawd/code/t3code/apps/server/src/codexAppServerManager.ts)
- [apps/server/src/terminal/Layers/Manager.ts](/home/clawd/code/t3code/apps/server/src/terminal/Layers/Manager.ts)
- [apps/web/src/components/ChatView.tsx](/home/clawd/code/t3code/apps/web/src/components/ChatView.tsx)
- [apps/web/src/components/ThreadTerminalDrawer.tsx](/home/clawd/code/t3code/apps/web/src/components/ThreadTerminalDrawer.tsx)
- [apps/web/src/routes/\_chat.settings.tsx](/home/clawd/code/t3code/apps/web/src/routes/_chat.settings.tsx)
