import { seededRandom } from './noise';
import {
  CORRIDORS, CLEARING, MOUNTAIN, SUMMIT, BEACH, WATER_Y, BASIN, SEA_EDGE_X, PATH_WIDTH, TRAIL_WIDTH, LOWLAND_Y, FAR_FOREST, distToPaths, landHeight, inFarForest,
} from './forest_map';

// *** FOREST LAYOUT SETTINGS ***
// Pure, deterministic placement of Kenney Nature Kit models along the forest map (see forest_map.js). No three.js / Rapier here.
// Decisions use landHeight (no random hills), so regenerating the hills only moves models up/down, never adds or removes them.
export const KIT_SCALE         = 4;      // Kenney models are ~1 unit; x4 fits the car (2 x 4 m)
const LAYOUT_SEED              = 17;
const FIELD_MARGIN             = 5;      // keep this far from the field edges
const SEAM_MARGIN              = 7;      // and this far from the ground edge (the entrance stays open)

// Trees
export const TREE_COUNT        = 340;
export const TREE_MIN_SPACING  = 5;
export const TREE_PATH_CLEAR   = PATH_WIDTH / 2 + 4.5; // trees stay this far from any path centerline
const TREE_CLEARING_GAP        = 4;      // and this far from the clearing edge
const TREE_MAX_ALTITUDE        = 15;     // tree line on the mountain
const CONIFER_ALTITUDE         = 7;      // above this only pines
const CONIFER_MIX              = 0.12;   // share of pines in the lowland forest
const TREE_SCALE               = { min: 0.85, max: 1.3 };
const TREE_TRUNK_RADIUS        = 0.06;   // kit units (x scale)
const TREE_COLLIDER_HEIGHT     = 0.3;    // share of the tree height that is solid
const UNDERGROWTH_SHARE        = 0.5;    // share of trees with a plant/mushroom/flower at their feet
const MOSS_COUNT               = 12;

// Far forest (on the lowland outside the terrain field, out to the backdrop mountains)
export const FAR_TREE_COUNT    = 2200;   // target; fewer when the area fills up
export const FAR_TREE_SPACING  = 7;      // m between trees (sparser than the field forest)
const FAR_TREE_ATTEMPTS        = 10;     // random tries per tree before giving up
const FAR_PINE_BASE            = 0.05;   // share of pines near the field ...
const FAR_PINE_GAIN            = 0.8;    // ... growing by this much toward the mountains
export const PINE_COUNT        = 70;     // extra pines on the mountain flanks
export const PINE_SPACING      = 4;
export const PINE_PATH_CLEAR   = TRAIL_WIDTH / 2 + 2; // they may stand closer to the trail than lowland trees
const PINE_MAX_ALTITUDE        = 20;

// Flowers
const PATCH_COUNT              = 130;
const PATCH_RADIUS             = 3.5;
const PATCH_SIZE               = { min: 6, max: 14 };
const SMALL_SCALE              = { min: 0.8, max: 1.4 };

// Rocks
const BIG_ROCK_COUNT           = 40;     // rock-tall / stone-tall, scale 1.8-2.8
const BIG_ROCK_SCALE           = { min: 1.8, max: 2.8 };
export const BIG_ROCK_PATH_CLEAR = PATH_WIDTH / 2 + 5;
const LARGE_ROCK_COUNT         = 48;     // rock-large / stone-large
const LARGE_ROCK_SCALE         = { min: 1.2, max: 2.0 };
const SMALL_ROCK_COUNT         = 190;
const SMALL_ROCK_SCALE         = { min: 1.0, max: 1.8 };
const STUMP_COUNT              = 28;
const LOG_COUNT                = 18;

// Mountain cliffs
const OUTCROP_COUNT            = 14;
const OUTCROP_PIECES           = { min: 4, max: 6 };
const OUTCROP_RADIUS           = 2.5;
const OUTCROP_ZONE             = { min: 0.3, max: 0.85 };  // share of the mountain radius
const OUTCROP_TRAIL_CLEAR      = TRAIL_WIDTH / 2 + 0.5;
const CLIFF_SCALE              = { min: 1.0, max: 1.7 };
const CLIFF_SINK               = 0.6;    // meters pushed into the slope

// Path decoration (stones, flowers, grass along every path)
const DECOR_SPACING            = 3.2;

// Camp in the clearing
const CAMP_TENT_RADIUS         = 6.5;
const CAMP_EXCLUSION           = 9;      // flowers keep out of this radius around the fire
const CLEARING_FLOWERS         = 60;

// Beach / sea
const PIER_LIFT                = 0.35;   // pier deck above the water
const PIER_PLANKS              = 3;
const PALM_COUNT               = 22;
const SHORE_ROCKS              = 10;
const SEA_ROCKS                = 6;
const LILY_COUNT               = 10;

const SOLID_BOX                = { kind: 'box', shrink: 0.8 };
const SOLID_HULL               = { kind: 'hull' };

/**
 * Build the item list.
 * @param manifest models from nature/manifest.json ({ name, size, min, max })
 * @param heightAt terrain height function (world x, z) -> y (including hills)
 * @param field    world rectangle of the terrain { minX, maxX, minZ, maxZ }
 * @return { items, stats } where each item is { name, x, y, z, rotY, scale, collider, tag, top }
 */
export function buildNatureLayout({ manifest, heightAt, field }) {
  const rand = seededRandom(LAYOUT_SEED);
  const range = ({ min, max }) => min + rand() * (max - min);
  const pickFrom = (list) => list[Math.floor(rand() * list.length)];
  const shuffle = (list) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  /** Endless cycle through a shuffled copy of the list, so every model shows up before any repeats. */
  const cycler = (list) => {
    let q = [];
    return () => { if (!q.length) q = shuffle(list); return q.pop(); };
  };

  const info = new Map(manifest.map((m) => [m.name, m]));
  const names = manifest.map((m) => m.name);
  const group = (re) => names.filter((n) => re.test(n));
  const G = {
    broadleaf: group(/^tree-(?!pine|palm|cone)/),
    conifer: group(/^tree-(pine|cone)/),
    palm: group(/^tree-palm/),
    flower: group(/^flower-/),
    grass: group(/^grass(-|$)/),
    plant: group(/^plant-/),
    mushroom: group(/^mushroom-/),
    bigRock: group(/^(rock|stone)-tall/),
    largeRock: group(/^(rock|stone)-large/),
    smallRock: group(/^(rock|stone)-small/),
    stump: group(/^stump-/),
    log: group(/^log(-|$)/),
    cliff: group(/^cliff-/),
  };
  const items = [];

  /** Place a model. baseY = surface its lowest point rests on (default: terrain). */
  const put = (name, x, z, { rotY = 0, jitter = 1, baseY, collider = null, tag = 'prop' } = {}) => {
    const m = info.get(name);
    if (!m) throw new Error(`unknown model ${name}`);
    const scale = KIT_SCALE * jitter;
    const base = baseY ?? heightAt(x, z);
    const y = base - m.min[1] * scale;
    if (collider?.kind === 'trunk') {
      const halfHeight = (TREE_COLLIDER_HEIGHT * (m.max[1] - m.min[1]) * scale) / 2;
      collider = { kind: 'cylinder', radius: TREE_TRUNK_RADIUS * scale, halfHeight, centerY: m.min[1] * scale + halfHeight };
    }
    const item = { name, x, y, z, rotY, scale, collider, tag, top: y + m.max[1] * scale };
    items.push(item);
    return item;
  };

  // ---- sampling helpers ----
  const placed = [];                                     // circles already taken: { x, z, r }
  const reserve = (x, z, r) => placed.push({ x, z, r });
  const isFree = (x, z, r) => placed.every((p) => Math.hypot(p.x - x, p.z - z) >= p.r + r);
  const inField = (x, z, m = FIELD_MARGIN) => x > field.minX + m && x < field.maxX - SEAM_MARGIN && z > field.minZ + m && z < field.maxZ - m;
  const clearingDist = (x, z) => Math.hypot(x - CLEARING.x, z - CLEARING.z);
  const randomPoint = () => [field.minX + FIELD_MARGIN + rand() * (field.maxX - SEAM_MARGIN - field.minX - FIELD_MARGIN), field.minZ + FIELD_MARGIN + rand() * (field.maxZ - field.minZ - 2 * FIELD_MARGIN)];
  /** Find a free spot: accept(x, z, landH) is the caller's rule, r its footprint. Returns [x, z] or null. */
  const findSpot = (r, accept, attempts = 120) => {
    for (let i = 0; i < attempts; i++) {
      const [x, z] = randomPoint();
      if (isFree(x, z, r) && accept(x, z, landHeight(x, z))) return [x, z];
    }
    return null;
  };

  // ---- 1. Summit viewpoint ----
  {
    const base = heightAt(SUMMIT.x, SUMMIT.z);
    put('platform-stone', SUMMIT.x, SUMMIT.z, { jitter: 1.6, baseY: base, tag: 'summit' }); // no collider: the trail ends on it
    put('sign', SUMMIT.x + 4, SUMMIT.z - 3, { rotY: -0.6, tag: 'summit' });
    put('campfire-stones', SUMMIT.x - 5, SUMMIT.z + 2, { tag: 'summit' });
    put('log', SUMMIT.x - 7, SUMMIT.z + 2.5, { rotY: 0.4, tag: 'summit' });
    put('log-large', SUMMIT.x - 3.5, SUMMIT.z + 5, { rotY: 1.9, tag: 'summit' });
    ['stone-largea', 'rock-largeb', 'stone-largec'].forEach((n, k) => {
      const a = 1.2 + k * 2.1;
      put(n, SUMMIT.x + Math.cos(a) * 7.5, SUMMIT.z + Math.sin(a) * 7.5, { rotY: a, jitter: 1.3, collider: SOLID_HULL, tag: 'summit' });
    });
    reserve(SUMMIT.x, SUMMIT.z, 11);
  }

  // ---- 2. Camp in the clearing ----
  {
    reserve(CLEARING.x, CLEARING.z, CAMP_EXCLUSION);
    const at = (name, dx, dz, o) => put(name, CLEARING.x + dx, CLEARING.z + dz, { tag: 'camp', ...o });
    at('campfire-logs', 0, 0);
    ['tent-detailedclosed', 'tent-detailedopen', 'tent-smallclosed', 'tent-smallopen'].forEach((n, k) => {
      const a = Math.PI / 4 + (k * Math.PI) / 2 + 0.25;
      const dx = Math.cos(a) * CAMP_TENT_RADIUS;
      const dz = Math.sin(a) * CAMP_TENT_RADIUS;
      at(n, dx, dz, { rotY: Math.atan2(-dx, -dz), collider: SOLID_BOX });
    });
    for (let k = 0; k < 4; k++) {
      const a = k * (Math.PI / 2) + 0.9;
      at(k % 2 ? 'log-large' : 'log', Math.cos(a) * 3, Math.sin(a) * 3, { rotY: a + Math.PI / 2 });
    }
    at('log-stack', -9.5, 1, { rotY: 1.57, collider: SOLID_BOX });
    at('log-stacklarge', 9.5, -2, { rotY: 1.57, collider: SOLID_BOX });
    at('bed', -0.5, 8.2, { rotY: 0.3 });
    at('bed-floor', -8.2, -2.2, { rotY: -0.4 });
    at('pot-large', 1.6, 1.8);
    at('pot-small', -1.8, 1.4);
    at('campfire-stones', -7.5, -11.5);
    at('campfire-bricks', 11, 5);
    at('campfire-planks', -11, -6);
    at('sign', 2, -CLEARING.radius + 1.5, { rotY: Math.PI });
  }

  // ---- 3. Beach, pier, canoe, lilies ----
  {
    const pierY = WATER_Y + PIER_LIFT;
    for (let k = 0; k < PIER_PLANKS; k++) put('path-wood', BEACH.x - 3 - 4 * k, BEACH.z, { baseY: pierY, tag: 'pier' });
    put('path-woodend', BEACH.x - 3 - 4 * PIER_PLANKS, BEACH.z, { baseY: pierY, tag: 'pier' });
    reserve(BEACH.x - 10, BEACH.z, 10);
    put('canoe', BEACH.x - 9, BEACH.z + 7, { rotY: 1.2, baseY: WATER_Y - 0.02, tag: 'beach' });
    put('canoe-paddle', BEACH.x + 4, BEACH.z + 9, { rotY: 0.7, tag: 'beach' });
    put('canoe', BEACH.x + 1, BEACH.z - 12, { rotY: 0.3, tag: 'beach' });
    put('platform-beach', BEACH.x + 4, BEACH.z + 17, { jitter: 1.6, tag: 'beach' });
    reserve(BEACH.x + 4, BEACH.z + 17, 4);

    const beachSpot = (x, z, h) => x < BASIN.startX + 4 && h > WATER_Y + 0.2 && h < 0.8 && distToPaths(x, z) > 6;
    const nextPalm = cycler(G.palm);
    for (let k = 0; k < PALM_COUNT; k++) {
      const p = findSpot(3.2, beachSpot);
      if (!p) continue;
      put(nextPalm(), p[0], p[1], { rotY: rand() * Math.PI * 2, jitter: range(TREE_SCALE), collider: { kind: 'trunk' }, tag: 'palm' });
      reserve(p[0], p[1], 2.5);
    }
    const nextStone = cycler([...G.largeRock, ...G.smallRock]);
    for (let k = 0; k < SHORE_ROCKS; k++) {
      const p = findSpot(2, (x, z, h) => x < BASIN.startX + 8 && h > WATER_Y - 0.6 && h < 0.4 && distToPaths(x, z) > 7);
      if (!p) continue;
      const n = nextStone();
      put(n, p[0], p[1], { rotY: rand() * Math.PI * 2, jitter: range(LARGE_ROCK_SCALE), collider: /large/.test(n) ? SOLID_HULL : null, tag: 'beach' });
      reserve(p[0], p[1], 1.8);
    }
    const nextBig = cycler(G.bigRock);
    for (let k = 0; k < SEA_ROCKS; k++) {
      const p = findSpot(3.5, (x, z, h) => x < SEA_EDGE_X + 22 && h < WATER_Y - 0.8 && h > -3.4 && distToPaths(x, z) > 9);
      if (!p) continue;
      put(nextBig(), p[0], p[1], { rotY: rand() * Math.PI * 2, jitter: range(BIG_ROCK_SCALE), collider: SOLID_HULL, tag: 'beach' });
      reserve(p[0], p[1], 3.5);
    }
    const nextLily = cycler(['lily-large', 'lily-small']);
    for (let k = 0; k < LILY_COUNT; k++) {
      const p = findSpot(1.5, (x, z, h) => x < BASIN.startX + 10 && h < WATER_Y - 0.2 && h > WATER_Y - 1.4 && distToPaths(x, z) > 8);
      if (!p) continue;
      put(nextLily(), p[0], p[1], { rotY: rand() * Math.PI * 2, baseY: WATER_Y - 0.03, tag: 'beach' });
      reserve(p[0], p[1], 1.2);
    }
  }

  // ---- 4. Decoration along every path and the trail ----
  {
    const nextSmall = cycler(G.smallRock);
    const nextFlower = cycler(G.flower);
    const nextGrass = cycler(G.grass);
    CORRIDORS.forEach((c) => {
      let acc = DECOR_SPACING;
      let side = 1;
      for (let i = 1; i < c.pts.length; i++) {
        acc += Math.hypot(c.pts[i].x - c.pts[i - 1].x, c.pts[i].z - c.pts[i - 1].z);
        if (acc < DECOR_SPACING) continue;
        acc = 0;
        side = -side;
        const a = c.pts[i - 1];
        const b = c.pts[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const off = (c.halfWidth + 0.4 + rand() * 1.6) * side;
        const x = b.x + (-(b.z - a.z) / len) * off;
        const z = b.z + ((b.x - a.x) / len) * off;
        if (!inField(x, z, 2) || landHeight(x, z) < WATER_Y + 0.4) continue;
        const r = rand();
        if (r < 0.5) put(nextSmall(), x, z, { rotY: rand() * 6.28, jitter: range({ min: 0.7, max: 1.3 }), tag: 'decor' });
        else if (r < 0.82) put(nextFlower(), x, z, { rotY: rand() * 6.28, jitter: range(SMALL_SCALE), tag: 'decor' });
        else put(nextGrass(), x, z, { rotY: rand() * 6.28, jitter: range(SMALL_SCALE), tag: 'decor' });
      }
    });
  }


  // ---- 5. Big and large rocks, cliff outcrops (placed first: they need the most room) ----
  {
    const nextBig = cycler(G.bigRock);
    const nextLarge = cycler(G.largeRock);
    const nextCliff = cycler(G.cliff);
    const notWater = (h) => h > WATER_Y + 0.8;
    for (let k = 0; k < BIG_ROCK_COUNT; k++) {
      const foot = k < BIG_ROCK_COUNT / 2;
      const p = findSpot(3.5, (x, z, h) => {
        if (!notWater(h) || clearingDist(x, z) < CLEARING.radius + 3 || distToPaths(x, z) < BIG_ROCK_PATH_CLEAR) return false;
        const d = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z) / MOUNTAIN.radius;
        return foot ? d > 0.85 && d < 1.5 : d > 1.5;
      }, 120);
      if (!p) continue;
      put(nextBig(), p[0], p[1], { rotY: rand() * 6.28, jitter: range(BIG_ROCK_SCALE), collider: SOLID_HULL, tag: 'bigrock' });
      reserve(p[0], p[1], 3.5);
    }
    for (let k = 0; k < LARGE_ROCK_COUNT; k++) {
      const p = findSpot(2.2, (x, z, h) => notWater(h) && clearingDist(x, z) > CLEARING.radius + 2 && distToPaths(x, z) > PATH_WIDTH / 2 + 2.5);
      if (!p) continue;
      put(nextLarge(), p[0], p[1], { rotY: rand() * 6.28, jitter: range(LARGE_ROCK_SCALE), collider: SOLID_HULL, tag: 'rock' });
      reserve(p[0], p[1], 2.2);
    }
    let made = 0;
    for (let attempt = 0; attempt < 2000 && made < OUTCROP_COUNT; attempt++) {
      const a = rand() * Math.PI * 2;
      const r = MOUNTAIN.radius * (OUTCROP_ZONE.min + rand() * (OUTCROP_ZONE.max - OUTCROP_ZONE.min));
      const cx = MOUNTAIN.x + Math.cos(a) * r;
      const cz = MOUNTAIN.z + Math.sin(a) * r;
      if (!inField(cx, cz, 8) || distToPaths(cx, cz) < OUTCROP_TRAIL_CLEAR + OUTCROP_RADIUS || !isFree(cx, cz, OUTCROP_RADIUS)) continue;
      const n = Math.floor(range(OUTCROP_PIECES));
      for (let i = 0; i < n; i++) {
        const ang = rand() * Math.PI * 2;
        const d = rand() * OUTCROP_RADIUS;
        const x = cx + Math.cos(ang) * d;
        const z = cz + Math.sin(ang) * d;
        put(nextCliff(), x, z, { rotY: rand() * 6.28, jitter: range(CLIFF_SCALE), baseY: heightAt(x, z) - CLIFF_SINK, collider: SOLID_BOX, tag: 'cliff' });
      }
      reserve(cx, cz, OUTCROP_RADIUS);
      made++;
    }
  }

  // ---- 6. Trees: pines on the mountain, broadleaf forest below, undergrowth, moss, stumps, logs ----
  const trees = [];
  {
    const nextBroad = cycler(G.broadleaf);
    const nextConifer = cycler(G.conifer);
    const pineSpot = (x, z, h) => h > 3 && h <= PINE_MAX_ALTITUDE && distToPaths(x, z) >= PINE_PATH_CLEAR && landHeight(x, z) > WATER_Y + 1.2;
    for (let k = 0; k < PINE_COUNT; k++) {
      const p = findSpot(PINE_SPACING / 2, pineSpot, 150);
      if (!p) continue;
      put(nextConifer(), p[0], p[1], { rotY: rand() * Math.PI * 2, jitter: range(TREE_SCALE), collider: { kind: 'trunk' }, tag: 'pine' });
      reserve(p[0], p[1], PINE_SPACING / 2);
    }
    const treeSpot = (x, z, h) => h >= WATER_Y + 1.2 && h <= TREE_MAX_ALTITUDE && x < field.maxX - 6 && distToPaths(x, z) >= TREE_PATH_CLEAR && clearingDist(x, z) > CLEARING.radius + TREE_CLEARING_GAP;
    for (let k = 0; k < TREE_COUNT; k++) {
      const p = findSpot(TREE_MIN_SPACING / 2, treeSpot, 80);
      if (!p) continue;
      const h = landHeight(p[0], p[1]);
      const pine = h > CONIFER_ALTITUDE || rand() < CONIFER_MIX;
      trees.push(put(pine ? nextConifer() : nextBroad(), p[0], p[1], { rotY: rand() * Math.PI * 2, jitter: range(TREE_SCALE), collider: { kind: 'trunk' }, tag: 'tree' }));
      reserve(p[0], p[1], TREE_MIN_SPACING / 2);
    }
    const allTrees = () => items.filter((i) => i.tag === 'tree' || i.tag === 'pine' || i.tag === 'palm');
    const farFromTrees = (x, z) => allTrees().every((t) => Math.hypot(t.x - x, t.z - z) > 1.4);
    const nextPlant = cycler(G.plant);
    const nextMush = cycler(G.mushroom);
    const nextFlower = cycler(G.flower);
    const nextGrass = cycler(G.grass);
    trees.forEach((t) => {
      if (rand() > UNDERGROWTH_SHARE) return;
      const a = rand() * Math.PI * 2;
      const d = 1.8 + rand() * 1.5;
      const x = t.x + Math.cos(a) * d;
      const z = t.z + Math.sin(a) * d;
      if (!farFromTrees(x, z) || distToPaths(x, z) < PATH_WIDTH / 2 + 1) return;
      const r = rand();
      const name = r < 0.25 ? nextMush() : r < 0.55 ? nextPlant() : r < 0.8 ? nextFlower() : nextGrass();
      put(name, x, z, { rotY: rand() * 6.28, jitter: range(SMALL_SCALE), tag: 'undergrowth' });
    });
    shuffle(trees.filter((t) => G.broadleaf.includes(t.name))).slice(0, MOSS_COUNT).forEach((t) => {
      put('hanging-moss', t.x + 0.4, t.z + 0.2, { baseY: t.y + (t.top - t.y) * 0.45, rotY: rand() * 6.28, jitter: 1.5, tag: 'moss' });
    });
    const woodSpot = (x, z, h) => h > WATER_Y + 1.2 && h < TREE_MAX_ALTITUDE && distToPaths(x, z) > PATH_WIDTH / 2 + 2.5 && clearingDist(x, z) > CLEARING.radius + 2;
    const nextStump = cycler(G.stump);
    for (let k = 0; k < STUMP_COUNT; k++) {
      const p = findSpot(1.2, woodSpot, 150);
      if (!p) continue;
      put(nextStump(), p[0], p[1], { rotY: rand() * 6.28, jitter: range({ min: 1, max: 1.5 }), collider: SOLID_HULL, tag: 'stump' });
      reserve(p[0], p[1], 1.2);
    }
    const nextLog = cycler(G.log);
    for (let k = 0; k < LOG_COUNT; k++) {
      const p = findSpot(1.8, woodSpot, 150);
      if (!p) continue;
      put(nextLog(), p[0], p[1], { rotY: rand() * 6.28, jitter: range({ min: 1, max: 1.4 }), tag: 'log' });
      reserve(p[0], p[1], 1.8);
    }
  }

  // ---- 7. Flower meadows (patches in the forest + the clearing) and small stones ----
  {
    const nextFlower = cycler(G.flower);
    const nextGrass = cycler(G.grass);
    const nextSmall = cycler(G.smallRock);
    const solids = items.filter((i) => i.tag === 'tree' || i.tag === 'pine' || i.tag === 'palm' || i.tag === 'bigrock' || i.tag === 'rock' || i.tag === 'cliff' || i.tag === 'stump');
    const clearOfSolids = (x, z) => solids.every((t) => Math.hypot(t.x - x, t.z - z) > 1.6);
    const patches = [];
    for (let k = 0; k < PATCH_COUNT * 6 && patches.length < PATCH_COUNT; k++) {
      const [x, z] = randomPoint();
      const h = landHeight(x, z);
      if (h < 0.2 || h > 9 || distToPaths(x, z) < PATH_WIDTH / 2 + 1.5 || clearingDist(x, z) < CLEARING.radius + 2) continue;
      if (patches.some((p) => Math.hypot(p[0] - x, p[1] - z) < PATCH_RADIUS * 1.2)) continue;
      patches.push([x, z]);
      const a = nextFlower();
      const b = nextFlower();
      const n = Math.floor(range(PATCH_SIZE));
      for (let i = 0; i < n; i++) {
        const ang = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * PATCH_RADIUS;
        const fx = x + Math.cos(ang) * d;
        const fz = z + Math.sin(ang) * d;
        if (!clearOfSolids(fx, fz) || distToPaths(fx, fz) < PATH_WIDTH / 2 + 0.8) continue;
        put(rand() < 0.25 ? nextGrass() : rand() < 0.5 ? a : b, fx, fz, { rotY: rand() * 6.28, jitter: range(SMALL_SCALE), tag: 'patch' });
      }
    }
    for (let k = 0; k < CLEARING_FLOWERS; k++) {
      const ang = rand() * Math.PI * 2;
      const d = CAMP_EXCLUSION + 1 + rand() * (CLEARING.radius + 2 - CAMP_EXCLUSION - 1);
      const x = CLEARING.x + Math.cos(ang) * d;
      const z = CLEARING.z + Math.sin(ang) * d;
      if (!inField(x, z, 2) || distToPaths(x, z) < PATH_WIDTH / 2 + 0.8) continue;
      put(rand() < 0.2 ? nextGrass() : nextFlower(), x, z, { rotY: rand() * 6.28, jitter: range(SMALL_SCALE), tag: 'clearing' });
    }
    for (let k = 0; k < SMALL_ROCK_COUNT; k++) {
      const [x, z] = randomPoint();
      if (landHeight(x, z) <= WATER_Y + 0.8 || distToPaths(x, z) < PATH_WIDTH / 2 + 1 || !clearOfSolids(x, z)) continue;
      put(nextSmall(), x, z, { rotY: rand() * 6.28, jitter: range(SMALL_ROCK_SCALE), tag: 'smallrock' });
    }
  }

  // ---- 8. Far forest: flat lowland between the terrain field and the backdrop mountains (pines toward the mountains) ----
  {
    const nextBroad = cycler(G.broadleaf);
    const nextConifer = cycler(G.conifer);
    const cell = FAR_TREE_SPACING;
    const grid = new Map(); // spatial hash: trees are at least FAR_TREE_SPACING apart, so only the 3x3 cells around a point matter
    const keyOf = (cx, cz) => cx * 100003 + cz;
    const isClear = (x, z) => {
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(keyOf(cx + dx, cz + dz));
          if (list && list.some((p) => Math.hypot(p[0] - x, p[1] - z) < FAR_TREE_SPACING)) return false;
        }
      }
      return true;
    };
    const { center, radius } = FAR_FOREST;
    let placedFar = 0;
    for (let attempt = 0; attempt < FAR_TREE_COUNT * FAR_TREE_ATTEMPTS && placedFar < FAR_TREE_COUNT; attempt++) {
      const r = Math.sqrt(rand()) * radius;
      const a = rand() * Math.PI * 2;
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      if (!inFarForest(x, z, field) || !isClear(x, z)) continue;
      const pine = rand() < FAR_PINE_BASE + FAR_PINE_GAIN * Math.min(1, Math.max(0, (r / radius - 0.35) / 0.6)); // more pines toward the mountains
      put(pine ? nextConifer() : nextBroad(), x, z, { rotY: rand() * Math.PI * 2, jitter: range(TREE_SCALE), baseY: LOWLAND_Y, collider: { kind: 'trunk' }, tag: 'far' });
      const k = keyOf(Math.floor(x / cell), Math.floor(z / cell));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push([x, z]);
      placedFar++;
    }
  }

  const byTag = {};
  items.forEach((it) => { byTag[it.tag] = (byTag[it.tag] ?? 0) + 1; });
  return { items, stats: { total: items.length, byTag, trees: trees.length, models: new Set(items.map((i) => i.name)).size } };
}

// ---- manual (hand-edited) layout ----
export const MANUAL_LAYOUT_VERSION = 1;
const ROUND_POS = 2;    // decimals of x / z in the manual file (1 cm)
const ROUND_ANGLE = 3;
const ROUND_SCALE = 3;

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Turn layout items into the JSON-friendly manual format. y is stored as `dy`, the offset from the terrain surface at (x, z),
 * so a manual layout still follows the hills when they are regenerated.
 * @return { version, items: [{ name, x, z, dy, rotY, scale, tag, collider }] }
 */
export function serializeLayout(items, heightAt) {
  return {
    version: MANUAL_LAYOUT_VERSION,
    items: items.map((it) => {
      const x = round(it.x, ROUND_POS);
      const z = round(it.z, ROUND_POS);
      const c = it.collider ? Object.fromEntries(Object.entries(it.collider).map(([k, v]) => [k, typeof v === 'number' ? round(v, 3) : v])) : null;
      return { name: it.name, x, z, dy: round(it.y - heightAt(x, z), 3), rotY: round(it.rotY, ROUND_ANGLE), scale: round(it.scale, ROUND_SCALE), tag: it.tag, collider: c };
    }),
  };
}

/**
 * Build the layout from a hand-edited file (same shape as `serializeLayout`). Optional per item: dy (default 0), rotY (0), scale (KIT_SCALE),
 * tag ('prop'), collider (null = none; see the collider kinds in nature_kit.js). Throws on unknown models or non-numeric values.
 * @return { items, stats } like `buildNatureLayout`
 */
export function layoutFromManual(data, { manifest, heightAt }) {
  if (!data || !Array.isArray(data.items)) throw new Error('manual layout: expected { items: [...] }');
  if (data.version !== undefined && data.version !== MANUAL_LAYOUT_VERSION) throw new Error(`manual layout: unsupported version ${data.version}`);
  const info = new Map(manifest.map((m) => [m.name, m]));
  const items = data.items.map((raw, i) => {
    const m = info.get(raw.name);
    if (!m) throw new Error(`manual layout: item ${i} has unknown model "${raw.name}"`);
    const { x, z, dy = 0, rotY = 0, scale = KIT_SCALE, tag = 'prop', collider = null } = raw;
    [x, z, dy, rotY, scale].forEach((v) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`manual layout: item ${i} (${raw.name}) has a non-numeric value`); });
    const y = heightAt(x, z) + dy;
    return { name: raw.name, x, y, z, rotY, scale, collider, tag, top: y + m.max[1] * scale };
  });
  const byTag = {};
  items.forEach((it) => { byTag[it.tag] = (byTag[it.tag] ?? 0) + 1; });
  return { items, stats: { total: items.length, byTag, trees: byTag.tree ?? 0, models: new Set(items.map((i) => i.name)).size } };
}
