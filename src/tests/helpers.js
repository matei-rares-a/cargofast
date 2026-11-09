import { vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Chainable stand-in for lil-gui (the real one needs a DOM). */
export function createFakeGui() {
  const chain = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? undefined : chain),
    apply: () => chain,
  });
  return chain;
}

/** Stub `window` and return a function that fires key events at the registered listeners. */
export function stubWindowKeys() {
  const listeners = { keydown: [], keyup: [] };
  vi.stubGlobal('window', {
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
  });
  return (type, code) => listeners[type].forEach((fn) => fn({ code, preventDefault() {} }));
}

/**
 * Wrap the GLTFLoader module so load() reads from src/static on disk instead of HTTP.
 * Textures are stripped (no DOM in node) and the .bin is inlined as a data URI.
 * Use inside vi.mock: `async (orig) => (await import('./helpers')).withDiskGltfLoader(await orig())`.
 */
export function withDiskGltfLoader(mod) {
  class DiskGLTFLoader extends mod.GLTFLoader {
    load(url, onLoad, _onProgress, onError) {
      try {
        const dir = fileURLToPath(new URL('../static/', import.meta.url));
        const json = JSON.parse(readFileSync(dir + url, 'utf8'));
        const bin = readFileSync(dir + json.buffers[0].uri);
        json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
        delete json.images;
        delete json.textures;
        json.materials?.forEach((m) => {
          if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture;
        });
        this.parse(JSON.stringify(json), '', onLoad, onError);
      } catch (e) {
        onError?.(e);
      }
    }
  }
  return { ...mod, GLTFLoader: DiskGLTFLoader };
}

/** Minimal scene stand-in: records added objects. */
export function createScene() {
  return new THREE.Scene();
}

/** Step the physics world (and optional per-step hook) for a number of fixed steps. */
export function runSteps(world, steps, beforeStep) {
  const dt = world.timestep;
  for (let i = 0; i < steps; i++) {
    beforeStep?.(dt);
    world.step();
  }
}

/** Static ground matching the layout used in script.js (top surface at y = 0). */
export function addGround(RAPIER, world, size = 40, thickness = 0.5) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -thickness, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, thickness, size / 2).setFriction(0.5), body);
}

/**
 * Step one plain world (box falling on a ground) before anything else.
 * Workaround: in a fresh test file the first `world.step()` of a world with a vehicle traps ("RuntimeError: unreachable") in Rapier's wasm;
 * a warm-up step of an ordinary world avoids it. Call right after `await RAPIER.init()` in files that drive the car.
 */
export function warmUpPhysics(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: -20.81, z: 0 });
  addGround(RAPIER, world);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
  runSteps(world, 60);
}