# In-Canvas Execution Overlay & SSE Contract

Branch `users/k_sfar/execution_in_main_ui` brings workflow execution INTO the canvas
(`WorkflowCanvasPage`) instead of the standalone `ExecutionPage`:
- Live status overlays on each `AudioSeparationNode` (border/pulse/footer/elapsed/error)
- `components/execution/ExecutionDrawer.tsx` — collapsible bottom drawer listing node executions (retry/download)
- Per-node ▶ Run / ↻ Retry / ↻ Re-run buttons; progress streams over SSE via `hooks/useExecutionStream.ts`

## Execution data-flow contract (the critical, non-obvious part)
- **`POST /api/workflows/{id}/execute`** (`WorkflowsController.Execute`) creates `NodeExecution` rows
  **for ROOT nodes only** (`SourceNodeId == null`). **Downstream node executions are created LAZILY**
  by `NodeCompletedConsumer` as parents complete — each with a **brand-new Guid Id**.
- **Retry** (`ExecutionsController.RetryNode`) also creates a **new** `NodeExecution` (new Guid, attempt+1)
  with the same `WorkflowNodeId`.
- ⇒ The client cannot key live state purely by `NodeExecution.id` (those ids are unknown for downstream/retry).
  It must reconcile by the **stable `workflowNodeId`** (== React Flow node id == workflow `nodes[].id` == version
  StructureJson node Guid).

## SSE event vocabulary (`ExecutionEventBus` → consumers)
- Node events: `NodeStarted` / `NodeCompleted` / `NodeFailed` — now carry
  `{ type, nodeExecutionId, workflowNodeId, attempt, ... }` (workflowNodeId+attempt were ADDED to fix downstream/retry).
- Execution events: `ExecutionRunning` / `ExecutionCompleted` / `ExecutionPartiallyFailed`.
- ⚠️ `Failed` and `Cancelled` execution statuses exist in the enum but are **never set and never streamed**
  (a node failure only yields `PartiallyFailed`). No cancel endpoint exists.

## Frontend reconciliation (the fix)
- `lib/executionState.ts`: `applyNodeStatusEvent(prev, ev)` upserts — update by id, else append/replace by
  `workflowNodeId` (one row per workflow node, latest attempt wins). `upsertNodeExecution(prev, full)` for retry response.
- Both `WorkflowCanvasPage.onNodeStatus` and `ExecutionPage.onNodeStatus` use it; retry `onSuccess` uses `upsertNodeExecution`.
- Canvas keeps execution state in **local `useState`** (NOT a react-query query) — so `onExecutionStatus` explicitly
  **refetches `executionsService.get(id)` and re-seeds** on terminal status (a prior `invalidateQueries(['execution'])`
  was DEAD — no such query exists on this page). `ExecutionPage` IS query-driven (`['execution', id]`).
- `hooks/useNowTick.ts`: 1s re-render while a node is `Running` so elapsed durations advance (they read wall-clock at render).

## Known follow-ups NOT yet fixed (need product/design decisions)
- **Branched-graph PartiallyFailed**: set eagerly on first node failure; client treats it as terminal and closes the
  stream → still-running sibling branches freeze. And `allCompleted` (requires every node Completed) means a failed
  node keeps the execution `PartiallyFailed` forever (never upgrades). Needs server reconciliation + terminal events.
- **Version node-ID drift**: canvas renders the LATEST workflow version, but the execution is pinned to the version at
  start. Editing+saving during/after a run bumps the version; overlays then mismatch. `WorkflowExecutionDto` omits
  `WorkflowVersionId`, so the client can't even detect drift. Save/Add-Node are not gated on `isRunning`.
- **Late-subscriber gap**: `ExecutionEventBus` has no replay/snapshot; events before connect are lost (mitigated
  somewhat by the terminal refetch + the `latestExecution` seed which only matches Running/Pending).

Topology note: full stack runs via docker compose behind an nginx **`gateway` on :8765** (proxies `front` + `api`);
`VITE_SERVICE_URL` defaults to it. The `http://localhost:5001` fallback in frontend services is dead (dev uses :8080).
See `mem:frontend/canvas_ui`, `mem:project_overview`.
