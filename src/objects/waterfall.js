import * as THREE from 'three';
import { WATERFALL, WATER_Y } from './forest_map';

// *** WATERFALL SETTINGS ***
const WATER_COLOR    = 0xbfe6ff; // falling water
const WATER_OPACITY  = 0.75;
const FOAM_COLOR     = 0xf4fbff; // splash where the water meets the sea
const FOAM_OPACITY   = 0.9;
const FOAM_RADIUS    = 3;
const FOAM_LIFT      = 0.08;     // above the sea surface, so it does not flicker against it
const SHEET_OFFSET   = 0.3;      // the sheet stands this far out from the bluff edge, toward the sea

/** Waterfall from the bluff's west edge down into the sea: a translucent sheet and a foam pool at its foot. */
export class Waterfall {
  /**
   * @param scene    three.js scene
   * @param terrain  Terrain (heightAt, onRebuild); the sheet is fitted to the bluff top on every rebuild
   */
  constructor(scene, terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'Waterfall';
    this.sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(WATERFALL.width, 1),
      new THREE.MeshBasicMaterial({ color: WATER_COLOR, transparent: true, opacity: WATER_OPACITY, side: THREE.DoubleSide, depthWrite: false })
    );
    this.foam = new THREE.Mesh(
      new THREE.CircleGeometry(FOAM_RADIUS, 24),
      new THREE.MeshBasicMaterial({ color: FOAM_COLOR, transparent: true, opacity: FOAM_OPACITY, depthWrite: false })
    );
    this.foam.rotation.x = -Math.PI / 2; // lies on the sea surface
    this.group.add(this.sheet, this.foam);
    scene.add(this.group);
    terrain.onRebuild(() => this.place());
    this.place();
  }

  /** Fit the sheet from the bluff top down to the sea surface, and move the foam pool to its foot. */
  place() {
    const top = this.terrain.heightAt(WATERFALL.x + 1, WATERFALL.z); // plateau just inside the edge
    const drop = Math.max(0.5, top - WATER_Y);
    this.sheet.geometry.dispose();
    this.sheet.geometry = new THREE.PlaneGeometry(WATERFALL.width, drop);
    this.sheet.position.set(WATERFALL.x - SHEET_OFFSET, (top + WATER_Y) / 2, WATERFALL.z);
    this.sheet.rotation.y = -Math.PI / 2; // faces west, toward the sea
    this.foam.position.set(WATERFALL.x - 2, WATER_Y + FOAM_LIFT, WATERFALL.z);
  }
}
