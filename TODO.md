# TODO

Open follow-ups for the in-canvas execution feature (`users/k_sfar/execution_in_main_ui`).

These came out of an adversarial review of the execution data-flow (frontend SSE/state +
backend event contract). The clear-cut bugs were already fixed on this branch (see
**Done** at the bottom); the items below were deferred because they need a product/design
decision or a riskier change rather than a mechanical fix. Background: Serena memory
`frontend/execution_overlay`.

---

## 1. Branched-graph `PartiallyFailed` semantics — freezes live branches & never upgrades (HIGH)

> ✅ **Resolved** (`users/k_sfar/todo-enhancements`): `Services/ExecutionReconciler.cs` now settles
> the terminal status only once no node is `Pending`/`Queued`/`Running`, called from both
> `NodeCompletedConsumer` and `NodeFailedConsumer`, emitting exactly one terminal SSE event on the
> transition. Branched DAGs no longer freeze sibling branches or get stuck `PartiallyFailed` forever.

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

> ✅ **Resolved**: `ExecutionReconciler` can now settle `Failed` (no node ever completed) in
> addition to `PartiallyFailed`/`Completed`. `POST /api/executions/{id}/cancel`
> (`ExecutionsController.Cancel`) sets `Cancelled` + publishes `ExecutionCancelled`;
> `NodeCompletedConsumer` guards against resurrecting a cancelled execution. Frontend maps all 5
> statuses in `useExecutionStream.ts` and has a Cancel button on the canvas while running.

**Where:** `WorkflowExecutionStatus.cs` (enum defines them); no assignment anywhere.
`useExecutionStream.ts:51-56` maps only `ExecutionRunning/Completed/PartiallyFailed`.

**Problem:** The enum (and the TS type `types/execution.ts:1`) declare `Failed` and `Cancelled`,
but nothing ever sets them and no `ExecutionFailed`/`ExecutionCancelled` SSE event is published.
A node failure only ever yields `PartiallyFailed`. There is also no cancel endpoint/consumer.

**Fix:** Decide the real terminal semantics (tie in with #1). Publish a terminal event for every
terminal DB state so stream and DB never diverge; add a cancel endpoint that sets `Cancelled` +
publishes `ExecutionCancelled`; map the new types in `useExecutionStream.ts`.

## 3. Workflow version node-ID drift breaks overlays after edit-during-run (MEDIUM)

> ✅ **Resolved**: `WorkflowExecutionDto.WorkflowVersionId` and node label/model resolution from the
> pinned version were already in place; this session added `WorkflowDto.VersionId` (the *latest*
> version) so the client can detect drift, plus an amber "Workflow changed since this execution
> ran" banner on `WorkflowCanvasPage` when `activeExecution.workflowVersionId !== workflow.versionId`.
> Save / + Add Node were already gated on `isRunning`. Verified live in the browser.

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

> ✅ **Resolved**: `ExecutionEventBus.Subscribe`/`Unsubscribe` register a subscriber synchronously;
> `ExecutionsController.StreamExecution` subscribes first, then sends a `{ type: "Snapshot",
> execution }` event with the full current DB state, then streams live events — no backlog needed,
> a subscriber can never miss the window between DB-read and stream-start. Frontend:
> `useExecutionStream({ onSnapshot })`, wired in both `WorkflowCanvasPage` and `ExecutionPage`.
> (Also added an ownership check on the stream endpoint that was previously missing — any
> authenticated user could stream any execution id.)

**Where:** `src/main-api/.../Services/ExecutionEventBus.cs:18-33,35-59`;
`ExecutionsController.StreamExecution:75-89`.

**Problem:** `PublishAsync` is fire-and-forget to currently-connected subscribers only — no
backlog. Any event fired between page load and SSE connect (or during a reconnect) is lost. The
new terminal-refetch + `latestExecution` seed mitigate but don't fully cover mid-run reconnects.

**Fix:** On stream connect, first yield a `Snapshot` event with the current execution + all
`NodeExecution` rows so the client fully reconciles regardless of missed events. Optionally keep
a bounded per-execution ring buffer and replay it to new subscribers.

## 5. Gateway nginx SSE robustness (LOW / infra)

> ✅ **Already implemented** — `nginx.conf` already had `proxy_http_version 1.1;`,
> `proxy_set_header Connection "";`, `proxy_buffering off;` and `proxy_read_timeout 3600s;` on the
> `/api/` location. No changes needed.

**Where:** `nginx.conf` `location /api/`.

**Problem:** Real-time buffering is handled (backend sends `X-Accel-Buffering: no`), but the
proxy lacks `proxy_read_timeout` (default 60s closes idle SSE connections mid-node) and
`proxy_http_version 1.1;` / `proxy_set_header Connection "";` for clean keep-alive streaming.

**Fix:** For the `/api/` (or a dedicated stream) location add:
`proxy_http_version 1.1; proxy_set_header Connection ""; proxy_read_timeout 3600s;`
(`proxy_buffering off;` is optional given the X-Accel-Buffering header).

## 6. Harden node-execution idempotency at the data layer (LOW)

> ✅ **Resolved**: `NodeCompletedConsumer` now skips creating a downstream `NodeExecution` if a
> non-`Failed` row already exists for `(WorkflowExecutionId, downstream.Id)`. Added a DB-level
> unique index on `(WorkflowExecutionId, WorkflowNodeId, Attempt)`
> (migration `20260730235350_AddNodeExecutionUniqueIndex`) as a backstop. (Still no MassTransit
> inbox — considered out of scope for this pass.)

**Where:** `NodeCompletedConsumer.cs` (chaining), `ApplicationDbContext` (NodeExecution mapping).

**Problem:** A duplicate-`Completed` early-return guard was added, but there's still no DB-level
protection. MassTransit has no inbox/outbox configured (`Startup.cs:93-127`), so redelivery or a
retry of a node that already spawned children could still create duplicate downstream rows.

**Fix:** Before creating a child `NodeExecution`, skip if a non-`Failed` row already exists for
`(WorkflowExecutionId, childWorkflowNodeId)`. Consider a unique index on
`(WorkflowExecutionId, WorkflowNodeId, Attempt)` and a MassTransit inbox for true idempotency.

## 7. Minor / housekeeping (LOW)

> ✅ **Resolved** — all four bullets below addressed: `useNowTick` now returns the current epoch-ms
> so `AudioSeparationNode`'s `elapsed` no longer reads `Date.now()` during render; `storybook-static`
> added to `eslint.config.js` ignores; the dead `:5001` fallback in `apiClient.ts`/`filesService.ts`/
> `useExecutionStream.ts` aligned to `:8080`; `App.tsx` routes converted to `React.lazy` +
> `Suspense`, splitting the bundle into per-route chunks (no more single >500kB chunk).

- `AudioSeparationNode.tsx` `elapsed` reads the wall-clock during render (`react-hooks/purity`
  lint). Now that `useNowTick` drives re-renders, consider deriving elapsed from the tick to
  satisfy the rule.
- ESLint lints generated `storybook-static/` (25 phantom errors). Add it to `.eslintignore` /
  flat-config `ignores`.
- Dead `http://localhost:5001` fallback in `apiClient.ts` / `filesService.ts` /
  `useExecutionStream.ts` (dev uses `:8080`, prod uses the `:8765` gateway). Align or drop it.
- Vite bundle > 500 kB — consider route-level code splitting.

## 8. Transient remote-error classification + auto-retry (LOW/MEDIUM)

> ✅ **Resolved**: `separator.py` now classifies the remote error message (`_is_transient_remote_error`
> — matches `Errno 22`, `instantiate`, timeouts, connection errors, 5xx) and raises
> `TransientSeparationError` instead of a generic `RuntimeError` when it looks transient. Added a
> bounded auto-retry (up to 3 attempts, exponential backoff) in `NodeFailedConsumer` for transient
> node failures. **Verified live**: this exact path (a real Modal `/download` contention) fired
> during manual testing and self-healed automatically within 1-2 retries.

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

## 9. Modal `/download` endpoint's unconditional `volume.reload()` contends with concurrent writers (LOW/MEDIUM)

> ✅ **Resolved** (deferred fix now applied): `download_file` resolves the filename/path from
> `modal.Dict` first (no volume I/O), then only calls `volume.reload()` if the file isn't already
> visible locally; reload retries with backoff (`_reload_volume_with_retry`, ~0.5s→1s→2s, up to 4
> attempts) on "open files" conflicts before falling back to 404. The dead duplicate
> `get_file_by_hash_function` (same bug, zero callers) was deleted. **Not yet deployed to Modal**
> (`modal deploy` was intentionally not run this session) — the worker-side mitigations (item #8)
> already self-heal against the currently-deployed (unpatched) endpoint in the meantime.

**Where:** `src/modal-deploy/deploy_modal.py` — `download_file` (`/download/{task_id}/{file_hash}`,
~line 434-471) and the dead/unused duplicate `get_file_by_hash_function` (~line 274-299).

**Problem:** Observed live: `kuielab_b_bass.onnx` separated successfully on the remote Modal API
(both stems written), but the node completed with **zero stems**. Root cause: three sibling
branches (`kuielab_a_bass.onnx`, `kuielab_b_bass.onnx`, `htdemucs_6s.yaml`) were submitted
concurrently. While the worker tried to download `kuielab_b_bass`'s two output files, the
`htdemucs_6s` job — running in a *different* container — still had its own (unrelated) output
files open for writing on the same shared Modal `Volume`. `volume.reload()` in the `/download`
handler locks at the **whole-volume** level, not per-directory/task, so both downloads got a 500:
`"there are open files preventing the operation: path outputs/<other-task-id>/drums_*.flac is
open"`. The remote client (`audio_separator.remote`) swallows per-file download errors and still
reports `status: "completed"`, so `RemoteAudioSeparator.separate()` returned an empty file list
and the node published `NodeCompletedEvent` with an empty `outputArtifactPaths`.

**Already mitigated (done, this session):** `RemoteAudioSeparator.separate()`
(`app/separator.py`) now raises `TransientSeparationError` when `len(downloaded_files) <
len(expected_files)` instead of silently returning a partial/empty list; `handlers.py` classifies
it as `is_transient=True`. The node now correctly shows **Failed (transient)** and can be
retried, instead of falsely showing **Completed** with no stems.

**Deferred fix (not applied):** Reduce/avoid the reload contention itself in
`deploy_modal.py`'s `/download` handler:
- Only call `volume.reload()` if the file isn't already visible locally (`os.path.exists`) —
  skips the whole-volume lock entirely for warm containers that already see the file.
- When a reload is actually needed and fails with the "open files" conflict, retry with backoff
  (~0.5s → up to a few seconds) since the conflicting writer typically closes/commits quickly,
  instead of failing the request immediately.
- Optionally delete or fix the dead duplicate `get_file_by_hash_function` (same bug, unused).

> Full suggested diff was drafted in chat but not applied — revisit when touching
> `deploy_modal.py` next, or if transient download failures on concurrent branches recur often
> enough to be worth the deploy.

## 10. Add community rock/guitar models (becruily guitar, Rifforge, gilliaan phantom-center) (FEATURE)

**Where:** `~/Repos/python-audio-separator/audio_separator/models.json` (registration);
`src/audio-separation-worker/requirements.txt` + `src/modal-deploy/deploy_modal.py:64-70` (SDK install
source); `~/Repos/audio-sep/build_model_registry.py` (registry generator);
`src/audio-separation-worker/app/model_registry.json` + `src/front/src/lib/models.ts` (regenerated data);
`src/main-api/.../Domain/Models/StemDefinitions.cs` (C# mirror).

**Goal:** Run a self-hosted rock/distorted-guitar pipeline (strip vocals with a metal-focused instrumental
model → extract guitar → split lead/rhythm) using three publicly-downloadable community models not yet in
audio-separator: **becruily Mel-Band guitar**, **Rifforge (mesk, metal)**, and a **gilliaan phantom-center**
model. Note `BS-Roformer-SW.ckpt` is already in the registry with a `Guitar` stem — a working guitar model
exists today; this adds better/more-specialised ones.

**Findings (why this shape):**
- **Arch fit — yes.** audio-separator 0.44.1 (nomadkaraoke fork) builds any BS/Mel-Band Roformer from its YAML
  (`separator/roformer/`). becruily guitar + Rifforge = Mel-Band → `MDXC` path. gilliaan ships a Mel/BS and an
  MDX23C variant (both fine); **avoid the SCNet variant** — no SCNet arch here. **No MSST rebuild needed**;
  reserve MSST only as a future *second worker backend* for SCNet/Apollo/MedleyVox-only models.
- **The gate.** `download_model_files()` refuses any filename not in the merged registry
  (`ValueError: not found in supported model files`, `separator.py:756`). There is no "point at arbitrary local
  files" API. Adding a model = register in `models.json` + make `.ckpt`/`.yaml` reachable + regenerate the
  app's `model_registry.json` + sync the C# mirror.
- **Durability — HF owners can delete/rename/gate repos at any time.** Chosen mitigation: **both** mirror the
  weights to our own fork's GitHub release *and* pre-seed the Modal volume, so runtime never fetches from the
  original HF repo (`download_file_if_not_exists` early-returns when the file already exists,
  `separator.py:496-498`).

**Two prerequisite gaps to fix first:**
- **G1 — runtimes install PyPI, not our fork.** worker `requirements.txt` → `audio-separator`;
  `deploy_modal.py:65` → `audio-separator[gpu]`; and `~/Repos/python-audio-separator` is a clone of *upstream*,
  not our fork. Must: fork the repo, then install *from the fork* in both places
  (`git+https://github.com/<you>/python-audio-separator@<branch>`).
- **G2 — registry generator input is circular.** `models.ts` now derives `MODEL_DEFINITIONS` from
  `model_registry.json`, but `build_model_registry.py:parse_models_ts` (lines 118-137) still regex-parses an
  inline `MODEL_DEFINITIONS` literal that no longer exists. Add a `--seed <file.json>` input supplying the
  hand-written display metadata (`value,label,stems,category,arch`) for new models, used instead of
  `parse_models_ts`; reuse the SDK-resolution path unchanged (lines 79-115, 257-293) so
  `real_stems`/`stem_map` are still read from each model's real YAML `training.instruments`.

**Steps:**
1. **Fork + install-from-fork** (fixes G1): worker `requirements.txt` and `deploy_modal.py` `pip_install`.
2. **Register** (edit fork's `models.json`): becruily guitar + Rifforge → `roformer_download_list`; gilliaan →
   `roformer_download_list` (Mel/BS variant, preferred) or `mdx23c_download_list`. Entry shape:
   `"Roformer Model: <friendly>": {"<model>.ckpt": "<config>.yaml"}` (exact filenames must match hosted assets).
3. **Host weights (both):** upload `.ckpt`+`.yaml` as GitHub release assets on the fork under the
   `releases/download/model-configs` tag the SDK falls back to (`separator.py:701-703,733-752`), *and* pre-seed
   the Modal `audio-separator-models` volume (mounted `/models`, `deploy_modal.py:79,104`) + the worker
   `model-cache` volume.
4. **Regenerate registry** (fixes G2): add `--seed`; run generator in a venv with the *forked* SDK + weights
   present; copy the updated `model_registry.json` into both worker `app/` and front `src/lib/`.
5. **Sync C# mirror:** add the 3 filenames → display stems to `StemDefinitions.cs` `ModelStems`.
6. **Optional UX:** add a `guitar_rock` ensemble/pipeline preset to `models.ts` `EnsemblePresets`.

**Verify:** SDK resolves each filename with no `ValueError`; generator writes `status:"ok"` entries with
plausible `stem_map` (e.g. `{"Guitar":"guitar"}`); worker + Modal produce a `guitar_*` stem and complete a node;
with the original HF name broken, separation still succeeds from the pre-seeded volume/fork release; the 3 models
appear in the ModelBrowser and the Rifforge→becruily-guitar→phantom-center DAG runs on a distorted-guitar track.

> Full research + rationale captured in the planning session (deton24 guide cross-reference, arch analysis,
> `python-audio-separator` 0.44.1 internals). Related existing artifact:
> `~/Repos/python-audio-separator/docs/deton24-model-mapping-and-ensemble-guide.md` (Section 6 "Missing
> Top-Tier Models" already lists Rifforge + gilliaan; Task B already describes the `models.json` process).

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
