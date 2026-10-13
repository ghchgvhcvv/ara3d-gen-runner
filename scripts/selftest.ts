/**
 * Fuzz test: generates many random characters at every detail level and checks
 * mesh validity plus the structural integrity of every export format.
 *   npm test
 */
import { unzipSync, unzlibSync } from 'fflate';
import { generateCharacter } from '../src/core/character';
import { triangleCount, type MeshData } from '../src/core/mesh';
import { DETAILS, POSES, PRESETS, DEFAULT_PARAMS, randomParams, type CharacterParams } from '../src/core/params';
import { exportCharacter } from '../src/export';

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error('FAIL', msg);
};

function checkMesh(m: MeshData, label: string) {
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
  }
  let minY = Infinity;
  for (let i = 1; i < m.positions.length; i += 3) minY = Math.min(minY, m.positions[i]);
  if (Math.abs(minY) > 0.005) fail(`${label}: feet not on ground (minY=${minY.toFixed(4)})`);
}

/** Minimal binary FBX parser: walks every node record and checks offsets. */
function parseFbx(data: Uint8Array, label: string): Map<string, number> {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = new TextDecoder().decode(data.subarray(0, 18));
  if (magic !== 'Kaydara FBX Binary') fail(`${label}: bad FBX magic`);
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
        const len = dv.getUint32(p, true), encd = dv.getUint32(p + 4, true), clen = dv.getUint32(p + 8, true);
        const raw = data.subarray(p + 12, p + 12 + clen);
        const bytes = encd ? unzlibSync(raw) : raw;
        const el = t === 'd' || t === 'l' ? 8 : t === 'b' ? 1 : 4;
        if (bytes.length !== len * el) fail(`${label}: array ${name} decoded size mismatch`);
        p += 12 + clen;
      } else throw new Error(`${label}: unknown prop type ${t} in ${name}`);
    }
    if (p !== pEnd) fail(`${label}: property length mismatch in ${name}`);
    while (p < end) p = readNode(p);
    if (p !== end) fail(`${label}: end offset mismatch in ${name}`);
    return end;
  };
  let o = 27;
  for (;;) {
    if (dv.getUint32(o, true) === 0) break;
    o = readNode(o);
  }
  return counts;
}

function checkExports(ch: ReturnType<typeof generateCharacter>, label: string) {
  const glb = exportCharacter(ch, 'glb')[0].data;
  const gdv = new DataView(glb.buffer, glb.byteOffset);
  if (gdv.getUint32(0, true) !== 0x46546c67 || gdv.getUint32(8, true) !== glb.length) fail(`${label}: bad GLB header`);
  const jlen = gdv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jlen)));
  if (json.meshes[0].primitives.length !== ch.mesh.groups.length) fail(`${label}: GLB primitive count`);

  const counts = parseFbx(exportCharacter(ch, 'fbx')[0].data, label);
  if (counts.get('Material') !== ch.mesh.materials.length) fail(`${label}: FBX material count`);
  if (counts.get('Geometry') !== 1 || counts.get('Model') !== 1) fail(`${label}: FBX object count`);

  const [obj] = exportCharacter(ch, 'obj');
  const faces = new TextDecoder().decode(obj.data).split('\n').filter((l) => l.startsWith('f ')).length;
  if (faces !== triangleCount(ch.mesh)) fail(`${label}: OBJ face count ${faces} != ${triangleCount(ch.mesh)}`);

  const zip = unzipSync(exportCharacter(ch, 'zip')[0].data);
  const names = Object.keys(zip).map((n) => n.split('/').pop()!.split('.').slice(1).join('.'));
  for (const ext of ['glb', 'fbx', 'obj', 'mtl', 'params.json']) if (!names.includes(ext)) fail(`${label}: zip missing .${ext}`);
}

const t0 = performance.now();
const cases: [string, CharacterParams][] = [];
for (const [name, p] of Object.entries(PRESETS)) cases.push([`preset ${name}`, { ...DEFAULT_PARAMS, ...p, name }]);
for (let seed = 0; seed < 150; seed++) {
  const detail = DETAILS[seed % 3];
  const pose = POSES[(seed >> 2) % 2];
  cases.push([`seed ${seed}`, { ...randomParams(seed), detail, pose, flatShading: seed % 5 === 0, fingers: seed % 4 !== 0 }]);
}
// Extremes
cases.push(['extreme small', { ...DEFAULT_PARAMS, height: 1.0, headScale: 2.4, muscle: 0, bodyFat: 0, eyeSize: 2.2 }]);
cases.push(['extreme big', { ...DEFAULT_PARAMS, height: 2.3, headScale: 0.85, muscle: 1, bodyFat: 1, shoulderWidth: 1.35, hipWidth: 1.3 }]);

for (const [label, p] of cases) {
  try {
    const ch = generateCharacter(p);
    checkMesh(ch.mesh, label);
    checkExports(ch, label);
  } catch (e) {
    fail(`${label}: threw ${(e as Error).stack}`);
  }
}
console.log(`${cases.length} characters checked in ${((performance.now() - t0) / 1000).toFixed(1)} s, ${failures} failures`);
process.exit(failures ? 1 : 0);
