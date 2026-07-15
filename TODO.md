# TODO

Open follow-ups for the in-canvas execution feature (`users/k_sfar/execution_in_main_ui`).

These came out of an adversarial review of the execution data-flow (frontend SSE/state +
backend event contract). The clear-cut bugs were already fixed on this branch (see
**Done** at the bottom); the items below were deferred because they need a product/design
decision or a riskier change rather than a mechanical fix. Background: Serena memory
`frontend/execution_overlay`.

---

## 1. Branched-graph `PartiallyFailed` semantics — freezes live branches & never upgrades (HIGH)

**Where:** `src/main-api/.../Consumers/NodeFailedConsumer.cs:47-48`,
`NodeCompletedConsumer.cs:112-118`; `src/front/.../pages/WorkflowCanvasPage.tsx:201-205,239-244`.

**Problem:** `NodeFailedConsumer` sets the whole execution to `PartiallyFailed` on the *first*
node failure, with no check for sibling branches still running. The client treats
`PartiallyFailed` as terminal (`isTerminal`) and gates the SSE subscription on `!isTerminal`,
so the stream is torn down — any still-running parallel branch (B) freezes in the UI. Worse,
`NodeCompletedConsumer`'s `allCompleted` requires *every* workflow node to have a `Completed`
execution, so a permanently-failed node means the execution can never reach `Completed` — it
stays `PartiallyFailed` forever even if all other branches finish.

**Fix options:**
- (server, preferred) Don't mark `PartiallyFailed` until no nodes remain `Running`/`Queued`.
  Add a reconciliation (callable from both NodeCompleted and NodeFailed consumers): once
  nothing is `Running`/`Queued`, set `Completed` if all nodes completed, else `PartiallyFailed`/
  `Failed`, and publish the matching terminal SSE event. Relax `allCompleted` to consider the
  latest attempt per `WorkflowNodeId`.
- (client) Don't treat `PartiallyFailed` as terminal for stream gating — keep streaming until a
  truly terminal event arrives. (Only safe once the server emits a final terminal event for
  linear-chain failures too, otherwise the stream leaks open.)

> Linear chains (the common case) are effectively fine today; this bites branched DAGs.

## 2. `Failed` / `Cancelled` execution states are unreachable; no cancel endpoint (MEDIUM)

**Where:** `WorkflowExecutionStatus.cs` (enum defines them); no assignment anywhere.
`useExecutionStream.ts:51-56` maps only `ExecutionRunning/Completed/PartiallyFailed`.

**Problem:** The enum (and the TS type `types/execution.ts:1`) declare `Failed` and `Cancelled`,
but nothing ever sets them and no `ExecutionFailed`/`ExecutionCancelled` SSE event is published.
A node failure only ever yields `PartiallyFailed`. There is also no cancel endpoint/consumer.

**Fix:** Decide the real terminal semantics (tie in with #1). Publish a terminal event for every
terminal DB state so stream and DB never diverge; add a cancel endpoint that sets `Cancelled` +
publishes `ExecutionCancelled`; map the new types in `useExecutionStream.ts`.

## 3. Workflow version node-ID drift breaks overlays after edit-during-run (MEDIUM)

**Where:** `WorkflowsController.cs:108-146` (Update mints a new version), `:178` (Execute pins
`latestVersion`); `WorkflowCanvasPage.tsx:247-293` (overlay keys by latest-version node id);
`ExecutionDtos.cs:14-23` (DTO omits `WorkflowVersionId`).

**Problem:** `NodeExecution.WorkflowNodeId` belongs to the version that was executed, but the
canvas always renders the *latest* version. Editing + Save during/after a run bumps the version
(new node Guids for added nodes); overlays then silently mismatch — new nodes show no status,
removed/renumbered nodes leave orphan drawer rows labelled "Node". The DTO doesn't expose
`WorkflowVersionId`, so the client can't even detect drift. Save / + Add Node are not gated on
`isRunning`.

**Fix:** Expose `workflowVersionId` on `WorkflowExecutionDto`; overlay the *executed* version's
nodes (or at minimum show a "workflow changed since this run" banner and gate editing while an
execution overlay is active).

## 4. No SSE replay/snapshot for late subscribers (MEDIUM)

**Where:** `src/main-api/.../Services/ExecutionEventBus.cs:18-33,35-59`;
`ExecutionsController.StreamExecution:75-89`.

**Problem:** `PublishAsync` is fire-and-forget to currently-connected subscribers only — no
backlog. Any event fired between page load and SSE connect (or during a reconnect) is lost. The
new terminal-refetch + `latestExecution` seed mitigate but don't fully cover mid-run reconnects.

**Fix:** On stream connect, first yield a `Snapshot` event with the current execution + all
`NodeExecution` rows so the client fully reconciles regardless of missed events. Optionally keep
a bounded per-execution ring buffer and replay it to new subscribers.

## 5. Gateway nginx SSE robustness (LOW / infra)

**Where:** `nginx.conf` `location /api/`.

**Problem:** Real-time buffering is handled (backend sends `X-Accel-Buffering: no`), but the
proxy lacks `proxy_read_timeout` (default 60s closes idle SSE connections mid-node) and
`proxy_http_version 1.1;` / `proxy_set_header Connection "";` for clean keep-alive streaming.

**Fix:** For the `/api/` (or a dedicated stream) location add:
`proxy_http_version 1.1; proxy_set_header Connection ""; proxy_read_timeout 3600s;`
(`proxy_buffering off;` is optional given the X-Accel-Buffering header).

## 6. Harden node-execution idempotency at the data layer (LOW)

**Where:** `NodeCompletedConsumer.cs` (chaining), `ApplicationDbContext` (NodeExecution mapping).

**Problem:** A duplicate-`Completed` early-return guard was added, but there's still no DB-level
protection. MassTransit has no inbox/outbox configured (`Startup.cs:93-127`), so redelivery or a
retry of a node that already spawned children could still create duplicate downstream rows.

**Fix:** Before creating a child `NodeExecution`, skip if a non-`Failed` row already exists for
`(WorkflowExecutionId, childWorkflowNodeId)`. Consider a unique index on
`(WorkflowExecutionId, WorkflowNodeId, Attempt)` and a MassTransit inbox for true idempotency.

## 7. Minor / housekeeping (LOW)

- `AudioSeparationNode.tsx` `elapsed` reads the wall-clock during render (`react-hooks/purity`
  lint). Now that `useNowTick` drives re-renders, consider deriving elapsed from the tick to
  satisfy the rule.
- ESLint lints generated `storybook-static/` (25 phantom errors). Add it to `.eslintignore` /
  flat-config `ignores`.
- Dead `http://localhost:5001` fallback in `apiClient.ts` / `filesService.ts` /
  `useExecutionStream.ts` (dev uses `:8080`, prod uses the `:8765` gateway). Align or drop it.
- Vite bundle > 500 kB — consider route-level code splitting.

## 8. Transient remote-error classification + auto-retry (LOW/MEDIUM)

**Where:** `src/audio-separation-worker/app/handlers.py` (`is_transient=isinstance(e, OSError)`),
`src/audio-separation-worker/app/separator.py` (`RemoteAudioSeparator` wraps remote failures as
`RuntimeError`).

**Problem:** Remote separation failures are surfaced as a generic `RuntimeError("Remote separation
failed: …")`, so the worker's `is_transient` heuristic (`isinstance(e, OSError)`) is always `False`
for remote runs — even when the underlying cause is clearly transient. Observed live: an ensemble
Roformer node failed once on Modal with `Failed to instantiate Roformer model: [Errno 22] Invalid
argument` (a cold model-download/caching race on the Modal `/models` volume) and then **succeeded on
a manual retry with no changes**. Combined with `isTransient` being computed-but-unused (no auto
retry/backoff anywhere), a transient cold-cache blip becomes a hard node failure that requires a
manual click.

**Fix options:**
- (worker) Classify remote errors: parse/propagate the remote error so obviously-transient causes
  (`[Errno 22]`, `instantiate … model`, timeouts, 5xx) set `is_transient=True`.
- (worker/engine) Add a bounded auto-retry-with-backoff for transient node failures (e.g. 2–3
  attempts) so cold-start blips self-heal without user intervention. Tie into the retry path that
  already creates a new `NodeExecution` (attempt+1).

---

## Done (this branch)

- SSE node events now carry `workflowNodeId` + `attempt` (3 consumers) so downstream/retry
  updates can be placed by stable workflow-node id.
- Frontend reconciles via `lib/executionState.ts` (`applyNodeStatusEvent` upsert /
  `upsertNodeExecution`) — downstream nodes and retries now display live (canvas + ExecutionPage).
- `WorkflowCanvasPage.onExecutionStatus` refetches + re-seeds on terminal (the old
  `invalidateQueries(['execution'])` was dead — no such query on the canvas).
- `useExecutionStream`: forwards `workflowNodeId`/`attempt`; auth header only when token present;
  401/403 is fatal (no silent retry loop).
- `useNowTick` makes "Running" elapsed timers advance (node card + drawer).
- Seed effect is ref-guarded (deleting all nodes without saving no longer resurrects them);
  `errorMessage` preserved on non-failure events.
- `NodeCompletedConsumer` early-returns on duplicate `Completed` events (no duplicate downstream
  spawn / duplicate GPU work on redelivery).
