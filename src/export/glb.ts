/** Binary glTF 2.0 (.glb) writer. One mesh, one primitive per material. */
import type { MeshData } from '../core/mesh';
import { hexToRgb, srgbToLinear } from '../core/math';

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

export function exportGLB(mesh: MeshData, name = 'Character'): Uint8Array {
  const chunks: Uint8Array[] = [];
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  let offset = 0;

  const addView = (data: Uint8Array, target: number) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      offset += pad;
    }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength, target });
    chunks.push(data);
    offset += data.byteLength;
    return bufferViews.length - 1;
  };
  const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

  const vcount = mesh.positions.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vcount; i++)
    for (let k = 0; k < 3; k++) {
      const v = mesh.positions[i * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }

  const uvs = new Float32Array(mesh.uvs.length);
  for (let i = 0; i < mesh.uvs.length; i += 2) {
    uvs[i] = mesh.uvs[i];
    uvs[i + 1] = 1 - mesh.uvs[i + 1]; // glTF UV origin is top-left
  }

  const addAttr = (data: Float32Array, type: string, extra: object = {}) => {
    accessors.push({ bufferView: addView(bytes(data), ARRAY_BUFFER), componentType: FLOAT, count: vcount, type, ...extra });
    return accessors.length - 1;
  };
  const POSITION = addAttr(mesh.positions, 'VEC3', { min, max });
  const NORMAL = addAttr(mesh.normals, 'VEC3');
  const TEXCOORD_0 = addAttr(uvs, 'VEC2');

  const small = vcount < 65536;
  const primitives = mesh.groups.map((g) => {
    const idx = small ? Uint16Array.from(g.indices) : g.indices;
    accessors.push({
      bufferView: addView(bytes(idx), ELEMENT_ARRAY_BUFFER),
      componentType: small ? UNSIGNED_SHORT : UNSIGNED_INT,
      count: g.indices.length,
      type: 'SCALAR',
    });
    return { attributes: { POSITION, NORMAL, TEXCOORD_0 }, indices: accessors.length - 1, material: g.material, mode: 4 };
  });

  const materials = mesh.materials.map((m) => ({
    name: m.name,
    pbrMetallicRoughness: {
      baseColorFactor: [...hexToRgb(m.color).map(srgbToLinear), 1],
      metallicFactor: m.metalness,
      roughnessFactor: m.roughness,
    },
  }));

  const json = {
    asset: { version: '2.0', generator: '3d-gen character generator' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };

  const binPad = (4 - (offset % 4)) % 4;
  const bin = new Uint8Array(offset + binPad);
  let o = 0;
  for (const c of chunks) {
    bin.set(c, o);
    o += c.byteLength;
  }
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }

  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  const b = 20 + jsonBytes.length;
  dv.setUint32(b, bin.length, true);
  dv.setUint32(b + 4, 0x004e4942, true); // "BIN\0"
  out.set(bin, b + 8);
  return out;
}
