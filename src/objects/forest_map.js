import { smoothstep } from './noise';

// *** FOREST MAP SETTINGS ***
// Pure geometry of the western world (no three.js / Rapier): winding forest path with 3 exits
// (clearing, sea, mountain), the mountain with a spiral trail to the summit, the sea basin.
// All values are world units (x, z on the ground plane, y up). The grass field spans x -180..-20, z -80..80.
export const PATH_WIDTH        = 8;     // forest path width
export const TRAIL_WIDTH       = 8;     // mountain trail width (a drift off the ledge is easy to correct)
export const PATH_SHOULDER     = 7;     // terrain blends back to natural over this distance beside a path
export const TRAIL_SHOULDER    = 8;     // wider on the mountain: a gentler embankment on the downhill side
const SAMPLE_STEP              = 2;     // meters between sampled path points

export const ENTRANCE          = { x: -20, z: 0 };                                       // where the path meets the ground
export const CLEARING          = { x: -62, z: 50, radius: 15, feather: 10 };             // clearing (poiana) with the camp
export const BEACH             = { x: -160, z: 9 };                                      // end of the sea branch
export const WATER_Y           = -1.2;  // sea surface
export const SEABED_Y          = -4;    // solid floor under the open sea (the car can wade in)
export const SEA_EDGE_X        = -176;  // west of this the far land ends and the open sea begins
export const BASIN             = { startX: -148, length: 32, depth: 3.6 };               // terrain falls below water west of startX
export const MOUNTAIN          = { x: -110, z: -40, radius: 34, height: 26 };            // smooth cone with a flat summit
const TRAIL_MAX_SLOPE          = 0.12;  // rise per meter of trail (about 6.8 degrees)
const TRAIL_TOP_RADIUS         = 1.5;   // the spiral ends this far from the summit center
const SUMMIT_PLATEAU           = 0.15;  // share of the radius that is perfectly flat on top (the viewpoint)
const TRAIL_INWARD_MAX         = 0.6;   // max share of each meter spent moving toward the summit (flat parts)
const TRAIL_STEP               = 1;     // meters between trail points
const TRAIL_SUBSTEPS           = 8;     // integration steps per trail point
const TRAIL_DIRECTION          = 1;     // 1 = counter-clockwise seen from above (x right, z down), -1 = clockwise

// Hand-placed centerline waypoints of the forest paths (smoothed with a Catmull-Rom spline).
const MAIN_WAYPOINTS = [
  [-20, 0], [-30, 3], [-42, -4], [-54, 1], [-64, 9], [-76, 5], [-88, -1], [-98, -2], [-108, 6], [-118, 13], [-130, 10], [-142, 16], [-152, 12], [-160, 9],
];
const CLEARING_WAYPOINTS = [[-64, 9], [-62, 20], [-57, 31], [-58, 41], [-62, 50]];
const ACCESS_JUNCTION    = [-98, -2];  // where the mountain branch leaves the main path (a point of MAIN_WAYPOINTS)

/** Share of the way from the summit plateau edge (0) to the foot (1). */
const flank = (r) => Math.min(1, Math.max(0, (r / MOUNTAIN.radius - SUMMIT_PLATEAU) / (1 - SUMMIT_PLATEAU)));

/** Summit height profile: flat top, steep flanks, flat foot. */
export function mountainHeight(x, z) {
  return MOUNTAIN.height * (1 - smoothstep(0, 1, flank(Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z))));
}

/** Steepness |dh/dr| of the mountain at distance r from its center. */
function mountainSlope(r) {
  const u = flank(r);
  return u <= 0 || u >= 1 ? 0 : (MOUNTAIN.height * 6 * u * (1 - u)) / (MOUNTAIN.radius * (1 - SUMMIT_PLATEAU));
}
/** Terrain drop toward the sea (negative below the base level). */
export function basinHeight(x) {
  const u = Math.min(1, Math.max(0, (BASIN.startX - x) / BASIN.length));
  return -BASIN.depth * smoothstep(0, 1, u);
}

/** Catmull-Rom spline through the waypoints, resampled every `step` meters. */
function smoothPolyline(waypoints, step) {
  const p = [waypoints[0], ...waypoints, waypoints[waypoints.length - 1]];
  const dense = [];
  for (let i = 1; i < p.length - 2; i++) {
    for (let k = 0; k < 24; k++) {
      const t = k / 24;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      dense.push({ x: c(p[i - 1][0], p[i][0], p[i + 1][0], p[i + 2][0]), z: c(p[i - 1][1], p[i][1], p[i + 1][1], p[i + 2][1]) });
    }
  }
  const last = waypoints[waypoints.length - 1];
  dense.push({ x: last[0], z: last[1] });
  const out = [dense[0]];
  let acc = 0;
  for (let i = 1; i < dense.length; i++) {
    acc += Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z);
    if (acc >= step) { out.push(dense[i]); acc = 0; }
  }
  if (out[out.length - 1] !== dense[dense.length - 1]) out.push(dense[dense.length - 1]);
  return out;
}

/** Spiral trail on the mountain flank: gradient never exceeds TRAIL_MAX_SLOPE; ends near the summit. */
function buildTrail() {
  const [jx, jz] = ACCESS_JUNCTION;
  const startAngle = Math.atan2(jz - MOUNTAIN.z, jx - MOUNTAIN.x);
  let r = MOUNTAIN.radius;
  let a = startAngle;
  const pts = [];
  for (let i = 0; i < 4000 && r > TRAIL_TOP_RADIUS; i++) {
    const x = MOUNTAIN.x + Math.cos(a) * r;
    const z = MOUNTAIN.z + Math.sin(a) * r;
    pts.push({ x, z, y: mountainHeight(x, z) });
    for (let k = 0; k < TRAIL_SUBSTEPS && r > TRAIL_TOP_RADIUS; k++) { // fine steps keep the real gradient at the limit even on curved flanks
      const g = mountainSlope(r);
      const inward = Math.min(TRAIL_INWARD_MAX, g > 1e-6 ? TRAIL_MAX_SLOPE / g : TRAIL_INWARD_MAX);
      const ds = TRAIL_STEP / TRAIL_SUBSTEPS;
      r -= inward * ds;
      a += (TRAIL_DIRECTION * Math.sqrt(1 - inward * inward) * ds) / r;
    }
  }  pts.push({ x: MOUNTAIN.x, z: MOUNTAIN.z, y: mountainHeight(MOUNTAIN.x, MOUNTAIN.z) }); // summit center
  return pts;
}

const withY = (pts, yFn) => pts.map((p) => ({ x: p.x, z: p.z, y: yFn(p.x, p.z) }));
const startOfTrail = () => {
  const a = Math.atan2(ACCESS_JUNCTION[1] - MOUNTAIN.z, ACCESS_JUNCTION[0] - MOUNTAIN.x);
  return [MOUNTAIN.x + Math.cos(a) * MOUNTAIN.radius, MOUNTAIN.z + Math.sin(a) * MOUNTAIN.radius];
};

const TRAIL_POINTS = buildTrail();
export const TRAIL_LENGTH = TRAIL_POINTS.reduce((s, p, i) => (i ? s + Math.hypot(p.x - TRAIL_POINTS[i - 1].x, p.z - TRAIL_POINTS[i - 1].z) : 0), 0);
export const SUMMIT = { x: MOUNTAIN.x, z: MOUNTAIN.z, y: mountainHeight(MOUNTAIN.x, MOUNTAIN.z) };

/** Every path as a polyline of { x, z, y } plus its width. kind: 'path' (forest) or 'trail' (mountain). */
export const CORRIDORS = [
  { name: 'main', kind: 'path', halfWidth: PATH_WIDTH / 2, shoulder: PATH_SHOULDER, pts: withY(smoothPolyline(MAIN_WAYPOINTS, SAMPLE_STEP), (x) => basinHeight(x)) },
  { name: 'clearing', kind: 'path', halfWidth: PATH_WIDTH / 2, shoulder: PATH_SHOULDER, pts: withY(smoothPolyline(CLEARING_WAYPOINTS, SAMPLE_STEP), () => 0) },
  { name: 'access', kind: 'path', halfWidth: PATH_WIDTH / 2, shoulder: PATH_SHOULDER, pts: withY(smoothPolyline([ACCESS_JUNCTION, startOfTrail()], SAMPLE_STEP), () => 0) },
  { name: 'trail', kind: 'trail', halfWidth: TRAIL_WIDTH / 2, shoulder: TRAIL_SHOULDER, pts: TRAIL_POINTS },
];

// bounding boxes (with reach) for quick rejection
CORRIDORS.forEach((c) => {
  const reach = c.halfWidth + c.shoulder;
  c.bbox = {
    minX: Math.min(...c.pts.map((p) => p.x)) - reach, maxX: Math.max(...c.pts.map((p) => p.x)) + reach,
    minZ: Math.min(...c.pts.map((p) => p.z)) - reach, maxZ: Math.max(...c.pts.map((p) => p.z)) + reach,
  };
});

/** Closest point of a corridor centerline: { dist, y }. */
export function nearestOnCorridor(c, x, z) {
  let best = Infinity;
  let by = 0;
  for (let i = 1; i < c.pts.length; i++) {
    const a = c.pts[i - 1];
    const b = c.pts[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
    const d2 = (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2;
    if (d2 < best) { best = d2; by = a.y + (b.y - a.y) * t; }
  }
  return { dist: Math.sqrt(best), y: by };
}

/** Smallest distance from (x, z) to any path or trail centerline. */
export function distToPaths(x, z) {
  let best = Infinity;
  for (const c of CORRIDORS) {
    const b = c.bbox;
    if (x < b.minX - 50 || x > b.maxX + 50 || z < b.minZ - 50 || z > b.maxZ + 50) continue;
    best = Math.min(best, nearestOnCorridor(c, x, z).dist);
  }
  return best;
}

/** Lay the paths and the clearing into the natural terrain: flat strip + blended shoulders. */
export function carvePaths(natural, x, z) {
  let h = natural;
  for (const c of CORRIDORS) {
    const b = c.bbox;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    const n = nearestOnCorridor(c, x, z);
    const reach = c.halfWidth + c.shoulder;
    if (n.dist >= reach) continue;
    h += (n.y - h) * (1 - smoothstep(c.halfWidth, reach, n.dist));
  }
  const dc = Math.hypot(x - CLEARING.x, z - CLEARING.z);
  if (dc < CLEARING.radius + CLEARING.feather) h += (0 - h) * (1 - smoothstep(CLEARING.radius, CLEARING.radius + CLEARING.feather, dc));
  return h;
}

/** Terrain height without the random meadow hills: what the layout uses for decisions (so hills never change what is placed where). */
export function landHeight(x, z) {
  return carvePaths(mountainHeight(x, z) + basinHeight(x), x, z);
}

/** Top of the flat lowland (far land) around the terrain field: exactly the field's base level, so the field edges (hills ramp to 0 there) meet it without a step. */
export const LOWLAND_Y = 0;

/**
 * Far forest: trees on the flat lowland from the terrain field out to the backdrop mountains (which start at radius 260 from the same center, scenery.js).
 * Kept free: the terrain field (+ margin), the meadow around the start ground and the entrance, and the sea side.
 */
export const FAR_FOREST = {
  center: { x: -60, z: 0 },
  radius: 240,
  fieldMargin: 4,
  meadow: { minX: -30, maxX: 50, minZ: -50, maxZ: 50 },
  seaMargin: 6,
};

/** True when a far-forest tree may stand at (x, z); `field` = { minX, maxX, minZ, maxZ } of the terrain field. */
export function inFarForest(x, z, field) {
  const f = FAR_FOREST;
  if (Math.hypot(x - f.center.x, z - f.center.z) > f.radius) return false;
  if (x < SEA_EDGE_X + f.seaMargin) return false;
  const m = f.fieldMargin;
  if (x > field.minX - m && x < field.maxX + m && z > field.minZ - m && z < field.maxZ + m) return false;
  const g = f.meadow;
  return !(x > g.minX && x < g.maxX && z > g.minZ && z < g.maxZ);
}
