# CarGoFast - project context

Personal hobby project (not work/automotive). Notes live here in the repo, not in `C:\context`.

Origin: moved from `Miniatures/frontend/threejs` (Miniatures repo). Remote: `github.com/matei-rares-a/cargofast`.

## What it is
Browser 3D driving sandbox. A low-poly car (raycast vehicle) drives on the forest ground (the original light-green 40x40 ground plane was removed; the start area is the far land). (The original pink cascade platforms and the 3-step staircase still exist as objects, but are moved 60 m under the map by PLATFORMS_DEPTH in script.js, so they are never seen.) West of the ground (x < -20) is a Kenney Nature Kit forest world: a winding dirt path with 3 exits (a clearing with a camp, the sea with a beach and pier, a mountain with a spiral trail to a summit viewpoint), flowers, trees, rocks, big rocks and cliffs, plus a ring of backdrop mountains. Debug GUI (lil-gui) exposes camera, car, terrain, scenery and a Warp menu.

## Stack
- three `^0.174` (rendering, GLTFLoader, OrbitControls)
- @dimforge/rapier3d-compat `^0.18` (physics, `createVehicleController`)
- lil-gui (debug panel), Vite 6 (dev/build), Vitest 3 (tests)
- Plain JS, ES modules, no TypeScript, no framework.

## Commands
```bash
npm install
npm run dev        # Vite dev server (opens browser unless SANDBOX_URL is set); start.bat does this
npm run build      # -> dist/ (needs build.target 'esnext' for top-level await)
npm run test:run   # vitest once; `npm test` = watch mode
```
Debug URLs: `/?warp=summit` (also `clearing`, `beach`, `foot`, `entrance`), `/?warp=summit&cam=0,9,16` (camera offset from the car, world axes), `/preview.html?prefix=tree` (kit model viewer).

## World map (all in `src/objects/forest_map.js`, pure data + functions)
World units are meters. The terrain field spans x -180..-20, z -80..80 (ground edge at x=-20 is the entrance).
- `main` path (8 m wide, Catmull-Rom through hand-placed waypoints): entrance (-20,0) -> beach (-160,9). It is the "sea" exit.
- Exit 1 `clearing` branch leaves the main path at (-64,9) and ends at the clearing (-62,50), radius 15, flat, with the camp.
- Exit 2 = the main path itself, down the beach into the sea (pier at the end). Sea basin: terrain falls below `WATER_Y = -1.2` west of x=-148.
- Exit 3 `access` branch leaves at (-98,-2) and joins the foot of the mountain trail (mountain center (-110,-40), radius 34, height 26, flat summit plateau).
- `trail`: 8 m wide spiral on the mountain flank, integrated numerically so the gradient never exceeds 0.12 (verified <= 0.14 by test), ~1.3 turns, ends at the summit center. The terrain is carved into a level ledge along it.
- `carvePaths(natural, x, z)` flattens the terrain along every path (blend over the shoulder: 7 m for paths, 8 m for the trail; widths are `PATH_WIDTH` / `TRAIL_WIDTH` in `forest_map.js`, and the layout keeps trees, rocks and flowers clear of them relative to those widths) and the clearing. `landHeight` = height without the random meadow hills (used by the layout for decisions).

## Layout
- `vite.config.js` - `root: 'src/'`, `publicDir: 'static'` (so `src/static/*` is served at `/`), `outDir: ../dist`, `base: './'` (relative URLs so the build works from any sub-path). Runtime asset URLs (`nature/...`, `LowPolyCars.gltf`) must stay RELATIVE (no leading `/`). GitHub Pages: `.github/workflows/deploy-pages.yml` (on push to `main`: npm ci, tests, build, deploy `dist/`; needs Settings > Pages > Source = "GitHub Actions"); URL `https://matei-rares-a.github.io/cargofast/`.
- `src/index.html` - `#app` mount + `script.js`.
- `src/script.js` - entry. Global settings (constants), renderer/scene/camera, Rapier world, ground, platforms, stairs, camera modes, fixed-step loop (1/60, max dt 0.033), Warp GUI + `?warp=` URL. Uses top-level `await RAPIER.init()`.
- `src/objects/car.js` - `CarObject`: loads `LowPolyCars.gltf`, chassis collider + 4-wheel vehicle controller, WASD, coasting/steering, wheel/body animation, `teleport(x,y,z,yaw)` (yaw 0 = facing +z), `reset()`.
- `src/objects/cubes.js` - `CubeObject`: controllable physics cube. Currently disabled in `script.js`.
- `src/objects/terrain.js` - `Terrain`: 160x160 field, 1 m grid. Height = meadow hills (seeded fBm, amplitude 2.5, fades near the ground edge, in the sea basin and on the summit) + mountain + sea basin, then `carvePaths`. Drives the visual mesh (vertex colors: patchy forest floor, rock on steep/high ground, sand on the beach, seabed) and a Rapier heightfield collider. `heightAt(x,z)`, `rebuild()`, `onRebuild(fn)`, `bounds`. GUI folder "Hills" (height, wavelength, seed regenerate on release). There are NO grass blades any more.
- `src/objects/trails.js` - `Trails`: dirt ribbon meshes draped on the terrain along every corridor of `forest_map.js` (rebuilt on `terrain.onRebuild`).
- `src/objects/scenery.js` - `Scenery`: ambient HemisphereLight (the sun in `script.js` is the only other light), fog, far land (flat lowland at LOWLAND_Y = 0 (forest_map.js) = terrain base level, so no step at the field edges; the terrain field rectangle x -176..-20, z -80..80 is CUT OUT of its shape so the terrain mesh meets it edge to edge; it is textured with a 512 px DataTexture over 600 m made from `forestFloorColor(wx,wz)` exported by `terrain.js` (same function as the terrain vertex colors, so colors blend); colliders = 3 boxes (east of the field, north, south), the field has its own heightfield; minus the sea side x < -176), sea plane at `WATER_Y` over x < -140, solid seabed at `SEABED_Y = -4` under the open sea, 48 instanced backdrop mountains on a 260-340 ring. GUI folder "Scenery".
- `src/objects/nature_layout.js` - pure, deterministic placement of Kenney models along the map (seeded; decisions use `landHeight`, so regenerating hills only moves models up/down). Order: summit viewpoint, camp, beach/pier/palms/sea rocks/lilies, path decoration (stones/flowers/grass), big+large rocks and cliff outcrops, mountain pines, forest (broadleaf, undergrowth, moss, stumps, logs), flower patches + clearing flowers + small stones, then the FAR FOREST: up to 2200 trees (7 m apart, spatial-hash sampled, pines more likely toward the mountains) on the flat lowland, tag ar, inside FAR_FOREST (disc radius 240 around (-60,0), i.e. out to the foot of the backdrop mountains at 260; not on the terrain field, not in the 80x100 m meadow around the start ground, not on the sea side). Tags per item (`tree`, `pine`, `palm`, `bigrock`, `cliff`, `camp`, `summit`, `pier`, ...). `KIT_SCALE = 4`.
- `src/objects/nature_kit.js` - `NatureKit`: loads only the models the layout uses (~170 of 329), merges each into ONE geometry with baked vertex colors, one `InstancedMesh` per model, shared material. Colliders: cylinder (trunks), box (cliffs, tents, platforms), convex hull (rocks, stumps). Async `load()`, re-snaps on `terrain.onRebuild`. GUI folder "Nature Kit": Show Models, Brightness, Palette (natural | original).
- `src/objects/coordinate_picker.js` - `CoordinatePicker` (debug): GUI folder "Coordinates", checkbox "Hover + click shows x y z" (OFF by default). Hover shows a tooltip next to the cursor ("Terrain  x -57.2  y 0.0  z 37.2"), a click (press and release within 5 px, so camera drags do not count) drops a red cone pin with a label that follows it on screen (max 20; a pin shrinks, fades and vanishes after "Pins vanish after (s)" seconds, default 10, 0 = never; "Clear pins" button, "Last click" field). Ray casts the targets given by `script.js` (terrain, ground, far land, sea, backdrop mountains, nature kit group); invisible objects are ignored; disabled in the pointer-locked free-fly camera mode.
- `src/objects/noise.js` - `seededRandom`, `createValueNoise`, `fbm`, `smoothstep`.
- `src/objects/RapierDebugRenderer.js` - collider wireframe, OFF by default (heightfield has ~50k edges).
- `src/static/` - `LowPolyCars.gltf/.bin`, `Car Texture 1.png`; `src/static/nature/` - all 329 Kenney `*.glb` (CC0, https://kenney.nl/assets/nature-kit, via the hidencod.github.io/tge-assets mirror) + `manifest.json` (bbox per model) + `README.txt`. About half are unused by the layout but kept (3 MB total, all shipped in `dist/`).
- `src/preview.html` - dev viewer for the kit (`?prefix=tree`).
- `src/tests/` - Vitest tests (see below).

## Controls
W/S throttle/reverse, A/D steer, Ctrl+R reset. Camera modes (GUI): `fixed` (OrbitControls, default), `follow` (scroll = zoom), `independent` (click for pointer lock; WASD/Space/Shift free-fly, car input blocked; settings in GUI > Camera: "free-fly speed" 1-200 m/s, default 10, also changed by the mouse wheel in this mode, and "free-fly look" = mouse sensitivity; both live in the `FREE_CAM` object in `script.js`). GUI "Warp" jumps the car (and puts the camera behind it) to Entrance / Clearing / Beach / Mountain foot / Summit.

## Conventions (from `AGENT.MD`, `.github/copilot-instructions.md`)
- Concise answers; ask for clarification when unclear; DRY/KISS/YAGNI; OOP.
- Magic numbers as constants at top of the file; object properties parametrized and highlighted at top; defaults must be reflected in the debug GUI.
- Feature-global settings go in the main `.js` file only when requested.
- Prettier: width 250, 2 spaces, single quotes, semicolons.

## Tests (verified: 118 passing, 8 files)
- `coordinate_picker.test.js` - coordinate formatting (no "-0.0"), ray picking maps the screen to world axes, misses and invisible objects, hover tooltip (throttle, hide on miss / disabled / inactive / leave), click vs drag vs right click, pin label, 20-pin cap, clear, labels follow pins and hide behind the camera, cursor, wiring in `script.js`. Also checked once end to end in headless Edge through the DevTools protocol (real GUI checkbox + mouse events: tooltip and two pins with labels appeared).
- `forest_map.test.js` - 3 exits really connect (branches start on the main path, end at clearing / beach / trail foot), path is winding, everything inside the field, trail starts at 0 and ends at the summit, never descends, gradient <= 0.14, circles the mountain, stays on the mountain surface.
- `terrain.test.js` - mesh/collider/function agree (asymmetric off-grid points, catches swapped heightfield axes; verified to fail if the index order is swapped), flat entrance, summit plateau, sea basin + sand, paths and clearing flat, trail is a level ledge, rebuild/seed/determinism, `Trails` ribbons lie on the terrain, car settles on the path and on the summit.
- `nature.test.js` - layout (deterministic, independent of hills, inside field, on terrain, forest density/species/spacing/path clearance/tree line, trunk colliders, flower patches, big rocks, cliffs on the mountain, summit viewpoint, camp with 4 tents, pier into the water) and `NatureKit` with the real GLBs (instance counts, shared non-metal vertex-color material, palette switch, colliders, ball stopped by a trunk, ray hits a big rock hull, re-snap without collider leaks).
- `drive.test.js` - the real car, driven by a small pure-pursuit driver in pure physics, reaches the beach along the winding path, the clearing along its branch, and the summit up the spiral trail (about 36 s of game time).
- `scenery.test.js` - fog/CAM_FAR, ambient light, far land (no hole, solid everywhere except the terrain's sea basin, level LOWLAND_Y), the original platforms hidden under the sea floor (parsed from script.js), sea plane, seabed, mountains ring.
- `physics.test.js`, `smoke.test.js` - original + car/cube/debug-renderer smoke tests (the car loaded from the real gltf).
- `helpers.js` - fake lil-gui, `window` key stub, fixed-step runner, ground builder, `withDiskGltfLoader` (shared GLTFLoader mock), `warmUpPhysics`.
- Test tricks: `GLTFLoader` is mocked to read the car from disk (bin inlined, textures stripped: no DOM); kit GLBs have no textures so they parse as they are; `ProgressEvent` polyfilled; car loads async so tests `waitFor(car.ready)`.
- Sanity-checked: `ENGINE_FORCE = 0` fails the throttle test; swapping the heightfield index order fails the terrain test.

## Known quirks / unverified
- Rapier wasm quirk: in a fresh test file the first `world.step()` of a world containing a vehicle traps (`RuntimeError: unreachable`); stepping one plain world first avoids it (`warmUpPhysics`). The game is not affected (the world has stepped many frames before the car model finishes loading).
- `car.js` coasting hack: releasing W overwrites the velocity with the stored pre-release direction for 1.5 s, so the car does not turn while coasting. The test driver brakes with S instead of releasing W.
- Rapier ray casts that hit exactly on a heightfield grid edge can miss; tests use off-grid points. Heightfield vs analytic height differ up to ~0.1-0.3 m on the steep mountain flank (1 m bilinear grid).
- The kit GLBs export `metalness = 1` for every material (near-black without an env map): `NatureKit` ignores their materials and uses its own (metalness 0, vertex colors). Kenney's own colors are very light pastels (grass #73eddd); the default "natural" palette in `nature_kit.js` re-colors them by material name.
- The mountain trail is a narrow ledge (6 m) with a steep drop on the outside; a car that is too fast in the tight upper turns (radius ~10 m) can leave it. The test driver uses 6 m/s there.
- Verified by headless Edge screenshots (`/?warp=...`): entrance, clearing + camp, beach + pier + sea, mountain foot, summit vistas west (sea), north (backdrop mountains) and south (forest + sea). Unverified: frame rate on a real GPU with ~2k instances / ~170 draw calls, and the feel of driving through props.
- Wheels: `WHEEL_VISUAL_TRAVEL_SCALE` in `car.js` is 1.0 (was 0.55, which sank the wheels ~22 cm); measured wheel bottoms at rest -0.006 m (smoke test checks wheel contact).
- Cosmetic: there is no water/sea animation.
- Resize handler in `script.js` is commented out, so the canvas does not follow window resizes.
- `car.js` and `cubes.js` both call `preventDefault()` on every keydown/keyup (blocks browser shortcuts like F5/F12).
- `npm install` reports 21 audit vulnerabilities (dev tooling deps; not triaged). `jest` is listed in devDependencies but unused. `rapier3d` (non-compat) is also a dependency but only `-compat` is imported.
