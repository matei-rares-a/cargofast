import { describe, test, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { Terrain, FIELD_CENTER, FIELD_SIZE } from '../objects/terrain';
import { Trails } from '../objects/trails';
import { CORRIDORS, MOUNTAIN, SUMMIT, BEACH, WATER_Y, BASIN, CLEARING, START, LOWLAND_Y } from '../objects/forest_map';
import { CarObject } from '../objects/car';
import { createFakeGui, stubWindowKeys, createScene, runSteps, addGround, warmUpPhysics } from './helpers';

const GRAVITY_Y = -20.81;
const RAY_START_Y = 80;
// Sample points spread over the field, deliberately asymmetric in x and z (catches swapped axes in the heightfield) and off the 1-unit grid
// (a ray hitting exactly on a triangle edge can slip through in Rapier). Includes mountain, sea basin, path and meadow points.
const SAMPLE_POINTS = [
  [-30.37, -10.21], [-45.62, 37.48], [-60.13, -52.77], [-87.37, 5.21], [-110.3, 61.3], [-120.71, -33.45], [-141.28, 17.92], [-158.54, -70.16], [-170.83, 44.39], [-133.91, -48.64],
  [-125.4, -40.7], [-162.2, 9.3], [-176.4, 3.3], [-75.5, 7.7],
];

// GLTFLoader reads the real car model from disk (see helpers.withDiskGltfLoader).
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', async (importOriginal) => (await import('./helpers')).withDiskGltfLoader(await importOriginal()));

beforeAll(async () => {
  globalThis.ProgressEvent ??= class ProgressEvent extends Event {};
  await RAPIER.init();
  warmUpPhysics(RAPIER);
});

/** Physics surface height at world x, z found by casting a ray straight down. */
function physicsHeightAt(world, x, z) {
  const hit = world.castRay(new RAPIER.Ray({ x, y: RAY_START_Y, z }, { x: 0, y: -1, z: 0 }), 200, true);
  return hit ? RAY_START_Y - hit.timeOfImpact : null;
}

describe('Terrain', () => {
  let scene, world, terrain;

  beforeEach(() => {
    scene = createScene();
    world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    terrain = new Terrain(scene, world, createFakeGui());
    world.step(); // refresh scene queries so raycasts see the new colliders
  });

  test('adds a vertex-colored mesh to the scene', () => {
    expect(scene.children).toContain(terrain.ground);
    expect(terrain.ground.material.vertexColors).toBe(true);
    expect(terrain.ground.geometry.attributes.color.count).toBe(terrain.ground.geometry.attributes.position.count);
  });

  test('the field edge lies east of the start ground, so the spawn is on the terrain', () => {
    expect(FIELD_CENTER.x + FIELD_SIZE.x / 2).toBeGreaterThan(START.x + START.rx + START.feather);
    expect(FIELD_CENTER.y).toBe(LOWLAND_Y); // the surrounding far land is at the same level
    const src = readFileSync(fileURLToPath(new URL('../script.js', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/GROUND_SIZE|GROUND_COLOR/); // the original light-green ground plane is gone
    expect(src).not.toMatch(/PlaneGeometry\(GROUND/);
  });

  test('the field is flat under the start ground (spawn and entrance)', () => {
    for (let x = -5; x <= 5; x += 2.5) for (let z = -5; z <= 5; z += 2.5) expect(terrain.heightAt(x, z)).toBeCloseTo(FIELD_CENTER.y, 5);
  });

  test('the physics heightfield matches the terrain function everywhere (axes not swapped)', () => {
    SAMPLE_POINTS.forEach(([x, z]) => {
      expect(Math.abs(physicsHeightAt(world, x, z) - terrain.heightAt(x, z))).toBeLessThan(0.3); // bilinear 1 m grid vs analytic function, on steep flanks
    });
  });

  test('the visual mesh matches the terrain function at its vertices', () => {
    const pos = terrain.ground.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 997) expect(pos.getY(i)).toBeCloseTo(terrain.relHeight(pos.getX(i), pos.getZ(i)), 5);
  });

  describe('mountain', () => {
    test('has a flat summit about MOUNTAIN.height high and falls to the base level at its foot', () => {
      for (const [dx, dz] of [[0, 0], [2, 1], [-3, 2], [1, -3]]) expect(terrain.heightAt(SUMMIT.x + dx, SUMMIT.z + dz)).toBeCloseTo(MOUNTAIN.height, 0);
      expect(terrain.heightAt(MOUNTAIN.x + MOUNTAIN.radius + 8, MOUNTAIN.z)).toBeLessThan(3.5);
    });

    test('the physics surface at the summit is the terrain surface', () => {
      expect(physicsHeightAt(world, SUMMIT.x + 0.37, SUMMIT.z + 0.21)).toBeCloseTo(terrain.heightAt(SUMMIT.x + 0.37, SUMMIT.z + 0.21), 1);
    });
  });

  describe('sea', () => {
    test('the terrain falls below the water toward the west edge, with a sandy shore', () => {
      expect(terrain.heightAt(FIELD_CENTER.x - FIELD_SIZE.x / 2 + 3, 40)).toBeLessThan(WATER_Y - 1.5);
      expect(terrain.heightAt(BASIN.startX + 2, 40)).toBeGreaterThan(WATER_Y + 1.5);
      const pos = terrain.ground.geometry.attributes.position;
      const col = terrain.ground.geometry.attributes.color;
      let sandy = 0;
      for (let i = 0; i < pos.count; i++) {
        const wx = FIELD_CENTER.x + pos.getX(i);
        if (wx < BASIN.startX - 10 || wx > BASIN.startX + 12 || pos.getY(i) < WATER_Y || pos.getY(i) > 0.2) continue;
        if (col.getX(i) > 0.7 && col.getY(i) > 0.6) sandy++;
      }
      expect(sandy).toBeGreaterThan(100);
    });
  });

  describe('paths', () => {
    test('every path is flat across its width, even where meadow hills would be', () => {
      // the bluff path climbs on purpose (a ramp), so only the level paths are checked here
      CORRIDORS.filter((c) => c.kind === 'path' && c.name !== 'bluff').forEach((c) => {
        for (let i = 2; i < c.pts.length - 2; i += 3) {
          const a = c.pts[i - 1];
          const b = c.pts[i + 1];
          const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
          const nx = -(b.z - a.z) / len;
          const nz = (b.x - a.x) / len;
          const center = terrain.heightAt(c.pts[i].x, c.pts[i].z);
          for (const off of [-3.6, 3.6]) expect(Math.abs(terrain.heightAt(c.pts[i].x + nx * off, c.pts[i].z + nz * off) - center)).toBeLessThan(0.3);
        }
      });
    });

    test('the clearing is flat', () => {
      for (const [dx, dz] of [[0, 0], [5, 3], [-8, 4], [3, -9], [-6, -6]]) expect(terrain.heightAt(CLEARING.x + dx, CLEARING.z + dz)).toBeCloseTo(0, 1);
    });

    test('the mountain trail is level across its width (a ledge on the steep flank)', () => {
      const trail = CORRIDORS.find((c) => c.name === 'trail');
      for (let i = 5; i < trail.pts.length - 5; i += 4) {
        const a = trail.pts[i - 1];
        const b = trail.pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const nx = -(b.z - a.z) / len;
        const nz = (b.x - a.x) / len;
        const center = terrain.heightAt(trail.pts[i].x, trail.pts[i].z);
        for (const off of [-3, 3]) expect(Math.abs(terrain.heightAt(trail.pts[i].x + nx * off, trail.pts[i].z + nz * off) - center)).toBeLessThan(0.3);
      }
    });
  });

  test('rebuild() with another seed changes the meadow hills and notifies listeners', () => {
    const meadow = [[-60.1, -20.3], [-70.2, 25.7], [-140.3, 40.1], [-90.7, 55.2]];
    const before = meadow.map(([x, z]) => terrain.heightAt(x, z));
    const listener = vi.fn();
    terrain.onRebuild(listener);

    terrain.settings.hillSeed += 1;
    terrain.rebuild();
    world.step();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(meadow.map(([x, z]) => terrain.heightAt(x, z))).not.toEqual(before);
    SAMPLE_POINTS.forEach(([x, z]) => expect(physicsHeightAt(world, x, z)).toBeCloseTo(terrain.heightAt(x, z), 1));
  });

  test('hillAmplitude 0 leaves only the mountain, the sea basin and the paths', () => {
    terrain.settings.hillAmplitude = 0;
    terrain.rebuild();
    expect(terrain.heightAt(-60.1, -20.3)).toBeCloseTo(0, 5);
    expect(terrain.heightAt(SUMMIT.x, SUMMIT.z)).toBeCloseTo(MOUNTAIN.height, 3);
  });

  test('the same seed always gives the same terrain', () => {
    const other = new Terrain(createScene(), new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 }), createFakeGui());
    SAMPLE_POINTS.forEach(([x, z]) => expect(other.heightAt(x, z)).toBe(terrain.heightAt(x, z)));
  });
});

describe('Trails', () => {
  test('one up-facing ribbon per path lying on the terrain', () => {
    const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    const terrain = new Terrain(createScene(), world, createFakeGui());
    const scene = createScene();
    const trails = new Trails(scene, terrain);
    expect(trails.meshes.size).toBe(CORRIDORS.length);
    trails.meshes.forEach((mesh, name) => {
      expect(scene.children[0].children).toContain(mesh);
      const pos = mesh.geometry.attributes.position;
      const nor = mesh.geometry.attributes.normal;
      expect(pos.count).toBeGreaterThan(10);
      for (let i = 0; i < pos.count; i += 17) {
        expect(pos.getY(i) - terrain.heightAt(pos.getX(i), pos.getZ(i))).toBeGreaterThan(0.05); // lifted a little above the terrain
        expect(pos.getY(i) - terrain.heightAt(pos.getX(i), pos.getZ(i))).toBeLessThan(0.2);
        expect(nor.getY(i)).toBeGreaterThan(0.5);
      }
      expect(name).toBeTruthy();
    });
  });
});

describe('driving on the terrain', () => {
  let world, terrain, car, rb;

  beforeEach(async () => {
    stubWindowKeys();
    world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    addGround(RAPIER, world);
    terrain = new Terrain(createScene(), world, createFakeGui());
    car = new CarObject(createScene(), world, createFakeGui());
    await vi.waitFor(() => expect(car.ready).toBe(true), { timeout: 5000 });
    rb = car.car.rigidBody;
  });

  const settle = () => runSteps(world, 240, (dt) => car.prePhysicsStep(dt));

  test('the car settles on the flat forest path at the same height as on the ground', () => {
    settle();
    const yGround = rb.translation().y;
    car.teleport(-40, 3, 0, 0);
    settle();
    expect(Math.abs(rb.translation().y - terrain.heightAt(rb.translation().x, rb.translation().z) - yGround)).toBeLessThan(0.15);
  });

  test('the car rides on the summit instead of falling through the mountain', () => {
    settle();
    const yGround = rb.translation().y;
    car.teleport(SUMMIT.x, SUMMIT.y + 3, SUMMIT.z, 0);
    settle();
    expect(rb.translation().y).toBeGreaterThan(MOUNTAIN.height + yGround - 0.5);
    expect(rb.translation().y).toBeLessThan(MOUNTAIN.height + yGround + 1);
  });
});
