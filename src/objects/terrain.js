import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createValueNoise, fbm, smoothstep } from './noise';
import { BASIN, MOUNTAIN, WATER_Y, basinHeight, mountainHeight, bluffHeight, carvePaths } from './forest_map';

// *** TERRAIN SETTINGS ***
// Field base level is y = FIELD_CENTER.y. Center x = -60 with size 240 makes the field span x -180..60, so it covers the start ground and the oval meadow east of the old edge (x = -20).
export const FIELD_CENTER    = { x: -60, y: 0, z: 0 };
export const FIELD_SIZE      = { x: 240, z: 160 };
const FIELD_CELL             = 1;         // world units per terrain grid cell (smaller = smoother, heavier)
const FIELD_FRICTION         = 0.5;
const FIELD_ROUGHNESS        = 1.0;

// Procedural meadow hills (fade to zero at the ground edge and into the sea basin; paths flatten them)
const HILL_AMPLITUDE         = 2.5;       // max hill height (world units); 0 = flat
const HILL_WAVELENGTH        = 45;        // world units between hill centers; smaller = more, narrower hills
const HILL_ORIGIN            = { x: -100, z: 0 }; // where the hill noise starts (the old field center): keeps the existing hills in place
const HILL_OCTAVES           = 3;         // noise layers; more = bumpier detail
const HILL_SEED              = 21;
const HILL_NOISE_MIN         = 0.5;       // noise below this stays flat (raise for fewer hills)
const HILL_NOISE_MAX         = 0.72;      // noise above this reaches full amplitude
const HILL_FLAT_MARGIN       = 20;        // world units from the ground edge where hills ramp up from 0
const HILL_AMPLITUDE_GUI_MAX = 8;
const HILL_WAVELENGTH_GUI    = { min: 15, max: 120 };
const HILL_SEED_GUI_MAX      = 999;

// Ground colors (per vertex): forest floor patches, rock on steep/high ground, sand on the beach
const COLOR_FLOOR_DARK       = new THREE.Color(0x3a6f2c);
const COLOR_FLOOR_LIGHT      = new THREE.Color(0x5f9a3e);
const COLOR_ROCK             = new THREE.Color(0x8d8a82);
const COLOR_ROCK_HIGH        = new THREE.Color(0xb4b2ab);
const COLOR_SAND             = new THREE.Color(0xe3d09b);
const COLOR_SEABED           = new THREE.Color(0xb7ab80);
const COLOR_NOISE_SCALE      = 6;         // world units per color blotch
const ROCK_SLOPE_START       = 0.88;      // normal.y below this starts to turn rocky (1 = flat)
const ROCK_SLOPE_FULL        = 0.7;       // normal.y below this is full rock
const ROCK_HIGH_START        = 0.6;       // share of the mountain height where rock gets lighter
const SAND_UPPER             = 0.6;       // sand starts to appear below this height above the base level
const SAND_FROM_X            = BASIN.startX + 8;

const FLOOR_NOISE = createValueNoise(7);

/** Forest floor color at a world position (patchy dark / light green). Shared with the far land texture, so the two meet without a visible seam. */
export function forestFloorColor(wx, wz, target = new THREE.Color()) {
  return target.copy(COLOR_FLOOR_DARK).lerp(COLOR_FLOOR_LIGHT, FLOOR_NOISE(wx / COLOR_NOISE_SCALE, wz / COLOR_NOISE_SCALE));
}

export class Terrain {
  constructor(scene, world, gui) {
    this.world = world;
    this.listeners = [];
    this.settings = {
      hillAmplitude: HILL_AMPLITUDE,
      hillWavelength: HILL_WAVELENGTH,
      hillSeed:      HILL_SEED,
    };
    this.cols = Math.round(FIELD_SIZE.x / FIELD_CELL);
    this.rows = Math.round(FIELD_SIZE.z / FIELD_CELL);
    this.seamX = FIELD_CENTER.x + FIELD_SIZE.x / 2; // world x where the field meets the ground
    this.bounds = { minX: FIELD_CENTER.x - FIELD_SIZE.x / 2, maxX: this.seamX, minZ: FIELD_CENTER.z - FIELD_SIZE.z / 2, maxZ: FIELD_CENTER.z + FIELD_SIZE.z / 2 }; // world rectangle
    this._noise = createValueNoise(this.settings.hillSeed);

    this.ground   = this._createGround(scene);
    this.body     = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(FIELD_CENTER.x, FIELD_CENTER.y, FIELD_CENTER.z));
    this.collider = null;
    this.rebuild();

    const h = gui.addFolder('Hills');
    h.add(this.settings, 'hillAmplitude', 0, HILL_AMPLITUDE_GUI_MAX, 0.1).name('Height').onFinishChange(() => this.rebuild());
    h.add(this.settings, 'hillWavelength', HILL_WAVELENGTH_GUI.min, HILL_WAVELENGTH_GUI.max, 1).name('Wavelength').onFinishChange(() => this.rebuild());
    h.add(this.settings, 'hillSeed', 0, HILL_SEED_GUI_MAX, 1).name('Seed').onFinishChange(() => this.rebuild());
  }

  /** Register a callback fired after the terrain was regenerated (trees etc. re-snap to the ground). */
  onRebuild(fn) { this.listeners.push(fn); }

  /** Meadow hills only (no mountain, sea or paths). */
  hills(lx, lz) {
    const { hillAmplitude, hillWavelength } = this.settings;
    if (hillAmplitude <= 0) return 0;
    const wx = FIELD_CENTER.x + lx;
    // Noise is sampled from a fixed origin, so moving the field center does not reshuffle the hills that already exist
    const n = fbm(this._noise, (wx - HILL_ORIGIN.x) / hillWavelength, (FIELD_CENTER.z + lz - HILL_ORIGIN.z) / hillWavelength, HILL_OCTAVES);
    const hill = smoothstep(HILL_NOISE_MIN, HILL_NOISE_MAX, n);
    const edgeRamp = smoothstep(0, HILL_FLAT_MARGIN, this.seamX - wx) * smoothstep(0, HILL_FLAT_MARGIN, FIELD_SIZE.z / 2 - Math.abs(lz)); // flat at the ground edge and at the north / south edges (they meet the lowland)
    const basinFade = 1 + basinHeight(wx) / BASIN.depth; // 1 on land, 0 at the bottom of the sea basin
    const mountainFade = 1 - mountainHeight(wx, FIELD_CENTER.z + lz) / MOUNTAIN.height; // flat summit
    return hillAmplitude * hill * edgeRamp * basinFade * mountainFade;
  }

  /** Terrain height above FIELD_CENTER.y at a point given relative to the field center. */
  relHeight(lx, lz) {
    const wx = FIELD_CENTER.x + lx;
    const wz = FIELD_CENTER.z + lz;
    return carvePaths(this.hills(lx, lz) + mountainHeight(wx, wz) + basinHeight(wx) + bluffHeight(wx, wz), wx, wz);
  }

  /** World-space terrain surface height (y) at world x, z. */
  heightAt(x, z) {
    return FIELD_CENTER.y + this.relHeight(x - FIELD_CENTER.x, z - FIELD_CENTER.z);
  }

  /** Regenerate: visual mesh and collider from the current settings. */
  rebuild() {
    this._noise = createValueNoise(this.settings.hillSeed);
    this._updateGroundMesh();
    this._replaceCollider();
    this.listeners.forEach((fn) => fn());
  }

  _createGround(scene) {
    const geo = new THREE.PlaneGeometry(FIELD_SIZE.x, FIELD_SIZE.z, this.cols, this.rows);
    geo.rotateX(-Math.PI / 2); // bake: plane now lies in XZ, y is up
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.0, roughness: FIELD_ROUGHNESS }));
    mesh.position.set(FIELD_CENTER.x, FIELD_CENTER.y, FIELD_CENTER.z);
    mesh.receiveShadow = true;
    mesh.name = 'Terrain';
    scene.add(mesh);
    return mesh;
  }

  _updateGroundMesh() {
    const geo = this.ground.geometry;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.relHeight(pos.getX(i), pos.getZ(i)));
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    this._paint(geo);
  }

  /** Vertex colors: patchy forest floor, rock on steep or high ground, sand on the beach. */
  _paint(geo) {
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const col = geo.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const wx = FIELD_CENTER.x + pos.getX(i);
      const wz = FIELD_CENTER.z + pos.getZ(i);
      const h = pos.getY(i);
      forestFloorColor(wx, wz, c);
      const rock = 1 - smoothstep(ROCK_SLOPE_FULL, ROCK_SLOPE_START, nor.getY(i));
      const high = smoothstep(MOUNTAIN.height * ROCK_HIGH_START, MOUNTAIN.height, h);
      c.lerp(COLOR_ROCK, Math.max(rock, high * 0.6)).lerp(COLOR_ROCK_HIGH, high * 0.5);
      const sand = (1 - smoothstep(0, SAND_UPPER, h)) * smoothstep(SAND_FROM_X, SAND_FROM_X - 6, wx);
      c.lerp(COLOR_SAND, sand);
      if (h < WATER_Y) c.lerp(COLOR_SEABED, smoothstep(WATER_Y, WATER_Y - 1.5, h) * 0.6);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  _replaceCollider() {
    if (this.collider) this.world.removeCollider(this.collider, true);
    // Rapier heightfield: (rows+1) x (cols+1) samples, column-major, rows along z, columns along x; centered on the body.
    const heights = new Float32Array((this.rows + 1) * (this.cols + 1));
    for (let col = 0; col <= this.cols; col++) {
      for (let row = 0; row <= this.rows; row++) {
        const lx = -FIELD_SIZE.x / 2 + col * FIELD_CELL;
        const lz = -FIELD_SIZE.z / 2 + row * FIELD_CELL;
        heights[row + col * (this.rows + 1)] = this.relHeight(lx, lz);
      }
    }
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.heightfield(this.rows, this.cols, heights, { x: FIELD_SIZE.x, y: 1, z: FIELD_SIZE.z }).setFriction(FIELD_FRICTION),
      this.body
    );
  }
}
