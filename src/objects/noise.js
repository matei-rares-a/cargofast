// Small deterministic noise helpers (no dependencies) used for procedural terrain and scenery.

/** Seeded RNG returning floats in [0, 1). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D value noise in [0, 1], smooth (quintic fade) and tiled every 256 lattice cells. */
export function createValueNoise(seed) {
  const rand = seededRandom(seed);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const values = Array.from({ length: 256 }, () => rand());
  const lattice = (ix, iz) => values[perm[(perm[ix & 255] + iz) & 255]];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;

  return (x, z) => {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const fx = fade(x - x0);
    const fz = fade(z - z0);
    return lerp(
      lerp(lattice(x0, z0), lattice(x0 + 1, z0), fx),
      lerp(lattice(x0, z0 + 1), lattice(x0 + 1, z0 + 1), fx),
      fz
    );
  };
}

/** Fractal sum of a noise function, normalized back to [0, 1]. */
export function fbm(noise, x, z, octaves = 3, lacunarity = 2, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Hermite smoothstep: 0 below edge0, 1 above edge1. */
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
