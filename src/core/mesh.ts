import { cross, dot, normalize, sub, type Vec3 } from './math';

export interface Material {
  name: string;
  /** sRGB hex colour, e.g. "#c68642" */
  color: string;
  roughness: number;
  metalness: number;
}

export interface MeshGroup {
  material: number;
  /** Triangle list into the vertex arrays. */
  indices: Uint32Array;
}

/**
 * Format-neutral triangle mesh. Every exporter and the viewer consume this.
 * Units are metres, +Y up, character faces +Z, feet on y = 0.
 */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Primary bone index per vertex (into Skeleton.joints). Used for rigging later. */
  bones: Uint16Array;
  groups: MeshGroup[];
  materials: Material[];
}

export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private bone: number[] = [];
  private tris = new Map<number, number[]>();
  readonly materials: Material[] = [];
  private byName = new Map<string, number>();

  /** Register a material (by name) and return its index. */
  material(m: Material): number {
    const existing = this.byName.get(m.name);
    if (existing !== undefined) return existing;
    this.materials.push(m);
    this.byName.set(m.name, this.materials.length - 1);
    return this.materials.length - 1;
  }

  vertex(p: Vec3, n: Vec3, u: number, v: number, bone: number): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.bone.push(bone);
    return this.bone.length - 1;
  }

  private p(i: number): Vec3 {
    return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]];
  }
  private n(i: number): Vec3 {
    return [this.nrm[i * 3], this.nrm[i * 3 + 1], this.nrm[i * 3 + 2]];
  }

  /**
   * Add a triangle. Winding is fixed up automatically so the face points the
   * same way as `hint` (or the vertex normals when no hint is given).
   * Degenerate triangles (e.g. at loft poles) are dropped.
   */
  tri(a: number, b: number, c: number, mat: number, hint?: Vec3): void {
    const pa = this.p(a);
    const g = cross(sub(this.p(b), pa), sub(this.p(c), pa));
    if (dot(g, g) < 1e-20) return;
    let ref = hint;
    if (!ref) {
      const na = this.n(a), nb = this.n(b), nc = this.n(c);
      ref = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
    }
    let list = this.tris.get(mat);
    if (!list) this.tris.set(mat, (list = []));
    if (dot(g, ref) < 0) list.push(a, c, b);
    else list.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number, mat: number, hint?: Vec3): void {
    this.tri(a, b, c, mat, hint);
    this.tri(a, c, d, mat, hint);
  }

  get vertexCount(): number {
    return this.bone.length;
  }

  /** Finalise. `flat` un-welds every triangle and uses face normals (low-poly look). */
  build(flat = false): MeshData {
    // Drop materials that ended up with no triangles and compact indices.
    const used = [...this.tris.keys()].filter((m) => this.tris.get(m)!.length > 0).sort((a, b) => a - b);
    const materials = used.map((m) => this.materials[m]);

    if (!flat) {
      return {
        positions: new Float32Array(this.pos),
        normals: new Float32Array(this.nrm),
        uvs: new Float32Array(this.uv),
        bones: new Uint16Array(this.bone),
        groups: used.map((m, i) => ({ material: i, indices: new Uint32Array(this.tris.get(m)!) })),
        materials,
      };
    }

    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], bone: number[] = [];
    const groups: MeshGroup[] = [];
    used.forEach((m, gi) => {
      const src = this.tris.get(m)!;
      const idx: number[] = [];
      for (let t = 0; t < src.length; t += 3) {
        const [a, b, c] = [src[t], src[t + 1], src[t + 2]];
        const pa = this.p(a);
        const fn = normalize(cross(sub(this.p(b), pa), sub(this.p(c), pa)));
        for (const v of [a, b, c]) {
          idx.push(bone.length);
          pos.push(...this.p(v));
          nrm.push(...fn);
          uv.push(this.uv[v * 2], this.uv[v * 2 + 1]);
          bone.push(this.bone[v]);
        }
      }
      groups.push({ material: gi, indices: new Uint32Array(idx) });
    });
    return {
      positions: new Float32Array(pos),
      normals: new Float32Array(nrm),
      uvs: new Float32Array(uv),
      bones: new Uint16Array(bone),
      groups,
      materials,
    };
  }
}

export function triangleCount(m: MeshData): number {
  return m.groups.reduce((s, g) => s + g.indices.length / 3, 0);
}
