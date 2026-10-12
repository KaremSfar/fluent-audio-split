# Fluent Audio Split — Frontend AI Instructions

## Overview
React SPA for an audio stem separation app. Users build multi-node DAG workflows, execute them, and stream real-time progress. Each node runs an ML separation model and produces named stem outputs that can be piped into downstream nodes.

## Setup
```bash
cp .env.example .env.development   # set VITE_SERVICE_URL=http://localhost:8080
npm install
npm run dev   # → http://localhost:5173
npm run build # production build
```

## Tech Stack
| Tool | Details |
|---|---|
| Framework | React 19 + TypeScript via Vite |
| Styling | Tailwind CSS v3 |
| UI Components | shadcn/ui (New York style, Violet theme) — `src/components/ui/` |
| Forms | react-hook-form + Zod |
| HTTP Client | Axios — `src/services/apiClient.ts` |
| Routing | React Router v7 |
| Server State | TanStack Query v5 |
| SSE | `@microsoft/fetch-event-source` |
| Telemetry | OpenTelemetry — `src/telemetry/otel.ts` |

To add shadcn components: `npx shadcn@latest add <component>`

## Folder Structure
```
src/
  auth/           # AuthContext, authService, useAuth
  components/ui/  # shadcn/ui components
  hooks/          # useExecutionStream (SSE)
  lib/            # models.ts, utils.ts
  pages/          # Route-level components
  services/       # apiClient, workflowsService, executionsService, filesService
  types/          # workflow.ts, execution.ts, file.ts, auth.ts
```

## Pages / Routes
| Route | Page | Purpose |
|---|---|---|
| `/login` | LoginPage | JWT login |
| `/register` | RegisterPage | Register |
| `/dashboard` | DashboardPage | Overview |
| `/files` | FilesPage | Upload + list audio files |
| `/workflows/new` | NewWorkflowPage | Create workflow (name only) |
| `/workflows/:id/canvas` | WorkflowCanvasPage | DAG canvas editor |
| `/executions` | ExecutionsListPage | List executions |
| `/executions/:id` | ExecutionPage | Live progress + stem results |
| `/executions/:id/results` | ResultsPage | Results DAW: shared transport + bar-snapped loop, per-stem fader/mute/solo, master, metronome that can follow the song's beat map (`components/daw/`) |

## Theming (light / dark / system)
- `src/theme/`: `ThemeProvider` (wraps the app in `App.tsx`), `useTheme()` → `{ preference, theme, setPreference }`, `theme.ts` (storage key `localStorage['fas:theme']`, `system` = key absent, `resolveTheme`, `applyTheme`). The `dark` class and `color-scheme` live on `<html>`; tailwind `darkMode: ["class"]`.
- **No flash**: an inline script in `index.html` applies the saved/system theme before first paint. Keep it in sync with `theme.ts` if the key or logic changes.
- Toggle: `components/layout/ThemeToggle.tsx` (sun/moon button → Light / Dark / System menu, arrow keys + Esc). It is in `AppHeader`, the canvas header and on the login/register pages.
- **Colours come from tokens** in `src/index.css` (`:root` light, `.dark` dark): shadcn tokens (`background`, `card`, `popover`, `muted-foreground`, `border`, …) plus `link` (text links, ≥ 4.5:1 in both themes) and the DAW set `daw-surface | lane | control | control-hover | border | playhead | bar | beat | meter`. Don't use `bg-white`, `bg-zinc-*`, `text-gray-*` etc. for surfaces/text. Tinted status colours are fine when paired: e.g. `bg-red-50 dark:bg-red-950/40`, `text-red-600 dark:text-red-400`, `border-amber-300 dark:border-amber-700/70`. Solid fills carrying white text use ≥ 600 shades (`bg-violet-600`, `bg-teal-700`, `bg-red-600`) for contrast; stem-colour chips (`STEM_COLORS`, -300/-400) carry dark text (`text-zinc-950`).
- Canvas-drawn colours can't read CSS variables: wavesurfer colours come from `useTheme()` and are restyled with `setOptions` (no re-decode); `stemColor(output, nodeType, theme)` returns a deep shade for the light studio and the bright `STEM_COLORS` shade for dark; the unplayed waveform is an **opaque** mix (`mixHex` over `LANE_HEX`), because wavesurfer composites the played part with the unplayed alpha. `LANE_HEX` must match `--daw-lane`.
- React Flow: `colorMode={theme}` plus `--xy-*` overrides on `.react-flow` in `index.css` (canvas, dots, minimap, controls). Node cards use `bg-card`; handle fills use `hsl(var(--card))`.
- Storybook has a Theme toolbar (`.storybook/preview.ts`) that toggles the same `dark` class.

## Key Implementation Details

### WorkflowCanvasPage (DAG Editor)
- Local state: `localNodes: WorkflowNode[]` — mirrors server nodes + unsaved additions
- New nodes created locally get `id: "new:<uuid>"` to mark them as unsaved
- **Save logic** (`saveMutation`): nodes with `new:` prefix send `id: undefined` so the API inserts them; persisted nodes send their real UUID for update
- `sourceNodeId` pointing to another new node is sent as `null` (can't resolve FK for unsaved parent — user must save top-down)
- After save: `onSuccess` replaces `localNodes` with server response (real IDs replace temp IDs)
- Node layout: `buildLevels()` groups nodes by tree depth → rendered as horizontal rows
- Viewport: `FitViewOnChange` (child of `<ReactFlow>`) fits all nodes (`maxZoom: 1`) once every node is measured (`useNodesInitialized`) and again whenever the node count grows. Don't rely on the `fitView` prop: the graph is seeded in an effect after mount, so it fit too early (zoomed in, nodes clipped).
- Cascade delete: `getDescendantIds()` recursively collects all child IDs

### models.ts (src/lib/models.ts)
- `MODEL_DEFINITIONS`: array of `{ value, label, stems }` — model filenames incl. extension
- `getStemsForModel(modelName)`: returns stem list for a model
- `STEM_COLORS`: maps stem name → Tailwind bg color class
- **Must be kept in sync** with `StemDefinitions.cs` (API) and `models.py` (worker)

### useExecutionStream (src/hooks/useExecutionStream.ts)
- Wraps SSE connection to `GET /api/executions/{id}/stream`
- `outputPaths` field in events is `Record<string, string>` (stemName → relativePath)

## TypeScript Types
```ts
// workflow.ts
WorkflowNode { id, order, nodeType, configJson, sourceNodeId, sourceOutputName }
UpdateWorkflowNodeRequest { id?, order, nodeType, configJson, sourceNodeId, sourceOutputName }

// execution.ts
NodeExecutionDto { outputArtifactPaths: Record<string, string> }
```

## Common Pitfalls
- Always use full model filenames as `value` in MODEL_DEFINITIONS (e.g. `htdemucs_ft.yaml` not `htdemucs_ft`)
- New nodes must not send `id` to the API — use the `new:` prefix trick and strip it at save time
- `sourceNodeId` in new nodes should reference an already-persisted parent; if not, set to `null` and save in two steps

## Results DAW (`pages/ResultsPage.tsx`, `components/daw/`)
- **Studio UI** (one codepath for both themes, tokens only): `TransportBar` (row 1: transport · clock/bar-beat · loop · `master` slot; row 2: `MetronomeControls` — click/tempo row, then grid alignment · click vol · practice · Advanced toggle). Shared control classes are in `daw/ui.ts` (`ctl`, `neutral`, `toggle`, `segItem`, `field`, …; 32 px controls, 28 px in secondary rows). Faders use the `.daw-range` CSS (track filled to `--fill`, 0 dB detent mark). The page is full height: the mixer `section` is `flex-1`, the header column continues below the last track to the footer, and `LanesOverlay` draws one playhead, the loop band and anchor guides across all lanes on md+ (wavesurfer cursors are hidden there via `cursor={false}`).
- One `StemSyncEngine` per page; track ids are `ResultTrack.id`. Chain per stem: source -> gate (mute/solo) -> fader -> analyser -> master -> destination. `setMuted` is the audible gate; `setVolume` is the fader.
- Solo logic lives in `useMixerState` (additive; Alt = exclusive). Mixer state is persisted in `localStorage['fas:mixer:v2:<executionId>']`. Untrusted storage goes through `parseMetronome`/`sanitizeMap`/`sanitizeAnchors`; reducer patches through `sanitizeMetronome` (keeps `map`/`anchors` identity so the grid is only rebuilt when they change).
- **Click = metronome + beat grid.** `beatGrid.ts` defines `BeatGrid` (`beatTime(k)`, `beatIndexAt(pos)`, `beatInBar(k)`, `barIndex(k)`): `FixedGrid` (bpm + offsetSec) or `MapGrid` (explicit beat times; extrapolates past either end with the median of the nearest 4 intervals). `buildGrid(settings)` picks the map in `mode: 'follow'`, else the fixed grid. Bars come from "downbeat refs": the map's `downbeatIndex`, overridden by user beat-1 anchors (each further one re-phases bars from that beat on; bar numbers stay continuous).
- `metronome.ts` schedules clicks on the engine's `AudioContext` clock (25 ms tick, 100 ms lookahead) from the engine's transport anchor and resyncs on every transport change. It iterates grid beats × `subdivision` (1/2/3/4; sub-ticks use a softer 2 kHz click), applies the per-beat `accents` pattern (0 off / 1 normal / 2 accent; length = beatsPerBar 1–12) and the gap click (`gap.onBars` on / `gap.offBars` silent, cycle anchored to the bar where playback *started*, not reset by seeks/loop laps). Count-in runs at the tempo at the start position and is phase-aligned to the grid (delay = n·spb − distance to the next beat). Dedupe uses the raw (unwrapped) transport position; with an engaged loop the window is split into laps by `loopSegments`.
- **Beat tracking** (`beatTracker.ts`, pure TS, no deps): decimate to ~11 kHz → log spectral flux onset envelope (+ low band < 160 Hz for downbeats) → global tempo by prior-weighted autocorrelation (60–200 BPM, log-normal prior at 120) → local tempo per 8 s window (±45 % of global) → Ellis DP beat tracking (tightness 100) → sub-frame peak refinement (+8 ms calibrated latency) → downbeat = strongest low-band phase. Confidence is mostly envelope periodicity (noise ≈ 0.1). `beatTracker.worker.ts` runs it off the main thread; `beatAnalysis.ts` (`analyzeBeats`) downmixes (chunked, yields) the drums stem (`/drum|perc/i`) or all loaded stems and drives the worker with progress + AbortSignal. Analyses with confidence ≥ 0.35 switch to Follow automatically. `web-audio-beat-detector` is no longer imported (dependency can be dropped).
- **Anchors** (`Anchor { pos, kind: 'beat' | 'downbeat' | 'bar1' }`, applied by `applyAnchors`): nearest map beat snaps onto the anchor, corrections are interpolated linearly between anchors, held after the last, faded in over 4 beats before the first; the map is extended to reach anchors outside it; beats never fold back (≥ 60 ms apart). `D` in Follow mode adds a phase-only `bar1` anchor; `[`/`]` shift the whole map. Half/Double edit the map (or the fixed BPM).
- **Loop**: `engine.setLoop({start,end} | null)` uses native `AudioBufferSourceNode.loop` with the same loopStart/loopEnd on every stem (seamless, sample-aligned). It re-anchors the transport at "now" and retargets live sources in place (no restart). `nowPos()` wraps (`wrapLoopPos`); `TransportSnapshot.loop` is the loop engaged for the current anchor (only when the anchor position is before the loop end; playing from after the end runs linearly). `toCtxTime` stays linear (first lap only). UI snaps loops to bars (`barRegion`, `nearestBarLine`); loop state is not persisted.
- Click practice (`enterPractice`/`exitPractice` reducer actions) stores a `PracticeSnapshot` (tracks, click on/off, count-in) and restores it on exit; persisted so a reload mid-practice can still exit.
- `BeatFlash` (screen-edge flash) runs its own rAF and writes styles directly; it and the beat dots are disabled with `prefers-reduced-motion`.
- Pure modules have vitest tests (`npm test`): `gain`, `metronome` (fake clock: fixed/map/drift/seek/subdivision/accents/gap/count-in/loop laps), `beatGrid` (anchors, bar phase, half/double), `beatTracker` (synthetic clicks: steady 120, 110→120 ramp, noise, downbeat), `mixerReducer` (practice), `stemSyncEngine` (loop).
