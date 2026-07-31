# TODO

Items 1-9 from the original adversarial review of the in-canvas execution feature (branched
`PartiallyFailed` semantics, cancel endpoint, workflow version drift, SSE snapshot/replay,
nginx SSE config, node-execution idempotency, frontend housekeeping, transient remote-error
classification + auto-retry, Modal `/download` contention) have all been resolved and verified
live (`users/k_sfar/todo-enhancements`). Background: Serena memory `frontend/execution_overlay`.

---

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
