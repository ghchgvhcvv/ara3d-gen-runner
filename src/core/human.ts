/**
 * Builds a complete character: morphed body + fitted proxies (eyes, brows,
 * lashes, hair, clothes, shoes, hat) + skeleton, as one multi-material mesh.
 */
import type { AssetLibrary, AssetMaterial, CatalogItem, ProxyMeta, Slider } from './assets';
import { compact, subdivide, vertexNormals, type PolyMesh } from './geometry';
import { buildGarments, dressing } from './garments';
import type { Vec3 } from './math';
import { applyTPose, baseSkin, placeBones, skeletonDefs, skinFromRefs, skinPart, VertexGrid, type Rig } from './rig/rig';
import type { Skin } from './geometry';
import { MeshAssembler, type Material, type MeshData } from './mesh';
import { applyTargets, targetWeights } from './morph';
import type { Pack } from './pack';
import { ageToYears, type HumanParams } from './params';

export interface Character {
  params: HumanParams;
  mesh: MeshData;
  /** Skeleton + bind pose (absent when rigging is off). */
  rig?: Rig;
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

function proxyMesh(proxy: Pack<ProxyMeta>, coords: Float32Array, skin?: Skin): PolyMesh {
  const a = proxy.arrays as Record<string, Uint8Array & Uint32Array & Float32Array>;
  return {
    positions: fit(proxy, coords), faceSizes: a.faceSizes, faceVerts: a.faceVerts, faceUVs: a.faceUVs, uvs: a.uvs,
    skin: skin && skinFromRefs(a.refs, a.weights, skin),
  };
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
  const hat = find(cat.hats, p.hat);
  const hair = find(cat.hair, p.hair);
  const brows = find(cat.eyebrows, p.eyebrows);
  const lashes = find(cat.eyelashes, p.eyelashes);
  const eyeMat = find(cat.eyes, p.eyes) ?? cat.eyes[0];
  const skin = p.skin === 'auto' ? autoSkin(p, cat.skins) : find(cat.skins, p.skin) ?? autoSkin(p, cat.skins);
  const low = p.detail === 'low';
  const bodyLod = low ? cat.bodies.find((b) => b.id === (p.gender >= 0.5 ? 'male1591' : 'female1605')) : undefined;
  // Procedural footwear: combat boots reuse the boots asset plus generated shafts.
  const shoesItem = p.shoes === 'combat_boots' ? find(cat.shoes, 'shoes03') : find(cat.shoes, p.shoes);
  const pieces = dressing(p);

  const load = (item?: CatalogItem) => (item?.file ? lib.proxy(item.file) : Promise.resolve(undefined));
  const [pOutfit, pShoes, pHat, pHair, pBrows, pLashes, pEyes, pBody] = await Promise.all([
    load(outfit), load(shoesItem), load(hat), load(hair), load(brows), load(lashes),
    lib.proxy(low ? cat.eyeMesh.replace('high-poly', 'low-poly') : cat.eyeMesh), load(bodyLod),
  ]);

  const coords = applyTargets(lib, targetWeights(p, slidersOf(lib)));
  const fv = lib.base.arrays.faceVerts as Uint32Array;
  // Rigging: target skeleton and per-base-vertex weights; every part derives its weights from these.
  const rigged = p.rig !== 'none';
  const defs = rigged ? skeletonDefs(lib, { type: p.rig, face: p.faceBones }) : [];
  const bskin = rigged ? baseSkin(lib, defs) : undefined;
  const regions = lib.base.arrays.regions as Uint8Array;
  let grid: VertexGrid | undefined;
  const skinOf = (m: PolyMesh, k = 6): PolyMesh => {
    if (!bskin || m.skin) return m;
    grid ??= new VertexGrid(coords, (v) => regions[v] !== 255);
    return { ...m, skin: skinPart(m, bskin, grid, k) };
  };
  const fullBody: PolyMesh = {
    skin: bskin,
    positions: coords,
    faceSizes: new Uint8Array(fv.length / 4).fill(4),
    faceVerts: fv,
    faceUVs: lib.base.arrays.faceUVs as Uint32Array,
    uvs: lib.base.arrays.uvs as Float32Array,
  };

  // --- Procedural garments ---
  const gparts = buildGarments(lib, coords, vertexNormals(fullBody), fv, pieces);

  // --- Body (hide skin that clothes cover, to avoid poke-through) ---
  // Asset proxies hide any face touching one of their deleted vertices (MakeHuman behaviour);
  // fitted garments hide faces they fully cover.
  const assetDel = new Uint8Array(lib.base.meta.vertexCount);
  for (const px of [pOutfit, pShoes, pHat]) if (px) for (const v of px.arrays.deleteVerts as Uint32Array) assetDel[v] = 1;
  const coveredFaces = new Uint8Array(fv.length / 4);
  for (const g of gparts) if (g.hides) for (let f = 0; f < coveredFaces.length; f++) coveredFaces[f] |= g.hides[f];
  let body: PolyMesh = pBody
    ? proxyMesh(pBody, coords, bskin)
    : compact(fullBody, (f, c) => !(assetDel[c[0]] | assetDel[c[1]] | assetDel[c[2]] | assetDel[c[3]]) && !coveredFaces[f]);
  const hd = p.detail === 'high';
  if (hd) body = subdivide(body);

  const parts: [PolyMesh, Material][] = [];
  parts.push([body, { ...toMaterial(skin.material!), name: 'Skin', color: tint(skin.material!.color, p.skinTint), roughness: 0.55 }]);
  parts.push([proxyMesh(pEyes, coords, bskin), { ...toMaterial(eyeMat.material!), name: 'Eyes', alpha: 'mask' }]);
  if (pBrows && brows) parts.push([proxyMesh(pBrows, coords, bskin), { ...toMaterial(brows.material!), name: 'Eyebrows' }]);
  if (pLashes && lashes) parts.push([proxyMesh(pLashes, coords, bskin), { ...toMaterial(lashes.material!), name: 'Eyelashes' }]);
  const groundParts: PolyMesh[] = [];
  if (pShoes && shoesItem) {
    const m = proxyMesh(pShoes, coords, bskin);
    parts.push([hd ? subdivide(m) : m, { ...toMaterial(shoesItem.material!), name: 'Shoes' }]);
    groundParts.push(m);
  }
  if (pOutfit && outfit) {
    const m = proxyMesh(pOutfit, coords, bskin);
    const mat = toMaterial(outfit.material!);
    parts.push([hd ? subdivide(m) : m, { ...mat, name: 'Outfit', color: tint(mat.color, p.outfitTint) }]);
  }
  for (const g of gparts) {
    const m = skinOf(g.mesh, g.smooth ? 4 : 8);
    parts.push([hd && g.smooth ? subdivide(m) : m, g.material]);
    if (g.ground) groundParts.push(g.mesh);
  }
  const hatMesh = pHat ? proxyMesh(pHat, coords, bskin) : undefined;
  // Lowest point of anything covering the crown: hair above it is trimmed.
  let brim = Infinity;
  for (const m of [hatMesh, ...gparts.filter((g) => g.headwear).map((g) => g.mesh)])
    if (m) for (let i = 1; i < m.positions.length; i += 3) brim = Math.min(brim, m.positions[i]);
  if (pHair && hair) {
    const mat = toMaterial(hair.material!);
    let m = proxyMesh(pHair, coords, bskin);
    if (brim < Infinity) {
      const P = m.positions;
      m = compact(m, (_, c) => c.reduce((s, v) => s + P[v * 3 + 1], 0) / c.length < brim + 0.05);
    }
    parts.push([m, { ...mat, name: 'Hair', color: tint(mat.color, p.hairTint), doubleSided: true }]);
  }
  if (hatMesh && hat) parts.push([hatMesh, { ...toMaterial(hat.material!), name: 'Hat' }]);

  // --- To metres, feet on the ground ---
  let minY = Infinity, maxBodyY = -Infinity;
  for (const m of [body, ...groundParts]) for (let i = 1; i < m.positions.length; i += 3) minY = Math.min(minY, m.positions[i]);
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
  const out = parts.map(([m, mat]) => [{ ...m, positions: xf(m.positions) }, mat] as const);

  // --- Rig: bones placed on the morphed joints; optional T-pose re-posing ---
  let rig: Rig | undefined;
  if (rigged) {
    const joint = (name: string): Vec3 => {
      const idx = lib.base.meta.joints[name];
      const s: Vec3 = [0, 0, 0];
      for (const v of idx) for (let d = 0; d < 3; d++) s[d] += coords[v * 3 + d];
      return [(s[0] / idx.length) * DM, (s[1] / idx.length - minY) * DM, (s[2] / idx.length) * DM];
    };
    let bones = placeBones(defs, joint);
    if (p.restPose === 'T') bones = applyTPose(bones, out.map(([m]) => m));
    rig = { type: p.rig, restPose: p.restPose, bones };
  }

  const asm = new MeshAssembler();
  for (const [m, mat] of out) asm.add(m, mat);
  return { params: p, mesh: asm.build(), rig, height: (maxBodyY - minY) * DM };
}

/** Texture files referenced by a mesh. */
export function textureFiles(mesh: MeshData): string[] {
  return [...new Set(mesh.materials.flatMap((m) => [m.map, m.normalMap].filter((x): x is string => !!x)))];
}
