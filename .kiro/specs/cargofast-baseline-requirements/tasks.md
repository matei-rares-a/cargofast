# Implementation Plan: CarGoFast Baseline Requirements

## Overview

This spec is a baseline of the current, implemented CarGoFast project. The code already satisfies the requirements as written, so there is nothing to re-implement. The tasks below are a review-and-update checklist:

- Resolve each Open Question of `requirements.md` / `design.md` with a decision: `keep`, `change (to what)` or `ignore`.
- Verify the items marked unverified (manual layout sync, `cubes.js` behavior, `?cam=` validation, performance).
- Keep requirements, design and `.kiro/steering/project-context.md` aligned and record changes in the requirements Change Log.

How to use a decision task: write the decision in the task notes. If the decision is `keep` or `ignore`, no code changes; only note it for the Change Log. If the decision is `change`, edit the code location named in the task and update the named requirement ID in `requirements.md` (and the matching section of `design.md`). A requirement ID is never renumbered; a removed requirement stays marked `[REMOVED]` with the reason.

No test-writing tasks are part of this plan.

## Tasks

- [ ] 1. Camera and rendering decisions
  - [ ] 1.1 Decide: wheel zoom in mode `fixed` (Open Question 1)
    - Decision needed: `keep` / `change (to what)` / `ignore`.
    - Finding: the wheel handler changes `camOffset`, but in `fixed` only OrbitControls decides the view, and OrbitControls also zooms on the same wheel event.
    - If `change`: edit the wheel handler in `src/script.js` (for example, apply `camOffset` only in `follow`, or disable OrbitControls zoom in `fixed`), then update REQ-CAM-005 criterion 1 and, if the behavior of `fixed` changes, REQ-CAM-002.
    - _Requirements: REQ-CAM-005, REQ-CAM-002, REQ-CAM-003_

  - [ ] 1.2 Decide: window resize handling (Open Question 3)
    - Decision needed: `keep` / `change (to what)` / `ignore`.
    - Finding: the resize handler in `src/script.js` is commented out, so renderer size and camera aspect stay at their initial values.
    - If `change`: re-enable the resize handler (renderer size, pixel ratio, camera aspect, `updateProjectionMatrix`), then rewrite REQ-CAM-001 criterion 4 and update `design.md` open point 3.
    - _Requirements: REQ-CAM-001_

  - [ ] 1.3 Decide: Warp "Entrance" target (Open Question 16)
    - Decision needed: `keep` (name stays, target stays at `SPAWN` (0, 3, 0)) / `change (rename the button, or move the target to the forest entrance (-20, 0))` / `ignore`.
    - If `change`: edit the `WARPS` table and the `entrance` handling in `src/script.js`, then update REQ-GUI-002 criteria 1, 3 and 4 and the `?warp=entrance` description.
    - _Requirements: REQ-GUI-002, REQ-CAR-006_

- [ ] 2. Car and controls decisions
  - [ ] 2.1 Decide: `preventDefault()` on every key (Open Question 4)
    - Decision needed: `keep` / `change (to what)` / `ignore`.
    - Finding: `src/objects/car.js` and `src/objects/cubes.js` call `preventDefault()` on every `keydown` / `keyup` on `window`, which blocks F5, F12 and similar browser keys.
    - If `change`: restrict `preventDefault()` to the game keys (W, A, S, D, Space, Shift, Ctrl+R) in both files, then update REQ-CAR-001 / REQ-CAR-002 text and `design.md` open point 4.
    - _Requirements: REQ-CAR-001, REQ-CAR-002, REQ-CAR-007_

  - [ ] 2.2 Decide: coasting behavior (Open Question 6)
    - Decision needed: `keep` / `change (to what)` / `ignore`.
    - Finding: with neither W nor S pressed, the horizontal velocity is forced linearly to 0 over 1.5 s (`COAST_STOP_TIME`) and the brake of 1.5 is applied afterwards. This also holds at start, so the car does not roll downhill.
    - If `change`: edit the coasting logic in `src/objects/car.js` (for example, skip the velocity override on slopes or at start), then update REQ-CAR-003 criteria 1 to 5 and `design.md` open point 6.
    - _Requirements: REQ-CAR-003_

  - [ ] 2.3 Decide: physics body of the hidden cube (Open Question 9)
    - Depends on the result of task 6.2 (reading `cubes.js`).
    - Decision needed: `keep` (body stays in the world) / `change (remove the body when disabled, or do not create the cube)` / `ignore`.
    - If `change`: edit `src/objects/cubes.js` and the cube setup in `src/script.js`, then update REQ-CAR-007 criteria 1 to 3 and `design.md` open point 9.
    - _Requirements: REQ-CAR-007_

- [ ] 3. Scenery and physics decisions
  - [ ] 3.1 Decide: shadows (Open Question 2)
    - Decision needed: `keep` (shadow map stays enabled, no visible shadows) / `change (to what)` / `ignore`.
    - Finding: the sun has `castShadow = true` with a 1024 x 1024 shadow map, but only the hidden cube casts shadows; `NatureKit` uses `CAST_SHADOWS = false` and the car does not set `castShadow`.
    - If `change`: either remove the unused shadow setup in `src/script.js`, or enable casting on the car (`src/objects/car.js`) and on the terrain / Nature Kit receivers (`CAST_SHADOWS` in `src/objects/nature_kit.js`). Then update REQ-SCN-001 criterion 1, REQ-NAT-001 criterion 3 and `design.md` open point 2.
    - _Requirements: REQ-SCN-001, REQ-NAT-001_

  - [ ] 3.2 Decide: the 300 m physics limit (Open Question 5)
    - Decision needed: `keep` / `change (invisible walls, automatic reset below a Y limit, or larger colliders)` / `ignore`.
    - Finding: solid ground exists only within +/-300 m (plus the field heightfield and the seabed); beyond that the car falls, while the visual disc is 900 m.
    - If `change`: edit the collider setup in `src/objects/scenery.js` and, for an automatic reset, the frame loop in `src/script.js`. Then update REQ-SCN-003 (criteria 1 and 3) and, for a reset, REQ-PHY-001; update `design.md` open point 5.
    - _Requirements: REQ-SCN-003, REQ-SCN-002, REQ-PHY-001_

- [ ] 4. Map and Nature Kit decisions
  - [ ] 4.1 Decide: colliders for the pier and the platforms (Open Question 8)
    - Decision needed: `keep` (no collider, the car cannot drive onto them) / `change (add collider to which items)` / `ignore`.
    - Finding: in `src/objects/nature_layout.js` the pier, `platform-beach` and `platform-stone` on the summit are placed without a collider, although the project notes mention one for platforms.
    - If `change`: add `collider` (for example `box`) to those `put` calls in `src/objects/nature_layout.js`; if `src/static/nature/layout.manual.json` is used, regenerate it (see task 6.1). Then update REQ-NAT-002 criteria 2 and 4, REQ-NAT-004 criterion 3, and `design.md` open point 8.
    - _Requirements: REQ-NAT-002, REQ-NAT-004, REQ-NAT-008_

  - [ ] 4.2 Decide: trail width note (Open Question 7)
    - Decision needed: `keep` (code value `TRAIL_WIDTH = 8` is correct; fix the note) / `change (set TRAIL_WIDTH to another value, for example 6)` / `ignore`.
    - Finding: `.kiro/steering/project-context.md` says "6 m ledge"; `src/objects/forest_map.js` has `TRAIL_WIDTH = 8`.
    - If `keep`: correct the "6 m" wording in `.kiro/steering/project-context.md`. If `change`: edit `TRAIL_WIDTH` in `src/objects/forest_map.js` and update REQ-MAP-003 criterion 5 (terrain carving, ribbons and layout clearances follow the constant).
    - _Requirements: REQ-MAP-003, REQ-MAP-006_

- [ ] 5. Build, deploy and asset decisions
  - [ ] 5.1 Decide: `vite-plugin-restart` glob (Open Question 10)
    - Decision needed: `keep` / `change (fix the path, or remove the plugin)` / `ignore`.
    - Finding: the glob `'../static/**'` is resolved against `root: 'src/'`, giving `<project>/static/**`, which does not exist; the assets are in `src/static`.
    - If `change`: edit the plugin entry in `vite.config.js` (and `package.json` if the plugin is removed), then update REQ-BLD-001 and `design.md` open point 10.
    - _Requirements: REQ-BLD-001_

  - [ ] 5.2 Decide: `start.bat` port validation (Open Question 11)
    - Decision needed: `keep` (numeric check only) / `change (enforce 1024-65535)` / `ignore`.
    - Finding: the comment in `start.bat` says 1024-65535, but the validation only checks that `DEV_PORT` is numeric.
    - If `change`: add the range check in `start.bat`, then update REQ-BLD-002 criterion 3. If `keep`: correct the comment in `start.bat` or leave as noted.
    - _Requirements: REQ-BLD-002_

  - [ ] 5.3 Decide: test step in the deploy workflow (Open Question 12)
    - Decision needed: `keep` / `change (remove the test step from the pipeline; also decide whether `start.bat` keeps its `test` mode)` / `ignore`.
    - Finding: `.github/workflows/deploy-pages.yml` runs `npm run test:run` before the build; `start.bat` has a `test` mode.
    - If `change`: edit `.github/workflows/deploy-pages.yml` (and `start.bat` if the `test` mode is dropped), then update REQ-BLD-003 criterion 2 and REQ-BLD-002 criterion 5.
    - _Requirements: REQ-BLD-003, REQ-BLD-002_

  - [ ] 5.4 Decide: unused files and dependencies (Open Question 13)
    - Decision needed per item: `keep` / `remove` / `ignore`. Items: `src/static/LowPolyCars.glb`, `src/static/LowPolyCars.blend1`, the unused Kenney models in `src/static/nature/` (about half of 329), the `jest` devDependency, and the non-compat `@dimforge/rapier3d` dependency.
    - If `remove`: delete the files or edit `package.json` and `package-lock.json`, check that `src/objects/nature_layout.js` and `nature_kit.js` do not reference removed models (the manual layout may use different models), then update REQ-BLD-001 / REQ-NAT-001 where they mention assets.
    - _Requirements: REQ-BLD-001, REQ-NAT-001, REQ-CAR-001_

- [ ] 6. Verification of unverified items
  - [ ] 6.1 Verify: `layout.manual.json` is in sync with the generator (Open Question 14)
    - Compare `src/static/nature/layout.manual.json` with the output of `nature_layout.js` (read the generator rules and compare item counts per tag, or run the app with `?layout=generated`, use the GUI button "Export layout (JSON)" and diff the download against the shipped file).
    - Outcome to record: `in sync` / `out of sync (what differs)`. If out of sync, decide whether to replace the shipped file with a fresh export or leave it as a hand-edited file.
    - _Requirements: REQ-NAT-008, REQ-NAT-009, REQ-NAT-003_

  - [ ] 6.2 Verify: `cubes.js` behavior (Open Question 9)
    - Read `src/objects/cubes.js` in full. Confirm whether the cube keeps a dynamic body and collider while the mesh is hidden, whether `inputBlocked = true` stops all input handling, and whether `reset()` still moves the body.
    - Outcome to record: confirmed behavior, and any difference from REQ-CAR-007 criteria 1 to 3 (feeds task 2.3).
    - _Requirements: REQ-CAR-007, REQ-CAR-002_

  - [ ] 6.3 Verify: `?cam=dx,dy,dz` parsing and validation
    - Read the `cam` parameter handling in `src/script.js` (`urlParams`, `pendingWarp`, `warpTo`). Check the behavior for: missing parameter, fewer or more than 3 values, non-numeric values (NaN), `cam` given without `warp`.
    - Optionally confirm in the running app with `/?warp=summit&cam=0,9,16` and with a malformed value such as `/?warp=summit&cam=a,b`.
    - Outcome to record: the real behavior; if invalid input can produce NaN camera positions, decide `keep` or `change (fall back to the default offset)` and update REQ-GUI-002 criterion 6 accordingly.
    - _Requirements: REQ-GUI-002_

  - [ ] 6.4 Verify: frame rate with the full scene (Open Question 15)
    - Manually run the app (`start.bat` or `npm run dev`) on a real GPU and note the frame rate in the clearing, on the beach, on the summit (`?warp=summit`) and at the entrance, with the default settings (about 2000+ instances).
    - Outcome to record: measured fps per location and the machine used, or `not measured`. If the result is poor, note it as a new requirement candidate rather than changing the baseline.
    - _Requirements: REQ-NAT-001, REQ-SCN-005, REQ-PHY-001_

- [ ] 7. Keep documents aligned
  - [ ] 7.1 Align requirements, design and project notes, and update the Change Log
    - Collect every decision from tasks 1.1 to 5.4 and every outcome from tasks 6.1 to 6.4.
    - In `requirements.md`: update each affected requirement, answer or remove the resolved items in "Open Questions", and add one row per change to the "Change Log" table (date, REQ ID, what changed). Decisions of `keep` / `ignore` also get a row or a short note so the answer is not lost.
    - In `design.md`: update the "Open Points That Affect the Design" table and the affected component sections so they match the code.
    - In `.kiro/steering/project-context.md`: correct every statement that no longer matches (trail width, test counts if affected, known quirks, file list, "unverified" items that are now verified).
    - Check that REQ IDs in the three documents still match and none was renumbered.
    - _Requirements: REQ-CAR-001, REQ-CAR-002, REQ-CAR-003, REQ-CAR-007, REQ-CAM-001, REQ-CAM-005, REQ-SCN-001, REQ-SCN-003, REQ-MAP-003, REQ-NAT-002, REQ-NAT-008, REQ-GUI-002, REQ-BLD-001, REQ-BLD-002, REQ-BLD-003_

## Notes

- This plan does not re-implement existing behavior; each decision task changes code only when the decision is `change`.
- Verification tasks 6.1 to 6.4 come first in execution order (wave 0) because tasks 2.3 and 7.1 use their results.
- No task writes or runs tests.
- Decision tasks may edit `requirements.md`, so they run one at a time.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["6.1", "6.2", "6.3", "6.4"] },
    { "id": 1, "tasks": ["1.1"] },
    { "id": 2, "tasks": ["1.2"] },
    { "id": 3, "tasks": ["1.3"] },
    { "id": 4, "tasks": ["2.1"] },
    { "id": 5, "tasks": ["2.2"] },
    { "id": 6, "tasks": ["2.3"] },
    { "id": 7, "tasks": ["3.1"] },
    { "id": 8, "tasks": ["3.2"] },
    { "id": 9, "tasks": ["4.1"] },
    { "id": 10, "tasks": ["4.2"] },
    { "id": 11, "tasks": ["5.1"] },
    { "id": 12, "tasks": ["5.2"] },
    { "id": 13, "tasks": ["5.3"] },
    { "id": 14, "tasks": ["5.4"] },
    { "id": 15, "tasks": ["7.1"] }
  ]
}
```
