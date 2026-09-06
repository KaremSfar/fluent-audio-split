# In-Canvas Execution Overlay & SSE Contract

Branch `users/k_sfar/execution_in_main_ui` (merged to `main`) brought workflow execution INTO the
canvas (`WorkflowCanvasPage`) instead of the standalone `ExecutionPage`. A follow-up session on
`users/k_sfar/todo-enhancements` closed out nearly all deferred TODO items (see bottom).

## Execution data-flow contract (the critical, non-obvious part)
- **`POST /api/workflows/{id}/execute`** (`WorkflowsController.Execute`) creates `NodeExecution` rows
  **for ROOT nodes only** (`SourceNodeId == null`). **Downstream node executions are created LAZILY**
  by `NodeCompletedConsumer` as parents complete — each with a **brand-new Guid Id**.
- **Retry** (`ExecutionsController.RetryNode`) also creates a **new** `NodeExecution` (new Guid, attempt+1)
  with the same `WorkflowNodeId`. Same shape for the **automatic** transient-failure retry (see below).
- ⇒ The client cannot key live state purely by `NodeExecution.id` (those ids are unknown for downstream/retry).
  It must reconcile by the **stable `workflowNodeId`**.

## SSE event vocabulary (`ExecutionEventBus` → consumers)
- Node events: `NodeStarted` / `NodeCompleted` / `NodeFailed` — carry
  `{ type, nodeExecutionId, workflowNodeId, attempt, ... }`.
- Execution events: `ExecutionRunning` / `ExecutionCompleted` / `ExecutionPartiallyFailed` /
  `ExecutionFailed` / `ExecutionCancelled` — all reachable now (see "Reconciliation" below).
- **`Snapshot`** (NEW): on every `GET /api/executions/{id}/stream` connect/reconnect, the server
  subscribes to the event bus FIRST (`ExecutionEventBus.Subscribe` — synchronous registration so no
  event published between DB-read and stream-start is lost), THEN sends one
  `{ type: "Snapshot", execution: WorkflowExecutionDto }` event with the full current state, THEN
  streams live events. Frontend: `useExecutionStream({ onSnapshot })`; both `WorkflowCanvasPage` and
  `ExecutionPage` use it to fully reconcile `nodeExecutions`/`execStatus` on (re)connect — closes the
  "late subscriber misses events" gap.
- ⚠️ **JSON casing gotcha**: `ExecutionEventBus.PublishAsync`/the controller's manual Snapshot
  serialization do NOT go through ASP.NET Core's MVC pipeline (which auto-applies
  `JsonSerializerDefaults.Web` = camelCase). Anonymous-object events were fine because their
  property names are hand-typed in camelCase already, but serializing a raw DTO record
  (`WorkflowExecutionDto` in the Snapshot payload) with the default `JsonSerializer.Serialize`
  produces PascalCase (`NodeExecutions`, not `nodeExecutions`) and silently breaks the frontend
  (`execution.nodeExecutions` → `undefined` → crash). Fixed via
  `ExecutionEventBus.JsonOptions = new(JsonSerializerDefaults.Web)`, reused by both `PublishAsync`
  and the controller's snapshot serialization. **Any future direct `JsonSerializer.Serialize` of a
  DTO for the frontend must use this options object (or go through MVC) — do not use the
  parameterless overload.**

## Server-side reconciliation (`ExecutionReconciler`, `Services/ExecutionReconciler.cs`)
Replaces the old "mark PartiallyFailed on first node failure" behavior. Called from both
`NodeCompletedConsumer` and `NodeFailedConsumer` after each node settles:
- No terminal decision while any node is `Pending`/`Queued`/`Running` (branched DAGs no longer freeze
  sibling branches or get stuck `PartiallyFailed` forever).
- Once nothing is in flight: `Completed` if every node's latest attempt is `Completed`, else
  `PartiallyFailed` if some completed, else `Failed`. `Cancelled` is set explicitly by the cancel
  endpoint and is never overwritten (`IsTerminal` check short-circuits).
- Returns the new terminal status only on the transition (so exactly one terminal SSE event fires),
  mapped to its event name via `ExecutionReconciler.ToEventType`.

## Cancel endpoint
`POST /api/executions/{id}/cancel` (`ExecutionsController.Cancel`) — sets non-terminal `NodeExecution`s
to `Cancelled`, execution to `Cancelled`, publishes `ExecutionCancelled`. `NodeCompletedConsumer` guards
against resurrecting a cancelled execution (records the node's output but doesn't chain downstream or
flip status back). Frontend: Cancel button in `WorkflowCanvasPage` header while running.

## Bounded auto-retry for transient node failures
`NodeFailedConsumer.TryAutoRetryAsync`: when `NodeFailedEvent.IsTransient` and the failed node's
`Attempt < 3`, automatically requeues a new attempt (same shape as manual retry) after an exponential
backoff (`2^(attempt-1)` seconds via `Task.Delay` in-consumer — no MassTransit scheduler configured).
Gives up after 3 attempts (falls through to normal reconciliation, node shows `Failed`, manual retry
still available). **Verified live**: a real Modal `/download` whole-volume-lock contention (concurrent
sibling branches) triggered `TransientSeparationError` from the worker, auto-retried, and self-healed
within 1-2 attempts with zero user action.

## Idempotent downstream chaining
`NodeCompletedConsumer`: before creating a downstream `NodeExecution`, skips if a non-`Failed` row
already exists for `(WorkflowExecutionId, downstream.Id)` — guards against duplicate chaining on
MassTransit redelivery (no inbox/outbox configured). DB-level backstop: unique index on
`(WorkflowExecutionId, WorkflowNodeId, Attempt)` (migration `AddNodeExecutionUniqueIndex`).

## Workflow version drift
`WorkflowDto` now exposes `VersionId` (latest version's id); `WorkflowExecutionDto` already exposed
`WorkflowVersionId` (the version actually executed). `WorkflowCanvasPage` computes
`versionDrift = activeExecution.workflowVersionId !== workflow.versionId` (only meaningful once not
running, since Save/+Add Node are gated on `isRunning`) and shows an amber banner: "Workflow changed
since this execution ran…". Node labels/models in the overlay were already resolved server-side from
the *executed* version (`NodeExecutionDto.NodeLabel`/`ModelName`), so orphaned rows still render
sensibly even pre-banner.

## Frontend reconciliation
- `lib/executionState.ts`: `applyNodeStatusEvent`/`upsertNodeExecution` — unchanged, still the core
  upsert-by-`workflowNodeId` logic.
- `WorkflowCanvasPage` keeps execution state in local `useState` (not react-query); reconciles via
  terminal-refetch (`executionsService.get`) AND now also via the `Snapshot` SSE event.
  `ExecutionPage` is query-driven (`['execution', id]`) but also wires `onSnapshot` the same way.
- `useNowTick(active)` now **returns the current epoch-ms** (not `void`) so `AudioSeparationNode`'s
  `elapsed` derives from it instead of calling `Date.now()` during render (purity fix).

Topology: full stack runs via docker compose behind an nginx **`gateway` on :8765**; nginx already had
proper SSE proxy config (`proxy_http_version 1.1`, `Connection ""`, `proxy_buffering off`,
`proxy_read_timeout 3600s`) — no changes needed there.

## Remaining known gap (deliberately NOT done)
- TODO item #10 (community rock/guitar models) — explicitly out of scope, not implemented.

See `mem:frontend/canvas_ui`, `mem:project_overview`.
