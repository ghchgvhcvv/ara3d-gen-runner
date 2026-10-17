/**
 * Skin overlay: tattoos, stubble and shaved-scalp hair are painted into one
 * RGBA texture in the base mesh's UV space and shown on a thin copy of the
 * body faces that carry any paint. Designs are evaluated on the *unmorphed*
 * base mesh, so they follow every body shape through the UVs and the texture
 * can be cached across slider changes.
 */
import type { AssetLibrary } from '../assets';
import { vertexNormals } from '../geometry';
import { encodePNG } from '../garments/textures';
import { makeBody, type Body } from '../garments/body';
import type { Vec3 } from '../math';

/** RGB 0..255 + alpha 0..1 (null / alpha 0 = no paint). */
export type Paint = [number, number, number, number] | null;

export interface Layer {
  /** Body regions this layer can paint (limits the faces rasterised). */
  regions: number[];
  /** Paint at a point on the base (unmorphed) body, in decimetres. */
  paint(p: Vec3, region: number, side: number): Paint;
}

const baseBodies = new WeakMap<AssetLibrary, Body>();
/** The unmorphed base body with its region coordinates (designs are defined on it). */
export function baseBody(lib: AssetLibrary): Body {
  let b = baseBodies.get(lib);
  if (!b) {
    const fv = lib.base.arrays.faceVerts as Uint32Array;
    const positions = lib.base.arrays.positions as Float32Array;
    const normals = vertexNormals({
      positions, faceVerts: fv, faceSizes: new Uint8Array(fv.length / 4).fill(4),
      faceUVs: lib.base.arrays.faceUVs as Uint32Array, uvs: lib.base.arrays.uvs as Float32Array,
    });
    b = makeBody(positions, normals, lib.base.arrays.regions as Uint8Array, lib.base.meta.joints);
    baseBodies.set(lib, b);
  }
  return b;
}

export interface Painted {
  /** PNG (RGBA). */
  png: Uint8Array;
  /** Base-mesh faces of the overlay: those that carry paint plus two rings of (transparent) neighbours. */
  faces: Uint8Array;
}

/** Grow a face selection by `rings` rings of vertex-adjacent faces. */
function grow(fv: Uint32Array, sel: Uint8Array, nVerts: number, rings: number): Uint8Array {
  const nf = fv.length / 4;
  let out = sel.slice();
  for (let ring = 0; ring < rings; ring++) {
    const vmark = new Uint8Array(nVerts);
    for (let f = 0; f < nf; f++) if (out[f]) for (let k = 0; k < 4; k++) vmark[fv[f * 4 + k]] = 1;
    const next = out.slice();
    for (let f = 0; f < nf; f++) if (!next[f]) for (let k = 0; k < 4; k++) if (vmark[fv[f * 4 + k]]) next[f] = 1;
    out = next;
  }
  return out;
}

/** Rasterise layers (composited in order, "over") into a size x size texture. */
export function paintOverlay(lib: AssetLibrary, layers: Layer[], size = 2048): Painted {
  const body = baseBody(lib);
  const P = body.coords;
  const fv = lib.base.arrays.faceVerts as Uint32Array;
  const fu = lib.base.arrays.faceUVs as Uint32Array;
  const uv = lib.base.arrays.uvs as Float32Array;
  const regions = body.regions;
  const nf = fv.length / 4;
  const rgba = new Float32Array(size * size * 4);
  const used = new Uint8Array(size * size); // texel inside some rasterised face
  const faces = new Uint8Array(nf);
  const wanted = new Set(layers.flatMap((l) => l.regions));

  const raster = (f: number, active: Layer[]) => {
    const region = regions[fv[f * 4]];
    const side = P[fv[f * 4] * 3] >= 0 ? 1 : -1;
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
      const ids = [a, b, c].map((k) => f * 4 + k);
      const tx = ids.map((i) => uv[fu[i] * 2] * size - 0.5);
      const ty = ids.map((i) => (1 - uv[fu[i] * 2 + 1]) * size - 0.5);
      const pv = ids.map((i) => fv[i]);
      const area = (tx[1] - tx[0]) * (ty[2] - ty[0]) - (tx[2] - tx[0]) * (ty[1] - ty[0]);
      if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(...tx))), x1 = Math.min(size - 1, Math.ceil(Math.max(...tx)));
      const y0 = Math.max(0, Math.floor(Math.min(...ty))), y1 = Math.min(size - 1, Math.ceil(Math.max(...ty)));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          // Barycentrics, with a small margin so neighbouring triangles overlap (no cracks).
          const w1 = ((x - tx[0]) * (ty[2] - ty[0]) - (tx[2] - tx[0]) * (y - ty[0])) / area;
          const w2 = ((tx[1] - tx[0]) * (y - ty[0]) - (x - tx[0]) * (ty[1] - ty[0])) / area;
          const w0 = 1 - w1 - w2;
          const e = -0.02;
          if (w0 < e || w1 < e || w2 < e) continue;
          const t = y * size + x;
          used[t] = 1;
          const p: Vec3 = [0, 0, 0];
          for (let d = 0; d < 3; d++) p[d] = P[pv[0] * 3 + d] * w0 + P[pv[1] * 3 + d] * w1 + P[pv[2] * 3 + d] * w2;
          for (const l of active) {
            const c = l.paint(p, region, side);
            if (!c || c[3] <= 0.002) continue;
            // "Over" compositing (premultiplied accumulation).
            const o = t * 4, A = c[3], keep = 1 - A;
            rgba[o] = c[0] * A + rgba[o] * keep;
            rgba[o + 1] = c[1] * A + rgba[o + 1] * keep;
            rgba[o + 2] = c[2] * A + rgba[o + 2] * keep;
            rgba[o + 3] = A + rgba[o + 3] * keep;
            faces[f] = 1;
          }
        }
    }
  };
  const done = new Uint8Array(nf);
  for (let f = 0; f < nf; f++) {
    const region = regions[fv[f * 4]];
    if (!wanted.has(region)) continue;
    raster(f, layers.filter((l) => l.regions.includes(region)));
    done[f] = 1;
  }
  // The overlay also shows transparent neighbours: claim their texels (so edge bleeding can't paint them).
  const sel = grow(fv, faces, P.length / 3, 2);
  for (let f = 0; f < nf; f++) if (sel[f] && !done[f]) raster(f, []);

  // Bleed colour (and alpha) a few texels past UV island edges so mipmaps don't show seams.
  for (let pass = 0; pass < 4; pass++) {
    const grow: number[] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const t = y * size + x;
        if (used[t]) continue;
        let n = 0;
        const acc = [0, 0, 0, 0];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= size || Y >= size) continue;
          const q = Y * size + X;
          if (!used[q]) continue;
          for (let k = 0; k < 4; k++) acc[k] += rgba[q * 4 + k];
          n++;
        }
        if (n) grow.push(t, acc[0] / n, acc[1] / n, acc[2] / n, acc[3] / n);
      }
    for (let i = 0; i < grow.length; i += 5) {
      const t = grow[i];
      used[t] = 1;
      for (let k = 0; k < 4; k++) rgba[t * 4 + k] = grow[i + 1 + k];
    }
  }

  const px = new Uint8Array(size * size * 4);
  for (let t = 0; t < size * size; t++) {
    const A = rgba[t * 4 + 3];
    if (A <= 0) continue;
    // Un-premultiply.
    px[t * 4] = Math.min(255, rgba[t * 4] / A);
    px[t * 4 + 1] = Math.min(255, rgba[t * 4 + 1] / A);
    px[t * 4 + 2] = Math.min(255, rgba[t * 4 + 2] / A);
    px[t * 4 + 3] = Math.round(Math.min(1, A) * 255);
  }
  return { png: encodePNG(size, size, px, true), faces: sel };
}

/**
 * The overlay surface: painted faces plus two rings of neighbours (so that
 * subdividing gives the same surface as the body underneath), minus faces
 * hidden under clothes.
 */
export function overlaySurface(faces: Uint8Array, hidden: Uint8Array): Uint8Array {
  const sel = faces.slice();
  for (let f = 0; f < sel.length; f++) if (hidden[f]) sel[f] = 0;
  return sel;
}
