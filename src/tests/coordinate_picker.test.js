import { describe, test, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CoordinatePicker, formatCoords } from '../objects/coordinate_picker';
import { createFakeGui } from './helpers';

const CANVAS = { left: 100, top: 50, width: 800, height: 600 };
const CENTER = { x: CANVAS.left + CANVAS.width / 2, y: CANVAS.top + CANVAS.height / 2 };

/** Minimal DOM stand-ins (the tests run in node). */
function fakeElement() {
  return { style: {}, textContent: '', removed: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.removed = true; } };
}
function fakeDocument() {
  const created = [];
  return { created, createElement: () => { const el = fakeElement(); created.push(el); return el; }, body: { appendChild() {} } };
}
function fakeCanvas() {
  const handlers = {};
  return {
    style: {},
    handlers,
    addEventListener: (type, fn) => { handlers[type] = fn; },
    getBoundingClientRect: () => ({ ...CANVAS, right: CANVAS.left + CANVAS.width, bottom: CANVAS.top + CANVAS.height }),
    fire: (type, e) => handlers[type]?.(e),
  };
}
const ev = (x, y, button = 0) => ({ clientX: x, clientY: y, button });

describe('formatCoords', () => {
  test('prints x, y, z with one decimal and an optional object name', () => {
    expect(formatCoords(new THREE.Vector3(-61.234, 0, 48.26), 'Terrain')).toBe('Terrain  x -61.2  y 0.0  z 48.3');
    expect(formatCoords(new THREE.Vector3(1, 2, 3))).toBe('x 1.0  y 2.0  z 3.0');
  });
});

describe('CoordinatePicker', () => {
  let scene, camera, canvas, doc, floor, hidden, picker, clock, active;

  beforeEach(() => {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, CANVAS.width / CANVAS.height, 0.1, 500);
    camera.position.set(0, 20, 0);
    camera.up.set(0, 0, -1); // screen up = -z, screen right = +x
    camera.lookAt(0, 0, 0); // looking straight down at the origin
    floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 3;
    floor.name = 'Floor';
    hidden = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial());
    hidden.rotation.x = -Math.PI / 2;
    hidden.position.y = 10; // above the floor, but invisible: must be ignored
    hidden.visible = false;
    scene.add(floor, hidden);
    canvas = fakeCanvas();
    doc = fakeDocument();
    clock = 0;
    active = true;
    picker = new CoordinatePicker({
      scene, camera, domElement: canvas, gui: createFakeGui(), getTargets: () => [floor, hidden], isActive: () => active, documentRef: doc, now: () => clock,
    });
    picker.settings.enabled = true;
  });

  const tooltip = () => doc.created[0];

  test('pick(): the center of the screen hits the point straight below the camera, on the visible floor', () => {
    const hit = picker.pick(CENTER.x, CENTER.y);
    expect(hit.name).toBe('Floor');
    expect(hit.point.x).toBeCloseTo(0, 5);
    expect(hit.point.y).toBeCloseTo(3, 5);
    expect(hit.point.z).toBeCloseTo(0, 5);
  });

  test('pick(): screen offsets map to the right world direction (x right, z toward the bottom of the screen)', () => {
    const right = picker.pick(CENTER.x + 200, CENTER.y);
    const down = picker.pick(CENTER.x, CENTER.y + 150);
    expect(right.point.x).toBeGreaterThan(1);
    expect(Math.abs(right.point.z)).toBeLessThan(1e-4);
    expect(Math.abs(down.point.x)).toBeLessThan(1e-4);
    expect(down.point.z).toBeGreaterThan(1);
  });

  test('pick(): misses (nothing under the cursor) return null', () => {
    camera.lookAt(0, 20, -50); // looking at the horizon, no target there
    expect(picker.pick(CENTER.x, CENTER.y)).toBeNull();
  });

  test('hover: shows a tooltip with the coordinates next to the cursor', () => {
    picker.onPointerMove(ev(CENTER.x, CENTER.y));
    expect(tooltip().style.display).toBe('block');
    expect(tooltip().textContent).toBe('Floor  x 0.0  y 3.0  z 0.0');
    expect(tooltip().style.left).toBe(`${CENTER.x + 14}px`);
    expect(tooltip().style.top).toBe(`${CENTER.y + 18}px`);
  });

  test('hover: is throttled, hides on a miss, when disabled, when inactive and when the mouse leaves', () => {
    picker.onPointerMove(ev(CENTER.x, CENTER.y));
    const first = tooltip().textContent;
    clock = 10; // < throttle
    picker.onPointerMove(ev(CENTER.x + 100, CENTER.y));
    expect(tooltip().textContent).toBe(first);
    clock = 100;
    picker.onPointerMove(ev(CENTER.x + 100, CENTER.y));
    expect(tooltip().textContent).not.toBe(first);

    picker.settings.enabled = false;
    clock = 200;
    picker.onPointerMove(ev(CENTER.x, CENTER.y));
    expect(tooltip().style.display).toBe('none');

    picker.settings.enabled = true;
    active = false;
    clock = 300;
    picker.onPointerMove(ev(CENTER.x, CENTER.y));
    expect(tooltip().style.display).toBe('none');

    active = true;
    clock = 400;
    picker.onPointerMove(ev(CENTER.x, CENTER.y));
    expect(tooltip().style.display).toBe('block');
    canvas.fire('pointerleave', {});
    expect(tooltip().style.display).toBe('none');
  });

  test('click: drops a pin at the point with a label showing the coordinates', () => {
    canvas.fire('pointerdown', ev(CENTER.x + 100, CENTER.y));
    canvas.fire('pointerup', ev(CENTER.x + 101, CENTER.y + 1));
    expect(picker.pins.length).toBe(1);
    const pin = picker.pins[0];
    expect(scene.getObjectByName('Coordinate Pins').children).toContain(pin.marker);
    expect(pin.point.y).toBeCloseTo(3, 5);
    expect(pin.label.textContent).toMatch(/^x [-\d.]+  y 3\.0  z [-\d.]+$/);
    expect(picker.settings.last).toContain('Floor');
    expect(pin.marker.position.y).toBeGreaterThan(pin.point.y); // the cone stands on the point with its tip down
  });

  test('click: a drag (camera rotation) or a right click does not drop a pin; disabled / inactive neither', () => {
    canvas.fire('pointerdown', ev(CENTER.x, CENTER.y));
    canvas.fire('pointerup', ev(CENTER.x + 60, CENTER.y));
    canvas.fire('pointerdown', ev(CENTER.x, CENTER.y, 2));
    canvas.fire('pointerup', ev(CENTER.x, CENTER.y, 2));
    picker.settings.enabled = false;
    canvas.fire('pointerdown', ev(CENTER.x, CENTER.y));
    canvas.fire('pointerup', ev(CENTER.x, CENTER.y));
    picker.settings.enabled = true;
    active = false;
    canvas.fire('pointerdown', ev(CENTER.x, CENTER.y));
    canvas.fire('pointerup', ev(CENTER.x, CENTER.y));
    expect(picker.pins.length).toBe(0);
  });

  test('keeps at most 20 pins (the oldest go first) and clearPins() removes markers and labels', () => {
    const labels = [];
    for (let i = 0; i < 23; i++) {
      canvas.fire('pointerdown', ev(CENTER.x + i * 5, CENTER.y));
      canvas.fire('pointerup', ev(CENTER.x + i * 5, CENTER.y));
      labels.push(picker.pins[picker.pins.length - 1].label);
    }
    expect(picker.pins.length).toBe(20);
    expect(labels.slice(0, 3).every((l) => l.removed)).toBe(true);
    expect(scene.getObjectByName('Coordinate Pins').children.length).toBe(20);
    picker.clearPins();
    expect(picker.pins.length).toBe(0);
    expect(scene.getObjectByName('Coordinate Pins').children.length).toBe(0);
    expect(labels.every((l) => l.removed)).toBe(true);
  });

  test('update(): pin labels follow their pins on screen and hide when the pin is behind the camera', () => {
    canvas.fire('pointerdown', ev(CENTER.x, CENTER.y));
    canvas.fire('pointerup', ev(CENTER.x, CENTER.y));
    const label = picker.pins[0].label;
    picker.update();
    expect(label.style.display).toBe('block');
    expect(parseFloat(label.style.left)).toBeCloseTo(CENTER.x, 0);
    camera.position.set(0, 20, 0);
    camera.lookAt(0, 40, 0); // looking away from the pin
    picker.update();
    expect(label.style.display).toBe('none');
  });

  describe('pin lifetime', () => {
    const dropPin = () => {
      canvas.fire('pointerdown', ev(CENTER.x, CENTER.y));
      canvas.fire('pointerup', ev(CENTER.x, CENTER.y));
      return picker.pins[picker.pins.length - 1];
    };

    test('defaults to 10 seconds', () => {
      expect(picker.settings.pinSeconds).toBe(10);
    });

    test('a pin stays full size for 9 s, shrinks and fades during the last second and is gone after 10 s', () => {
      const pin = dropPin();
      clock = 9000;
      picker.update();
      expect(picker.pins.length).toBe(1);
      expect(pin.label.style.opacity).toBe('1');
      expect(pin.marker.scale.x).toBeCloseTo(1);

      clock = 9500;
      picker.update();
      expect(picker.pins.length).toBe(1);
      expect(parseFloat(pin.label.style.opacity)).toBeCloseTo(0.5, 2);
      expect(pin.marker.scale.x).toBeCloseTo(0.5, 2);

      clock = 10000;
      picker.update();
      expect(picker.pins.length).toBe(0);
      expect(pin.label.removed).toBe(true);
      expect(scene.getObjectByName('Coordinate Pins').children).not.toContain(pin.marker);
    });

    test('each pin has its own clock', () => {
      const first = dropPin();
      clock = 6000;
      const second = dropPin();
      clock = 10500;
      picker.update();
      expect(picker.pins).toEqual([second]);
      expect(first.label.removed).toBe(true);
      clock = 16000;
      picker.update();
      expect(picker.pins.length).toBe(0);
    });

    test('0 keeps the pins forever, and a shorter lifetime from the GUI applies to existing pins', () => {
      picker.settings.pinSeconds = 0;
      dropPin();
      clock = 1e9;
      picker.update();
      expect(picker.pins.length).toBe(1);
      picker.settings.pinSeconds = 3;
      picker.update();
      expect(picker.pins.length).toBe(0);
    });
  });

  test('the GUI toggle changes the canvas cursor', () => {
    picker.settings.enabled = true;
    picker._applyCursor();
    expect(canvas.style.cursor).toBe('crosshair');
    picker.settings.enabled = false;
    picker._applyCursor();
    expect(canvas.style.cursor).toBe('');
  });
});

describe('script.js wiring', () => {
  test('creates the picker with the terrain, ground, sea and nature group as targets, and updates it every frame', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('../script.js', import.meta.url)), 'utf8');
    expect(src).toMatch(/new CoordinatePicker\(/);
    ['TERRAIN.ground', 'SCENERY.sea', 'NATURE.group'].forEach((t) => expect(src).toContain(t));
    expect(src).toContain('PICKER.update()');
    expect(src).not.toMatch(/getTargets: \(\) => \[[^\]]*(?<![.\w])ground\b/); // the old ground plane is not a target any more
    // independent (free-fly) camera settings are in the Camera GUI folder and are what the loop and the mouse really use
    expect(src).toMatch(/camGui\.add\(FREE_CAM, 'speed'/);
    expect(src).toMatch(/camGui\.add\(FREE_CAM, 'sensitivity'/);
    expect(src).toContain('FREE_CAM.speed * dt');
    expect(src).toContain('e.movementX * FREE_CAM.sensitivity');
  });
});
