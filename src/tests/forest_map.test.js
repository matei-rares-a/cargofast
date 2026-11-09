import { describe, test, expect } from 'vitest';
import {
  CORRIDORS, ENTRANCE, CLEARING, BEACH, MOUNTAIN, SUMMIT, TRAIL_LENGTH, WATER_Y, BASIN, PATH_WIDTH, TRAIL_WIDTH,
  mountainHeight, basinHeight, distToPaths, landHeight, nearestOnCorridor,
} from '../objects/forest_map';

const FIELD = { minX: -180, maxX: -20, minZ: -80, maxZ: 80 };
const corridor = (name) => CORRIDORS.find((c) => c.name === name);
const first = (c) => c.pts[0];
const last = (c) => c.pts[c.pts.length - 1];
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

describe('forest paths: one winding path with three exits', () => {
  const main = corridor('main');

  test('starts at the ground edge (the entrance) and ends on the beach', () => {
    expect(dist(first(main), ENTRANCE)).toBeLessThan(0.5);
    expect(dist(last(main), BEACH)).toBeLessThan(0.5);
  });

  test('is winding: much longer than the straight line, and changes direction both ways', () => {
    const length = main.pts.reduce((s, p, i) => (i ? s + dist(p, main.pts[i - 1]) : 0), 0);
    expect(length).toBeGreaterThan(dist(first(main), last(main)) * 1.05);
    const heading = main.pts.slice(1).map((p, i) => Math.atan2(p.z - main.pts[i].z, p.x - main.pts[i].x));
    const turns = heading.slice(1).map((h, i) => Math.atan2(Math.sin(h - heading[i]), Math.cos(h - heading[i])));
    expect(turns.some((t) => t > 0.02)).toBe(true);
    expect(turns.some((t) => t < -0.02)).toBe(true);
  });

  test('exit 1: a branch from the main path ends in the middle of the clearing', () => {
    const b = corridor('clearing');
    expect(nearestOnCorridor(main, first(b).x, first(b).z).dist).toBeLessThan(0.5);
    expect(dist(last(b), CLEARING)).toBeLessThan(0.5);
  });

  test('exit 2: the main path itself continues to the sea', () => {
    expect(last(main).x).toBeLessThan(BASIN.startX);
    expect(last(main).y).toBeLessThan(0);
    expect(last(main).y).toBeGreaterThan(WATER_Y - 0.3);
  });

  test('exit 3: a branch leaves the main path and joins the foot of the mountain trail', () => {
    const access = corridor('access');
    const trail = corridor('trail');
    expect(nearestOnCorridor(main, first(access).x, first(access).z).dist).toBeLessThan(0.5);
    expect(dist(last(access), first(trail))).toBeLessThan(0.5);
  });

  test('the three exits are far apart (different directions)', () => {
    const ends = [last(corridor('clearing')), last(main), first(corridor('trail'))];
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(dist(ends[i], ends[j])).toBeGreaterThan(40);
  });

  test('everything stays inside the field', () => {
    CORRIDORS.forEach((c) => c.pts.forEach((p) => {
      expect(p.x).toBeGreaterThan(FIELD.minX + 5);
      expect(p.x).toBeLessThanOrEqual(FIELD.maxX);
      expect(p.z).toBeGreaterThan(FIELD.minZ + 5);
      expect(p.z).toBeLessThan(FIELD.maxZ - 5);
    }));
    expect(CLEARING.z + CLEARING.radius + CLEARING.feather).toBeLessThan(FIELD.maxZ);
  });

  test('path widths: forest paths 5 m, mountain trail narrower', () => {
    expect(main.halfWidth * 2).toBe(PATH_WIDTH);
    expect(corridor('trail').halfWidth * 2).toBe(TRAIL_WIDTH);
  });
});

describe('mountain trail to the summit', () => {
  const trail = corridor('trail');

  test('starts on the flat ground at the foot and ends at the summit', () => {
    expect(first(trail).y).toBeCloseTo(0, 5);
    expect(dist(last(trail), SUMMIT)).toBeLessThan(0.5);
    expect(last(trail).y).toBeCloseTo(MOUNTAIN.height, 1);
  });

  test('never descends and never exceeds a driveable gradient', () => {
    for (let i = 1; i < trail.pts.length; i++) {
      const rise = trail.pts[i].y - trail.pts[i - 1].y;
      const run = dist(trail.pts[i], trail.pts[i - 1]);
      expect(rise).toBeGreaterThanOrEqual(-1e-9);
      expect(rise / run).toBeLessThanOrEqual(0.14);
    }
  });

  test('is a spiral around the mountain: long, and it circles it', () => {
    expect(TRAIL_LENGTH).toBeGreaterThan(MOUNTAIN.height / 0.14);
    expect(TRAIL_LENGTH).toBeLessThan(500);
    let turned = 0;
    for (let i = 1; i < trail.pts.length; i++) {
      const a0 = Math.atan2(trail.pts[i - 1].z - MOUNTAIN.z, trail.pts[i - 1].x - MOUNTAIN.x);
      const a1 = Math.atan2(trail.pts[i].z - MOUNTAIN.z, trail.pts[i].x - MOUNTAIN.x);
      turned += Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
    }
    expect(Math.abs(turned)).toBeGreaterThan(Math.PI * 2); // more than one full turn
  });

  test('stays on the mountain surface (no cutting into the flank)', () => {
    trail.pts.forEach((p) => expect(p.y).toBeCloseTo(mountainHeight(p.x, p.z), 5));
  });
});

describe('height helpers', () => {
  test('mountain: flat summit, smooth foot, symmetric', () => {
    expect(mountainHeight(MOUNTAIN.x, MOUNTAIN.z)).toBeCloseTo(MOUNTAIN.height, 5);
    expect(mountainHeight(MOUNTAIN.x + MOUNTAIN.radius, MOUNTAIN.z)).toBe(0);
    expect(mountainHeight(MOUNTAIN.x + 20, MOUNTAIN.z)).toBeCloseTo(mountainHeight(MOUNTAIN.x, MOUNTAIN.z - 20), 8);
  });

  test('basin: land on the east, below the water at the west edge', () => {
    expect(basinHeight(BASIN.startX + 1)).toBeCloseTo(0, 8);
    expect(basinHeight(-180)).toBeLessThan(WATER_Y - 1);
  });

  test('distToPaths: zero on a centerline, grows away from it, and landHeight is deterministic', () => {
    const p = CORRIDORS[0].pts[10];
    expect(distToPaths(p.x, p.z)).toBeLessThan(1e-6);
    expect(distToPaths(p.x, p.z + 30)).toBeGreaterThan(1);
    expect(landHeight(-100.5, 20.5)).toBe(landHeight(-100.5, 20.5));
  });
});
