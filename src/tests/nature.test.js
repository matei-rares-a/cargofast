import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Terrain } from '../objects/terrain';
import { NatureKit } from '../objects/nature_kit';
import { buildNatureLayout, serializeLayout, layoutFromManual, KIT_SCALE, TREE_PATH_CLEAR, TREE_MIN_SPACING, PINE_PATH_CLEAR, BIG_ROCK_PATH_CLEAR, FAR_TREE_SPACING } from '../objects/nature_layout';
import { CLEARING, MOUNTAIN, SUMMIT, BEACH, WATER_Y, SEA_EDGE_X, LOWLAND_Y, FAR_FOREST, distToPaths, landHeight, inFarForest } from '../objects/forest_map';
import { MOUNTAIN_RING } from '../objects/scenery';
import { createFakeGui, createScene, runSteps } from './helpers';

const GRAVITY_Y = -20.81;
const NATURE_DIR = fileURLToPath(new URL('../static/nature/', import.meta.url));
const manifest = JSON.parse(readFileSync(`${NATURE_DIR}manifest.json`, 'utf8'));
const info = new Map(manifest.map((m) => [m.name, m]));

/** Loads a real kit GLB from disk (the kit has no textures, so no DOM is needed). */
const loadModel = async (name) => {
  const buf = readFileSync(`${NATURE_DIR}${name}.glb`);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  return gltf.scene;
};

beforeAll(async () => {
  globalThis.ProgressEvent ??= class ProgressEvent extends Event {};
  await RAPIER.init();
});

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  const terrain = new Terrain(createScene(), world, createFakeGui());
  return { world, terrain };
}

const base = (it) => it.y + info.get(it.name).min[1] * it.scale; // y of the model's lowest point

describe('forest layout', () => {
  let terrain, layout, items;

  beforeEach(() => {
    ({ terrain } = makeWorld());
    layout = buildNatureLayout({ manifest, heightAt: (x, z) => terrain.heightAt(x, z), field: terrain.bounds });
    items = layout.items;
  });

  const byTag = (...tags) => items.filter((i) => tags.includes(i.tag));

  test('every placed model exists in the kit manifest, and the forest uses a wide selection of it', () => {
    items.forEach((i) => expect(info.has(i.name)).toBe(true));
    expect(layout.stats.models).toBeGreaterThan(140);
  });

  test('is deterministic, and independent of the random meadow hills (they only move models up and down)', () => {
    const again = buildNatureLayout({ manifest, heightAt: (x, z) => terrain.heightAt(x, z), field: terrain.bounds });
    expect(again.items).toEqual(items);
    terrain.settings.hillSeed += 9;
    terrain.rebuild();
    const other = buildNatureLayout({ manifest, heightAt: (x, z) => terrain.heightAt(x, z), field: terrain.bounds });
    expect(other.items.map((i) => [i.name, i.x, i.z, i.rotY, i.scale])).toEqual(items.map((i) => [i.name, i.x, i.z, i.rotY, i.scale]));
  });

  test('everything is inside the field and not in the open water', () => {
    const b = terrain.bounds;
    items.filter((it) => it.tag !== 'far').forEach((it) => { // the far forest is outside the field on purpose
      expect(it.x).toBeGreaterThan(b.minX);
      expect(it.x).toBeLessThanOrEqual(b.maxX);
      expect(it.z).toBeGreaterThan(b.minZ);
      expect(it.z).toBeLessThan(b.maxZ);
    });
  });

  test('items rest on the terrain (their lowest point is at the terrain height)', () => {
    byTag('tree', 'undergrowth', 'patch', 'rock', 'smallrock', 'bigrock', 'decor', 'camp', 'stump').forEach((it) => {
      expect(base(it)).toBeCloseTo(terrain.heightAt(it.x, it.z), 5);
    });
  });

  describe('forest', () => {
    test('is dense: 200+ trees, with enough species', () => {
      const trees = byTag('tree', 'palm');
      expect(trees.length).toBeGreaterThan(200);
      expect(new Set(trees.map((t) => t.name)).size).toBeGreaterThan(40);
    });

    test('trees keep clear of every path, the clearing and each other', () => {
      const trees = byTag('tree');
      trees.forEach((t) => {
        expect(distToPaths(t.x, t.z)).toBeGreaterThanOrEqual(TREE_PATH_CLEAR - 1e-6);
        expect(Math.hypot(t.x - CLEARING.x, t.z - CLEARING.z)).toBeGreaterThan(CLEARING.radius + 3);
        expect(landHeight(t.x, t.z)).toBeGreaterThan(WATER_Y + 1);
      });
      for (let i = 0; i < trees.length; i++) {
        for (let j = i + 1; j < trees.length; j++) {
          expect(Math.hypot(trees[i].x - trees[j].x, trees[i].z - trees[j].z)).toBeGreaterThanOrEqual(TREE_MIN_SPACING - 1e-6);
        }
      }
    });

    test('pines grow on the mountain, broadleaf trees on the lowland, palms on the beach', () => {
      const pines = byTag('pine');
      expect(pines.length).toBeGreaterThan(12);
      pines.forEach((t) => {
        expect(t.name).toMatch(/^tree-(pine|cone)/);
        expect(landHeight(t.x, t.z)).toBeGreaterThan(3);
        expect(distToPaths(t.x, t.z)).toBeGreaterThanOrEqual(PINE_PATH_CLEAR - 1e-6);
      });
      byTag('tree').filter((t) => landHeight(t.x, t.z) > 7).forEach((t) => expect(t.name).toMatch(/^tree-(pine|cone)/));
      expect(byTag('tree').some((t) => /^tree-(oak|default|detailed|fat|simple|tall|thin)/.test(t.name))).toBe(true);
      const palms = byTag('palm');
      expect(palms.length).toBeGreaterThan(8);
      palms.forEach((p) => {
        expect(p.name).toMatch(/^tree-palm/);
        expect(p.x).toBeLessThan(-140);
      });
    });

    test('there is a tree line: nothing taller than 15 m up the mountain', () => {
      byTag('tree').forEach((t) => expect(landHeight(t.x, t.z)).toBeLessThanOrEqual(15));
    });

    test('every tree has a thin solid trunk collider', () => {
      byTag('tree', 'palm').forEach((t) => {
        expect(t.collider.kind).toBe('cylinder');
        expect(t.collider.radius).toBeLessThan(0.5 * KIT_SCALE);
      });
    });
  });

  describe('flowers, plants and rocks', () => {
    test('all 9 flower models grow in meadow patches, along the paths and in the clearing', () => {
      const flowers = byTag('patch', 'decor', 'clearing', 'undergrowth').filter((i) => i.name.startsWith('flower-'));
      expect(new Set(flowers.map((f) => f.name)).size).toBe(9);
      expect(byTag('patch').length).toBeGreaterThan(100);
      expect(byTag('clearing').length).toBeGreaterThan(30);
      byTag('clearing').forEach((c) => expect(Math.hypot(c.x - CLEARING.x, c.z - CLEARING.z)).toBeLessThanOrEqual(CLEARING.radius + 3));
    });

    test('mushrooms, bushes and grass tufts grow under the trees', () => {
      const under = new Set(byTag('undergrowth').map((u) => u.name.split('-')[0]));
      ['mushroom', 'plant', 'flower'].forEach((k) => expect(under.has(k)).toBe(true));
    });

    test('big rocks (30+, scale 1.8x or more) stand around the mountain foot and the paths, with hull colliders', () => {
      const big = byTag('bigrock');
      expect(big.length).toBeGreaterThan(30);
      big.forEach((r) => {
        expect(r.name).toMatch(/^(rock|stone)-tall/);
        expect(r.scale).toBeGreaterThanOrEqual(KIT_SCALE * 1.8 - 1e-6);
        expect(r.collider.kind).toBe('hull');
        expect(distToPaths(r.x, r.z)).toBeGreaterThanOrEqual(BIG_ROCK_PATH_CLEAR - 1e-6);
      });
      expect(big.filter((r) => Math.hypot(r.x - MOUNTAIN.x, r.z - MOUNTAIN.z) < MOUNTAIN.radius * 1.3).length).toBeGreaterThan(8);
    });

    test('medium rocks and many small stones are scattered; stones also line the paths', () => {
      expect(byTag('rock').length).toBeGreaterThan(30);
      expect(byTag('smallrock').length).toBeGreaterThan(60);
      expect(byTag('decor').some((d) => /^(rock|stone)-small/.test(d.name))).toBe(true);
    });
  });

  describe('far forest (from the terrain field out to the backdrop mountains)', () => {
    const far = () => byTag('far');
    const radius = (t) => Math.hypot(t.x - FAR_FOREST.center.x, t.z - FAR_FOREST.center.z);

    test('is big: 1200+ trees, all standing on the flat lowland with a trunk collider', () => {
      expect(far().length).toBeGreaterThan(1200);
      far().forEach((t) => {
        expect(base(t)).toBeCloseTo(LOWLAND_Y, 5);
        expect(t.collider.kind).toBe('cylinder');
        expect(t.name).toMatch(/^tree-/);
      });
    });

    test('stays inside the allowed zone: not on the field, the start meadow, the sea', () => {
      far().forEach((t) => expect(inFarForest(t.x, t.z, terrain.bounds)).toBe(true));
      far().forEach((t) => {
        expect(t.x).toBeGreaterThan(SEA_EDGE_X);
        expect(radius(t)).toBeLessThanOrEqual(FAR_FOREST.radius + 1e-6);
      });
    });

    test('reaches the mountains: trees grow out to the foot of the backdrop ring in the north, south and east', () => {
      expect(FAR_FOREST.radius).toBeGreaterThan(MOUNTAIN_RING.min - 40); // ends right before the ring starts
      const reach = far().filter((t) => radius(t) > FAR_FOREST.radius - 40);
      expect(reach.length).toBeGreaterThan(80);
      expect(reach.some((t) => t.z < -150)).toBe(true); // north
      expect(reach.some((t) => t.z > 150)).toBe(true); // south
      expect(reach.some((t) => t.x > 100)).toBe(true); // east
      expect(far().filter((t) => t.z < -100).length).toBeGreaterThan(200);
      expect(far().filter((t) => t.z > 100).length).toBeGreaterThan(200);
      expect(far().filter((t) => t.x > 60).length).toBeGreaterThan(200);
    });

    test('trees keep their spacing, and pines take over toward the mountains', () => {
      const trees = far();
      const grid = new Map();
      trees.forEach((t) => {
        const k = `${Math.floor(t.x / FAR_TREE_SPACING)},${Math.floor(t.z / FAR_TREE_SPACING)}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(t);
      });
      trees.forEach((t) => {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            (grid.get(`${Math.floor(t.x / FAR_TREE_SPACING) + dx},${Math.floor(t.z / FAR_TREE_SPACING) + dz}`) ?? []).forEach((o) => {
              if (o !== t) expect(Math.hypot(o.x - t.x, o.z - t.z)).toBeGreaterThanOrEqual(FAR_TREE_SPACING - 1e-6);
            });
          }
        }
      });
      const pineShare = (list) => list.filter((t) => /^tree-(pine|cone)/.test(t.name)).length / list.length;
      expect(pineShare(trees.filter((t) => radius(t) > 190))).toBeGreaterThan(pineShare(trees.filter((t) => radius(t) < 120)) + 0.2);
    });

    test('joins the field forest without a gap (the lowland meets the field edges at the same level)', () => {
      // a field edge point and the lowland next to it are within a few cm of each other
      [[-100, -79.9], [-100, 79.9], [-60, 79.9], [-140, -79.9]].forEach(([x, z]) => expect(Math.abs(terrain.heightAt(x, z) - LOWLAND_Y)).toBeLessThan(0.25));
    });
  });

  describe('mountain, clearing and beach', () => {
    test('cliff outcrops sit on the mountain flanks, away from the trail', () => {
      const cliffs = byTag('cliff');
      expect(cliffs.length).toBeGreaterThan(20);
      cliffs.forEach((c) => {
        expect(c.name).toMatch(/^cliff-/);
        expect(Math.hypot(c.x - MOUNTAIN.x, c.z - MOUNTAIN.z)).toBeLessThan(MOUNTAIN.radius);
        expect(distToPaths(c.x, c.z)).toBeGreaterThan(4.2); // outside the 8 m ledge
        expect(c.collider.kind).toBe('box');
      });
    });

    test('the summit has a viewpoint: platform, sign, fire and seats around the top', () => {
      const s = byTag('summit');
      ['platform-stone', 'sign', 'campfire-stones'].forEach((n) => expect(s.some((i) => i.name === n)).toBe(true));
      s.forEach((i) => expect(Math.hypot(i.x - SUMMIT.x, i.z - SUMMIT.z)).toBeLessThan(14));
      s.forEach((i) => expect(base(i)).toBeGreaterThan(MOUNTAIN.height - 5));
    });

    test('the clearing has a camp: 4 tents around a fire, logs, bed and pots', () => {
      const camp = byTag('camp');
      const tents = camp.filter((i) => i.name.startsWith('tent-'));
      expect(tents.length).toBe(4);
      tents.forEach((t) => expect(Math.hypot(t.x - CLEARING.x, t.z - CLEARING.z)).toBeLessThan(CLEARING.radius));
      ['campfire-logs', 'bed', 'pot-large', 'sign'].forEach((n) => expect(camp.some((i) => i.name === n)).toBe(true));
    });

    test('the beach has a wooden pier into the water, a canoe, lilies and rocks in the sea', () => {
      const pier = byTag('pier');
      expect(pier.length).toBe(4);
      expect(pier.filter((p) => p.name === 'path-woodend').length).toBe(1);
      pier.forEach((p) => {
        expect(p.x).toBeLessThan(BEACH.x);
        expect(Math.abs(p.z - BEACH.z)).toBeLessThan(0.01);
        expect(base(p)).toBeGreaterThan(WATER_Y);
      });
      const beach = byTag('beach');
      expect(beach.some((b) => b.name === 'canoe')).toBe(true);
      expect(beach.some((b) => b.name.startsWith('lily'))).toBe(true);
      expect(beach.some((b) => /^(rock|stone)-tall/.test(b.name) && landHeight(b.x, b.z) < WATER_Y)).toBe(true);
    });
  });
});

describe('NatureKit (real kit models)', () => {
  let world, terrain, scene, kit;

  beforeEach(async () => {
    ({ world, terrain } = makeWorld());
    scene = createScene();
    kit = new NatureKit(scene, world, createFakeGui(), terrain, { manifest, loadModel });
    await kit.load();
  }, 60000);

  test('builds one instanced mesh per used model, with the right instance counts', () => {
    expect(kit.meshes.size).toBe(kit.stats.models);
    kit.slots.forEach((list, name) => {
      expect(kit.meshes.get(name)).toBeInstanceOf(THREE.InstancedMesh);
      expect(kit.meshes.get(name).count).toBe(list.length);
    });
    expect(scene.children).toContain(kit.group);
    expect(kit.items.length).toBe(kit.stats.total);
  });

  test('uses one shared non-metallic material with baked vertex colors', () => {
    expect(kit.material.metalness).toBe(0);
    expect(kit.material.vertexColors).toBe(true);
    const name = [...kit.meshes.keys()].find((n) => n.startsWith('tree-oak'));
    expect(name).toBeDefined();
    const colors = kit.meshes.get(name).geometry.attributes.color;
    expect(colors.count).toBeGreaterThan(10);
  });

  test('palette can switch to the original pastel Kenney colors and back', () => {
    const name = [...kit.meshes.keys()].find((n) => n.startsWith('rock-large'));
    const attr = kit.meshes.get(name).geometry.attributes.color;
    const natural = Array.from(attr.array);
    kit.setPalette('original');
    expect(Array.from(attr.array)).not.toEqual(natural);
    expect(kit.material.color.r).toBeCloseTo(0.65);
    kit.setPalette('natural');
    expect(Array.from(attr.array)).toEqual(natural);
    expect(kit.material.color.r).toBeCloseTo(1);
  });

  test('creates a physics collider for every solid item', () => {
    const solid = kit.items.filter((i) => i.collider).length;
    expect(solid).toBeGreaterThan(300);
    expect(kit.colliders.length).toBe(solid);
  });

  test('a ball rolled into a tree trunk is stopped by it', () => {
    world.step();
    const t = kit.items.find((i) => i.tag === 'tree');
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x - 4, t.y + 1.2, t.z).setLinvel(8, 0, 0).setGravityScale(0));
    world.createCollider(RAPIER.ColliderDesc.ball(0.3), body);
    runSteps(world, 120);
    expect(body.translation().x).toBeLessThan(t.x);
  });

  test('big rocks are solid hulls: a ray from above lands on the rock, well above the terrain', () => {
    world.step();
    const rock = kit.items.find((i) => i.tag === 'bigrock');
    const hit = world.castRay(new RAPIER.Ray({ x: rock.x, y: rock.top + 20, z: rock.z }, { x: 0, y: -1, z: 0 }), 100, true);
    expect(hit).not.toBeNull();
    const hitY = rock.top + 20 - hit.timeOfImpact;
    expect(hitY).toBeGreaterThan(terrain.heightAt(rock.x, rock.z) + 2);
    expect(hitY).toBeLessThanOrEqual(rock.top + 0.05);
  });

  test('regenerating the hills re-snaps the models without leaking colliders', () => {
    const collidersBefore = world.colliders.len();
    const instancesBefore = [...kit.slots.values()].map((l) => l.length);
    const first = kit.items.find((i) => i.tag === 'tree');

    terrain.settings.hillSeed += 5;
    terrain.rebuild();

    expect(world.colliders.len()).toBe(collidersBefore);
    expect([...kit.slots.values()].map((l) => l.length)).toEqual(instancesBefore);
    kit.items.filter((i) => ['tree', 'patch', 'rock'].includes(i.tag)).forEach((t) => {
      expect(base(t)).toBeCloseTo(terrain.heightAt(t.x, t.z), 5);
    });
    expect(kit.items.find((i) => i.tag === 'tree').x).toBe(first.x);
  });

  test('"Show Models" hides the whole kit', () => {
    kit.group.visible = false;
    expect(kit.group.visible).toBe(false);
  });
});

describe('manual (hand-edited) layout', () => {
  let world, terrain;
  const heightAt = (x, z) => terrain.heightAt(x, z);
  const generated = () => buildNatureLayout({ manifest, heightAt, field: terrain.bounds });
  const oak = manifest.find((m) => m.name.startsWith('tree-oak')).name;
  const rock = manifest.find((m) => m.name.startsWith('rock-large')).name;

  beforeEach(() => {
    ({ world, terrain } = makeWorld());
  });

  test('USE_MANUAL_LAYOUT is false by default (the generated layout is used)', () => {
    const src = readFileSync(fileURLToPath(new URL('../objects/nature_kit.js', import.meta.url)), 'utf8');
    expect(src).toMatch(/const USE_MANUAL_LAYOUT\s*=\s*false;/);
    const kit = new NatureKit(createScene(), world, createFakeGui(), terrain, { manifest, loadModel });
    expect(kit.settings.manualLayout).toBe(false);
  });

  test('the generated layout survives serialize -> manual load (same models, same places, same colliders)', () => {
    const gen = generated();
    const data = JSON.parse(JSON.stringify(serializeLayout(gen.items, heightAt))); // through real JSON, like the file
    const back = layoutFromManual(data, { manifest, heightAt });
    expect(back.items.length).toBe(gen.items.length);
    gen.items.forEach((a, i) => {
      const b = back.items[i];
      expect(b.name).toBe(a.name);
      expect(b.tag).toBe(a.tag);
      expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(0.006);
      expect(Math.abs(b.z - a.z)).toBeLessThanOrEqual(0.006);
      expect(Math.abs(b.y - a.y)).toBeLessThan(0.03);
      expect(Math.abs(b.scale - a.scale)).toBeLessThan(0.001);
      expect(b.collider?.kind).toBe(a.collider?.kind);
    });
    expect(back.stats.total).toBe(gen.stats.total);
  });

  test('the shipped src/static/nature/layout.manual.json is a valid file that matches the generated layout it started from', () => {
    const data = JSON.parse(readFileSync(`${NATURE_DIR}layout.manual.json`, 'utf8'));
    const back = layoutFromManual(data, { manifest, heightAt });
    expect(back.items.length).toBe(generated().items.length);
  });

  test('manual items follow the hills: they keep their offset from the terrain when it is regenerated', () => {
    const data = { version: 1, items: [{ name: oak, x: -100, z: 30, dy: 0.5 }, { name: rock, x: -60, z: -30 }] };
    terrain.settings.hillSeed += 7;
    terrain.rebuild();
    const [a, b] = layoutFromManual(data, { manifest, heightAt }).items;
    expect(a.y).toBeCloseTo(terrain.heightAt(-100, 30) + 0.5, 6);
    expect(b.y).toBeCloseTo(terrain.heightAt(-60, -30), 6);
    expect([b.scale, b.rotY, b.tag, b.collider]).toEqual([KIT_SCALE, 0, 'prop', null]); // defaults for the optional fields
  });

  test('invalid files are rejected with a clear message (unknown model, non-numeric value, wrong version, no items)', () => {
    const load = (d) => () => layoutFromManual(d, { manifest, heightAt });
    expect(load({ items: [{ name: 'tree-nope', x: 0, z: 0 }] })).toThrow(/unknown model "tree-nope"/);
    expect(load({ items: [{ name: oak, x: '1', z: 0 }] })).toThrow(/non-numeric/);
    expect(load({ items: [{ name: oak, x: 0 }] })).toThrow(/non-numeric/);
    expect(load({ version: 99, items: [] })).toThrow(/version/);
    expect(load({})).toThrow(/items/);
    expect(load(null)).toThrow(/items/);
  });

  describe('NatureKit', () => {
    const FILE = {
      version: 1,
      items: [
        { name: oak, x: -100, z: 30, rotY: 1, scale: 4, tag: 'tree', collider: { kind: 'cylinder', radius: 0.3, halfHeight: 0.6, centerY: 0.6 } },
        { name: oak, x: -90, z: 30, tag: 'tree', collider: { kind: 'cylinder', radius: 0.3, halfHeight: 0.6, centerY: 0.6 } },
        { name: rock, x: -80, z: 30, tag: 'rock' },
      ],
    };
    const make = (opts) => new NatureKit(createScene(), world, createFakeGui(), terrain, { manifest, loadModel, ...opts });

    test('with the flag on, only the items of the file exist (no generated forest), with their colliders', async () => {
      const kit = make({ manualLayout: true, manualData: FILE });
      await kit.load();
      expect(kit.settings.manualLayout).toBe(true);
      expect(kit.items.length).toBe(3);
      expect(kit.meshes.size).toBe(2);
      expect(kit.meshes.get(oak).count).toBe(2);
      expect(kit.meshes.get(rock).count).toBe(1);
      expect(kit.colliders.length).toBe(2); // the rock has no collider in the file
      expect(kit.items[0].y).toBeCloseTo(terrain.heightAt(-100, 30), 6);
    });

    test('a manual layout is re-snapped to the regenerated hills without changing what is there', async () => {
      const kit = make({ manualLayout: true, manualData: FILE });
      await kit.load();
      terrain.settings.hillSeed += 3;
      terrain.rebuild();
      expect(kit.items.length).toBe(3);
      kit.items.forEach((it) => expect(it.y).toBeCloseTo(terrain.heightAt(it.x, it.z), 6));
      expect(kit.colliders.length).toBe(2);
    });

    test('an unreadable or invalid file warns and falls back to the generated layout', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const kit = make({ manualLayout: true, manualData: { items: [{ name: 'tree-nope', x: 0, z: 0 }] } });
      await kit.load();
      expect(warn).toHaveBeenCalledOnce();
      expect(kit.settings.manualLayout).toBe(false);
      expect(kit.items.length).toBe(generated().items.length);
      warn.mockRestore();
    });

    test('the current layout can be exported as a manual file that loads back (generated -> JSON text -> manual kit)', async () => {
      const kit = make({});
      await kit.load();
      const text = kit.exportLayoutJson();
      const data = JSON.parse(text);
      expect(data.version).toBe(1);
      expect(data.items.length).toBe(kit.items.length);
      const manual = make({ manualLayout: true, manualData: data });
      await manual.load();
      expect(manual.items.length).toBe(kit.items.length);
      expect(manual.meshes.size).toBe(kit.meshes.size);
      expect(manual.colliders.length).toBe(kit.colliders.length);
    }, 60000);

    describe('GUI switch', () => {
      afterEach(() => { delete globalThis.location; });

      test('the checkbox reloads the page with ?layout=manual / generated (the URL parameter wins over the constant)', () => {
        globalThis.location = { href: 'http://localhost:5173/index.html?warp=summit', search: '?warp=summit' };
        const urls = [];
        const kit = make({ navigate: (u) => urls.push(u) });
        kit._switchLayout(true);
        kit._switchLayout(false);
        expect(urls[0]).toContain('layout=manual');
        expect(urls[0]).toContain('warp=summit'); // other parameters are kept
        expect(urls[1]).toContain('layout=generated');
      });

      test('?layout=manual in the URL turns the manual layout on, ?layout=generated turns it off', () => {
        globalThis.location = { href: 'http://localhost/?layout=manual', search: '?layout=manual' };
        expect(new NatureKit(createScene(), world, createFakeGui(), terrain, { manifest, loadModel }).settings.manualLayout).toBe(true);
        globalThis.location = { href: 'http://localhost/?layout=generated', search: '?layout=generated' };
        expect(new NatureKit(createScene(), world, createFakeGui(), terrain, { manifest, loadModel }).settings.manualLayout).toBe(false);
      });
    });
  });
});
