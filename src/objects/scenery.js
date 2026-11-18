import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { seededRandom } from './noise';
import { WATER_Y, SEABED_Y, SEA_EDGE_X, LOWLAND_Y } from './forest_map';
import { FIELD_CENTER, FIELD_SIZE, forestFloorColor } from './terrain';

// *** SCENERY SETTINGS ***
// Backdrop only (fog, far land, mountains). Trees, rocks, cliffs etc. come from the Nature Kit (nature_kit.js).
// Center of the scenery rings (roughly the middle of the whole play area).
export const SCENERY_CENTER      = { x: -60, z: 0 };

// Ambient fill so surfaces facing away from the sun are not black (the sun in script.js is the only other light)
const AMBIENT_SKY_COLOR          = 0xffffff;
const AMBIENT_GROUND_COLOR       = 0x8a9a7a;
const AMBIENT_INTENSITY          = 1.0;
const AMBIENT_GUI_MAX            = 4;

// Fog (color = scene background, so distant objects fade into the sky)
const FOG_NEAR                   = 150;
const FOG_FAR                    = 520;
const FOG_GUI_MAX                = 1000;

// Far land: a big flat lowland around the whole play area (the far forest grows on it, up to the backdrop mountains).
// Its top is LOWLAND_Y (forest_map.js), a hair below the ground plane and the terrain edges, so they meet without a step.
const FAR_LAND_RADIUS            = 900;    // visual disc
const FAR_LAND_PHYSICS_HALF      = 300;    // solid square half-size around the origin (the car can drive on it)
const FAR_LAND_Y                 = LOWLAND_Y;
const FAR_LAND_THICKNESS         = 0.5;    // half-height of the collider
const FAR_LAND_FRICTION          = 0.5;
// The far land is painted with the terrain's own forest-floor colors (terrain.js forestFloorColor), sampled from a texture, so the two surfaces blend into each other
const FAR_LAND_TEXTURE_SIZE      = 512;    // px per side
const FAR_LAND_TEXTURE_WORLD     = 600;    // world meters covered by the texture (centered on the origin); beyond that the edge color continues
// The terrain field is cut out of the far land: the terrain mesh covers that rectangle and meets the far land edge to edge
const FIELD_CUTOUT = {
  minX: SEA_EDGE_X, maxX: FIELD_CENTER.x + FIELD_SIZE.x / 2,
  minZ: FIELD_CENTER.z - FIELD_SIZE.z / 2, maxZ: FIELD_CENTER.z + FIELD_SIZE.z / 2,
};
// Sea: everything west of SEA_EDGE_X (the far land stops there) plus the basin inside the terrain; surface at WATER_Y (forest_map.js)
const SEA_COLOR                  = 0x2f8fd0;
const SEA_OPACITY                = 0.88;
const SEA_ROUGHNESS              = 0.3;
const SEA_EAST_X                 = -140;   // the water plane reaches this far east (the terrain hides it where land is above water)
const SEA_SIZE_Z                 = 1800;

// Mountains (instanced low-poly cones, visual only)
export const MOUNTAIN_COUNT      = 48;
export const MOUNTAIN_RING       = { min: 260, max: 340 };  // distance from SCENERY_CENTER
const MOUNTAIN_HEIGHT            = { min: 50, max: 120 };
const MOUNTAIN_RADIUS            = { min: 45, max: 90 };
const MOUNTAIN_BASE_Y            = -10;
const MOUNTAIN_COLOR             = 0x7a8fa6;
const MOUNTAIN_SHADE_MIN         = 0.7;                     // darkest per-mountain brightness (1 = full)
const MOUNTAIN_SEED              = 5;
const MOUNTAINS_VISIBLE          = true;

export class Scenery {
  /**
   * @param scene  three.js scene (its background color is reused as fog color)
   * @param world  Rapier world (far land collider)
   * @param gui    lil-gui root
   */
  constructor(scene, world, gui) {
    this.settings = {
      ambient:          AMBIENT_INTENSITY,
      fogNear:          FOG_NEAR,
      fogFar:           FOG_FAR,
      mountainsVisible: MOUNTAINS_VISIBLE,
      mountainColor:    `#${MOUNTAIN_COLOR.toString(16).padStart(6, '0')}`,
    };

    this.ambientLight = new THREE.HemisphereLight(AMBIENT_SKY_COLOR, AMBIENT_GROUND_COLOR, AMBIENT_INTENSITY);
    scene.add(this.ambientLight);
    scene.fog = new THREE.Fog(scene.background ?? 0xffffff, FOG_NEAR, FOG_FAR);
    this.farLand   = this._createFarLand(scene);
    this.farLandColliders = this._createFarLandColliders(world);
    this.sea = this._createSea(scene);
    this.mountains = this._createMountains(scene);

    const f = gui.addFolder('Scenery');
    f.add(this.settings, 'ambient', 0, AMBIENT_GUI_MAX, 0.05).name('Ambient Light').onChange((v) => { this.ambientLight.intensity = v; });
    f.add(this.settings, 'fogNear', 0, FOG_GUI_MAX, 1).name('Fog Near').onChange((v) => { scene.fog.near = v; });
    f.add(this.settings, 'fogFar', 0, FOG_GUI_MAX, 1).name('Fog Far').onChange((v) => { scene.fog.far = v; });
    f.add(this.settings, 'mountainsVisible').name('Show Mountains').onChange((v) => { this.mountains.visible = v; });
    f.addColor(this.settings, 'mountainColor').name('Mountain Tint').onChange((v) => this.mountains.material.color.set(v));
  }

  _createFarLand(scene) {
    // disc of radius FAR_LAND_RADIUS without the sea side (x < SEA_EDGE_X) and without the rectangle covered by the terrain field
    const phi = Math.acos(SEA_EDGE_X / FAR_LAND_RADIUS);
    const edgeY = FAR_LAND_RADIUS * Math.sin(phi);
    const c = FIELD_CUTOUT;
    const shape = new THREE.Shape(); // shape y = -world z (rotated below); the cut-out is symmetric in z, so the sign does not matter
    shape.moveTo(SEA_EDGE_X, -edgeY);
    shape.absarc(0, 0, FAR_LAND_RADIUS, -phi, phi, false);
    shape.lineTo(c.minX, c.maxZ);
    shape.lineTo(c.maxX, c.maxZ);
    shape.lineTo(c.maxX, c.minZ);
    shape.lineTo(c.minX, c.minZ);
    shape.lineTo(SEA_EDGE_X, -edgeY);
    const geo = new THREE.ShapeGeometry(shape, 96);
    geo.rotateX(-Math.PI / 2);
    // planar uv from the world position: the texture covers FAR_LAND_TEXTURE_WORLD meters around the origin (linear mapping, edge color beyond)
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) + FAR_LAND_TEXTURE_WORLD / 2) / FAR_LAND_TEXTURE_WORLD;
      uv[i * 2 + 1] = (pos.getZ(i) + FAR_LAND_TEXTURE_WORLD / 2) / FAR_LAND_TEXTURE_WORLD;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.farLandTexture = this._createFarLandTexture();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.farLandTexture, roughness: 1.0, metalness: 0.0 }));
    mesh.position.set(0, FAR_LAND_Y, 0);
    mesh.name = 'Far Land';
    scene.add(mesh);
    return mesh;
  }

  /** Forest-floor colors of the terrain (same function, same world coordinates) baked into a texture. */
  _createFarLandTexture() {
    const n = FAR_LAND_TEXTURE_SIZE;
    const data = new Uint8Array(n * n * 4);
    const color = new THREE.Color();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const wx = ((i + 0.5) / n - 0.5) * FAR_LAND_TEXTURE_WORLD;
        const wz = ((j + 0.5) / n - 0.5) * FAR_LAND_TEXTURE_WORLD;
        const hex = forestFloorColor(wx, wz, color).getHex(); // getHex gives the sRGB value the texture needs
        data.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], (j * n + i) * 4);
      }
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  /** Fixed boxes that together make a solid floor at FAR_LAND_Y around the terrain field (the field has its own heightfield collider). */
  _createFarLandColliders(world) {
    const S = FAR_LAND_PHYSICS_HALF;
    const c = FIELD_CUTOUT;
    const rects = [
      { minX: c.maxX, maxX: S, minZ: -S, maxZ: S },             // east of the field (the start area)
      { minX: c.minX, maxX: c.maxX, minZ: -S, maxZ: c.minZ },   // north of the field
      { minX: c.minX, maxX: c.maxX, minZ: c.maxZ, maxZ: S },    // south of the field
    ];
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // seabed under the open sea: the car can wade in but never falls forever
    // It reaches east to SEA_EAST_X (where the water surface ends), so the water beyond the field's north and south edges has a floor too.
    // Inside the field the terrain stays above it (the basin bottoms out at -3.6, the seabed top is SEABED_Y = -4).
    const seaMinX = SEA_EDGE_X - 2 * S;
    const seaMaxX = SEA_EAST_X;
    world.createCollider(RAPIER.ColliderDesc.cuboid((seaMaxX - seaMinX) / 2, FAR_LAND_THICKNESS, S).setTranslation((seaMinX + seaMaxX) / 2, SEABED_Y - FAR_LAND_THICKNESS, 0).setFriction(FAR_LAND_FRICTION), body);
    return rects.map((r) =>
      world.createCollider(
        RAPIER.ColliderDesc.cuboid((r.maxX - r.minX) / 2, FAR_LAND_THICKNESS, (r.maxZ - r.minZ) / 2)
          .setTranslation((r.minX + r.maxX) / 2, FAR_LAND_Y - FAR_LAND_THICKNESS, (r.minZ + r.maxZ) / 2)
          .setFriction(FAR_LAND_FRICTION),
        body
      )
    );
  }

  _createSea(scene) {
    const width = SEA_EAST_X + 1000;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, SEA_SIZE_Z),
      new THREE.MeshStandardMaterial({ color: SEA_COLOR, roughness: SEA_ROUGHNESS, metalness: 0.0, transparent: true, opacity: SEA_OPACITY })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(SEA_EAST_X - width / 2, WATER_Y, 0);
    mesh.name = 'Sea';
    scene.add(mesh);
    return mesh;
  }

  _createMountains(scene) {
    const geo = new THREE.ConeGeometry(1, 1, 6, 1);
    geo.translate(0, 0.5, 0); // base at y = 0, unit height; scaled per instance
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0.0, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, MOUNTAIN_COUNT);
    mesh.name = 'Mountains';
    mesh.frustumCulled = false;

    const rand = seededRandom(MOUNTAIN_SEED);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const range = ({ min, max }) => min + rand() * (max - min);
    for (let i = 0; i < MOUNTAIN_COUNT; i++) {
      // evenly spread around the ring with some jitter, so no gap in the horizon
      const angle = ((i + rand() * 0.8) / MOUNTAIN_COUNT) * Math.PI * 2;
      const dist = range(MOUNTAIN_RING);
      dummy.position.set(SCENERY_CENTER.x + Math.cos(angle) * dist, MOUNTAIN_BASE_Y, SCENERY_CENTER.z + Math.sin(angle) * dist);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(range(MOUNTAIN_RADIUS), range(MOUNTAIN_HEIGHT), range(MOUNTAIN_RADIUS));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const v = MOUNTAIN_SHADE_MIN + rand() * (1 - MOUNTAIN_SHADE_MIN);
      mesh.setColorAt(i, color.setRGB(v, v, v));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.material.color.set(MOUNTAIN_COLOR);
    mesh.visible = this.settings.mountainsVisible;
    scene.add(mesh);
    return mesh;
  }
}
