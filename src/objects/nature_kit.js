import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildNatureLayout } from './nature_layout';

// *** NATURE KIT SETTINGS ***
// Kenney Nature Kit (CC0, https://kenney.nl/assets/nature-kit): the models used by nature_layout.js, instanced, with colliders for the solid ones.
const NATURE_BASE_URL    = 'nature/';  // relative to the page; files live in src/static/nature/
const MATERIAL_ROUGHNESS = 0.9;
const MATERIAL_METALNESS = 0.0;        // the kit exports metalness 1, which renders almost black without an environment map
// Kenney's own colors are very light pastels (grass #73eddd). NATURAL_PALETTE re-colors them by material name to match the rest of the game;
// materials missing here keep the original color. Switch in the GUI (Nature Kit > Palette).
const NATURAL_PALETTE = {
  grass: 0x55a63b, dirt: 0xb08358, dirtDark: 0x8a6140, stone: 0xb9bec2, stoneDark: 0x8c9296,
  leafsDark: 0x2f7d3a, leafsGreen: 0x3f9e44, leafsFall: 0xd98a2b,
  woodBark: 0x7a5535, woodBarkDark: 0x5f402a, wood: 0xa9794a, woodBirch: 0xe8e1d0, woodDark: 0x6d4c33, woodInner: 0xd9c29a,
  water: 0x4aa8e0, corn: 0xe3c45a,
  colorRed: 0xc84b4b, colorRedDark: 0x9b3535, colorPurple: 0x8a6bc9, colorWhite: 0xf2f2f2, colorYellow: 0xe8c040, colorTan: 0xcdb48a,
};
const PALETTES            = ['natural', 'original'];
const DEFAULT_PALETTE     = 'natural';
const NATURE_VISIBLE     = true;
const BRIGHTNESS         = { natural: 1.0, original: 0.65 }; // color multiplier per palette; the pastel original blows out under the strong sun
const BRIGHTNESS_GUI_MAX = 1.5;
const CAST_SHADOWS       = false;
const HULL_PRECISION     = 1000;       // convex hull points are de-duplicated at 1/HULL_PRECISION model units

/** Default model loader: returns the glTF scene of one kit model. */
function createDefaultLoader() {
  const loader = new GLTFLoader();
  return async (name) => (await loader.loadAsync(`${NATURE_BASE_URL}${name}.glb`)).scene;
}

/** Merge every mesh of a model into one geometry with baked vertex colors (so a model = one draw call). */
function bakeModel(root) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const attr of Object.keys(g.attributes)) if (attr !== 'position' && attr !== 'normal') g.deleteAttribute(attr);
    const n = g.attributes.position.count;
    const original = new Float32Array(n * 3);
    const natural = new Float32Array(n * 3);
    const nat = NATURAL_PALETTE[o.material.name] !== undefined ? new THREE.Color(NATURAL_PALETTE[o.material.name]) : o.material.color;
    for (let i = 0; i < n; i++) {
      original.set([o.material.color.r, o.material.color.g, o.material.color.b], i * 3);
      natural.set([nat.r, nat.g, nat.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(natural.slice(), 3));
    g.userData.palettes = { original, natural };
    parts.push(g);
  });
  const geometry = mergeGeometries(parts, false);
  geometry.userData.palettes = {
    original: Float32Array.from(parts.flatMap((p) => [...p.userData.palettes.original])),
    natural: Float32Array.from(parts.flatMap((p) => [...p.userData.palettes.natural])),
  };
  geometry.computeBoundingSphere();
  return geometry;
}

/** Unique vertex positions of a geometry (for convex hull colliders). */
function uniquePoints(geometry) {
  const pos = geometry.attributes.position;
  const seen = new Set();
  const out = [];
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * HULL_PRECISION)},${Math.round(pos.getY(i) * HULL_PRECISION)},${Math.round(pos.getZ(i) * HULL_PRECISION)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  return out;
}

export class NatureKit {
  /**
   * @param scene  three.js scene
   * @param world  Rapier world
   * @param gui    lil-gui root
   * @param terrain Terrain (height, bounds + rebuild notifications)
   * @param opts   optional { manifest, loadModel } to bypass fetch/GLTF (tests)
   */
  constructor(scene, world, gui, terrain, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.terrain = terrain;
    this.opts = opts;
    this.group = new THREE.Group();
    this.group.name = 'Nature Kit';
    this.group.visible = NATURE_VISIBLE;
    scene.add(this.group);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.colliders = [];
    this.meshes = new Map();   // model name -> InstancedMesh
    this.slots = new Map();    // model name -> item list, same order as instances
    this.hulls = new Map();    // model name -> unique local points
    this.items = [];
    this.stats = null;
    this.ready = null;

    this.settings = { visible: NATURE_VISIBLE, palette: DEFAULT_PALETTE, brightness: BRIGHTNESS[DEFAULT_PALETTE] };
    const f = gui.addFolder('Nature Kit');
    f.add(this.settings, 'visible').name('Show Models').onChange((v) => { this.group.visible = v; });
    this.brightnessCtrl = f.add(this.settings, 'brightness', 0.1, BRIGHTNESS_GUI_MAX, 0.05).name('Brightness').onChange((v) => this.material?.color.setScalar(v));
    f.add(this.settings, 'palette', PALETTES).name('Palette').onChange((v) => this.setPalette(v));
    terrain.onRebuild(() => { if (this.items.length) this.rebuild(); });
  }

  /** Switch between the natural and the original Kenney colors (also resets brightness to that palette's default). */
  setPalette(kind) {
    this.settings.palette = kind;
    this.meshes.forEach((mesh) => {
      const attr = mesh.geometry.attributes.color;
      attr.array.set(mesh.geometry.userData.palettes[kind]);
      attr.needsUpdate = true;
    });
    this.settings.brightness = BRIGHTNESS[kind];
    this.material?.color.setScalar(BRIGHTNESS[kind]);
    this.brightnessCtrl?.updateDisplay?.();
  }

  /** Load data and models, then place everything. Resolves when the scene is complete. */
  load() {
    this.ready ??= this._load();
    return this.ready;
  }

  async _load() {
    this.manifest = this.opts.manifest ?? (await (await fetch(`${NATURE_BASE_URL}manifest.json`)).json());
    this.info = new Map(this.manifest.map((m) => [m.name, m]));
    this.loadModel = this.opts.loadModel ?? createDefaultLoader();

    const layout = this._layout();
    const names = [...new Set(layout.items.map((i) => i.name))];
    const geometries = await Promise.all(names.map(async (n) => bakeModel(await this.loadModel(n))));
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: MATERIAL_ROUGHNESS, metalness: MATERIAL_METALNESS });
    material.color.setScalar(this.settings.brightness);
    this.material = material;
    names.forEach((n, k) => {
      const count = layout.items.filter((i) => i.name === n).length;
      const mesh = new THREE.InstancedMesh(geometries[k], material, count);
      mesh.name = n;
      mesh.castShadow = CAST_SHADOWS;
      mesh.frustumCulled = false; // instances are spread over the whole field
      this.meshes.set(n, mesh);
      this.group.add(mesh);
    });
    this._apply(layout);
    return this;
  }

  _layout() {
    const t = this.terrain;
    return buildNatureLayout({ manifest: this.manifest, heightAt: (x, z) => t.heightAt(x, z), field: t.bounds });
  }

  /** Re-snap everything to the (regenerated) terrain. Layout order is height-independent, so instances map 1:1. */
  rebuild() {
    this._apply(this._layout());
  }

  _apply(layout) {
    this.items = layout.items;
    this.stats = layout.stats;
    const slots = new Map();
    layout.items.forEach((it) => {
      if (!slots.has(it.name)) slots.set(it.name, []);
      slots.get(it.name).push(it);
    });
    this.slots = slots;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    slots.forEach((list, name) => {
      const mesh = this.meshes.get(name);
      list.forEach((it, k) => {
        mesh.setMatrixAt(k, m.compose(p.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.rotY), s.setScalar(it.scale)));
      });
      mesh.instanceMatrix.needsUpdate = true;
    });

    this.colliders.forEach((c) => this.world.removeCollider(c, true));
    this.colliders = [];
    layout.items.forEach((it) => {
      const desc = it.collider ? this._colliderFor(it) : null;
      if (desc) this.colliders.push(this.world.createCollider(desc, this.body));
    });
  }

  _colliderFor(it) {
    const c = it.collider;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rotY);
    const rot = { x: q.x, y: q.y, z: q.z, w: q.w };
    if (c.kind === 'cylinder') {
      return RAPIER.ColliderDesc.cylinder(c.halfHeight, c.radius).setTranslation(it.x, it.y + c.centerY, it.z);
    }
    const m = this.info.get(it.name);
    const box = () => {
      const shrink = c.shrink ?? 1;
      const local = new THREE.Vector3(...m.min).add(new THREE.Vector3(...m.max)).multiplyScalar(0.5 * it.scale).applyQuaternion(q);
      return RAPIER.ColliderDesc.cuboid(
        (Math.max(m.size[0], 0.02) * it.scale * shrink) / 2,
        (Math.max(m.size[1], 0.02) * it.scale * shrink) / 2,
        (Math.max(m.size[2], 0.02) * it.scale * shrink) / 2
      )
        .setTranslation(it.x + local.x, it.y + local.y, it.z + local.z)
        .setRotation(rot);
    };
    if (c.kind === 'box') return box();
    // convex hull of the model's vertices
    if (!this.hulls.has(it.name)) this.hulls.set(it.name, uniquePoints(this.meshes.get(it.name).geometry));
    const local = this.hulls.get(it.name);
    const pts = new Float32Array(local.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < local.length; i += 3) {
      v.set(local[i], local[i + 1], local[i + 2]).multiplyScalar(it.scale).applyQuaternion(q);
      pts[i] = v.x + it.x;
      pts[i + 1] = v.y + it.y;
      pts[i + 2] = v.z + it.z;
    }
    return RAPIER.ColliderDesc.convexHull(pts) ?? box();
  }
}
