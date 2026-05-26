# Frontend: Workflow Canvas UI (WorkflowCanvasPage)

## Layout
`WorkflowCanvasPage` renders a `flex-row` layout:
- **Left: React Flow canvas** (`flex-1`) — node graph editing
- **Right: `NodeSidePanel`** (fixed `w-96`) — appears when a node is clicked, dismissed by clicking the pane or the ✕ button

## Node Selection
- `selectedNodeId` state in `WorkflowCanvasPage`
- Set via `onNodeClick` ReactFlow prop, cleared via `onPaneClick`
- Node card highlights with `ring-2 ring-violet-300` when `selected === true` (ReactFlow passes `selected` as NodeProp)

## `AudioSeparationNode` (card on canvas)
- Simplified — shows model label, arch badge, ensemble indicator, output stems + handles
- Model selector and ensemble UI removed from node — now in `NodeSidePanel`
- Width: `w-64`

## `NodeSidePanel` (`src/front/src/components/NodeSidePanel.tsx`)
- Full model browser: search input, arch filter pills (All / MDXC·Roformer / MDX-Net / Demucs / VR Arch), category filter pills
- Model list grouped by category, scrollable (`max-h-72`), radio-style selection
- **Ensemble section**: toggle, blend algorithm select, primary model chip, add/remove ensemble model chips
- **★ Presets button** → `EnsemblePresetsModal` — lists 9 community presets (deton24 guide); clicking a preset applies primary model + ensemble models + algorithm in one shot

## Model Registry (`src/front/src/lib/models.ts`)
- `MODEL_DEFINITIONS` — 150+ models; categories: `splitter | multistem | karaoke | denoise | dereverb | debleed | drums | specialty`
- `ENSEMBLE_PRESETS` — 9 presets: instrumental_clean, instrumental_full, instrumental_balanced, instrumental_low_resource, vocal_balanced, vocal_clean, vocal_full, vocal_rvc, karaoke
- `STEM_COLORS` — extended for all new stem types (Reverb, Echo, Noise, Kick/Snare/Toms/HH, Male/Female, Crowd, Aspiration, etc.)
- `CATEGORY_LABELS` — display labels for all categories

## ⚠️ Sync Warning
`models.ts` (TypeScript) has 150+ models.
`app/models.py` (Python) and `StemDefinitions.cs` (C#) have NOT been updated to match.
These must be kept in sync when the worker actually needs to handle these models.
