/**
 * Lofting: sweep a (super-elliptical) cross-section along a path. Almost every
 * body part, piece of clothing and accessory is built from this one primitive.
 */
import { MeshBuilder } from './mesh';
import type { Surface } from './patch';
import {
  cross, dot, length, lerp, lerpV, madd, normalize, pchip, scale, sub, type Vec3,
} from './math';

/** Cross-section in the ring's local frame. U = side axis, V = "front" axis. */
export interface Shape {
  rx: number; // half-extent along U
  rzF: number; // half-extent along +V
  rzB: number; // half-extent along -V
  n: number; // superellipse exponent: 2 = ellipse, higher = boxier
  ox: number; // centre offset along U
  oz: number; // centre offset along V
  /** Optional radial multiplier by angle (theta = PI/2 is +V / front). */
  mod?: (theta: number) => number;
}

export interface Path {
  point(t: number): Vec3;
  tangent(t: number): Vec3;
  length: number;
}

export function linePath(a: Vec3, b: Vec3): Path {
  const d = sub(b, a);
  const T = normalize(d);
  return { point: (t) => lerpV(a, b, t), tangent: () => T, length: length(d) };
}

/** Piecewise-linear path parametrised by arc length, with smoothed tangents at joints. */
export function polyPath(pts: Vec3[]): Path & { tAt: number[] } {
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    seg.push(length(sub(pts[i + 1], pts[i])));
    total += seg[i];
  }
  const tAt = [0];
  for (let i = 0; i < seg.length; i++) tAt.push(tAt[i] + seg[i] / total);
  const locate = (t: number) => {
    let i = 0;
    while (i < seg.length - 1 && t > tAt[i + 1]) i++;
    return { i, f: (t - tAt[i]) / (tAt[i + 1] - tAt[i]) };
  };
  const dir = (i: number) => normalize(sub(pts[i + 1], pts[i]));
  const blend = 0.06;
  return {
    tAt,
    length: total,
    point: (t) => {
      const { i, f } = locate(t);
      return lerpV(pts[i], pts[i + 1], f);
    },
    tangent: (t) => {
      const { i } = locate(t);
      let T = dir(i);
      if (i > 0 && t - tAt[i] < blend) {
        const k = 0.5 + 0.5 * ((t - tAt[i]) / blend);
        T = normalize(lerpV(dir(i - 1), T, k));
      }
      if (i < seg.length - 1 && tAt[i + 1] - t < blend) {
        const k = 0.5 + 0.5 * ((tAt[i + 1] - t) / blend);
        T = normalize(lerpV(dir(i + 1), T, k));
      }
      return T;
    },
  };
}

export interface ShapeKey {
  t: number;
  rx: number;
  rzF: number;
  rzB?: number; // defaults to rzF
  n?: number;
  ox?: number;
  oz?: number;
}

/** Smoothly interpolated shape from keyframes along t. */
export function keyedShape(keys: ShapeKey[], defaultN = 2): (t: number) => Shape {
  const ts = keys.map((k) => k.t);
  const f = (sel: (k: ShapeKey) => number) => pchip(ts, keys.map(sel));
  const rx = f((k) => k.rx);
  const rzF = f((k) => k.rzF);
  const rzB = f((k) => k.rzB ?? k.rzF);
  const n = f((k) => k.n ?? defaultN);
  const ox = f((k) => k.ox ?? 0);
  const oz = f((k) => k.oz ?? 0);
  return (t) => ({ rx: rx(t), rzF: rzF(t), rzB: rzB(t), n: n(t), ox: ox(t), oz: oz(t) });
}

export interface Frame {
  C: Vec3;
  T: Vec3;
  U: Vec3;
  V: Vec3;
}

export type FrontRef = Vec3 | ((t: number) => Vec3);

export function frameAt(path: Path, front: FrontRef, t: number): Frame {
  const C = path.point(t);
  const T = path.tangent(t);
  let F = typeof front === 'function' ? front(t) : front;
  if (Math.abs(dot(F, T)) > 0.999) F = Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const U = normalize(cross(T, F));
  const V = cross(U, T);
  return { C, T, U, V };
}

const spow = (x: number, e: number) => Math.sign(x) * Math.pow(Math.abs(x), e);

export function ringPoint(fr: Frame, s: Shape, theta: number, inflate: number): Vec3 {
  const c = Math.cos(theta), sn = Math.sin(theta);
  const e = 2 / s.n;
  const m = (s.mod ? s.mod(theta) : 1) * inflate;
  const x = s.rx * spow(c, e) * m + s.ox;
  const z = (sn >= 0 ? s.rzF : s.rzB) * spow(sn, e) * m + s.oz;
  return madd(madd(fr.C, fr.U, x), fr.V, z);
}

export interface Span {
  t0: number;
  t1: number;
  mat: number;
  inflate: number;
  /** Optional re-mapping of ring spacing inside the span (s in [0,1] -> [0,1]). */
  warp?: (s: number) => number;
}

export interface LoftOpts {
  path: Path;
  shape: (t: number) => Shape;
  front: FrontRef;
  spans: Span[];
  radial: number;
  /** Rings per metre of path length. */
  density: number;
  minRings?: number;
  capStart?: boolean;
  capEnd?: boolean;
  bone: number | ((t: number) => number);
  /** Rotates where the UV seam / first vertex sits. Default: back (-V). */
  thetaStart?: number;
}

const EPS_T = 1e-3;
const EPS_TH = 1e-3;

/** Build a loft into the mesh builder. Returns nothing; geometry is appended. */
export function loft(b: MeshBuilder, o: LoftOpts): void {
  const R = o.radial;
  const th0 = o.thetaStart ?? -Math.PI / 2;
  const boneAt = (t: number) => (typeof o.bone === 'number' ? o.bone : o.bone(t));

  interface Ring {
    idx: number[];
    pts: Vec3[];
    t: number;
    inflate: number;
    fr: Frame;
  }

  const makeRing = (t: number, inflate: number): Ring => {
    const fr = frameAt(o.path, o.front, t);
    const sh = o.shape(t);
    const ta = Math.max(0, t - EPS_T), tb = Math.min(1, t + EPS_T);
    const fa = frameAt(o.path, o.front, ta), fb = frameAt(o.path, o.front, tb);
    const sa = o.shape(ta), sb = o.shape(tb);
    const centre = madd(madd(fr.C, fr.U, sh.ox), fr.V, sh.oz);
    const idx: number[] = [];
    const pts: Vec3[] = [];
    const bone = boneAt(t);
    for (let j = 0; j <= R; j++) {
      const th = th0 + (j / R) * Math.PI * 2;
      const p = ringPoint(fr, sh, th, inflate);
      const dTh = sub(ringPoint(fr, sh, th + EPS_TH, inflate), ringPoint(fr, sh, th - EPS_TH, inflate));
      const dT = sub(ringPoint(fb, sb, th, inflate), ringPoint(fa, sa, th, inflate));
      let n = cross(dTh, dT);
      const radial = sub(p, centre);
      if (length(n) < 1e-12) n = length(radial) > 1e-9 ? radial : scale(fr.T, t < 0.5 ? -1 : 1);
      n = normalize(n);
      if (dot(n, radial) < 0 && length(radial) > 1e-9) n = scale(n, -1);
      // At a closed pole, the numeric normal can be noisy: blend toward the axis.
      if (length(radial) < 1e-6) n = scale(fr.T, t < 0.5 ? -1 : 1);
      pts.push(p);
      idx.push(b.vertex(p, n, j / R, t, bone));
    }
    return { idx, pts, t, inflate, fr };
  };

  const band = (r0: Ring, r1: Ring, mat: number) => {
    for (let j = 0; j < R; j++) b.quad(r0.idx[j], r0.idx[j + 1], r1.idx[j + 1], r1.idx[j], mat);
  };

  /** Step face between two coincident rings of different size (clothing hem). */
  const hem = (inner: Ring, outer: Ring, facing: Vec3, mat: number) => {
    const bone = boneAt(inner.t);
    const a = inner.pts.map((p, j) => b.vertex(p, facing, j / R, inner.t, bone));
    const c = outer.pts.map((p, j) => b.vertex(p, facing, j / R, outer.t, bone));
    for (let j = 0; j < R; j++) b.quad(a[j], a[j + 1], c[j + 1], c[j], mat, facing);
  };

  const cap = (r: Ring, facing: Vec3, mat: number) => {
    const sh = o.shape(r.t);
    if (Math.max(sh.rx, sh.rzF, sh.rzB) * r.inflate < 1e-5) return;
    const bone = boneAt(r.t);
    const centre = madd(madd(r.fr.C, r.fr.U, sh.ox), r.fr.V, sh.oz);
    const ci = b.vertex(centre, facing, 0.5, r.t, bone);
    const ring = r.pts.map((p, j) => b.vertex(p, facing, j / R, r.t, bone));
    for (let j = 0; j < R; j++) b.tri(ci, ring[j], ring[j + 1], mat, facing);
  };

  let prev: Ring | null = null;
  let prevMat = -1;
  let first: Ring | null = null;
  for (const span of o.spans) {
    const lenT = span.t1 - span.t0;
    if (lenT <= 0) continue;
    const n = Math.max(o.minRings ?? 1, Math.ceil(o.path.length * lenT * o.density));
    let last: Ring | null = null;
    for (let k = 0; k <= n; k++) {
      const s = span.warp ? span.warp(k / n) : k / n;
      const t = lerp(span.t0, span.t1, s);
      let ring: Ring;
      if (k === 0 && prev && Math.abs(prev.inflate - span.inflate) < 1e-9) {
        ring = prev;
      } else {
        ring = makeRing(t, span.inflate);
        if (k === 0 && prev) {
          const prevBigger = prev.inflate > span.inflate;
          const facing = scale(ring.fr.T, prevBigger ? 1 : -1);
          if (prevBigger) hem(ring, prev, facing, prevMat);
          else hem(prev, ring, facing, span.mat);
        }
      }
      if (!first) first = ring;
      if (last) band(last, ring, span.mat);
      last = ring;
    }
    prev = last;
    prevMat = span.mat;
  }
  if (o.capStart && first) cap(first, scale(first.fr.T, -1), o.spans[0].mat);
  if (o.capEnd && prev) cap(prev, prev.fr.T, prevMat);
}

/** Layered material regions along a loft, resolved into non-overlapping spans. */
export interface Layer {
  t0: number;
  t1: number;
  mat: number;
  inflate: number;
  priority: number;
}

export function resolveLayers(base: { mat: number; inflate: number }, layers: Layer[]): Span[] {
  const cuts = new Set<number>([0, 1]);
  for (const l of layers) {
    cuts.add(Math.min(1, Math.max(0, l.t0)));
    cuts.add(Math.min(1, Math.max(0, l.t1)));
  }
  const ts = [...cuts].sort((a, b) => a - b);
  const spans: Span[] = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const mid = (t0 + t1) / 2;
    let top: { mat: number; inflate: number; priority: number } = { ...base, priority: -Infinity };
    for (const l of layers) if (mid >= l.t0 && mid <= l.t1 && l.priority > top.priority) top = l;
    const last = spans[spans.length - 1];
    if (last && last.mat === top.mat && last.inflate === top.inflate) last.t1 = t1;
    else spans.push({ t0, t1, mat: top.mat, inflate: top.inflate });
  }
  return spans;
}

/** Cosine spacing: denser rings near both ends (good for spheres / rounded tips). */
export const cosWarp = (s: number) => (1 - Math.cos(Math.PI * s)) / 2;

export interface EllipsoidOpts {
  center: Vec3;
  /** Unit direction of the "length" axis. */
  axis: Vec3;
  /** Reference "front" direction for the cross-section V axis. */
  front: Vec3;
  rLen: number;
  rU: number;
  rV: number;
  mat: number;
  bone: number;
  radial: number;
  rings: number;
  n?: number;
}

export function ellipsoid(b: MeshBuilder, o: EllipsoidOpts): void {
  const a = madd(o.center, o.axis, -o.rLen);
  const c = madd(o.center, o.axis, o.rLen);
  const path = linePath(a, c);
  loft(b, {
    path,
    front: o.front,
    shape: (t) => {
      const k = Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
      return { rx: o.rU * k, rzF: o.rV * k, rzB: o.rV * k, n: o.n ?? 2, ox: 0, oz: 0 };
    },
    spans: [{ t0: 0, t1: 1, mat: o.mat, inflate: 1, warp: cosWarp }],
    radial: o.radial,
    density: 0,
    minRings: o.rings,
    bone: o.bone,
  });
}

/** Tapered spike from base to tip. */
export function cone(
  b: MeshBuilder,
  base: Vec3,
  tip: Vec3,
  r: number,
  mat: number,
  bone: number,
  radial: number,
  front: Vec3 = [0, 0, 1],
): void {
  loft(b, {
    path: linePath(base, tip),
    front,
    shape: (t) => {
      const k = r * Math.pow(1 - t, 0.9);
      return { rx: k, rzF: k, rzB: k, n: 2, ox: 0, oz: 0 };
    },
    spans: [{ t0: 0, t1: 1, mat, inflate: 1 }],
    radial,
    density: 0,
    minRings: 3,
    capStart: true,
    bone,
  });
}


/** Expose a loft's outer surface (theta, t) so shells (hair, hats) can hug it. */
export function loftSurface(path: Path, shape: (t: number) => Shape, front: FrontRef): Surface {
  const ct = (t: number) => Math.min(1, Math.max(0, t));
  const point = (th: number, t: number) => ringPoint(frameAt(path, front, ct(t)), shape(ct(t)), th, 1);
  return {
    point,
    normal(th, t) {
      t = ct(t);
      const fr = frameAt(path, front, t);
      const sh = shape(t);
      const p = point(th, t);
      const centre = madd(madd(fr.C, fr.U, sh.ox), fr.V, sh.oz);
      const dTh = sub(point(th + EPS_TH, t), point(th - EPS_TH, t));
      const dT = sub(point(th, t + EPS_T), point(th, t - EPS_T));
      let n = cross(dTh, dT);
      const radial = sub(p, centre);
      if (length(n) < 1e-10 || length(radial) < 1e-6) return scale(fr.T, t < 0.5 ? -1 : 1);
      n = normalize(n);
      return dot(n, radial) < 0 ? scale(n, -1) : n;
    },
  };
}
