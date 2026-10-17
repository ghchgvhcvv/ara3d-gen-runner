/**
 * "Looks": tattoos, procedural hairstyles, facial hair and earrings. Returns
 * mesh parts in morphed body space (decimetres); human.ts skins and places them.
 */
import type { AssetLibrary } from '../assets';
import { compact, type PolyMesh } from '../geometry';
import type { Material } from '../mesh';
import { ageToYears, type HumanParams } from '../params';
import { beardCards, boxBraids, cornrows, hairLayers, isProceduralHair, spikes, type HeadCtx } from './hair';
import { earrings, metalMaterial } from './jewelry';
import { baseBody, paintOverlay, overlaySurface, type Layer } from './overlay';
import { tattooLayers } from './tattoos';
import { braidTexture, hairCardTexture, spikeTexture } from './textures';
import type { TexOut } from '../garments/textures';
import { merge } from '../garments/ring';

export { TATTOOS, TATTOO_LABELS, type TattooId } from './tattoos';
export { FACIAL_HAIR, FACIAL_HAIR_LABELS, HAIRSTYLES, isProceduralHair, type FacialHairId, type HairstyleId } from './hair';
export { EARRINGS, EARRING_LABELS, type EarringId, type Metal } from './jewelry';

export interface LooksInput {
  p: HumanParams;
  /** Morphed base mesh coordinates and vertex normals (decimetres). */
  coords: Float32Array;
  normals: Float32Array;
  /** The full (skinned) base mesh with morphed positions. */
  fullBody: PolyMesh;
  /** Base faces hidden under clothes (the overlay skips them). */
  hidden: Uint8Array;
  /** Neck base height (dm): box braids stop above the shoulders. */
  neckY: number;
  low: boolean;
}

export interface Looks {
  /** Skin overlay (tattoos, stubble, shaved scalp): already skinned via the body. */
  overlay?: [PolyMesh, Material];
  /** Scalp hair geometry (skin to the head). */
  hair: [PolyMesh, Material][];
  /** Beard / mustache cards (skin to head + neck, so the jaw moves them). */
  beard: [PolyMesh, Material][];
  /** Earrings (skin to the head). */
  jewelry: [PolyMesh, Material][];
}

/** Which base faces carry paint, per overlay texture. */
const paintedFaces = new WeakMap<AssetLibrary, Map<string, Uint8Array>>();

function hashKey(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Register a generated texture once; returns its file names. */
function tex(lib: AssetLibrary, id: string, make: () => TexOut): { map: string; normalMap?: string } {
  const map = `${id}.png`, normalMap = `${id}_n.png`;
  if (!lib.hasTexture(map)) {
    const t = make();
    lib.registerTexture(map, t.color);
    if (t.normal) lib.registerTexture(normalMap, t.normal);
  }
  return { map, normalMap: lib.hasTexture(normalMap) ? normalMap : undefined };
}

export function buildLooks(lib: AssetLibrary, i: LooksInput): Looks {
  const { p } = i;
  const out: Looks = { hair: [], beard: [], jewelry: [] };
  const base = baseBody(lib);
  const adult = ageToYears(p.age) >= 18;
  const tattoos = adult ? [...new Set(p.tattoos ?? [])].sort() : [];
  const facial = p.facialHair ?? 'none';
  const hairColor = p.hairColor ?? '#2a1e16';
  const beardColor = p.beardColor ?? '#241a13';
  const proc = isProceduralHair(p.hair) ? p.hair : '';

  // --- Skin overlay ---
  const layers: Layer[] = [...hairLayers(proc, facial, hairColor, beardColor), ...tattooLayers(base, tattoos, p.tattooInk ?? '#1c2128')];
  if (layers.length) {
    const size = i.low ? 1024 : 2048;
    const key = `look_${hashKey(JSON.stringify([tattoos, p.tattooInk, proc, facial, hairColor, beardColor, size]))}`;
    const map = `${key}.png`;
    let cache = paintedFaces.get(lib);
    if (!cache) paintedFaces.set(lib, (cache = new Map()));
    let faces = cache.get(key);
    if (!faces || !lib.hasTexture(map)) {
      const painted = paintOverlay(lib, layers, size);
      lib.registerTexture(map, painted.png);
      cache.set(key, (faces = painted.faces));
    }
    const sel = overlaySurface(faces, i.hidden);
    // Offset along the body normals: 0.4 mm (more on the low-poly proxy body).
    const d = i.low ? 0.02 : 0.004;
    const positions = new Float32Array(i.coords.length);
    for (let k = 0; k < positions.length; k++) positions[k] = i.coords[k] + i.normals[k] * d;
    const mesh = compact({ ...i.fullBody, positions }, (f) => sel[f] === 1);
    if (mesh.faceSizes.length)
      out.overlay = [mesh, { name: 'Skin details', color: '#ffffff', roughness: 0.6, metalness: 0, alpha: 'blend', doubleSided: false, map }];
  }

  // --- Geometry ---
  const ctx: HeadCtx = {
    base, coords: i.coords, normals: i.normals, regions: base.regions, faceVerts: lib.base.arrays.faceVerts as Uint32Array,
    seed: p.seed, low: i.low,
  };
  const hairMat = (name: string, t: { map: string; normalMap?: string }, extra: Partial<Material> = {}): Material => ({
    name, color: hairColor, roughness: 0.55, metalness: 0, alpha: 'opaque', doubleSided: false, ...t, ...extra,
  });
  if (proc === 'mohawk') {
    const m = spikes(ctx);
    if (m) out.hair.push([m, hairMat('Hair spikes', tex(lib, 'gen_hair_spike', spikeTexture))]);
  } else if (proc === 'cornrows') {
    const m = cornrows(ctx);
    if (m) out.hair.push([m, hairMat('Braids', tex(lib, 'gen_hair_braid', braidTexture))]);
  } else if (proc === 'box_braids') {
    const m = boxBraids(ctx, i.neckY + 0.25);
    if (m) out.hair.push([m, hairMat('Braids', tex(lib, 'gen_hair_braid', braidTexture))]);
  }
  const beard = beardCards(ctx, facial);
  if (beard)
    out.beard.push([beard, hairMat('Beard', tex(lib, 'gen_hair_card', hairCardTexture), { color: beardColor, alpha: 'mask', doubleSided: true, roughness: 0.75 })]);

  const ear = p.earrings ?? 'none';
  const rings = merge(earrings(ear, base, i.coords, i.normals));
  if (rings) out.jewelry.push([rings, metalMaterial(p.earringMetal ?? 'gold')]);
  return out;
}
