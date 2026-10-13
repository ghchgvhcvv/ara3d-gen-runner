/**
 * Shells: a grid laid over an existing parametric surface (theta, t) and pushed
 * outward along its normal. Used for hair, beards and hats so they always hug
 * whatever head shape the generator produced.
 */
import { MeshBuilder } from './mesh';
import { cross, dot, length, lerp, madd, normalize, scale, sub, type Vec3 } from './math';

export interface Surface {
  point(theta: number, t: number): Vec3;
  normal(theta: number, t: number): Vec3;
}

export interface PatchOpts {
  surf: Surface;
  thickness: (theta: number, t: number) => number;
  theta0: number;
  theta1: number;
  tMin: (theta: number) => number;
  tMax: (theta: number) => number;
  cols: number;
  rows: number;
  mat: number;
  bone: number;
  /** Close the open lower edge back down to the surface. */
  rimBottom?: boolean;
  /** Close the open upper edge back down to the surface. */
  rimTop?: boolean;
  /** Extra outward displacement, e.g. for tufts. */
  displace?: (theta: number, t: number) => number;
}

export function patch(b: MeshBuilder, o: PatchOpts): void {
  const G = (th: number, s: number): Vec3 => {
    const t = lerp(o.tMin(th), o.tMax(th), s);
    const d = o.thickness(th, t) + (o.displace ? o.displace(th, t) : 0);
    return madd(o.surf.point(th, t), o.surf.normal(th, t), d);
  };
  const th = (j: number) => lerp(o.theta0, o.theta1, j / o.cols);
  const eps = 1e-3;

  const grid: number[][] = [];
  for (let i = 0; i <= o.rows; i++) {
    const s = i / o.rows;
    const row: number[] = [];
    for (let j = 0; j <= o.cols; j++) {
      const a = th(j);
      const p = G(a, s);
      const t = lerp(o.tMin(a), o.tMax(a), s);
      const base = o.surf.normal(a, t);
      const dA = sub(G(a + eps, s), G(a - eps, s));
      const dS = sub(G(a, Math.min(1, s + eps)), G(a, Math.max(0, s - eps)));
      let n = cross(dA, dS);
      n = length(n) < 1e-12 ? base : normalize(n);
      if (dot(n, base) < 0) n = scale(n, -1);
      row.push(b.vertex(p, n, j / o.cols, s, o.bone));
    }
    grid.push(row);
  }
  for (let i = 0; i < o.rows; i++)
    for (let j = 0; j < o.cols; j++)
      b.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j], o.mat);

  const rim = (s: number, dir: 1 | -1) => {
    const outer: number[] = [];
    const inner: number[] = [];
    for (let j = 0; j <= o.cols; j++) {
      const a = th(j);
      const t = lerp(o.tMin(a), o.tMax(a), s);
      const dS = sub(G(a, Math.min(1, s + eps)), G(a, Math.max(0, s - eps)));
      const facing = normalize(scale(dS, dir));
      // Tuck the inner edge slightly below the base surface to avoid z-fighting.
      const pIn = madd(o.surf.point(a, t), o.surf.normal(a, t), -0.002);
      outer.push(b.vertex(G(a, s), facing, j / o.cols, s, o.bone));
      inner.push(b.vertex(pIn, facing, j / o.cols, s, o.bone));
    }
    for (let j = 0; j < o.cols; j++) {
      const a = th(j + 0.5);
      const dS = sub(G(a, Math.min(1, s + eps)), G(a, Math.max(0, s - eps)));
      const hint = scale(dS, dir);
      b.quad(outer[j], outer[j + 1], inner[j + 1], inner[j], o.mat, hint);
    }
  };
  if (o.rimBottom) rim(0, -1);
  if (o.rimTop) rim(1, 1);
}
