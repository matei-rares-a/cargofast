import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { Terrain, FIELD_CENTER, FIELD_SIZE } from '../objects/terrain';
import { SEA_EDGE_X, WATER_Y, SEABED_Y, LOWLAND_Y, MOUNTAIN } from '../objects/forest_map';
import { Scenery, SCENERY_CENTER, MOUNTAIN_COUNT, MOUNTAIN_RING } from '../objects/scenery';
import { createFakeGui, createScene, runSteps } from './helpers';

const GRAVITY_Y = -20.81;
const SCRIPT_SRC = readFileSync(fileURLToPath(new URL('../script.js', import.meta.url)), 'utf8');

beforeAll(async () => {
  await RAPIER.init();
});

describe('Scenery', () => {
  let scene, world, scenery;

  beforeEach(() => {
    scene = createScene();
    scene.background = new THREE.Color(0xd2f7ff);
    world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    scenery = new Scenery(scene, world, createFakeGui());
    world.step(); // refresh scene queries
  });

  test('fog uses the sky color and fades in before the far plane', () => {
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    expect(scene.fog.color.getHex()).toBe(0xd2f7ff);
    expect(scene.fog.near).toBeLessThan(scene.fog.far);
    const camFar = Number(/const CAM_FAR\s*=\s*(\d+)/.exec(SCRIPT_SRC)[1]);
    expect(camFar).toBeGreaterThanOrEqual(scene.fog.far);
  });

  test('scenery objects are added to the scene', () => {
    [scenery.farLand, scenery.mountains, scenery.ambientLight, scenery.sea].forEach((o) => expect(scene.children).toContain(o));
  });

  test('ambient light fills the shade (hemisphere light with intensity > 0)', () => {
    expect(scenery.ambientLight).toBeInstanceOf(THREE.HemisphereLight);
    expect(scenery.ambientLight.intensity).toBeGreaterThan(0);
  });

  describe('far land', () => {
    test('the original platforms and stairs are hidden far under the map (below the sea floor)', () => {
      const depth = Number(/const PLATFORMS_DEPTH\s*=\s*(-?\d+)/.exec(SCRIPT_SRC)[1]);
      const platforms = new Function(`return ${/const PLATFORM_CONFIGS\s*=\s*(\[[\s\S]*?\]);/.exec(SCRIPT_SRC)[1]}`)();
      const stairStep = Number(/const STAIR_STEP_H\s*=\s*([\d.]+)/.exec(SCRIPT_SRC)[1]);
      const topY = Math.max(...platforms.map((p) => p.y + 0.5), 5 * stairStep + stairStep); // highest top surface before the move
      expect(depth).toBeLessThan(0);
      expect(topY + depth).toBeLessThan(SEABED_Y);
      expect(SCRIPT_SRC).toContain('createPlatform(x, y + PLATFORMS_DEPTH, z, w, d)');
      expect(SCRIPT_SRC).toContain('createPlatform(x, y + PLATFORMS_DEPTH, z, w, d, t)');
      expect(SCRIPT_SRC).not.toMatch(/addFolder\('Platforms'\)/);
    });

    test('lies exactly at the terrain base level (no step at the field edges), reaches far east and stops where the sea begins', () => {
      expect(scenery.farLand.position.y).toBe(LOWLAND_Y);
      expect(LOWLAND_Y).toBe(FIELD_CENTER.y);
      const geo = scenery.farLand.geometry;
      geo.computeBoundingBox();
      expect(geo.boundingBox.min.x).toBeGreaterThanOrEqual(SEA_EDGE_X - 0.5);
      expect(geo.boundingBox.max.x).toBeGreaterThan(100);
      expect(SEA_EDGE_X).toBeLessThanOrEqual(FIELD_CENTER.x - FIELD_SIZE.x / 2 + 5);
    });

    test('the terrain field is cut out of it, edge to edge (no overlap under the terrain, no gap at its borders)', () => {
      const pos = scenery.farLand.geometry.attributes.position;
      const c = { minX: FIELD_CENTER.x - FIELD_SIZE.x / 2, maxX: FIELD_CENTER.x + FIELD_SIZE.x / 2, minZ: -FIELD_SIZE.z / 2, maxZ: FIELD_SIZE.z / 2 };
      const index = scenery.farLand.geometry.index;
      expect(index).not.toBeNull();
      // no triangle centroid lies strictly inside the field rectangle
      for (let t = 0; t < index.count; t += 3) {
        const cx = (pos.getX(index.getX(t)) + pos.getX(index.getX(t + 1)) + pos.getX(index.getX(t + 2))) / 3;
        const cz = (pos.getZ(index.getX(t)) + pos.getZ(index.getX(t + 1)) + pos.getZ(index.getX(t + 2))) / 3;
        expect(cx > c.minX + 0.01 && cx < c.maxX - 0.01 && cz > c.minZ + 0.01 && cz < c.maxZ - 0.01).toBe(false);
      }
      // and the field border vertices exist on the far land (its cut-out corners)
      const hasVertex = (x, z) => { for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i) - x) < 1e-3 && Math.abs(pos.getZ(i) - z) < 1e-3) return true; return false; };
      [[c.maxX, c.minZ], [c.maxX, c.maxZ]].forEach(([x, z]) => expect(hasVertex(x, z)).toBe(true));
    });

    test('is painted with the terrain\'s own forest-floor colors, so the two surfaces blend (same function, same world position)', () => {
      const tex = scenery.farLandTexture;
      const n = tex.image.width;
      const span = 600; // FAR_LAND_TEXTURE_WORLD
      const texel = (wx, wz) => {
        const i = Math.min(n - 1, Math.max(0, Math.floor((wx / span + 0.5) * n)));
        const j = Math.min(n - 1, Math.max(0, Math.floor((wz / span + 0.5) * n)));
        const k = (j * n + i) * 4;
        return [tex.image.data[k], tex.image.data[k + 1], tex.image.data[k + 2]];
      };
      const terrain = new Terrain(createScene(), world, createFakeGui());
      const col = terrain.ground.geometry.attributes.color;
      const pos = terrain.ground.geometry.attributes.position;
      let checked = 0;
      for (let i = 0; i < pos.count && checked < 60; i += 211) {
        const wx = FIELD_CENTER.x + pos.getX(i);
        const wz = FIELD_CENTER.z + pos.getZ(i);
        if (Math.abs(pos.getZ(i)) > FIELD_SIZE.z / 2 - 6 || wx < -140 || terrain.ground.geometry.attributes.normal.getY(i) < 0.9 || Math.hypot(wx - MOUNTAIN.x, wz - MOUNTAIN.z) < MOUNTAIN.radius) continue; // sand, rock and the mountain are painted over the forest floor // flat border strip on the north / south edges, away from the sea
        const sRGB = new THREE.Color().setRGB(col.getX(i), col.getY(i), col.getZ(i)); // vertex colors are linear
        const hex = sRGB.getHex();
        const fromTerrain = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
        const fromFarLand = texel(wx, wz);
        fromTerrain.forEach((v, k) => expect(Math.abs(v - fromFarLand[k])).toBeLessThanOrEqual(12)); // one texel (1.2 m) apart, colors vary over ~6 m
        checked++;
      }
      expect(checked).toBeGreaterThan(10);
    });

    test('the original light-green 40 x 40 ground plane is gone: a ball dropped east of the field lands on the far land', () => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(100, 5, 0));
      world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
      runSteps(world, 180);
      expect(body.translation().y).toBeCloseTo(LOWLAND_Y + 0.5, 1);
    });

    test('has no hole any more: it is solid under where the cascade platforms used to hang', () => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(100, 5, 7));
      world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
      runSteps(world, 180);
      expect(body.translation().y).toBeCloseTo(LOWLAND_Y + 0.5, 1);
    });

    test('the sea surface lies at WATER_Y and extends far west', () => {
      expect(scenery.sea.position.y).toBe(WATER_Y);
      scenery.sea.geometry.computeBoundingBox();
      const left = scenery.sea.position.x + scenery.sea.geometry.boundingBox.min.x;
      expect(left).toBeLessThan(-800);
      expect(WATER_Y).toBeLessThan(scenery.farLand.position.y);
    });

    test('the far land leaves the terrain sea basin free (no floor sticking out of the beach)', () => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-160, 5, 0));
      world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
      runSteps(world, 120);
      expect(body.translation().y).toBeLessThan(-3); // nothing at the lowland level here: only the terrain heightfield (not in this test) belongs in the basin
      const side = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-160, 5, 100));
      world.createCollider(RAPIER.ColliderDesc.ball(0.5), side);
      runSteps(world, 120);
      expect(side.translation().y).toBeCloseTo(LOWLAND_Y + 0.5, 1); // beside the field the far land is solid again
    });

    test('there is a solid seabed under the open sea', () => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-250, 5, 0));
      world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
      runSteps(world, 240);
      expect(body.translation().y).toBeCloseTo(SEABED_Y + 0.5, 1);
    });

    test('is solid beside the ground (north / south / east of it)', () => {
      const drop = (x, z) => {
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 5, z));
        world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
        return body;
      };
      const balls = [drop(-60, 90), drop(-60, -90), drop(80, 0), drop(150, 150)]; // beyond the field's north, south and east edges
      runSteps(world, 180);
      balls.forEach((b) => expect(b.translation().y).toBeCloseTo(LOWLAND_Y + 0.5, 1));
    });
  });

  describe('mountains', () => {
    test('there are MOUNTAIN_COUNT mountains, all on the ring around the play area', () => {
      expect(scenery.mountains.count).toBe(MOUNTAIN_COUNT);
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      for (let i = 0; i < MOUNTAIN_COUNT; i++) {
        scenery.mountains.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        const dist = Math.hypot(p.x - SCENERY_CENTER.x, p.z - SCENERY_CENTER.z);
        expect(dist).toBeGreaterThanOrEqual(MOUNTAIN_RING.min - 1e-6);
        expect(dist).toBeLessThanOrEqual(MOUNTAIN_RING.max + 1e-6);
      }
    });

    test('the ring starts beyond the far edge of the grass field', () => {
      const fieldFarCorner = Math.hypot(FIELD_CENTER.x - FIELD_SIZE.x / 2 - SCENERY_CENTER.x, FIELD_SIZE.z / 2 - SCENERY_CENTER.z);
      expect(MOUNTAIN_RING.min).toBeGreaterThan(fieldFarCorner);
    });

    test('mountains are spread around the full circle (no big gap in the horizon)', () => {
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const angles = [];
      for (let i = 0; i < MOUNTAIN_COUNT; i++) {
        scenery.mountains.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        angles.push(Math.atan2(p.z - SCENERY_CENTER.z, p.x - SCENERY_CENTER.x));
      }
      angles.sort((a, b) => a - b);
      const gaps = angles.map((a, i) => (i === angles.length - 1 ? angles[0] + Math.PI * 2 - a : angles[i + 1] - a));
      expect(Math.max(...gaps)).toBeLessThan(Math.PI / 6);
    });
  });
});

describe('script.js: cube removed, base platform under the forest map', () => {
  test('the test cube is gone (no CubeObject, no CUBES, no cubes.js)', () => {
    expect(SCRIPT_SRC).not.toMatch(/CubeObject|CUBES|objects\/cubes/);
    expect(existsSync(fileURLToPath(new URL('../objects/cubes.js', import.meta.url)))).toBe(false);
  });

  test('a thin, flat, light-green platform lies under the whole terrain field, below the sea floor', () => {
    const cfg = new Function('SEABED_Y', `return ${/const BASE_PLATFORM\s*=\s*(\{[^}]*\});/.exec(SCRIPT_SRC)[1]}`)(SEABED_Y);
    const r = (cfg.color >> 16) & 255, g = (cfg.color >> 8) & 255, b = cfg.color & 255;
    expect(g).toBeGreaterThan(200); // light
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b); // green
    expect(cfg.halfThickness * 2).toBeLessThanOrEqual(0.5); // thin
    expect(cfg.y + cfg.halfThickness).toBeLessThan(SEABED_Y); // under the sea floor
    expect(cfg.margin).toBeGreaterThanOrEqual(0);
    expect(SCRIPT_SRC).toContain('createPlatform(FIELD_CENTER.x, BASE_PLATFORM.y, FIELD_CENTER.z, FIELD_SIZE.x + 2 * BASE_PLATFORM.margin, FIELD_SIZE.z + 2 * BASE_PLATFORM.margin, BASE_PLATFORM.halfThickness, BASE_PLATFORM.color)');
  });
});
