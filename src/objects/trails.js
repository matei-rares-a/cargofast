import * as THREE from 'three';
import { CORRIDORS } from './forest_map';

// *** TRAILS SETTINGS ***
// Dirt ribbons draped on the terrain along every path and the mountain trail (visual only; the terrain under them is already flattened).
const COLOR_CENTER       = new THREE.Color(0xa87c52);
const COLOR_EDGE         = new THREE.Color(0x8c6a49);
const COLOR_NOISE        = 0.12;      // random darkening per vertex row (0..1)
const WIDTH_SCALE        = 1.08;      // ribbon is a bit wider than the flat strip so its edges sit on the shoulder
const LATERAL_SEGMENTS   = 4;         // quads across the width
const LIFT               = 0.07;      // meters above the terrain (avoids z-fighting)
const LIFT_PER_PATH       = 0.012;     // each path sits a little higher than the previous one, so overlaps at junctions do not flicker
const POLYGON_OFFSET     = -2;

export class Trails {
  /**
   * @param scene   three.js scene
   * @param terrain Terrain (heightAt + onRebuild)
   */
  constructor(scene, terrain) {
    this.terrain = terrain;
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1.0, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: POLYGON_OFFSET, polygonOffsetUnits: POLYGON_OFFSET,
    });
    this.group = new THREE.Group();
    this.group.name = 'Trails';
    scene.add(this.group);
    this.meshes = new Map();
    CORRIDORS.forEach((c) => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      mesh.name = `Trail ${c.name}`;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.meshes.set(c.name, mesh);
      this.group.add(mesh);
    });
    this.rebuild();
    terrain.onRebuild(() => this.rebuild());
  }

  rebuild() {
    CORRIDORS.forEach((c) => this._build(c, this.meshes.get(c.name)));
  }

  _build(c, mesh) {
    const n = c.pts.length;
    const cols = LATERAL_SEGMENTS + 1;
    const positions = new Float32Array(n * cols * 3);
    const colors = new Float32Array(n * cols * 3);
    const color = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = c.pts[Math.max(0, i - 1)];
      const b = c.pts[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const nx = -tz;
      const nz = tx;
      const dark = 1 - COLOR_NOISE * ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) / 2;
      for (let j = 0; j < cols; j++) {
        const s = (j / LATERAL_SEGMENTS) * 2 - 1; // -1 .. 1 across the width
        const x = c.pts[i].x + nx * s * c.halfWidth * WIDTH_SCALE;
        const z = c.pts[i].z + nz * s * c.halfWidth * WIDTH_SCALE;
        const k = (i * cols + j) * 3;
        positions.set([x, this.terrain.heightAt(x, z) + LIFT + LIFT_PER_PATH * CORRIDORS.indexOf(c), z], k);
        color.copy(COLOR_CENTER).lerp(COLOR_EDGE, Math.abs(s) ** 2).multiplyScalar(dark);
        colors.set([color.r, color.g, color.b], k);
      }
    }
    const index = [];
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j;
        const b = a + 1;
        const cc = a + cols;
        const d = cc + 1;
        index.push(a, cc, b, b, cc, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    // make sure the ribbon faces up regardless of the path direction
    if (geo.attributes.normal.getY(Math.floor(geo.attributes.normal.count / 2)) < 0) {
      for (let k = 0; k < index.length; k += 3) { const t = index[k + 1]; index[k + 1] = index[k + 2]; index[k + 2] = t; }
      geo.setIndex(index);
      geo.computeVertexNormals();
    }
    geo.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }
}
