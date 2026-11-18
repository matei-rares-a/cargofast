import * as THREE from 'three';

// *** COMPASS SETTINGS ***
const SIZE_PX      = 110;        // diameter in pixels
const MARGIN_PX    = 16;         // distance from the top-left corner of the window
const CENTER       = 55;         // center of the 110 x 110 drawing
const LETTER_RADIUS = 37;        // distance of the letters from the center
const RING_FILL    = 'rgba(40, 40, 40, 0.55)'; // dial face: dark grey, see-through
const RING_EDGE    = 'rgba(255, 255, 255, 0.7)'; // dial outline and ticks
const LETTER_COLOR = '#ffffff';  // letters, N included, and the pivot
const NEEDLE_COLOR = '#d7263d';  // the fixed needle: where the camera looks
const NEEDLE_BACK  = '#8a8a8a';
const CARDINALS    = [['N', 0], ['E', 90], ['S', 180], ['W', 270]]; // letter and its world bearing in degrees (clockwise from north)

/**
 * Round compass in the top-left corner. The needle is fixed and points up, which is where the camera looks.
 * The dial ticks turn under it, and the letters move around the circle but stay upright, so they are easy to read.
 * World directions: north is -z, east is +x (the car starts facing +z, the sea lies to the west).
 */
export class Compass {
  /** @param parent  element the compass is appended to (default: document.body) */
  constructor(parent = document.body) {
    this.root = document.createElement('div');
    this.root.setAttribute('role', 'img');
    this.root.setAttribute('aria-label', 'Compass: the needle shows the direction the camera looks');
    Object.assign(this.root.style, {
      position: 'fixed', left: `${MARGIN_PX}px`, top: `${MARGIN_PX}px`,
      width: `${SIZE_PX}px`, height: `${SIZE_PX}px`, pointerEvents: 'none', zIndex: '10',
    });

    // dial face and ticks: these turn with the camera
    this.dial = document.createElement('div');
    Object.assign(this.dial.style, { position: 'absolute', inset: '0', transformOrigin: '50% 50%' });
    this.dial.innerHTML = `
      <svg viewBox="0 0 110 110" width="${SIZE_PX}" height="${SIZE_PX}" aria-hidden="true">
        <circle cx="${CENTER}" cy="${CENTER}" r="52" fill="${RING_FILL}" stroke="${RING_EDGE}" stroke-width="2"/>
        ${[0, 90, 180, 270].map((deg) => `<line x1="${CENTER}" y1="4" x2="${CENTER}" y2="12" stroke="${RING_EDGE}" stroke-width="2" transform="rotate(${deg} ${CENTER} ${CENTER})"/>`).join('')}
      </svg>`;
    this.root.appendChild(this.dial);

    // letters: not rotated, placed on the circle at their current bearing
    const letters = document.createElement('div');
    Object.assign(letters.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    letters.innerHTML = `
      <svg viewBox="0 0 110 110" width="${SIZE_PX}" height="${SIZE_PX}" aria-hidden="true">
        ${CARDINALS.map(([name]) => `<text data-letter="${name}" text-anchor="middle" dominant-baseline="middle" font-size="15" font-weight="700" font-family="sans-serif" fill="${LETTER_COLOR}">${name}</text>`).join('')}
      </svg>`;
    this.letters = CARDINALS.map(([name, bearing]) => ({ el: letters.querySelector(`[data-letter="${name}"]`), bearing: (bearing * Math.PI) / 180 }));
    this.root.appendChild(letters);

    // fixed needle: red tip up, grey tail down, pivot in the middle
    const needle = document.createElement('div');
    Object.assign(needle.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    needle.innerHTML = `
      <svg viewBox="0 0 110 110" width="${SIZE_PX}" height="${SIZE_PX}" aria-hidden="true">
        <polygon points="55,26 61,55 49,55" fill="${NEEDLE_COLOR}"/>
        <polygon points="55,84 61,55 49,55" fill="${NEEDLE_BACK}"/>
        <circle cx="55" cy="55" r="4" fill="${LETTER_COLOR}"/>
      </svg>`;
    this.root.appendChild(needle);

    parent.appendChild(this.root);
  }

  /**
   * Show the camera heading: the ticks turn, and each letter moves to its place on the circle, still upright.
   * @param camera  the active camera
   */
  update(camera) {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const bearing = Math.atan2(dir.x, -dir.z); // clockwise from north: 0 = facing -z (north), +PI/2 = facing +x (east)
    this.dial.style.transform = `rotate(${-bearing}rad)`; // the dial turns the other way, so north sits where north really is
    for (const { el, bearing: world } of this.letters) {
      const a = world - bearing; // clockwise from the top of the screen
      el.setAttribute('x', (CENTER + LETTER_RADIUS * Math.sin(a)).toFixed(2));
      el.setAttribute('y', (CENTER - LETTER_RADIUS * Math.cos(a)).toFixed(2));
    }
  }
}
