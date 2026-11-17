# Requirements Document

## Introduction

This document describes the CURRENT, already implemented behavior of the CarGoFast project (a browser 3D driving sandbox: three.js + Rapier + Vite). It is a baseline obtained by reading the source code, not new functionality. The values (widths, counts, radii, defaults) are the ones in the code at the time of writing.

The document is written in English; identifiers, constants and file names are the ones in the code. The EARS keywords (WHEN, WHILE, IF, THEN, WHERE, THE, SHALL) are kept in English.

Domains and ID prefixes:

- CAR: car and controls
- PHY: physics and simulation loop
- CAM: camera
- TER: terrain and hills
- MAP: forest map (paths, exits, clearing, beach, mountain)
- NAT: Nature Kit (models, layout, manual layout)
- SCN: scenery (lights, fog, far land, sea, backdrop mountains)
- GUI: debug panel, warp, coordinate picker
- BLD: run, build, deploy

### Requirements update workflow

A working document, in 4 steps:

1. Review: go through the document and either correct the text directly or mark the requirement with `[TO CHANGE]`, `[WRONG]` or `[OK]` in the title (optional); answer the "Open Questions" section.
2. Change: for a new or modified feature, edit (or ask to have edited) the requirement with the affected ID, then ask for the implementation based on it.
3. Stable IDs: an ID `REQ-<DOMAIN>-<NNN>` is not reused and not renumbered. A removed requirement stays in the document marked `[REMOVED]`, with the reason.
4. Log: any change after the baseline is recorded in the "Change Log" table at the end of the document (date, ID, what changed).

After implementation, the requirement and the code must stay aligned: if a default is changed in the code, the corresponding criterion is updated. The project notes in `.kiro/steering/project-context.md` remain the orientation document; in case of conflict, the code and this document take precedence.

## Glossary

- **Game**: the CarGoFast application, running in the browser (`src/script.js` as entry point).
- **Car**: the `CarObject` object (`src/objects/car.js`), a Rapier vehicle with 4 wheels and the `LowPolyCars.gltf` model.
- **Camera_Controller**: the camera logic in `script.js` (modes `fixed`, `follow`, `independent`).
- **Physics_World**: the Rapier world created in `script.js`.
- **Terrain**: the `Terrain` object (`src/objects/terrain.js`), the 160 x 160 m terrain field with hills, mountain and sea basin.
- **Forest_Map**: the pure data in `src/objects/forest_map.js` (paths, clearing, mountain, trail, basin, far forest).
- **Trails**: the `Trails` object (`src/objects/trails.js`), the dirt ribbons drawn on the paths.
- **Nature_Layout**: the deterministic placement generator in `src/objects/nature_layout.js`.
- **Nature_Kit**: the `NatureKit` object (`src/objects/nature_kit.js`), which loads and instantiates the Kenney Nature Kit models.
- **Manual_Layout_File**: `src/static/nature/layout.manual.json`, a hand-edited layout.
- **Scenery**: the `Scenery` object (`src/objects/scenery.js`), the backdrop (ambient light, fog, far land, sea, backdrop mountains).
- **Debug_GUI**: the lil-gui panel created in `script.js`.
- **Warp**: the menu and the URL parameter that teleport the car to points of interest.
- **Coordinate_Picker**: the `CoordinatePicker` object (`src/objects/coordinate_picker.js`).
- **Debug_Renderer**: the `RapierDebugRenderer` object.
- **Build_System**: the Vite configuration (`vite.config.js`) and the npm scripts in `package.json`.
- **Start_Script**: `start.bat`.
- **Deploy_Pipeline**: the workflow `.github/workflows/deploy-pages.yml`.
- **Kit unit**: a unit of the Kenney models; `KIT_SCALE = 4` converts it to meters.
- **World coordinates**: meters; x, z on the ground plane, y up.

## Requirements

### Requirement 1: REQ-CAR-001 — Car loading, spawn and structure

**User Story:** As a player, I want the car to appear ready to drive at the start, so that I can drive right away.

#### Acceptance Criteria

1. WHEN Game starts, THE Car SHALL load `LowPolyCars.gltf` asynchronously (relative URL) and SHALL set `ready = true` only after the model, the rigid body and the vehicle controller are created.
2. THE Car SHALL create a dynamic rigid body at `SPAWN = (0, 3, 0)` with `angularDamping = 1.0` and additional mass 8.0.
3. THE Car SHALL create a cuboid collider for the chassis with the model dimensions multiplied by 0.70 (width), 0.25 (height), 0.75 (length), translated on y by `CHASSIS_OFFSET_Y = 0.45`, restitution 0.05.
4. THE Car SHALL identify the wheels by the meshes whose name contains "whell" (spelled this way in the 3D model) and SHALL treat as front wheels those with z >= the mean z of the wheels.
5. THE Car SHALL use a Rapier vehicle controller with 4 wheels, vertical axis y and forward axis z.
6. WHILE `ready` is false, THE Car SHALL ignore input and SHALL NOT execute vehicle physics steps.
7. IF loading the model fails, THEN THE Car SHALL write the error to the console with the prefix "Car load error:".

### Requirement 2: REQ-CAR-002 — Controls and engine

**User Story:** As a player, I want to drive with the keyboard, so that I control the car.

#### Acceptance Criteria

1. WHILE key W is pressed and input is not blocked, THE Car SHALL apply the positive engine force `settings.engineForce` (default 60) on each of the 4 wheels (all-wheel drive).
2. WHILE key S is pressed and input is not blocked, THE Car SHALL apply the engine force `-settings.engineForce` on each wheel (reverse).
3. WHILE key A or D is pressed, THE Car SHALL set the target steering angle to `+maxSteer` (A) or `-maxSteer` (D), with `maxSteer` default 0.65 rad, and SHALL smooth the current angle with the factor 0.15 per physics step.
4. THE Car SHALL reduce the maximum steering angle linearly from 100% to 35% as the horizontal speed increases from 4.0 m/s to 14.0 m/s.
5. THE Car SHALL apply steering only on the front wheels.
6. WHILE `inputBlocked` is true, THE Car SHALL treat W, A, S, D as not pressed.
7. WHEN Ctrl+R is pressed, THE Game SHALL call `CAR.reset()` and `CUBES.reset()` and SHALL prevent the browser's default action.

### Requirement 3: REQ-CAR-003 — Coasting and brake

**User Story:** As a player, I want the car to stop smoothly when I release the throttle, so that it does not stop abruptly and does not skid.

#### Acceptance Criteria

1. WHEN W and S are both released after one of them was pressed, THE Car SHALL store the horizontal velocity (x, z) from that moment.
2. WHILE neither W nor S is pressed, THE Car SHALL set the horizontal velocity of the body to the stored velocity multiplied by `1 - t/1.5`, where t is the time in seconds elapsed since the release, and SHALL keep the vertical velocity component.
3. WHEN 1.5 s (`COAST_STOP_TIME`) have elapsed since the throttle was released, THE Car SHALL apply the brake force 1.5 on each wheel.
4. WHILE neither W nor S is pressed, THE Car SHALL apply on the front wheels only 0.18 of the current steering angle and SHALL damp the angular velocity on y with the factor `exp(-18 · dt)` per step.
5. WHEN W or S is pressed, THE Car SHALL reset the coasting timer to 0.

### Requirement 4: REQ-CAR-004 — Suspension, tires and GUI tuning

**User Story:** As a developer, I want adjustable suspension and tire parameters, so that I can tune the car behavior.

#### Acceptance Criteria

1. THE Car SHALL configure each wheel with: suspension rest length 0.45, maximum travel 0.60, maximum force 600, compression 1.8, relaxation 1.2, stiffness 25, `frictionSlip` 4.0, side stiffness 1.4.
2. THE Debug_GUI SHALL expose in the "Car" folder: Engine Force (10–300, step 5, default 60), Max Steer (0.1–1.0, step 0.05, default 0.65), Susp Stiffness (5–100, step 1, default 25), Tire Friction (0.5–30, step 0.5, default 4.0).
3. WHEN Susp Stiffness or Tire Friction is changed in the GUI, THE Car SHALL apply the new value immediately on all wheels.
4. WHEN Engine Force or Max Steer is changed in the GUI, THE Car SHALL use the new value at the next physics step.

### Requirement 5: REQ-CAR-005 — Visual animation of the car

**User Story:** As a player, I want the wheels and the body to react visibly, so that the car feels alive.

#### Acceptance Criteria

1. WHEN a wheel rolls, THE Car SHALL rotate the wheel mesh by the angle reported by the vehicle controller, with the sign `WHEEL_SPIN_DIR = -1`.
2. THE Car SHALL visually pivot the front wheels by the current steering angle.
3. THE Car SHALL position each wheel mesh on the real suspension travel (`WHEEL_VISUAL_TRAVEL_SCALE = 1.0`), so that the wheels touch the ground.
4. THE Car SHALL lift the body mesh by `MODEL_BODY_LIFT = 0.50` relative to the wheel center (visual geometry only, not the physics).
5. THE Car SHALL move the body vertically by the mean suspension travel (scale 0.06, limit ±0.03, smoothing 0.02) and SHALL tilt it by the front-rear difference (scale 0.35, limit ±0.16 rad, smoothing 0.05).

### Requirement 6: REQ-CAR-006 — Teleport and reset

**User Story:** As a player, I want to put the car back at the start or somewhere else, so that I can return after a mistake.

#### Acceptance Criteria

1. WHEN `teleport(x, y, z, yaw)` is called and Car is `ready`, THE Car SHALL set the position and the rotation on y (yaw 0 = facing +z) and SHALL clear the linear velocity, the angular velocity, the coasting timer, the steering angle and the body animations.
2. WHEN `reset()` is called, THE Car SHALL teleport to `SPAWN` (0, 3, 0) with yaw 0.
3. IF `teleport` is called before Car is `ready`, THEN THE Car SHALL ignore the call.

### Requirement 7: REQ-CAR-007 — The disabled test cube

**User Story:** As a developer, I want to keep the `CubeObject` object in the code, so that I can re-enable it if needed.

#### Acceptance Criteria

1. THE Game SHALL instantiate `CubeObject` and SHALL set `CUBES.inputBlocked = true` and `CUBES.mainCube.mesh.visible = false`.
2. THE Game SHALL NOT call `CUBES.update()` in the animation loop (the call is commented out).
3. THE Debug_GUI SHALL contain the "Cube" folder (Speed 1–20, Turn Speed 1–30).

### Requirement 8: REQ-PHY-001 — Physics world and simulation loop

**User Story:** As a developer, I want a stable fixed-step simulation, so that the car behavior does not depend on the frame rate.

#### Acceptance Criteria

1. THE Game SHALL initialize Rapier (`RAPIER.init()` with top-level await) before creating Physics_World.
2. THE Physics_World SHALL use the gravity `(0, -20.81, 0)`.
3. THE Game SHALL run the physics with a fixed step `FIXED_TIMESTEP = 1/60` s, accumulating time with `dt` capped at `MAX_DT = 0.033` s.
4. WHEN a fixed step is executed, THE Game SHALL call `CAR.prePhysicsStep(1/60)` before `world.step()`.
5. WHEN a frame ends, THE Game SHALL call `CAR.update(dt)`, `debugRenderer.update()`, the camera logic, `PICKER.update()` and SHALL render the scene.
6. THE Game SHALL use friction 0.5 on the terrain heightfield and on the far land colliders.

### Requirement 9: REQ-PHY-002 — Hidden original platforms and stairs

**User Story:** As a developer, I want to keep the initial test objects, so that I do not lose them, but they do not appear in the game.

#### Acceptance Criteria

1. THE Game SHALL create 3 cascade platforms (`PLATFORM_CONFIGS`) and 3 steps (`STAIR_CONFIGS`) as a magenta mesh (`0xff00ff`) plus a fixed collider.
2. THE Game SHALL shift all these objects by `PLATFORMS_DEPTH = -60` on y, under the map, so that they are not visible under normal gameplay conditions.

### Requirement 10: REQ-CAM-001 — Rendering and camera parameters

**User Story:** As a player, I want a clear 3D view of the world, so that I see the road and the surroundings.

#### Acceptance Criteria

1. THE Game SHALL render with an antialiased `WebGLRenderer`, `pixelRatio = min(devicePixelRatio, 2)` and the window size at start time.
2. THE Game SHALL use a perspective camera with FOV 60, near 0.1, far 900, initial position (0, 12, -11).
3. THE Game SHALL use the background color `0xd2f7ff` (the same as the fog).
4. WHEN the browser window is resized, THE Game SHALL NOT change the canvas size (the resize handler is commented out in the code).

### Requirement 11: REQ-CAM-002 — Camera mode `fixed` (default)

**User Story:** As a player, I want to rotate the camera around the car, so that I choose the viewing angle.

#### Acceptance Criteria

1. THE Camera_Controller SHALL start in mode `fixed`, with OrbitControls active and damping enabled.
2. WHILE the mode is `fixed`, THE Camera_Controller SHALL move the OrbitControls target toward the car position with interpolation 0.1 per frame.

### Requirement 12: REQ-CAM-003 — Camera mode `follow`

**User Story:** As a player, I want the camera to follow the car from behind, so that I see the driving direction.

#### Acceptance Criteria

1. WHILE the mode is `follow`, THE Camera_Controller SHALL position the camera at the car position plus the offset `camOffset` (default (0, 12, -11)) rotated with the car orientation, interpolating with the factor 0.1 per frame.
2. WHILE the mode is `follow`, THE Camera_Controller SHALL point the camera at the car and SHALL disable OrbitControls.

### Requirement 13: REQ-CAM-004 — Camera mode `independent` (free-fly)

**User Story:** As a developer, I want a free camera, so that I inspect the map.

#### Acceptance Criteria

1. WHEN the mode becomes `independent`, THE Camera_Controller SHALL block the car and cube input, SHALL disable OrbitControls and SHALL initialize yaw from the current camera direction and pitch to 0.
2. WHEN the user clicks on the canvas in mode `independent`, THE Camera_Controller SHALL request pointer lock.
3. WHILE pointer lock is active on the canvas, THE Camera_Controller SHALL change yaw/pitch with `FREE_CAM.sensitivity` (default 0.002 rad/px) and SHALL limit pitch to ±(π/2 − 0.01).
4. WHILE the mode is `independent`, THE Camera_Controller SHALL move the camera with W/S (forward/backward), A/D (left/right), Space (up), ShiftLeft (down), at the speed `FREE_CAM.speed` (default 10 m/s), normalizing the combined direction.
5. WHEN the mouse wheel is rotated in mode `independent`, THE Camera_Controller SHALL multiply the speed by 1.2 (wheel up) or divide it by 1.2 (wheel down), limited to 1–200 m/s.
6. WHEN the mode changes from `independent` to another mode, THE Camera_Controller SHALL exit pointer lock and SHALL unblock the car input.
7. THE Debug_GUI SHALL expose in the "Camera" folder: mode (follow / fixed / independent), offset X (−30..30), offset Y (0..50), offset Z (−70..70), free-fly speed (1–200, step 0.5), free-fly look (0.0005–0.01, step 0.0001).

### Requirement 14: REQ-CAM-005 — Wheel zoom in modes `fixed` and `follow`

**User Story:** As a player, I want to move the camera closer or farther with the mouse wheel, so that I adjust the distance.

#### Acceptance Criteria

1. WHEN the mouse wheel is rotated on the canvas in mode `fixed` or `follow`, THE Camera_Controller SHALL change `camOffset.z` by ±1.5 within the range [−60, −4] and `camOffset.y` by ∓0.75 within the range [1, 50].
2. WHEN the wheel is rotated on the canvas, THE Camera_Controller SHALL prevent the default page scroll.

### Requirement 15: REQ-TER-001 — The terrain field (mesh and collider)

**User Story:** As a player, I want a solid and visible terrain in the west, so that I can drive on it.

#### Acceptance Criteria

1. THE Terrain SHALL cover the rectangle x ∈ [−180, −20], z ∈ [−80, 80] (center (−100, 0, 0), size 160 x 160), with 1 m cells.
2. THE Terrain SHALL compute the height as the sum of: hills + `mountainHeight` + `basinHeight`, then `carvePaths`.
3. THE Terrain SHALL use the same height function for the visual mesh, for the Rapier heightfield collider and for `heightAt(x, z)`.
4. THE Terrain SHALL expose `bounds` (minX −180, maxX −20, minZ −80, maxZ 80), `heightAt`, `rebuild()` and `onRebuild(fn)`.
5. WHEN `rebuild()` is called, THE Terrain SHALL regenerate the mesh, SHALL replace the collider and SHALL notify all listeners registered through `onRebuild`.

### Requirement 16: REQ-TER-002 — Procedural hills and GUI tuning

**User Story:** As a developer, I want adjustable hills, so that I vary the relief.

#### Acceptance Criteria

1. THE Terrain SHALL generate hills with fBm noise with seed 21, 3 octaves, wavelength 45 m, amplitude 2.5 m, noise thresholds 0.5 (flat) and 0.72 (full amplitude).
2. THE Terrain SHALL reduce the hill amplitude to 0 at the east edge of the field (x = −20) and at the north and south edges (z = ±80), over a distance of 20 m, in the sea basin and on the mountain summit plateau.
3. THE Debug_GUI SHALL expose in the "Hills" folder: Height (0–8, step 0.1, default 2.5), Wavelength (15–120, step 1, default 45), Seed (0–999, step 1, default 21).
4. WHEN a value in the "Hills" folder is modified and released (`onFinishChange`), THE Terrain SHALL call `rebuild()`.
5. IF `hillAmplitude` is 0, THEN THE Terrain SHALL return 0 for the hills component.

### Requirement 17: REQ-TER-003 — Terrain colors

**User Story:** As a player, I want a natural-looking ground, so that the world looks credible.

#### Acceptance Criteria

1. THE Terrain SHALL color the vertices with dark green (`0x3a6f2c`) / light green (`0x5f9a3e`) patches generated by `forestFloorColor`, scale 6 m.
2. THE Terrain SHALL blend toward the rock color (`0x8d8a82`, lighter `0xb4b2ab` at the top) on steep slopes (normal y below 0.88, fully below 0.7) and at heights above 60% of the mountain height.
3. THE Terrain SHALL blend toward sand (`0xe3d09b`) near the beach (x below −140, height below 0.6 m) and toward the seabed color (`0xb7ab80`) below `WATER_Y`.
4. THE Terrain SHALL NOT contain grass blades.

### Requirement 18: REQ-MAP-001 — The main path and the exit to the sea

**User Story:** As a player, I want a winding road from the starting point to the beach, so that there is a main route.

#### Acceptance Criteria

1. THE Forest_Map SHALL define the `main` path as a Catmull-Rom spline through 14 hand-placed waypoints, from `ENTRANCE (−20, 0)` to `BEACH (−160, 9)`, sampled every 2 m.
2. THE Forest_Map SHALL use the path width `PATH_WIDTH = 8` m and a blend shoulder `PATH_SHOULDER = 7` m.
3. THE Forest_Map SHALL set the height of the `main` path center equal to `basinHeight(x)`, so that the path descends into the sea basin.
4. THE Forest_Map SHALL contain three exits from the main path: clearing, sea (the `main` path itself) and mountain.

### Requirement 19: REQ-MAP-002 — The exit to the clearing (clearing with camp)

**User Story:** As a player, I want a branch to a clearing, so that I find the camping place.

#### Acceptance Criteria

1. THE Forest_Map SHALL define the `clearing` path through 5 waypoints from (−64, 9) (a point on the `main` path) to (−62, 50), with center height 0.
2. THE Forest_Map SHALL define the clearing as a flat disc at y = 0, centered at (−62, 50), radius 15 m, with a transition (feather) of 10 m.

### Requirement 20: REQ-MAP-003 — The mountain, the access path and the spiral trail

**User Story:** As a player, I want to drive up the mountain to the summit, so that I reach the viewpoint.

#### Acceptance Criteria

1. THE Forest_Map SHALL define the mountain as a smooth cone with center (−110, −40), radius 34 m, height 26 m, with a flat summit plateau (15% of the radius).
2. THE Forest_Map SHALL define the `access` path from `(−98, −2)` (a point on the `main` path) to the foot of the trail, on the mountain's 34 m radius circle, at height 0.
3. THE Forest_Map SHALL generate the trail as a numerical spiral in the counterclockwise direction (`TRAIL_DIRECTION = 1`) on the mountain flank, with a 1 m step, from the foot of the mountain to 1.5 m from the center, followed by the point at the summit center.
4. THE Forest_Map SHALL limit the trail slope to `TRAIL_MAX_SLOPE = 0.12` m/m during construction.
5. THE Forest_Map SHALL use the trail width `TRAIL_WIDTH = 8` m and the shoulder `TRAIL_SHOULDER = 8` m.
6. THE Forest_Map SHALL expose `SUMMIT = (−110, summit y, −40)`, `TRAIL_LENGTH` and the `CORRIDORS` list (`main`, `clearing`, `access`, `trail`).

### Requirement 21: REQ-MAP-004 — The sea, the beach and the basin

**User Story:** As a player, I want to reach the sea and be able to enter the water, so that I explore the beach.

#### Acceptance Criteria

1. THE Forest_Map SHALL define the water level `WATER_Y = −1.2`, the seabed `SEABED_Y = −4` and the sea edge `SEA_EDGE_X = −176`.
2. THE Forest_Map SHALL define the basin with `startX = −148`, length 32 m and depth 3.6 m, so that the terrain descends smoothly below the water west of x = −148.
3. THE Forest_Map SHALL define `LOWLAND_Y = 0` as the level of the plain around the terrain field.

### Requirement 22: REQ-MAP-005 — Flattening the terrain under paths and clearing

**User Story:** As a player, I want smooth roads, so that I can drive without being tripped by hills.

#### Acceptance Criteria

1. THE Forest_Map SHALL, in `carvePaths`, bring the terrain height to the path center height over a band of width `halfWidth` and SHALL blend the band with the natural terrain (smoothstep) over the shoulder length.
2. THE Forest_Map SHALL bring the terrain height to 0 in the clearing, within the 15 m radius, with blending over the next 10 m.
3. THE Forest_Map SHALL expose `landHeight(x, z)` as the height without the random hills, used by Nature_Layout for placement decisions.

### Requirement 23: REQ-MAP-006 — The path ribbons (Trails)

**User Story:** As a player, I want roads that visibly differ from the grass, so that I see the routes.

#### Acceptance Criteria

1. THE Trails SHALL create one mesh for each corridor in `CORRIDORS`, as a ribbon with 4 lateral segments, width 1.08 x the path width, dirt colors (`0xa87c52` center, `0x8c6a49` edges) with random variation of up to 12%.
2. THE Trails SHALL position the ribbon 0.07 m above the terrain, plus 0.012 m per corridor index, with polygon offset −2.
3. WHEN Terrain notifies `onRebuild`, THE Trails SHALL rebuild all ribbons.
4. THE Trails SHALL be visual only (no collider).

### Requirement 24: REQ-NAT-001 — Loading and rendering the Nature Kit

**User Story:** As a player, I want a forest and natural elements in the world, so that the environment looks alive.

#### Acceptance Criteria

1. WHEN `NATURE.load()` is called, THE Nature_Kit SHALL download `nature/manifest.json` (relative URL) and SHALL load only the `.glb` models used by the layout.
2. THE Nature_Kit SHALL merge each model into a single geometry with vertex colors and SHALL create one `InstancedMesh` per model, with a shared material (roughness 0.9, metalness 0).
3. THE Nature_Kit SHALL render without cast shadows (`CAST_SHADOWS = false`) and with `frustumCulled = false` on the instances.
4. THE Nature_Kit SHALL use the `natural` palette (default), which recolors the Kenney materials by name, or the `original` palette; the default brightness is 1.0 (`natural`) and 0.65 (`original`).
5. THE Debug_GUI SHALL expose in the "Nature Kit" folder: Manual layout (reloads), Export layout (JSON), Show Models (default true), Brightness (0.1–1.5, step 0.05), Palette (natural | original).
6. WHEN the palette changes, THE Nature_Kit SHALL reset the brightness to the palette default value.
7. WHEN Terrain notifies `onRebuild`, THE Nature_Kit SHALL reposition the instances on the new terrain and SHALL recreate the colliders.
8. WHILE Nature_Kit is loading, THE Game SHALL keep running, and the models SHALL appear after loading; IF loading fails, THEN THE Game SHALL write "Nature kit load error:" to the console.

### Requirement 25: REQ-NAT-002 — Colliders for solid objects

**User Story:** As a player, I want not to pass through trees and rocks, so that the world feels solid.

#### Acceptance Criteria

1. THE Nature_Kit SHALL create a cylinder collider for the trunks of trees and palms (radius 0.06 · model scale; height 30% of the tree height, from the base).
2. THE Nature_Kit SHALL create a cuboid collider (shrunk by the factor 0.8) for cliff pieces, tents and log stacks (`log-stack`, `log-stacklarge`).
3. THE Nature_Kit SHALL create a convex hull collider for large and very large rocks, large rocks on the shore, boulders in the sea, the 3 rocks on the summit and stumps; IF the hull cannot be built, THEN THE Nature_Kit SHALL use a cuboid.
4. THE Nature_Kit SHALL place without collider: flowers, grass, mushrooms, plants, small stones, logs, moss, canoes, the pier (`pier`), `platform-beach` and `platform-stone` on the summit.

### Requirement 26: REQ-NAT-003 — The layout generator (principles)

**User Story:** As a developer, I want a deterministic layout, so that the world looks the same on every run.

#### Acceptance Criteria

1. THE Nature_Layout SHALL use a pseudo-random generator with seed 17 and SHALL produce the same list of items on every run, for the same manifest and the same field.
2. THE Nature_Layout SHALL make placement decisions based on `landHeight` (without hills), so that regenerating the hills moves the models vertically without adding or removing any.
3. THE Nature_Layout SHALL scale the models with `KIT_SCALE = 4` multiplied by a per-item jitter.
4. THE Nature_Layout SHALL execute the steps in the order: summit (viewpoint), camp, beach/pier/palms/sea rocks/lilies, path decoration, large rocks and cliffs, mountain pines, forest, flowers/small stones, far forest.
5. THE Nature_Layout SHALL label each item with a tag (`summit`, `camp`, `pier`, `beach`, `palm`, `decor`, `bigrock`, `rock`, `cliff`, `pine`, `tree`, `undergrowth`, `moss`, `stump`, `log`, `patch`, `clearing`, `smallrock`, `far`).
6. THE Nature_Layout SHALL keep trees at least 8.5 m (`PATH_WIDTH/2 + 4.5`) from the axis of any path and 4 m from the clearing edge.

### Requirement 27: REQ-NAT-004 — Points of interest: summit, camp, beach

**User Story:** As a player, I want points of interest at the end of each exit, so that exploring is worthwhile.

#### Acceptance Criteria

1. THE Nature_Layout SHALL place on the summit: `platform-stone` (scale x1.6), a sign, `campfire-stones`, two logs and 3 large rocks (`stone-largea`, `rock-largeb`, `stone-largec`) at 7.5 m from the center.
2. THE Nature_Layout SHALL place in the clearing: a fire (`campfire-logs`) at the center, 4 tents at 6.5 m from the center (with cuboid collider), 4 logs around the fire, 2 log stacks, a bed, a floor bed, 2 pots, 3 decorative fires and a sign.
3. THE Nature_Layout SHALL place on the beach: a pier made of 3 `path-wood` elements and one `path-woodend` toward the west, 0.35 m above the water, 2 canoes, a paddle and a `platform-beach`.
4. THE Nature_Layout SHALL place (if there is room) up to: 22 palms, 10 shore rocks, 6 large rocks in the sea, 10 lilies.

### Requirement 28: REQ-NAT-005 — The forest in the field

**User Story:** As a player, I want a dense forest near the roads, so that the route looks real.

#### Acceptance Criteria

1. THE Nature_Layout SHALL place up to 340 trees (`TREE_COUNT`), minimum distance 5 m between them, on terrain with height between `WATER_Y + 1.2` and 15 m.
2. THE Nature_Layout SHALL use exclusively conifers above 7 m and 12% conifers below this height.
3. THE Nature_Layout SHALL place up to 70 additional pines on the mountain flanks (distance 4 m, height between 3 and 20 m, at least 6 m from the axis of any path or trail).
4. THE Nature_Layout SHALL add vegetation at the base of about 50% of the trees (mushrooms, plants, flowers, grass), 12 hanging moss elements, 28 stumps and 18 logs.
5. THE Nature_Layout SHALL place decor (small stones 50%, flowers 32%, grass 18%) every 3.2 m along each path and along the trail, alternating sides.

### Requirement 29: REQ-NAT-006 — Rocks, cliffs and flowers

**User Story:** As a player, I want varied rocks, cliffs and flowers, so that the world does not look monotonous.

#### Acceptance Criteria

1. THE Nature_Layout SHALL place up to 40 large rocks (scale 1.8–2.8), half at the foot of the mountain and half far from the mountain, at least 9 m from the paths, and 48 very large rocks (scale 1.2–2.0).
2. THE Nature_Layout SHALL place 14 cliff groups on the mountain (4 or 5 pieces per group, within a 2.5 m radius), between 30% and 85% of the mountain radius, sunk 0.6 m into the slope, away from the trail.
3. THE Nature_Layout SHALL place up to 130 flower patches (radius 3.5 m, 6–14 flowers) on terrain with height between 0.2 and 9 m, plus up to 60 flowers in the clearing, at 10–17 m from the fire center.
4. THE Nature_Layout SHALL place up to 190 small stones outside the paths.

### Requirement 30: REQ-NAT-007 — Far forest

**User Story:** As a player, I want trees outside the terrain field as well, so that the horizon is not empty.

#### Acceptance Criteria

1. THE Nature_Layout SHALL place up to 2200 trees (`FAR_TREE_COUNT`), at minimum distance 7 m between them, at level `LOWLAND_Y`, with tag `far`, with 10 attempts per tree.
2. THE Nature_Layout SHALL restrict the far forest to the disc of radius 240 m centered at (−60, 0), outside the terrain field (+ 4 m margin), outside the start meadow x ∈ (−30, 50), z ∈ (−50, 50) and east of `SEA_EDGE_X + 6`.
3. THE Nature_Layout SHALL increase the proportion of conifers from 5% near the field toward the backdrop mountains (up to 85%).
4. THE Nature_Layout SHALL provide trunk colliders for the far forest trees, as for those in the field.

### Requirement 31: REQ-NAT-008 — Manual layout (flag and file)

**User Story:** As a developer, I want to use a hand-edited layout, so that I control the placement of each object.

#### Acceptance Criteria

1. THE Nature_Kit SHALL choose the layout source in the order: URL parameter `?layout=manual|generated`, then the constant `USE_MANUAL_LAYOUT` (default `false`).
2. WHERE the manual layout is active, THE Nature_Kit SHALL read `nature/layout.manual.json` with the shape `{ version, items: [{ name, x, z, dy, rotY, scale, tag, collider }] }`, where `dy` is the offset from the terrain surface.
3. THE Nature_Kit SHALL accept default values for the optional fields: `dy` 0, `rotY` 0, `scale` 4, `tag` "prop", `collider` none.
4. THE Nature_Kit SHALL accept the collider kinds `cylinder {radius, halfHeight, centerY}`, `box {shrink}` and `hull`.
5. IF the file is missing, has an unsupported version, has an unknown model or has non-numeric values, THEN THE Nature_Kit SHALL write a warning to the console and SHALL use the generated layout.
6. WHEN the user changes "Manual layout (reloads)" in the GUI, THE Nature_Kit SHALL reload the page with `?layout=manual` or `?layout=generated`.

### Requirement 32: REQ-NAT-009 — Layout export

**User Story:** As a developer, I want to export the current layout, so that I can edit it as a starting point for the manual layout.

#### Acceptance Criteria

1. WHEN the "Export layout (JSON)" button is pressed, THE Nature_Kit SHALL download a `layout.manual.json` file with the current layout in the manual format (x, z with 2 decimals, angles with 3, scale with 3, `dy` relative to the terrain).
2. THE Nature_Kit SHALL write each item on its own line in the JSON.
3. THE Nature_Kit SHALL produce an export that, loaded as a manual layout on the same terrain, reproduces the same items (names, positions, rotations, scales, tags, colliders).

### Requirement 33: REQ-SCN-001 — Lights and fog

**User Story:** As a player, I want uniform lighting and a foggy horizon, so that the scene looks natural.

#### Acceptance Criteria

1. THE Game SHALL use a white directional light (`0xffffff`), intensity 5, position (5, 10, 4), with `castShadow = true` and a 1024 x 1024 shadow map.
2. THE Scenery SHALL add a `HemisphereLight` (sky `0xffffff`, ground `0x8a9a7a`) with default intensity 1.0.
3. THE Scenery SHALL apply linear fog with the scene background color, `near = 150`, `far = 520`.
4. THE Debug_GUI SHALL expose in the "Scenery" folder: Ambient Light (0–4, step 0.05), Fog Near (0–1000), Fog Far (0–1000), Show Mountains, Mountain Tint.

### Requirement 34: REQ-SCN-002 — Far land (the visual plain)

**User Story:** As a player, I want a continuous plain around the play area, so that I do not see a gap below the horizon.

#### Acceptance Criteria

1. THE Scenery SHALL create a visual disc of radius 900 m at `y = LOWLAND_Y`, without the part west of `SEA_EDGE_X` and without the terrain field rectangle (x ∈ [−176, −20], z ∈ [−80, 80]).
2. THE Scenery SHALL texture the far land with a 512 x 512 px `DataTexture` covering 600 m centered on the origin, generated from `forestFloorColor` (the same function as the terrain).

### Requirement 35: REQ-SCN-003 — Colliders for far land and seabed

**User Story:** As a player, I want to be able to drive on the plain around the field, so that I can get from the start area to the field.

#### Acceptance Criteria

1. THE Scenery SHALL create 3 cuboid colliders (thickness 0.5, friction 0.5) for the plain area east of the field (the start area), north and south of the field, limited to ±300 m from the origin.
2. THE Scenery SHALL create a cuboid collider for the seabed at `y = SEABED_Y`, west of `SEA_EDGE_X`, over 600 m in x and 600 m in z.
3. IF the car leaves the areas covered by these colliders and by the terrain heightfield, THEN THE Physics_World SHALL NOT provide support under the car any more (the car falls).

### Requirement 36: REQ-SCN-004 — The sea

**User Story:** As a player, I want a visible sea in the west, so that the beach makes sense.

#### Acceptance Criteria

1. THE Scenery SHALL create a water plane at `y = WATER_Y (−1.2)`, color `0x2f8fd0`, opacity 0.88, roughness 0.3, between x = −1000 and x = −140, over 1800 m in z.
2. THE Scenery SHALL NOT animate the water.

### Requirement 37: REQ-SCN-005 — Backdrop mountains

**User Story:** As a player, I want mountains on the horizon, so that the world feels large.

#### Acceptance Criteria

1. THE Scenery SHALL create 48 conical mountains (6 sides, flat shading) as a visual-only `InstancedMesh`, without collider.
2. THE Scenery SHALL place the mountains on a ring between 260 and 340 m from (−60, 0), with height 50–120, radius 45–90, base at y = −10, seed 5, base color `0x7a8fa6`, per-mountain brightness between 0.7 and 1.
3. WHERE `mountainsVisible` is true (default), THE Scenery SHALL show the mountains.

### Requirement 38: REQ-GUI-001 — The debug panel

**User Story:** As a developer, I want a complete debug panel, so that I tune the game without editing the code.

#### Acceptance Criteria

1. THE Debug_GUI SHALL be a lil-gui panel with the folders: Camera, Car, Cube, Hills, Scenery, Nature Kit, Debug Renderer, Warp, Coordinates.
2. THE Debug_GUI SHALL display in each control the default value from the code.

### Requirement 39: REQ-GUI-002 — Warp

**User Story:** As a developer, I want to teleport the car to points of interest, so that I quickly test distant areas.

#### Acceptance Criteria

1. THE Debug_GUI SHALL expose in the "Warp" folder 5 buttons: Entrance, Clearing (camp), Beach (sea), Mountain foot, Summit (view).
2. WHEN a Warp button (other than Entrance) is pressed, THE Game SHALL teleport the car to the chosen point, at terrain height + 2.5 m, with the yaw of the point, and SHALL position the camera 11 m behind and 12 m above.
3. WHEN "Entrance" is pressed, THE Game SHALL call `CAR.reset()` (spawn at (0, 3, 0)).
4. THE Game SHALL define the points: Clearing (−62, 38), Beach (−154, 9) with yaw −π/2, Mountain foot (start of the trail), Summit (−107, −37) with yaw −π/2.
5. WHEN the URL contains `?warp=<entrance|clearing|beach|foot|summit>`, THE Game SHALL execute the warp once, after Car is `ready`.
6. WHERE the URL contains `cam=dx,dy,dz`, THE Game SHALL use this offset in world coordinates, relative to the car, instead of the default offset.

### Requirement 40: REQ-GUI-003 — Coordinate picker

**User Story:** As a developer, I want to find out the coordinates of a point in the scene, so that I place objects or define warps.

#### Acceptance Criteria

1. THE Coordinate_Picker SHALL be disabled by default (`enabled = false`) and SHALL be switchable on from the GUI (checkbox "Hover + click shows x y z").
2. WHILE active, THE Coordinate_Picker SHALL display next to the cursor a tooltip "Name  x ..  y ..  z .." (1 decimal, no "-0.0") for the first visible mesh hit by the ray, at most once every 40 ms.
3. WHEN the user left-clicks with a movement of at most 5 px, THE Coordinate_Picker SHALL place a pin (red cone, tip on the point) with a label that follows the pin on screen.
4. THE Coordinate_Picker SHALL keep at most 20 pins (the oldest is removed first) and SHALL delete a pin after "Pins vanish after" seconds (default 10, 0 = never; during the last second the pin shrinks and fades).
5. THE Debug_GUI SHALL expose in the "Coordinates" folder: the checkbox, "Pins vanish after (s, 0 = never)" (0–120), the "Clear pins" button and the "Last click" field.
6. THE Coordinate_Picker SHALL search for targets in: terrain, far land, sea, backdrop mountains, the Nature Kit group.
7. WHILE the camera mode is `independent`, THE Coordinate_Picker SHALL be inactive.
8. WHILE active, THE Coordinate_Picker SHALL set the canvas cursor to `crosshair`.

### Requirement 41: REQ-GUI-004 — Collision rendering (debug)

**User Story:** As a developer, I want to see the colliders, so that I debug the physics.

#### Acceptance Criteria

1. THE Debug_Renderer SHALL be disabled by default (`DEBUG_ENABLED = false`).
2. WHEN "Show Colliders" is checked, THE Debug_Renderer SHALL draw the wireframe of the Rapier colliders on every frame.

### Requirement 42: REQ-BLD-001 — Dev server and build (Vite)

**User Story:** As a developer, I want simple dev and build commands, so that I run and publish the project easily.

#### Acceptance Criteria

1. THE Build_System SHALL provide the npm scripts `dev` (Vite) and `build` (Vite build).
2. THE Build_System SHALL use `root: 'src/'`, `publicDir: 'static'` (served as `src/static/*` at the root), `base: './'`, `outDir: '../dist'` with `emptyOutDir: true`, `sourcemap: true`, `target: 'esnext'` (required for top-level await).
3. THE Build_System SHALL expose the dev server on the local network (`host: true`) and SHALL open the browser, unless `SANDBOX_URL` or `CODESANDBOX_HOST` is set.
4. THE Game SHALL load assets with relative URLs (`LowPolyCars.gltf`, `nature/...`), without a leading `/`.

### Requirement 43: REQ-BLD-002 — The `start.bat` script

**User Story:** As a developer, I want a single start script, so that I run the project without remembering the commands.

#### Acceptance Criteria

1. THE Start_Script SHALL have the configuration at the top: `RUN_MODE` (dev | build | test, default dev), `DEV_PORT` (default 5173), `OPEN_BROWSER` (default 1), `AUTO_INSTALL` (default 1).
2. WHEN run with `-p <mode> <port> <open_browser>`, THE Start_Script SHALL override the configuration values with the given arguments.
3. IF `npm` is missing from PATH, `package.json` is missing, `RUN_MODE` is invalid or `DEV_PORT` is not numeric (in dev mode), THEN THE Start_Script SHALL display an error and SHALL exit with code 1.
4. IF `node_modules` is missing and `AUTO_INSTALL` is 1, THEN THE Start_Script SHALL run `npm install`; IF `AUTO_INSTALL` is 0, THEN THE Start_Script SHALL exit with an error.
5. WHEN `RUN_MODE` is `dev`, THE Start_Script SHALL start `npm run dev -- --port <DEV_PORT>`; `build` SHALL run `npm run build`; `test` SHALL run `npm run test:run`.

### Requirement 44: REQ-BLD-003 — Deploy to GitHub Pages

**User Story:** As a developer, I want automatic publishing, so that the project is available online.

#### Acceptance Criteria

1. WHEN a push to `main` or a manual start (`workflow_dispatch`) occurs, THE Deploy_Pipeline SHALL run on `ubuntu-latest` with Node 20.
2. THE Deploy_Pipeline SHALL install the dependencies with `npm ci`, SHALL build with `npm run build`, SHALL upload `dist/` as a Pages artifact and SHALL publish through `actions/deploy-pages@v4`.
3. THE Deploy_Pipeline SHALL use concurrency on the group `pages` with cancellation of in-progress runs.
4. THE Deploy_Pipeline SHALL publish at `https://matei-rares-a.github.io/cargofast/`, with Settings > Pages > Source = "GitHub Actions".

## Open Questions

Each item is a mismatch or an unknown found while reading the code. Answer with "keep" (the requirement stays as written), "change (to what)" or "ignore".

1. **Wheel zoom in mode `fixed` (REQ-CAM-005):** the wheel changes `camOffset`, but in `fixed` the offset is not used (OrbitControls decides); OrbitControls also zooms on the same wheel. Do we keep it like this?
2. **Shadows (REQ-SCN-001):** the sun has `castShadow = true`, but nothing visible casts shadows (the car does not set `castShadow`; Nature Kit has `CAST_SHADOWS = false`; the only `castShadow = true` is the hidden cube). In practice no shadows appear. Is this intentional?
3. **Resize (REQ-CAM-001):** the resize handler is commented out; the canvas does not follow the window. Do we want it active?
4. **`preventDefault` on all keys (REQ-CAR-001):** `car.js` and `cubes.js` block every key (including F5, F12, the browser's Ctrl+R). Do we keep it?
5. **The 300 m physics limit (REQ-SCN-003):** outside the far land colliders (±300 m) the car falls; the visual disc is 900 m. Do we want a wall or an automatic reset?
6. **Coasting (REQ-CAR-003):** the horizontal velocity is forced linearly to 0 within 1.5 s after the throttle is released, regardless of the slope; at start (no input) the logic already begins in the "stopped" state (brake 1.5 applied and horizontal velocity forced to 0). The car does not roll downhill with W released. Do we keep it?
7. **Trail width:** the notes in `project-context.md` say "6 m ledge", the code has `TRAIL_WIDTH = 8`. I followed the code (8 m). Is that correct?
8. **Pier and platforms without collider (REQ-NAT-002):** the notes mention the collider for platforms, but in `nature_layout.js` the pier, `platform-beach` and `platform-stone` on the summit are placed without collider; the car cannot drive up onto the pier. Is this intentional?
9. **The cube (REQ-CAR-007):** I did not read `cubes.js` in full; I did not verify whether the physics body of the cube still exists/collides while the mesh is hidden.
10. **`vite-plugin-restart` (REQ-BLD-001):** configured with `'../static/**'` relative to `root: 'src/'` (so `<project>/static/**`, a folder that does not exist; the files are in `src/static`). It probably triggers nothing. Do we fix it or remove it?
11. **`start.bat` (REQ-BLD-002):** the comment says port 1024–65535, the validation only checks that it is numeric. Noted as is.
12. **Deploy (REQ-BLD-003):** the workflow also runs `npm run test:run` before the build; `start.bat` also has a `test` mode. As requested, tests are not part of this document; say whether the test step should be removed from the pipeline.
13. **Unused files:** `LowPolyCars.glb`, `LowPolyCars.blend1`, about half of the 329 Kenney models and the dependencies `jest` and `@dimforge/rapier3d` (non-compat) are not used. Do we keep them?
14. **`layout.manual.json`:** the notes say it is an export of the generated layout (~3000 items); I did not verify that it is still in sync with `nature_layout.js`.
15. **Performance:** the frame rate on a real GPU with ~2000+ instances has not been verified.
16. **Warp Entrance (REQ-GUI-002):** it does not put the car at the forest entrance (−20, 0), but at `SPAWN` (0, 3, 0). Is the name correct?

## Change Log

| Date | ID | Change |
|------|----|--------|
| (baseline) | all | Initial document, reverse-engineered from the code; awaiting review. |
