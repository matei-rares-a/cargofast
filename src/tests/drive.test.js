import { describe, test, expect, beforeAll, beforeEach, vi } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Terrain } from '../objects/terrain';
import { CarObject } from '../objects/car';
import { CORRIDORS, SUMMIT, BEACH, CLEARING, MOUNTAIN } from '../objects/forest_map';
import { createFakeGui, stubWindowKeys, createScene, addGround, warmUpPhysics } from './helpers';

// GLTFLoader reads the real car model from disk (see helpers.withDiskGltfLoader).
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', async (importOriginal) => (await import('./helpers')).withDiskGltfLoader(await importOriginal()));

const GRAVITY_Y = -20.81;
const MAX_SPEED = 9;          // m/s on the flat paths, the driver lifts the throttle above this
const TRAIL_MAX_SPEED = 6;    // m/s on the mountain trail
const TRAIL_LOOKAHEAD = 4;    // m, shorter: the upper turns of the spiral are only ~10 m apart
const LOOKAHEAD = 7;          // m ahead of the car on the path that the driver aims at
const STEER_DEADZONE = 0.06;  // rad
const ARRIVE_DIST = 5;        // m from the last path point counts as arrived
const MAX_SECONDS = 150;

beforeAll(async () => {
  globalThis.ProgressEvent ??= class ProgressEvent extends Event {};
  await RAPIER.init();
  warmUpPhysics(RAPIER);
});

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Chain of corridors into one list of {x, z} points. */
const route = (...names) => names.flatMap((n) => CORRIDORS.find((c) => c.name === n).pts);

describe('driving the real car on the real terrain (physics only)', () => {
  let press, world, terrain, car, rb;

  beforeEach(async () => {
    press = stubWindowKeys();
    world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    addGround(RAPIER, world);
    terrain = new Terrain(createScene(), world, createFakeGui());
    car = new CarObject(createScene(), world, createFakeGui());
    await vi.waitFor(() => expect(car.ready).toBe(true), { timeout: 5000 });
    rb = car.car.rigidBody;
  });

  /** Simple pure-pursuit driver: W (with a speed cap) and A/D toward a point ahead on the path. */
  function drive(points, maxSpeed = MAX_SPEED, lookahead = LOOKAHEAD) {
    const start = points[0];
    const next = points[Math.min(3, points.length - 1)];
    car.teleport(start.x, terrain.heightAt(start.x, start.z) + 1.5, start.z, Math.atan2(next.x - start.x, next.z - start.z));
    const goal = points[points.length - 1];
    let progress = 0;
    let best = { dist: Infinity, maxY: -Infinity, steps: 0 };
    const dt = world.timestep;
    for (let step = 0; step < MAX_SECONDS / dt; step++) {
      const t = rb.translation();
      // advance along the path to the closest point ahead of the last progress
      for (let i = progress; i < Math.min(points.length, progress + 25); i++) {
        if (Math.hypot(points[i].x - t.x, points[i].z - t.z) < Math.hypot(points[progress].x - t.x, points[progress].z - t.z)) progress = i;
      }
      let target = progress;
      while (target < points.length - 1 && Math.hypot(points[target].x - t.x, points[target].z - t.z) < lookahead) target++;
      const q = rb.rotation();
      const yaw = 2 * Math.atan2(q.y, q.w);
      const err = wrap(Math.atan2(points[target].x - t.x, points[target].z - t.z) - yaw);
      const v = rb.linvel();
      const speed = Math.hypot(v.x, v.z);
      press('keyup', 'KeyW'); press('keyup', 'KeyS'); press('keyup', 'KeyA'); press('keyup', 'KeyD');
      press('keydown', speed < maxSpeed ? 'KeyW' : 'KeyS'); // S brakes; releasing W would trigger the car's coasting hack, which freezes the velocity direction
      if (err > STEER_DEADZONE) press('keydown', 'KeyA');
      else if (err < -STEER_DEADZONE) press('keydown', 'KeyD');
      car.prePhysicsStep(dt);
      world.step();
      const d = Math.hypot(goal.x - t.x, goal.z - t.z);
      best = { dist: Math.min(best.dist, d), maxY: Math.max(best.maxY, t.y), steps: step };
      if (d < ARRIVE_DIST) break;
    }
    return best;
  }

  test('from the entrance along the winding path to the beach', () => {
    const result = drive(route('main'));
    expect(result.dist).toBeLessThan(ARRIVE_DIST);
    expect(rb.translation().x).toBeLessThan(BEACH.x + ARRIVE_DIST + 0.5);
  }, 120000);

  test('from the junction along the branch to the clearing', () => {
    const main = CORRIDORS.find((c) => c.name === 'main').pts;
    const branch = CORRIDORS.find((c) => c.name === 'clearing').pts;
    const junction = main.findIndex((p) => Math.hypot(p.x - branch[0].x, p.z - branch[0].z) < 1.5);
    expect(junction).toBeGreaterThan(0);
    const result = drive([...main.slice(Math.max(0, junction - 8), junction), ...branch]);
    expect(result.dist).toBeLessThan(ARRIVE_DIST);
    expect(Math.hypot(rb.translation().x - CLEARING.x, rb.translation().z - CLEARING.z)).toBeLessThan(ARRIVE_DIST + 1);
  }, 120000);

  test('from the foot of the mountain up the spiral trail to the summit', () => {
    const access = CORRIDORS.find((c) => c.name === 'access').pts;
    const result = drive(route('access', 'trail'), TRAIL_MAX_SPEED, TRAIL_LOOKAHEAD);
    expect(access.length).toBeGreaterThan(2);
    expect(result.dist).toBeLessThan(ARRIVE_DIST);
    expect(rb.translation().y).toBeGreaterThan(MOUNTAIN.height - 3);
    expect(Math.hypot(rb.translation().x - SUMMIT.x, rb.translation().z - SUMMIT.z)).toBeLessThan(ARRIVE_DIST + 1);
  }, 150000);
});
