import { describe, test, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CubeObject } from '../objects/cubes';
import { CarObject } from '../objects/car';
import { RapierDebugRenderer } from '../objects/RapierDebugRenderer';
import { createFakeGui, stubWindowKeys, createScene, runSteps, addGround, warmUpPhysics } from './helpers';

const GRAVITY_Y = -20.81; // same as script.js
const staticPath = (name) => fileURLToPath(new URL(`../static/${name}`, import.meta.url));

// GLTFLoader reads the real LowPolyCars.gltf from disk (see helpers.withDiskGltfLoader).
// Textures are stripped (no DOM in node) and the .bin is inlined as a data URI.
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', async (importOriginal) => (await import('./helpers')).withDiskGltfLoader(await importOriginal()));

beforeAll(async () => {
  // three's FileLoader needs ProgressEvent, which node lacks.
  globalThis.ProgressEvent ??= class ProgressEvent extends Event {};
  await RAPIER.init();
  warmUpPhysics(RAPIER);
});

/** CarObject loads its model asynchronously; wait until it is ready. */
async function createCar(scene, world) {
  const car = new CarObject(scene, world, createFakeGui());
  await vi.waitFor(() => expect(car.ready).toBe(true), { timeout: 5000 });
  return car;
}

describe('project assets', () => {
  test.each(['LowPolyCars.gltf', 'LowPolyCars.bin', 'Car Texture 1.png'])('static asset %s exists', (name) => {
    expect(existsSync(staticPath(name))).toBe(true);
  });

  test('gltf references files that exist', () => {
    const json = JSON.parse(readFileSync(staticPath('LowPolyCars.gltf'), 'utf8'));
    const uris = [...json.buffers, ...(json.images ?? [])].map((x) => decodeURIComponent(x.uri));
    uris.forEach((uri) => expect(existsSync(staticPath(uri))).toBe(true));
  });

  test('index.html loads script.js and has the #app mount point', () => {
    const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
    expect(html).toContain('id="app"');
    expect(html).toContain('src="./script.js"');
  });
});

describe('physics world', () => {
  test('a falling box comes to rest on the ground', () => {
    const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    addGround(RAPIER, world);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);

    runSteps(world, 240);

    expect(body.translation().y).toBeCloseTo(0.5, 1);
  });
});

describe('CubeObject', () => {
  let press, world, cube;

  beforeEach(() => {
    press = stubWindowKeys();
    world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    addGround(RAPIER, world);
    cube = new CubeObject(createScene(), world, createFakeGui());
  });

  test('creates a main cube with a mesh and a rigid body', () => {
    expect(cube.mainCube.mesh).toBeInstanceOf(THREE.Mesh);
    expect(cube.mainCube.rigidBody).toBeDefined();
  });

  test('W moves the cube toward -Z', () => {
    press('keydown', 'KeyW');
    const startZ = cube.mainCube.rigidBody.translation().z;
    runSteps(world, 30, () => cube.update());
    expect(cube.mainCube.rigidBody.translation().z).toBeLessThan(startZ - 0.5);
  });

  test('blocked input does not move the cube', () => {
    cube.inputBlocked = true;
    press('keydown', 'KeyW');
    const startZ = cube.mainCube.rigidBody.translation().z;
    runSteps(world, 30, () => cube.update());
    expect(cube.mainCube.rigidBody.translation().z).toBeCloseTo(startZ, 1);
  });

  test('reset() returns the cube to its spawn point', () => {
    const rb = cube.mainCube.rigidBody;
    const spawn = { ...rb.translation() };
    rb.setTranslation({ x: 10, y: 10, z: 10 }, true);
    cube.reset();
    expect(rb.translation()).toMatchObject(spawn);
  });
});

describe('CarObject (real LowPolyCars.gltf)', () => {
  let press, world, car;

  beforeEach(async () => {
    press = stubWindowKeys();
    world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    addGround(RAPIER, world);
    car = await createCar(createScene(), world);
  });

  const drive = (steps) =>
    runSteps(world, steps, (dt) => {
      car.prePhysicsStep(dt);
    });

  test('loads the model and builds a 4-wheel vehicle', () => {
    expect(car.ready).toBe(true);
    expect(car.getMesh()).toBeInstanceOf(THREE.Group);
    expect(car.vehicle.numWheels()).toBe(4);
    expect(car.frontCount).toBe(2);
  });

  test('drops from spawn and settles on its suspension above the ground', () => {
    drive(240);
    const y = car.car.rigidBody.translation().y;
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(3); // spawn height
    expect(Math.abs(car.car.rigidBody.linvel().y)).toBeLessThan(0.5);
  });

  test('throttle (W) accelerates the car forward', () => {
    drive(120); // settle
    const before = car.car.rigidBody.translation();
    press('keydown', 'KeyW');
    drive(120);
    const after = car.car.rigidBody.translation();
    const travelled = Math.hypot(after.x - before.x, after.z - before.z);
    expect(travelled).toBeGreaterThan(1);
  });

  test('blocked input keeps the car still', () => {
    drive(120);
    car.inputBlocked = true;
    const before = car.car.rigidBody.translation();
    press('keydown', 'KeyW');
    drive(120);
    const after = car.car.rigidBody.translation();
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.5);
  });

  test('the wheels rest ON the ground (their visual bottoms are within 3 cm of the surface, not sunk into it)', () => {
    drive(300);
    car.update();
    car.car.mesh.updateMatrixWorld(true);
    [...car.wheelMeshes.front, ...car.wheelMeshes.rear].forEach((w) => {
      const bottom = new THREE.Box3().setFromObject(w).min.y;
      expect(Math.abs(bottom)).toBeLessThan(0.03);
    });
  });

  test('update() syncs the mesh with the rigid body', () => {
    drive(60);
    car.update();
    const t = car.car.rigidBody.translation();
    expect(car.getMesh().position.y).toBeCloseTo(t.y, 5);
  });

  test('reset() puts the car back at spawn with no velocity', () => {
    press('keydown', 'KeyW');
    drive(120);
    car.reset();
    const t = car.car.rigidBody.translation();
    expect(t).toMatchObject({ x: 0, y: 3, z: 0 });
    expect(car.car.rigidBody.linvel()).toMatchObject({ x: 0, y: 0, z: 0 });
  });
});

describe('RapierDebugRenderer', () => {
  test('update() fills line geometry from the physics world', () => {
    const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    addGround(RAPIER, world);
    const dbg = new RapierDebugRenderer(createScene(), world, createFakeGui());
    dbg.settings.enabled = true; // off by default
    dbg.update();
    expect(dbg.mesh.visible).toBe(true);
    expect(dbg.mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  test('hides the mesh when disabled', () => {
    const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    const dbg = new RapierDebugRenderer(createScene(), world, createFakeGui());
    dbg.settings.enabled = false;
    dbg.update();
    expect(dbg.mesh.visible).toBe(false);
  });
});
