# DAW-style synced stem player (execution UI)

Each completed node execution's output stems get a DAW-style player, shown on **both** execution
views: `ExecutionPage` node cards (`NodeExecutionCard`) and the on-canvas `ExecutionDrawer` rows.
One **master Play per node** loads + plays all that node's stems together; per-stem **Mute/Solo**;
**click-to-seek** on any waveform. Stems across **different nodes** stay in sync — they are all the
same original song separated by different models, so they share one timeline.

## The hard problem (why the obvious approach failed)
wavesurfer.js **v7 plays each stem through its own independent `HTMLAudioElement`** — there is no
shared clock. The earlier per-`<audio>` approach (commits ~`0adc6b9`, `14072c5`) synced *within* a
node but produced a constant **cross-node echo**: joining an already-playing node meant reading a
peer's `currentTime` then `play()`-ing after unmeasurable start latency during which the peer moved
on → a permanent offset (comb-filters audibly, since it's the same song). Confirmed root cause by 4
independent analyses.

## Current architecture — one shared Web Audio clock
- **`components/execution/stemSyncEngine.ts` — `StemSyncEngine` (class).** Owns ONE `AudioContext`.
  Every stem is an `AudioBufferSourceNode` started off a single virtual transport anchored to
  `ctx.currentTime` (`pos = originPos + (ctx.currentTime − originCtxTime)`). Sources started from the
  same clock **never drift and join in exact phase → sample-accurate; nothing to "correct".** API:
  `register/unregister` (from the view), `prepare(ids)` (fetch+`decodeAudioData`+build waveform;
  idempotent/cached), `play(ids)`/`pause(ids)`, `seek(time)`, `setMuted(id,muted)`,
  `onTransportEnded(cb)`, `ensureContext()`, `release()`. `LOOKAHEAD=0.03s` co-scheduling; a per-stem
  `GainNode` gives click-free mute/solo (linear ramp); a `requestAnimationFrame` loop drives the
  waveform cursors; end-of-song rewinds to 0 and notifies every group.
- **`components/execution/StemWaveformPlayer.tsx`.** Demoted to a **muted, passive waveform
  visualizer** — no playback of its own. Registers a `StemVisual` `{renderWaveform, setCursor,
  setError}` with the engine in a **mount effect** (NOT an inline `ref` callback — so ordinary
  re-renders can't churn registration and silently drop a stem). Click/drag → `engine.seek`.
- **`components/execution/StemsPlayerGroup.tsx`.** The per-node **master transport**. On Play:
  `engine.ensureContext()` **synchronously in the click** → `engine.prepare(ids)` → `engine.play(ids)`;
  Pause → `engine.pause(ids)`; Mute/Solo → `engine.setMuted`; subscribes `onTransportEnded` to reset
  its own Play button. Renders `compact` (drawer) vs full (cards) layout.
- **Wiring.** `ExecutionPage` and `ExecutionDrawer` each create **one** engine
  (`useState(() => new StemSyncEngine())`, `release()` on unmount) and pass it to every node
  (`NodeExecutionCard`'s `engine` prop / directly). All nodes on a page share the one engine → that
  is what makes cross-node playback sync.

## Invariants & gotchas
- **Stem id in the engine registry = the artifact storage `path`** (globally unique per stem).
  `StemsPlayerGroup` passes `id={path} path={path}`.
- **`ensureContext()` MUST run synchronously inside the user gesture** (the Play click), before any
  `await`, or the browser autoplay policy keeps the context suspended and nothing is audible.
  (`prepare()` also calls it, but the group calls it explicitly first.)
- **Memory tradeoff:** the engine fully `decodeAudioData`s each stem into RAM (held until `release()`
  on page unmount) rather than streaming like the old `<audio>` approach. Fine for typical stem
  counts/lengths; watch for many long stems.
- Playback is **per-node** (each stem has an `active` flag); the shared transport only **freezes**
  when nothing anywhere is active. Playing a node joins the running transport in phase; seeking moves
  the whole page; end-of-song resets every node. `StemsPlayerGroup` keeps a private fallback engine
  when no shared one is passed (standalone use) — `new StemSyncEngine()` opens no `AudioContext` until
  first play.

## Verification status
Build/typecheck clean; a fake-`AudioContext` simulation proved a node joining 5 s mid-playback starts
in **identical phase (0-sample echo, 0 drift)**, plus correct seek/pause/freeze-resume/finish. **Not
yet audibly confirmed in the running app** (needs a real multi-node execution with completed stems) —
recommend a listen across two nodes.

See `mem:frontend/execution_overlay`, `mem:frontend/canvas_ui`.
