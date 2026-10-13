/**
 * Builds a complete character: morphed body + fitted proxies (eyes, brows,
 * lashes, hair, clothes, shoes, hat) + skeleton, as one multi-material mesh.
 */
import type { AssetLibrary, AssetMaterial, CatalogItem, ProxyMeta, Slider } from './assets';
import { compact, subdivide, type PolyMesh } from './geometry';
import type { Vec3 } from './math';
import { MeshAssembler, type Material, type MeshData } from './mesh';
import { applyTargets, targetWeights } from './morph';
import type { Pack } from './pack';
import { ageToYears, type HumanParams } from './params';

export interface Bone {
  name: string;
  parent: string | null;
  head: Vec3;
  tail: Vec3;
}

export interface Character {
  params: HumanParams;
  mesh: MeshData;
  bones: Bone[];
  /** Standing height in metres (body, without hair/hat). */
  height: number;
}

/** MakeHuman units are decimetres. */
const DM = 0.1;

const sliderCache = new WeakMap<AssetLibrary, Map<string, Slider>>();
function slidersOf(lib: AssetLibrary) {
  let m = sliderCache.get(lib);
  if (!m) sliderCache.set(lib, (m = new Map(lib.catalog.sliders.flatMap((g) => g.sliders.map((s) => [s.id, s] as const)))));
  return m;
}

/** Pick the skin texture closest to the character's ethnicity, sex and age. */
export function autoSkin(p: HumanParams, skins: CatalogItem[]): CatalogItem {
  const race = p.african >= p.asian && p.african >= p.caucasian ? 'african' : p.asian >= p.caucasian ? 'asian' : 'caucasian';
  const sex = p.gender >= 0.5 ? 'male' : 'female';
  const y = ageToYears(p.age);
  const ages = ['young', 'middleage', 'old'];
  const age = y < 38 ? 0 : y < 60 ? 1 : 2;
  let best = skins[0], bestScore = -Infinity;
  for (const s of skins) {
    const m = /^(young|middleage|old)_(african|asian|caucasian)_(male|female)(\d*)$/.exec(s.id);
    if (!m) continue;
    const score = (m[2] === race ? 8 : 0) + (m[3] === sex ? 4 : 0) - Math.abs(ages.indexOf(m[1]) - age) - (m[4] ? 0.1 : 0);
    if (score > bestScore) [best, bestScore] = [s, score];
  }
  return best;
}

function fit(proxy: Pack<ProxyMeta>, coords: Float32Array): Float32Array {
  const { refs, weights, offsets } = proxy.arrays as { refs: Uint32Array; weights: Float32Array; offsets: Float32Array };
  const sc = proxy.meta.scale.map((s, axis) =>
    s ? Math.abs(coords[s[0] * 3 + axis] - coords[s[1] * 3 + axis]) / s[2] : 1,
  );
  const n = proxy.meta.vertexCount;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = refs[i * 3] * 3, b = refs[i * 3 + 1] * 3, c = refs[i * 3 + 2] * 3;
    const wa = weights[i * 3], wb = weights[i * 3 + 1], wc = weights[i * 3 + 2];
    for (let d = 0; d < 3; d++)
      out[i * 3 + d] = wa * coords[a + d] + wb * coords[b + d] + wc * coords[c + d] + offsets[i * 3 + d] * sc[d];
  }
  return out;
}

function proxyMesh(proxy: Pack<ProxyMeta>, coords: Float32Array): PolyMesh {
  const a = proxy.arrays as Record<string, Uint8Array & Uint32Array & Float32Array>;
  return { positions: fit(proxy, coords), faceSizes: a.faceSizes, faceVerts: a.faceVerts, faceUVs: a.faceUVs, uvs: a.uvs };
}

function toMaterial(m: AssetMaterial, overrides: Partial<Material> = {}): Material {
  return {
    name: m.name, color: m.color, roughness: m.roughness, metalness: m.metalness,
    map: m.diffuse, normalMap: m.normal, alpha: m.alpha, doubleSided: m.doubleSided, ...overrides,
  };
}

/** Multiply two sRGB hex colours. */
function tint(a: string, b: string): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round((((pa >> s) & 255) * ((pb >> s) & 255)) / 255);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}

export async function buildHuman(lib: AssetLibrary, p: HumanParams): Promise<Character> {
  const cat = lib.catalog;
  const find = (items: CatalogItem[], id: string) => (id === 'none' ? undefined : items.find((i) => i.id === id));
  const outfit = find(cat.outfits, p.outfit);
  const shoes = find(cat.shoes, p.shoes);
  const hat = find(cat.hats, p.hat);
  const hair = find(cat.hair, p.hair);
  const brows = find(cat.eyebrows, p.eyebrows);
  const lashes = find(cat.eyelashes, p.eyelashes);
  const eyeMat = find(cat.eyes, p.eyes) ?? cat.eyes[0];
  const skin = p.skin === 'auto' ? autoSkin(p, cat.skins) : find(cat.skins, p.skin) ?? autoSkin(p, cat.skins);
  const low = p.detail === 'low';
  const bodyLod = low ? cat.bodies.find((b) => b.id === (p.gender >= 0.5 ? 'male1591' : 'female1605')) : undefined;

  const load = (item?: CatalogItem) => (item?.file ? lib.proxy(item.file) : Promise.resolve(undefined));
  const [pOutfit, pShoes, pHat, pHair, pBrows, pLashes, pEyes, pBody] = await Promise.all([
    load(outfit), load(shoes), load(hat), load(hair), load(brows), load(lashes),
    lib.proxy(low ? cat.eyeMesh.replace('high-poly', 'low-poly') : cat.eyeMesh), load(bodyLod),
  ]);

  const coords = applyTargets(lib, targetWeights(p, slidersOf(lib)));

  // --- Body (hide skin that clothes cover, to avoid poke-through) ---
  let body: PolyMesh;
  if (pBody) body = proxyMesh(pBody, coords);
  else {
    const hidden = new Uint8Array(lib.base.meta.vertexCount);
    for (const px of [pOutfit, pShoes, pHat]) if (px) for (const v of px.arrays.deleteVerts as Uint32Array) hidden[v] = 1;
    const fv = lib.base.arrays.faceVerts as Uint32Array;
    body = compact(
      {
        positions: coords,
        faceSizes: new Uint8Array(fv.length / 4).fill(4),
        faceVerts: fv,
        faceUVs: lib.base.arrays.faceUVs as Uint32Array,
        uvs: lib.base.arrays.uvs as Float32Array,
      },
      (_, c) => !(hidden[c[0]] | hidden[c[1]] | hidden[c[2]] | hidden[c[3]]),
    );
  }
  const hd = p.detail === 'high';
  if (hd) body = subdivide(body);

  const parts: [PolyMesh, Material][] = [];
  parts.push([body, { ...toMaterial(skin.material!), name: 'Skin', color: tint(skin.material!.color, p.skinTint), roughness: 0.55 }]);
  parts.push([proxyMesh(pEyes, coords), { ...toMaterial(eyeMat.material!), name: 'Eyes', alpha: 'mask' }]);
  if (pBrows && brows) parts.push([proxyMesh(pBrows, coords), { ...toMaterial(brows.material!), name: 'Eyebrows' }]);
  if (pLashes && lashes) parts.push([proxyMesh(pLashes, coords), { ...toMaterial(lashes.material!), name: 'Eyelashes' }]);
  if (pShoes && shoes) {
    const m = proxyMesh(pShoes, coords);
    parts.push([hd ? subdivide(m) : m, { ...toMaterial(shoes.material!), name: 'Shoes' }]);
  }
  if (pOutfit && outfit) {
    const m = proxyMesh(pOutfit, coords);
    const mat = toMaterial(outfit.material!);
    parts.push([hd ? subdivide(m) : m, { ...mat, name: 'Outfit', color: tint(mat.color, p.outfitTint) }]);
  }
  const hatMesh = pHat ? proxyMesh(pHat, coords) : undefined;
  if (pHair && hair) {
    const mat = toMaterial(hair.material!);
    let m = proxyMesh(pHair, coords);
    if (hatMesh) {
      // Drop hair polygons above the hat brim so hair doesn't poke through the crown.
      let brim = Infinity;
      for (let i = 1; i < hatMesh.positions.length; i += 3) brim = Math.min(brim, hatMesh.positions[i]);
      const P = m.positions;
      m = compact(m, (_, c) => c.reduce((s, v) => s + P[v * 3 + 1], 0) / c.length < brim + 0.05);
    }
    parts.push([m, { ...mat, name: 'Hair', color: tint(mat.color, p.hairTint), doubleSided: true }]);
  }
  if (hatMesh && hat) parts.push([hatMesh, { ...toMaterial(hat.material!), name: 'Hat' }]);

  // --- To metres, feet on the ground ---
  let minY = Infinity, maxBodyY = -Infinity;
  const ground = [body, ...(pShoes ? [parts.find((x) => x[1].name === 'Shoes')![0]] : [])];
  for (const m of ground) for (let i = 1; i < m.positions.length; i += 3) minY = Math.min(minY, m.positions[i]);
  for (let i = 1; i < body.positions.length; i += 3) maxBodyY = Math.max(maxBodyY, body.positions[i]);
  const xf = (src: Float32Array) => {
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      out[i] = src[i] * DM;
      out[i + 1] = (src[i + 1] - minY) * DM;
      out[i + 2] = src[i + 2] * DM;
    }
    return out;
  };
  const asm = new MeshAssembler();
  for (const [m, mat] of parts) asm.add({ ...m, positions: xf(m.positions) }, mat);

  // --- Skeleton joints: mean of their reference vertices ---
  const joint = (name: string): Vec3 => {
    const idx = lib.base.meta.joints[name];
    const s: Vec3 = [0, 0, 0];
    for (const v of idx) for (let d = 0; d < 3; d++) s[d] += coords[v * 3 + d];
    return [(s[0] / idx.length) * DM, (s[1] / idx.length - minY) * DM, (s[2] / idx.length) * DM];
  };
  const bones = lib.base.meta.bones.map((b) => ({ name: b.name, parent: b.parent, head: joint(b.head), tail: joint(b.tail) }));

  return { params: p, mesh: asm.build(), bones, height: (maxBodyY - minY) * DM };
}

/** Texture files referenced by a mesh. */
export function textureFiles(mesh: MeshData): string[] {
  return [...new Set(mesh.materials.flatMap((m) => [m.map, m.normalMap].filter((x): x is string => !!x)))];
}
