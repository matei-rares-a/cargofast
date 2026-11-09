import * as THREE from 'three';

// *** COORDINATE PICKER SETTINGS ***
// Debug tool (GUI > Coordinates): hover shows the world x/y/z under the cursor, click drops a pin with its coordinates.
const ENABLED_DEFAULT      = false;   // off until switched on in the GUI (so it never gets in the way while driving)
const HOVER_THROTTLE_MS    = 40;      // minimum time between two hover ray casts
const CLICK_MAX_MOVE_PX    = 5;       // a press that moves more than this is a camera drag, not a click
const MAX_PINS             = 20;      // oldest pins are removed first
const PIN_LIFETIME_S       = 10;      // pins (red cones + labels) disappear after this many seconds; 0 = never (GUI)
const PIN_FADE_S           = 1;       // they shrink and fade during their last second
const PIN_LIFETIME_GUI_MAX = 120;
const DECIMALS            = 1;        // digits after the decimal point in the shown coordinates
const PIN_COLOR            = 0xff3b30;
const PIN_HEIGHT           = 4;       // meters (cone, tip on the picked point)
const PIN_RADIUS           = 0.5;
const TOOLTIP_OFFSET_PX    = { x: 14, y: 18 };
const LABEL_LIFT           = 0.3;     // meters above the pin head where the pin label is anchored
const FONT                 = '12px/1.3 ui-monospace, Consolas, monospace';

/** "Terrain  x -61.2  y 0.0  z 48.3" */
export function formatCoords(point, name = '') {
  const k = 10 ** DECIMALS;
  const f = (v) => (Math.round(v * k) / k + 0).toFixed(DECIMALS); // "+ 0" turns -0 into 0, so no "-0.0"
  return `${name ? `${name}  ` : ''}x ${f(point.x)}  y ${f(point.y)}  z ${f(point.z)}`;
}

/** True when the object and all its parents are visible (the ray caster itself ignores `visible`). */
function isVisibleInScene(obj) {
  for (let o = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export class CoordinatePicker {
  /**
   * @param opts.scene       three.js scene (pin markers are added to it)
   * @param opts.camera      active camera
   * @param opts.domElement  canvas that receives the mouse events
   * @param opts.gui         lil-gui root (folder "Coordinates")
   * @param opts.getTargets  () => Object3D[] that can be picked (searched recursively)
   * @param opts.isActive    () => boolean; false while e.g. the pointer is locked (free-fly camera)
   * @param opts.documentRef document used for the tooltip and the pin labels (default: global document)
   * @param opts.now         () => ms clock (default performance.now)
   */
  constructor({ scene, camera, domElement, gui, getTargets, isActive = () => true, documentRef = globalThis.document, now = () => performance.now() }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.getTargets = getTargets;
    this.isActive = isActive;
    this.doc = documentRef;
    this.now = now;
    this.raycaster = new THREE.Raycaster();
    this.pins = [];
    this.down = null;
    this.lastHover = -Infinity;
    this.settings = { enabled: ENABLED_DEFAULT, pinSeconds: PIN_LIFETIME_S, last: '(click somewhere)' };

    this.pinGroup = new THREE.Group();
    this.pinGroup.name = 'Coordinate Pins';
    scene.add(this.pinGroup);
    this.pinGeometry = new THREE.ConeGeometry(PIN_RADIUS, PIN_HEIGHT, 12);
    this.pinMaterial = new THREE.MeshBasicMaterial({ color: PIN_COLOR });
    this.tooltip = this._createLabel(true);
    this._applyCursor();

    domElement.addEventListener('pointermove', (e) => this.onPointerMove(e));
    domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    domElement.addEventListener('pointerup', (e) => this.onPointerUp(e));
    domElement.addEventListener('pointerleave', () => this._hideTooltip());

    const f = gui.addFolder('Coordinates');
    f.add(this.settings, 'enabled').name('Hover + click shows x y z').onChange(() => {
      this._hideTooltip();
      this._applyCursor();
    });
    f.add(this.settings, 'pinSeconds', 0, PIN_LIFETIME_GUI_MAX, 1).name('Pins vanish after (s, 0 = never)');
    f.add({ clear: () => this.clearPins() }, 'clear').name('Clear pins');
    f.add(this.settings, 'last').name('Last click').listen();
  }

  /** Ray cast from a screen position; returns { point, object, name } for the nearest visible target, or null. */
  pick(clientX, clientY) {
    const rect = this.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.scene.updateMatrixWorld(); // normally already done by the last render; cheap when nothing moved
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.getTargets(), true).find((h) => h.object.isMesh && isVisibleInScene(h.object));
    if (!hit) return null;
    return { point: hit.point.clone(), object: hit.object, name: hit.object.name || hit.object.parent?.name || '' };
  }

  onPointerMove(e) {
    if (!this.settings.enabled || !this.isActive()) return this._hideTooltip();
    const t = this.now();
    if (t - this.lastHover < HOVER_THROTTLE_MS) return;
    this.lastHover = t;
    const hit = this.pick(e.clientX, e.clientY);
    if (!hit) return this._hideTooltip();
    this.tooltip.textContent = formatCoords(hit.point, hit.name);
    this.tooltip.style.left = `${e.clientX + TOOLTIP_OFFSET_PX.x}px`;
    this.tooltip.style.top = `${e.clientY + TOOLTIP_OFFSET_PX.y}px`;
    this.tooltip.style.display = 'block';
  }

  onPointerDown(e) {
    this.down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  }

  onPointerUp(e) {
    const down = this.down;
    this.down = null;
    if (!down || e.button !== 0 || !this.settings.enabled || !this.isActive()) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_MAX_MOVE_PX) return; // it was a camera drag
    const hit = this.pick(e.clientX, e.clientY);
    if (hit) this.addPin(hit);
  }

  /** Drop a pin (red cone, tip on the point) with a label that follows it on screen. */
  addPin(hit) {
    const marker = new THREE.Mesh(this.pinGeometry, this.pinMaterial);
    marker.rotation.x = Math.PI; // tip down
    marker.position.copy(hit.point).add(new THREE.Vector3(0, PIN_HEIGHT / 2, 0));
    marker.name = 'Coordinate Pin';
    this.pinGroup.add(marker);
    const label = this._createLabel(false);
    label.textContent = formatCoords(hit.point);
    label.style.display = 'block';
    this.pins.push({ marker, label, point: hit.point.clone(), born: this.now() });
    while (this.pins.length > MAX_PINS) this._removePin(this.pins.shift());
    this.settings.last = formatCoords(hit.point, hit.name);
    console.info(`Picked ${this.settings.last}`);
  }

  clearPins() {
    this.pins.forEach((p) => this._removePin(p));
    this.pins = [];
    this.settings.last = '(click somewhere)';
  }

  /** Call every frame: keeps the pin labels on top of their pins. */
  update() {
    this._expirePins();
    if (!this.pins.length) return;
    const rect = this.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    const view = new THREE.Vector3();
    this.camera.updateMatrixWorld();
    this.pins.forEach(({ label, point }) => {
      v.copy(point).add(new THREE.Vector3(0, PIN_HEIGHT + LABEL_LIFT, 0));
      const inFront = view.copy(v).applyMatrix4(this.camera.matrixWorldInverse).z < 0; // the camera looks down its own -z
      v.project(this.camera);
      const visible = inFront && v.z < 1 && Math.abs(v.x) <= 1.2 && Math.abs(v.y) <= 1.2;
      label.style.display = visible ? 'block' : 'none';
      if (visible) {
        label.style.left = `${rect.left + ((v.x + 1) / 2) * rect.width}px`;
        label.style.top = `${rect.top + ((1 - v.y) / 2) * rect.height}px`;
      }
    });
  }

  /** Remove pins older than the lifetime setting; during the last PIN_FADE_S seconds they shrink and fade out. */
  _expirePins() {
    const life = this.settings.pinSeconds;
    this.pins = this.pins.filter((pin) => {
      const left = life > 0 ? life - (this.now() - pin.born) / 1000 : Infinity;
      if (left <= 0) {
        this._removePin(pin);
        return false;
      }
      const k = Math.min(1, left / PIN_FADE_S);
      pin.marker.scale.setScalar(k);
      pin.label.style.opacity = String(k);
      return true;
    });
  }

  _removePin(pin) {
    this.pinGroup.remove(pin.marker);
    pin.label.remove();
  }

  _hideTooltip() {
    this.tooltip.style.display = 'none';
  }

  _applyCursor() {
    if (this.domElement.style) this.domElement.style.cursor = this.settings.enabled ? 'crosshair' : '';
  }

  _createLabel(isTooltip) {
    const el = this.doc.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '20',
      padding: '2px 6px',
      borderRadius: '4px',
      background: isTooltip ? 'rgba(0, 0, 0, 0.78)' : 'rgba(176, 20, 10, 0.85)',
      color: '#fff',
      font: FONT,
      whiteSpace: 'nowrap',
      transform: isTooltip ? 'none' : 'translate(-50%, -100%)',
    });
    el.setAttribute?.('role', 'status');
    this.doc.body.appendChild(el);
    return el;
  }
}
