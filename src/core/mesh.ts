import type { PolyMesh } from './geometry';
import { vertexNormals } from './geometry';

export interface Material {
  name: string;
  /** sRGB hex colour; multiplies the texture when there is one. */
  color: string;
  roughness: number;
  metalness: number;
  /** Texture file names (see AssetLibrary.texture). */
  map?: string;
  normalMap?: string;
  alpha: 'opaque' | 'mask' | 'blend';
  doubleSided: boolean;
  /** sRGB hex glow colour (neon, visors). */
  emissive?: string;
  /** 0..1, for alpha 'blend' materials without a texture. */
  opacity?: number;
}

export interface MeshGroup {
  material: number;
  /** Triangle list (for GLB / real-time rendering). */
  indices: Uint32Array;
  /** Original polygons (mostly quads) for FBX / OBJ: sizes + flattened vertex indices. */
  polySizes: Uint8Array;
  polyIndices: Uint32Array;
}

/**
 * Format-neutral mesh. Units are metres, +Y up, character faces +Z, feet on y = 0.
 * Vertices are split at UV seams, so every vertex has exactly one uv.
 */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  groups: MeshGroup[];
  materials: Material[];
}

export function triangleCount(m: MeshData): number {
  return m.groups.reduce((s, g) => s + g.indices.length / 3, 0);
}

/** Accumulates parts (each a PolyMesh + material) into one MeshData. */
export class MeshAssembler {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private groups: MeshGroup[] = [];
  readonly materials: Material[] = [];

  add(part: PolyMesh, material: Material): void {
    const N = vertexNormals(part);
    const base = this.pos.length / 3;
    const key = new Map<number, number>(); // (vertex, uv) -> output index
    const nUV = part.uvs.length / 2;
    const polyIdx: number[] = [];
    const tris: number[] = [];
    for (let f = 0, c = 0; f < part.faceSizes.length; f++) {
      const n = part.faceSizes[f];
      const out: number[] = [];
      for (let k = 0; k < n; k++) {
        const v = part.faceVerts[c + k], t = part.faceUVs[c + k];
        const id = v * nUV + t;
        let o = key.get(id);
        if (o === undefined) {
          o = base + key.size;
          key.set(id, o);
          this.pos.push(part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]);
          this.nrm.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
          this.uv.push(part.uvs[t * 2], part.uvs[t * 2 + 1]);
        }
        out.push(o);
      }
      polyIdx.push(...out);
      for (let k = 1; k < n - 1; k++) tris.push(out[0], out[k], out[k + 1]);
      c += n;
    }
    this.materials.push(material);
    this.groups.push({
      material: this.materials.length - 1,
      indices: Uint32Array.from(tris),
      polySizes: Uint8Array.from(part.faceSizes),
      polyIndices: Uint32Array.from(polyIdx),
    });
  }

  build(): MeshData {
    return {
      positions: Float32Array.from(this.pos),
      normals: Float32Array.from(this.nrm),
      uvs: Float32Array.from(this.uv),
      groups: this.groups,
      materials: this.materials,
    };
  }
}
