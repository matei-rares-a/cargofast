import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { CarObject, CAR_UPSIDE_DOWN_UP_Y } from './objects/car';
import {RapierDebugRenderer} from './objects/RapierDebugRenderer'
import { Terrain, FIELD_CENTER, FIELD_SIZE } from './objects/terrain';
import { Trails } from './objects/trails';
import { CLEARING, BEACH, SUMMIT, CORRIDORS, SEABED_Y } from './objects/forest_map';
import { Scenery } from './objects/scenery';
import { NatureKit } from './objects/nature_kit';
import { CoordinatePicker } from './objects/coordinate_picker';
import GUI from 'lil-gui'
//https://github.com/brunosimon/folio-2019/tree/master/static/models/car
/**
 * Debug
 */
const gui = new GUI()

// *** GLOBAL SETTINGS ***
const SCENE_BG_COLOR    = 0xd2f7ff;
const GRAVITY_Y         = -20.81;
const PLATFORM_THICKNESS = 0.5;   // half-height of the (hidden) original platforms
const PLATFORM_FRICTION  = 0.5;
// Base platform: a thin, flat, light-green slab under the whole forest map (terrain field + margin), below the sea floor
const BASE_PLATFORM = { color: 0x9be37a, y: SEABED_Y - 3, halfThickness: 0.15, margin: 10 }; // y = center height; margin = meters beyond the terrain field on every side
const FREE_CAM_SPEED    = 10.0;
const FREE_CAM_SENS     = 0.002;
const FREE_CAM_SPEED_RANGE   = { min: 1, max: 200 };         // GUI range of the free-fly speed (m/s)
const FREE_CAM_SENS_RANGE    = { min: 0.0005, max: 0.01 };  // GUI range of the mouse-look sensitivity (rad per pixel)
const FREE_CAM_WHEEL_FACTOR = 1.2;                         // each mouse wheel notch multiplies / divides the free-fly speed by this
const FREE_CAM = { speed: FREE_CAM_SPEED, sensitivity: FREE_CAM_SENS }; // independent camera settings (GUI > Camera)
const PLATFORMS_DEPTH = -60; // the original platforms and stairs are moved this far down: far under the map, never visible
// const PLATFORM_COLOR = 0x8d6e63; // brown (original)
const PLATFORM_COLOR     = 0xff00ff; // debug magenta
const STAIR_STEP_H       = 0.15;    // half-height per step (full = 0.3 unit — thin enough for car to climb)
// Cascade platforms (adjacent/touching, descending)
const PLATFORM_CONFIGS  = [
  { x:  27, y:  -5, z:   0, w: 14, d: 12 },
  { x:  27, y: -13, z:  13, w: 12, d: 14 },
  { x:   9, y: -22, z:  13, w: 12, d: 12 },
];
// Stairs: steps go toward +z, each step 0.3 unit tall, 6 units deep
const STAIR_CONFIGS = [
  { x: 0, y: STAIR_STEP_H * 1, z:  14, w: 32, d: 12, t: STAIR_STEP_H }, // step 1 top=0.30
  { x: 0, y: STAIR_STEP_H * 3, z:  17, w: 24, d:  6, t: STAIR_STEP_H }, // step 2 top=0.60
  { x: 0, y: STAIR_STEP_H * 5, z:  19, w: 16, d:  2, t: STAIR_STEP_H }, // step 3 top=0.90
];
const CAM_FOV           = 60;
const CAM_NEAR          = 0.1;
const CAM_FAR           = 900;      // must reach the far land / mountains from scenery.js
const CAM_INIT_POS      = { x: 0, y: 12, z: -11 };
const CAM_LERP          = 0.1;
const CAM_OFFSET        = { ...CAM_INIT_POS };
const CAM_TARGET_LERP   = 0.1;
const CAM_UPSIDE_DOWN_MAX_POLAR = Math.PI / 2 - 0.05; // fixed mode: polar angle limit (from +Y) while upside down, keeps the camera above the car
const CAM_SCROLL_STEP   = 1.5;
const CAM_SCROLL_MIN    = 4;
const CAM_SCROLL_MAX    = 60;
const LIGHT_COLOR       = 0xffffff;
const LIGHT_INTENSITY   = 5;
const LIGHT_POS         = { x: 5, y: 10, z: 4 };
const FIXED_TIMESTEP    = 1 / 60;
const MAX_DT            = 0.033;
// --- Global camera settings ---
const CAMERA_MODE = { mode: 'follow' }; // 'follow' | 'fixed' | 'independent'

// Free-fly camera state
const freeCam = {
  yaw: 0, pitch: 0,
  keys: {},
};
window.addEventListener('keydown', (e) => { freeCam.keys[e.code] = true; });
window.addEventListener('keyup',   (e) => { freeCam.keys[e.code] = false; });
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  freeCam.yaw   -= e.movementX * FREE_CAM.sensitivity;
  freeCam.pitch -= e.movementY * FREE_CAM.sensitivity;
  freeCam.pitch  = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, freeCam.pitch));
});

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.getElementById('app').appendChild(renderer.domElement);
renderer.domElement.addEventListener('click', () => {
  if (CAMERA_MODE.mode === 'independent') renderer.domElement.requestPointerLock();
});
renderer.domElement.addEventListener('wheel', (e) => {
  if (CAMERA_MODE.mode === 'independent') {
    e.preventDefault();
    const factor = e.deltaY < 0 ? FREE_CAM_WHEEL_FACTOR : 1 / FREE_CAM_WHEEL_FACTOR; // wheel up = faster
    FREE_CAM.speed = Math.max(FREE_CAM_SPEED_RANGE.min, Math.min(FREE_CAM_SPEED_RANGE.max, FREE_CAM.speed * factor));
    ctrlFreeSpeed.updateDisplay();
    return;
  }
  e.preventDefault();
  const step = e.deltaY > 0 ? -CAM_SCROLL_STEP : CAM_SCROLL_STEP;
  camOffset.z = Math.max(-CAM_SCROLL_MAX, Math.min(-CAM_SCROLL_MIN, camOffset.z + step));
  camOffset.y = Math.max(1, Math.min(50, camOffset.y - step * 0.5));
  ctrlOffsetY.updateDisplay();
  ctrlOffsetZ.updateDisplay();
}, { passive: false });

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(SCENE_BG_COLOR);

//Camera settings
const camera = new THREE.PerspectiveCamera(CAM_FOV, innerWidth / innerHeight, CAM_NEAR, CAM_FAR);
camera.position.set(CAM_INIT_POS.x, CAM_INIT_POS.y, CAM_INIT_POS.z);


const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enabled = true; // 'fixed' is the default mode

const camOffset = { x: CAM_OFFSET.x, y: CAM_OFFSET.y, z: CAM_OFFSET.z };
const camGui = gui.addFolder('Camera');
camGui.add(CAMERA_MODE, 'mode', ['follow', 'fixed', 'independent']).name('mode').onChange((v) => {
  controls.enabled = (v === 'fixed');
  const blocked = (v === 'independent');
  CAR.inputBlocked  = blocked;
  if (v !== 'independent' && document.pointerLockElement) document.exitPointerLock();
  if (v === 'independent') {
    freeCam.yaw   = Math.atan2(camera.getWorldDirection(new THREE.Vector3()).x,
                               camera.getWorldDirection(new THREE.Vector3()).z);
    freeCam.pitch = 0;
  }
});
const ctrlOffsetX = camGui.add(camOffset, 'x', -30, 30, 0.1).name('offset X');
const ctrlOffsetY = camGui.add(camOffset, 'y',   0, 50, 0.1).name('offset Y');
const ctrlOffsetZ = camGui.add(camOffset, 'z', -70, 70, 0.1).name('offset Z');
const ctrlFreeSpeed = camGui.add(FREE_CAM, 'speed', FREE_CAM_SPEED_RANGE.min, FREE_CAM_SPEED_RANGE.max, 0.5).name('free-fly speed');
camGui.add(FREE_CAM, 'sensitivity', FREE_CAM_SENS_RANGE.min, FREE_CAM_SENS_RANGE.max, 0.0001).name('free-fly look');

// Lights
// const hemi = new THREE.HemisphereLight(0xd2f7ff, 0x222222, 1);
// scene.add(hemi);
const dir = new THREE.DirectionalLight(LIGHT_COLOR, LIGHT_INTENSITY);
dir.position.set(LIGHT_POS.x, LIGHT_POS.y, LIGHT_POS.z);
dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024);
scene.add(dir);

// --- Rapier physics setup ---
await RAPIER.init();
const gravity = { x: 0.0, y: GRAVITY_Y, z: 0.0 };
const world = new RAPIER.World(gravity);

// (The original 40 x 40 light-green ground plane is gone: the far land of scenery.js covers the start area.)

// Original platforms and stairs (kept, but moved far under the map by PLATFORMS_DEPTH)
const platformMeshes = [];
function createPlatform(x, y, z, w, d, thick = PLATFORM_THICKNESS, color = PLATFORM_COLOR) {
  const mat  = new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 1.0 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, thick * 2, d), mat);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  mesh.name = 'Platform';
  scene.add(mesh);
  platformMeshes.push(mesh);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(w / 2, thick, d / 2).setFriction(PLATFORM_FRICTION),
    body
  );
  return mesh;
}
PLATFORM_CONFIGS.forEach(({ x, y, z, w, d }) => createPlatform(x, y + PLATFORMS_DEPTH, z, w, d));
STAIR_CONFIGS.forEach(({ x, y, z, w, d, t }) => createPlatform(x, y + PLATFORMS_DEPTH, z, w, d, t));
const basePlatform = createPlatform(FIELD_CENTER.x, BASE_PLATFORM.y, FIELD_CENTER.z, FIELD_SIZE.x + 2 * BASE_PLATFORM.margin, FIELD_SIZE.z + 2 * BASE_PLATFORM.margin, BASE_PLATFORM.halfThickness, BASE_PLATFORM.color);
basePlatform.material = new THREE.MeshBasicMaterial({ color: BASE_PLATFORM.color }); // unlit: stays light green even when seen from below (the sun only lights the top)

// Handle resize
// addEventListener('resize', () => {
//   camera.aspect = innerWidth / innerHeight;
//   camera.updateProjectionMatrix();
//   renderer.setSize(innerWidth + 10, innerHeight + 10);
// });


//Declaration of objects--------------------------------------

const TERRAIN = new Terrain(scene, world, gui) // forest terrain west of the start area (x < -20): meadow hills, mountain, sea basin
const TRAILS = new Trails(scene, TERRAIN) // dirt paths: forest path with 3 exits (clearing, sea, mountain) + mountain trail
const SCENERY = new Scenery(scene, world, gui) // fog, far land, mountains
const NATURE = new NatureKit(scene, world, gui, TERRAIN) // Kenney Nature Kit: forest, flowers, rocks, cliffs, camp, pier...
NATURE.load().catch((err) => console.error('Nature kit load error:', err)) // async: models pop in when ready
const CAR   = new CarObject(scene, world, gui)
const debugRenderer = new RapierDebugRenderer(scene, world, gui);

// Warp: jump to the points of interest of the forest map (GUI > Warp)
const WARP_DROP_HEIGHT = 2.5; // meters above the terrain
const trailPts = CORRIDORS.find((c) => c.name === 'trail').pts;
const trailStart = trailPts[0];
const trailYaw = Math.atan2(trailPts[3].x - trailStart.x, trailPts[3].z - trailStart.z); // face along the trail
const WARP_CAM_BEHIND  = 11;  // camera distance behind the car after a warp (same shape as CAM_INIT_POS)
const WARP_CAM_HEIGHT  = 12;
const WARPS = {
  entrance: { label: 'Entrance',        x: 0, z: 0, yaw: 0 },
  clearing: { label: 'Clearing (camp)', x: CLEARING.x, z: CLEARING.z - 12, yaw: 0 },
  beach:    { label: 'Beach (sea)',     x: BEACH.x + 6, z: BEACH.z, yaw: -Math.PI / 2 },
  foot:     { label: 'Mountain foot',   x: trailStart.x, z: trailStart.z, yaw: trailYaw },
  summit:   { label: 'Summit (view)',   x: SUMMIT.x + 3, z: SUMMIT.z + 3, yaw: -Math.PI / 2 },
};
/** Teleport the car and put the (orbit) camera behind it; camOffset = optional [dx, dy, dz] world offset from the car instead. */
function warpTo(key, camOffset) {
  const w = WARPS[key];
  if (key === 'entrance') CAR.reset();
  else CAR.teleport(w.x, TERRAIN.heightAt(w.x, w.z) + WARP_DROP_HEIGHT, w.z, w.yaw);
  const y = TERRAIN.heightAt(w.x, w.z);
  const [dx, dy, dz] = camOffset ?? [-Math.sin(w.yaw) * WARP_CAM_BEHIND, WARP_CAM_HEIGHT, -Math.cos(w.yaw) * WARP_CAM_BEHIND];
  camera.position.set(w.x + dx, y + dy, w.z + dz);
  controls.target.set(w.x, y, w.z);
  controls.update();
}
const warpGui = gui.addFolder('Warp');
Object.keys(WARPS).forEach((key) => warpGui.add({ go: () => warpTo(key) }, 'go').name(WARPS[key].label));
// URL shortcut, e.g. ?warp=summit or ?warp=summit&cam=0,30,40 (camera offset from the car); runs once the car model has loaded
const urlParams = new URLSearchParams(location.search);
let pendingWarp = WARPS[urlParams.get('warp')] ? urlParams.get('warp') : null;
const pendingCam = urlParams.get('cam')?.split(',').map(Number);

// Debug: hover shows the x/y/z under the cursor, click drops a pin with its coordinates (GUI > Coordinates; off by default)
const PICKER = new CoordinatePicker({
  scene, camera, domElement: renderer.domElement, gui,
  getTargets: () => [TERRAIN.ground, SCENERY.farLand, SCENERY.sea, SCENERY.mountains, NATURE.group],
  isActive: () => CAMERA_MODE.mode !== 'independent', // pointer-locked free-fly has no cursor
});

// Ctrl+R: reset all objects
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code === 'KeyR') {
    e.preventDefault();
    CAR.reset();
  }
});


// --- Animation loop with fixed-step accumulator ---
let last = performance.now();
let accumulator = 0;

//main function--------------------------------------------
function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  if (pendingWarp && CAR.ready) { warpTo(pendingWarp, pendingCam); pendingWarp = null; }

  // Step physics at a fixed rate for stability
  const dt = Math.min(MAX_DT, (now - last) / 1000);
  last = now;
  accumulator += dt;
  while (accumulator >= FIXED_TIMESTEP) {
    CAR.prePhysicsStep(FIXED_TIMESTEP); // apply engine/steer/brake + updateVehicle BEFORE step
    world.step();
    accumulator -= FIXED_TIMESTEP;
  }
  //Use of objects--------------------------------------------

  CAR.update(dt);
  debugRenderer.update();

  // Camera modes
  const carMesh = CAR.getMesh();
  if (CAMERA_MODE.mode === 'independent') {
    // Free-fly: WASD moves camera, mouse look
    const q = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(freeCam.pitch, freeCam.yaw, 0, 'YXZ'));
    camera.quaternion.copy(q);
    const move = new THREE.Vector3();
    if (freeCam.keys['KeyW']) move.z -= 1;
    if (freeCam.keys['KeyS']) move.z += 1;
    if (freeCam.keys['KeyA']) move.x -= 1;
    if (freeCam.keys['KeyD']) move.x += 1;
    if (freeCam.keys['Space'])    move.y += 1;
    if (freeCam.keys['ShiftLeft']) move.y -= 1;
    if (move.length() > 0) {
      move.normalize().applyQuaternion(q).multiplyScalar(FREE_CAM.speed * dt);
      camera.position.add(move);
    }
  } else if (carMesh) {
    if (CAMERA_MODE.mode === 'follow') {
      // Smooth follow behind the car
      // Upside down (on its roof): follow only the heading, so the camera stays above the ground instead of rolling with the car
      let followQuat = carMesh.quaternion;
      if (new THREE.Vector3(0, 1, 0).applyQuaternion(carMesh.quaternion).y < CAR_UPSIDE_DOWN_UP_Y) {
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(carMesh.quaternion);
        followQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(fwd.x, fwd.z));
      }
      const offset = new THREE.Vector3(camOffset.x, camOffset.y, camOffset.z);
      offset.applyQuaternion(followQuat);
      camera.position.lerp(carMesh.position.clone().add(offset), CAM_LERP);
      camera.lookAt(carMesh.position);
    } else {
      // Fixed: OrbitControls active, keep target on car
      const carUpY = new THREE.Vector3(0, 1, 0).applyQuaternion(carMesh.quaternion).y;
      controls.maxPolarAngle = carUpY < CAR_UPSIDE_DOWN_UP_Y ? CAM_UPSIDE_DOWN_MAX_POLAR : Math.PI;
      controls.target.lerp(carMesh.position, CAM_TARGET_LERP);
      controls.update();
    }
  }

  //End of main function---------------------------------------
  PICKER.update(); // keep the pin labels on their pins
  renderer.render(scene, camera);
}
animate();
