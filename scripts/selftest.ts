/**
 * Generates many random characters at every detail level and checks mesh
 * validity plus the structural integrity of every export format.
 *   npm test
 */
import { unzipSync, unzlibSync } from 'fflate';
import { buildHuman } from '../src/core/human';
import type { MeshData } from '../src/core/mesh';
import { DEFAULT_PARAMS, DETAILS, PRESETS, randomParams, type HumanParams } from '../src/core/params';
import { exportCharacter } from '../src/export';
import { dressing, GARMENTS } from '../src/core/garments';
import { Animator } from '../src/core/anim/evaluate';
import { CLIPS } from '../src/core/anim/clips';
import { nodeLibrary } from './node-assets';

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error('FAIL', msg);
};

function checkMesh(m: MeshData, label: string, height: number) {
  const vc = m.positions.length / 3;
  for (const arr of [m.positions, m.normals, m.uvs])
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return fail(`${label}: non-finite vertex data`);
  for (let i = 0; i < m.normals.length; i += 3) {
    const l = Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]);
    if (Math.abs(l - 1) > 1e-3) return fail(`${label}: non-unit normal (${l})`);
  }
  for (const g of m.groups) {
    if (g.indices.length % 3) fail(`${label}: index count not multiple of 3`);
    for (const i of g.indices) if (i >= vc) return fail(`${label}: index out of range`);
    const corners = g.polySizes.reduce((s, n) => s + n, 0);
    if (corners !== g.polyIndices.length) fail(`${label}: polygon corner count mismatch`);
  }
  if (m.joints && m.weights) {
    for (let v = 0; v < vc; v++) {
      const s = m.weights[v * 4] + m.weights[v * 4 + 1] + m.weights[v * 4 + 2] + m.weights[v * 4 + 3];
      if (Math.abs(s - 1) > 1e-3) return fail(`${label}: weights of vertex ${v} sum to ${s}`);
    }
  }
  let minY = Infinity;
  for (let i = 1; i < m.positions.length; i += 3) minY = Math.min(minY, m.positions[i]);
  if (Math.abs(minY) > 0.002) fail(`${label}: not on ground (minY=${minY.toFixed(4)})`);
  if (height < 0.8 || height > 2.6) fail(`${label}: implausible height ${height.toFixed(2)} m`);
}

/** Minimal binary FBX parser: walks every node record and checks offsets. */
function parseFbx(data: Uint8Array, label: string): Map<string, number> {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (new TextDecoder().decode(data.subarray(0, 18)) !== 'Kaydara FBX Binary') fail(`${label}: bad FBX magic`);
  const counts = new Map<string, number>();
  const readNode = (o: number): number => {
    const end = dv.getUint32(o, true);
    if (end === 0) return o + 13;
    const nprops = dv.getUint32(o + 4, true);
    const plen = dv.getUint32(o + 8, true);
    const nlen = data[o + 12];
    const name = new TextDecoder().decode(data.subarray(o + 13, o + 13 + nlen));
    counts.set(name, (counts.get(name) ?? 0) + 1);
    let p = o + 13 + nlen;
    const pEnd = p + plen;
    for (let i = 0; i < nprops; i++) {
      const t = String.fromCharCode(data[p++]);
      if (t === 'C') p += 1;
      else if (t === 'Y') p += 2;
      else if (t === 'I' || t === 'F') p += 4;
      else if (t === 'L' || t === 'D') p += 8;
      else if (t === 'S' || t === 'R') p += 4 + dv.getUint32(p, true);
      else if ('ilfdb'.includes(t)) {
        const len = dv.getUint32(p, true), enc = dv.getUint32(p + 4, true), clen = dv.getUint32(p + 8, true);
        const raw = data.subarray(p + 12, p + 12 + clen);
        const bytes = enc ? unzlibSync(raw) : raw;
        const size = t === 'd' || t === 'l' ? 8 : t === 'b' ? 1 : 4;
        if (bytes.length !== len * size) fail(`${label}: array ${name} decoded size mismatch`);
        p += 12 + clen;
      } else throw new Error(`${label}: unknown prop type ${t} in ${name}`);
    }
    if (p !== pEnd) fail(`${label}: property length mismatch in ${name}`);
    while (p < end) p = readNode(p);
    if (p !== end) fail(`${label}: end offset mismatch in ${name}`);
    return end;
  };
  let o = 27;
  while (dv.getUint32(o, true) !== 0) o = readNode(o);
  return counts;
}

const lib = await nodeLibrary();

async function checkExports(ch: Awaited<ReturnType<typeof buildHuman>>, label: string) {
  const glb = (await exportCharacter(lib, ch, 'glb')).data;
  const gdv = new DataView(glb.buffer, glb.byteOffset);
  if (gdv.getUint32(0, true) !== 0x46546c67 || gdv.getUint32(8, true) !== glb.length) fail(`${label}: bad GLB header`);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + gdv.getUint32(12, true))));
  if (json.meshes[0].primitives.length !== ch.mesh.groups.length) fail(`${label}: GLB primitive count`);
  const texCount = new Set(ch.mesh.materials.flatMap((m) => [m.map, m.normalMap]).filter(Boolean)).size;
  if ((json.images?.length ?? 0) !== texCount) fail(`${label}: GLB image count ${json.images?.length} != ${texCount}`);

  if (ch.rig) {
    if (!json.skins || json.skins[0].joints.length !== ch.rig.bones.length) fail(`${label}: GLB skin missing`);
    if (json.meshes[0].primitives[0].attributes.JOINTS_0 === undefined) fail(`${label}: GLB JOINTS_0 missing`);
    const want = ch.params.animations ? CLIPS.length : 0;
    if ((json.animations?.length ?? 0) !== want) fail(`${label}: GLB has ${json.animations?.length ?? 0} animations, expected ${want}`);
  }
  const counts = parseFbx((await exportCharacter(lib, ch, 'fbx')).data, label);
  if (ch.rig && (!counts.get('Pose') || (counts.get('Deformer') ?? 0) < 2)) fail(`${label}: FBX skin/bind pose missing`);
  if (ch.rig && ch.params.animations && counts.get('AnimationStack') !== CLIPS.length) fail(`${label}: FBX animation stacks ${counts.get('AnimationStack')}`);
  if (counts.get('Material') !== ch.mesh.materials.length) fail(`${label}: FBX material count`);
  if ((counts.get('Video') ?? 0) !== texCount) fail(`${label}: FBX embedded texture count`);

  const objZip = unzipSync((await exportCharacter(lib, ch, 'obj')).data);
  const objName = Object.keys(objZip).find((n) => n.endsWith('.obj'))!;
  const faces = new TextDecoder().decode(objZip[objName]).split('\n').filter((l) => l.startsWith('f ')).length;
  const polys = ch.mesh.groups.reduce((s, g) => s + g.polySizes.length, 0);
  if (faces !== polys) fail(`${label}: OBJ face count ${faces} != ${polys}`);
  if (Object.keys(objZip).filter((n) => n.startsWith('textures/')).length !== texCount) fail(`${label}: OBJ textures missing`);

  const zip = unzipSync((await exportCharacter(lib, ch, 'zip')).data);
  for (const ext of ['.glb', '.fbx', '.obj', '.mtl', '.params.json', 'LICENSE.txt'])
    if (!Object.keys(zip).some((n) => n.endsWith(ext))) fail(`${label}: zip missing ${ext}`);
}

const t0 = performance.now();
const cases: [string, HumanParams][] = [];
for (const [name, p] of Object.entries(PRESETS)) cases.push([`preset ${name}`, { ...DEFAULT_PARAMS, ...p, name }]);
for (let seed = 0; seed < 45; seed++) cases.push([`seed ${seed}`, { ...randomParams(seed, lib.catalog), detail: DETAILS[seed % 3] }]);
cases.push(['extremes min', { ...DEFAULT_PARAMS, age: 0.2, muscle: 0, weight: 0, height: 0, proportions: 0, gender: 0, detail: 'high' }]);
cases.push(['extremes max', { ...DEFAULT_PARAMS, age: 1, muscle: 1, weight: 1, height: 1, proportions: 1, gender: 1, detail: 'high' }]);
const allSliders = Object.fromEntries(lib.catalog.sliders.flatMap((g) => g.sliders.map((s) => [s.id, s.bipolar ? -0.7 : 0.7])));
cases.push(['every slider', { ...DEFAULT_PARAMS, modifiers: allSliders }]);
for (const o of lib.catalog.outfits) cases.push([`outfit ${o.id}`, { ...DEFAULT_PARAMS, outfit: o.id, gender: o.tags.includes('Female') ? 0 : 1 }]);
for (const h of lib.catalog.hair) cases.push([`hair ${h.id}`, { ...DEFAULT_PARAMS, hair: h.id, hat: 'fedora01' }]);
// Every procedural garment, on a female and a male body, at medium and HD.
for (const g of GARMENTS) {
  const slot = g.slot === 'acc' ? { accessories: [g.id] } : { [g.slot]: g.id };
  for (const [gender, detail] of [[0, 'medium'], [1, 'high']] as const)
    cases.push([`garment ${g.id} g${gender}`, { ...DEFAULT_PARAMS, outfit: 'none', gender, detail, ...slot }]);
}
cases.push(['sandals', { ...DEFAULT_PARAMS, outfit: 'none', shoes: 'sandals' }]);
cases.push(['barefoot', { ...DEFAULT_PARAMS, outfit: 'none', shoes: 'none', bottom: 'none' }]);

// Modesty rules: under-18 female characters always get a top; nobody is fully undressed.
{
  const teen = dressing({ ...DEFAULT_PARAMS, outfit: 'none', top: 'none', bottom: 'none', gender: 0, age: 0.3 });
  if (teen.top !== 'tank_top') fail('minor without top');
  if (teen.bottom !== 'briefs') fail('no bottom fallback');
  const adult = dressing({ ...DEFAULT_PARAMS, outfit: 'none', top: 'none', gender: 0, age: 0.6 });
  if (adult.top) fail('adult topless option not honoured');
  const bottomless = dressing({ ...DEFAULT_PARAMS, outfit: 'none', bottom: 'none', underwear: false, age: 0.6 });
  if (bottomless.bottom || bottomless.underwear) fail('adult bottomless option not honoured');
  for (const gender of [0, 1]) {
    const minor = dressing({ ...DEFAULT_PARAMS, outfit: 'none', bottom: 'none', underwear: false, age: 0.3, gender });
    if (minor.bottom !== 'briefs' || !minor.underwear) fail('minor without underwear');
  }
}
// Rig variants
for (const rig of ['game', 'game_lite', 'full', 'none'] as const)
  for (const restPose of ['A', 'T'] as const)
    cases.push([`rig ${rig} ${restPose}`, { ...DEFAULT_PARAMS, ...PRESETS['The Adventurer'], rig, restPose, faceBones: restPose === 'T' }]);
cases.push(['rig low detail', { ...DEFAULT_PARAMS, detail: 'low', restPose: 'T' }]);

for (const [label, p] of cases) {
  try {
    const ch = await buildHuman(lib, p);
    if ((p.rig ?? 'game') !== 'none' && (!ch.rig || !ch.mesh.joints)) fail(`${label}: not rigged`);
    if (ch.rig) for (const j of ch.mesh.joints!) if (j >= ch.rig.bones.length) { fail(`${label}: joint index out of range`); break; }
    checkMesh(ch.mesh, label, ch.height);
    // Every clip evaluates to finite, unit quaternions on every rig.
    if (ch.rig && label.startsWith('rig'))
      for (const c of CLIPS) {
        const { frames } = new Animator(ch.rig).bake(c, 10);
        for (const f of frames)
          for (const q of f.rot)
            if (!q.every(Number.isFinite) || Math.abs(Math.hypot(...q) - 1) > 1e-4) {
              fail(`${label}: clip ${c.id} produced a bad rotation`);
              break;
            }
      }
    if (label.startsWith('preset') || label.startsWith('seed 1') || label.startsWith('rig')) await checkExports(ch, label);
  } catch (e) {
    fail(`${label}: threw ${(e as Error).stack}`);
  }
}
console.log(`${cases.length} characters checked in ${((performance.now() - t0) / 1000).toFixed(1)} s, ${failures} failures`);
process.exit(failures ? 1 : 0);
