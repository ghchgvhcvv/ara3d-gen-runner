/**
 * Hair, facial hair and hats. All are shells laid over the generated head
 * surface, so they adapt to head width, jaw, chibi proportions, etc.
 */
import type { Ctx, Head } from './character';
import { cone, ellipsoid, keyedShape, loft, polyPath } from './loft';
import { add, clamp, lerp, madd, normalize, scale, smoothstep, sub, type Vec3 } from './math';
import { patch } from './patch';
import { J } from './skeleton';

const FRONT = Math.PI / 2;
const BACK = -Math.PI / 2;
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

/** Angular distance from the face direction, in [0, PI]. */
function fromFront(th: number): number {
  let a = Math.abs(th - FRONT) % (2 * Math.PI);
  if (a > Math.PI) a = 2 * Math.PI - a;
  return a;
}

/** Hairline height (head t) as a function of angle: front, sides, back. */
function hairline(front: number, side: number, back: number) {
  return (th: number) => {
    const a = fromFront(th);
    return a < Math.PI / 2
      ? lerp(front, side, smoothstep(0, 1, a / (Math.PI / 2)))
      : lerp(side, back, smoothstep(0, 1, (a - Math.PI / 2) / (Math.PI / 2)));
  };
}

function cols(ctx: Ctx) {
  return Math.round(ctx.q.headRadial * 1.5);
}
function rows(ctx: Ctx) {
  return [6, 12, 18][['low', 'medium', 'high'].indexOf(ctx.p.detail)];
}

/** A full-circle shell from a hairline up to the crown. */
function cap(
  ctx: Ctx, head: Head, mat: number,
  tMin: (th: number) => number, thick: (th: number, t: number) => number,
  displace?: (th: number, t: number) => number,
) {
  patch(ctx.b, {
    surf: head.surf, thickness: thick, displace,
    theta0: BACK, theta1: BACK + 2 * Math.PI,
    tMin, tMax: () => 1,
    cols: cols(ctx), rows: rows(ctx), mat, bone: J.Head, rimBottom: true,
  });
}

export function buildHair(ctx: Ctx, head: Head) {
  const { p, pr, mat, q, b } = ctx;
  const h = pr.headH;
  let style = p.hairStyle;
  const hatted = p.hat !== 'none';
  if (hatted && (style === 'spiky' || style === 'mohawk' || style === 'afro' || style === 'bun')) style = 'short';
  if (style === 'bald') return;
  const S = head.surf;

  const fringe = (th: number) => {
    const a = fromFront(th);
    return a < 1.1 ? 0.03 * Math.abs(Math.sin(th * 7)) * (1 - a / 1.1) : 0;
  };

  switch (style) {
    case 'buzz':
      cap(ctx, head, mat.hair, hairline(0.8, 0.6, 0.33), () => 0.012 * h);
      break;
    case 'short':
    case 'spiky': {
      const hl = hairline(0.79, 0.6, 0.3);
      cap(ctx, head, mat.hair, (th) => hl(th) - fringe(th), (_, t) => (0.016 + 0.07 * smoothstep(0.55, 1, t)) * h);
      if (style === 'spiky') {
        const n = [8, 14, 20][['low', 'medium', 'high'].indexOf(p.detail)];
        for (let i = 0; i < n; i++) {
          const th = BACK + ((i + ctx.rand() * 0.6) / n) * 2 * Math.PI;
          const t = lerp(0.68, 0.98, ctx.rand());
          const nrm = S.normal(th, t);
          const base = madd(S.point(th, t), nrm, 0.05 * h);
          const dir = normalize(add(add(nrm, scale(Y, 0.5)), scale(Z, -0.25)));
          const len = lerp(0.18, 0.3, ctx.rand()) * h;
          cone(b, base, madd(base, dir, len), 0.075 * h, mat.hair, J.Head, q.small);
        }
      }
      break;
    }
    case 'long': {
      const hl = hairline(0.8, 0.32, 0.08);
      cap(ctx, head, mat.hair, (th) => hl(th) - fringe(th), (_, t) => (0.04 + 0.04 * smoothstep(0.6, 0.95, t)) * h);
      // Curtain down the back, resting on the shoulders.
      const backZ = -(0.066 * pr.B + 0.02 * pr.B);
      const path = polyPath([
        [0, pr.chinY + h * 0.6, -pr.headD * 0.3],
        [0, pr.chinY + h * 0.05, -pr.headD * 0.55],
        [0, pr.neckBaseY - 0.13 * pr.B, backZ],
      ]);
      const tm = path.tAt[1];
      const W = pr.headW, D = pr.headD;
      loft(b, {
        path, front: Z,
        shape: keyedShape([
          { t: 0, rx: W * 1.0, rzF: D * 0.6, rzB: D * 0.75, n: 2.4 },
          { t: tm, rx: W * 1.02, rzF: D * 0.3, rzB: D * 0.42, n: 2.6 },
          { t: 0.85, rx: W * 0.95, rzF: 0.012 * pr.B, rzB: 0.03 * pr.B, n: 2.6 },
          { t: 1, rx: W * 0.7, rzF: 0.01 * pr.B, rzB: 0.012 * pr.B, n: 2.6 },
        ]),
        spans: [{ t0: 0, t1: 1, mat: mat.hair, inflate: 1 }],
        radial: q.radial, density: q.density, minRings: 4, capEnd: true,
        bone: (t) => (t < tm ? J.Head : J.Neck),
      });
      break;
    }
    case 'ponytail':
    case 'bun': {
      cap(ctx, head, mat.hair, hairline(0.8, 0.6, 0.3), (_, t) => (0.025 + 0.015 * t) * h);
      if (style === 'bun') {
        const t = 0.86;
        const c = madd(S.point(BACK, t), S.normal(BACK, t), 0.13 * h);
        ellipsoid(b, {
          center: c, axis: Y, front: Z, rLen: 0.15 * h, rU: 0.17 * h, rV: 0.16 * h,
          mat: mat.hair, bone: J.Head, radial: q.small + 4, rings: q.smallRings + 2,
        });
      } else {
        const t = 0.62;
        const a = madd(S.point(BACK, t), S.normal(BACK, t), 0.02 * h);
        const at = (dz: number, dy: number): Vec3 => add(a, [0, dy * h, dz * h]);
        const path = polyPath([at(0.05, 0), at(-0.14, -0.04), at(-0.2, -0.35), at(-0.14, -0.62)]);
        loft(b, {
          path, front: Y,
          shape: keyedShape([
            { t: 0, rx: 0.08 * h, rzF: 0.08 * h },
            { t: 0.15, rx: 0.1 * h, rzF: 0.1 * h },
            { t: 0.55, rx: 0.08 * h, rzF: 0.08 * h },
            { t: 0.88, rx: 0.045 * h, rzF: 0.045 * h },
            { t: 1, rx: 0.004 * h, rzF: 0.004 * h },
          ]),
          spans: [{ t0: 0, t1: 1, mat: mat.hair, inflate: 1 }],
          radial: q.small + 2, density: q.density, minRings: 5, capStart: true, bone: J.Head,
        });
        ellipsoid(b, {
          center: at(-0.1, -0.025), axis: normalize(sub(at(-0.14, -0.04), at(0.05, 0))), front: Y,
          rLen: 0.03 * h, rU: 0.085 * h, rV: 0.085 * h,
          mat: mat.accent, bone: J.Head, radial: q.small + 2, rings: q.smallRings,
        });
      }
      break;
    }
    case 'mohawk': {
      cap(ctx, head, mat.hair, hairline(0.8, 0.6, 0.33), () => 0.007 * h);
      const pts: Vec3[] = [];
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const t = lerp(0.8, 1, i / steps);
        pts.push(madd(S.point(FRONT, t), S.normal(FRONT, t), 0.005 * h));
      }
      for (let i = steps - 1; i >= 0; i--) {
        const t = lerp(0.35, 1, i / steps);
        pts.push(madd(S.point(BACK, t), S.normal(BACK, t), 0.005 * h));
      }
      const path = polyPath(pts);
      loft(b, {
        path, front: (t) => normalize(sub(path.point(t), head.center)),
        shape: keyedShape([
          { t: 0, rx: 0.04 * h, rzF: 0.06 * h, rzB: 0.02 * h },
          { t: 0.25, rx: 0.05 * h, rzF: 0.2 * h, rzB: 0.02 * h },
          { t: 0.55, rx: 0.05 * h, rzF: 0.22 * h, rzB: 0.02 * h },
          { t: 0.85, rx: 0.04 * h, rzF: 0.12 * h, rzB: 0.02 * h },
          { t: 1, rx: 0.03 * h, rzF: 0.03 * h, rzB: 0.02 * h },
        ]),
        spans: [{ t0: 0, t1: 1, mat: mat.hair, inflate: 1 }],
        radial: q.small, density: q.density, minRings: 12, capStart: true, capEnd: true, bone: J.Head,
      });
      break;
    }
    case 'afro':
      cap(
        ctx, head, mat.hair, hairline(0.78, 0.55, 0.3),
        (_, t) => (0.22 + 0.1 * smoothstep(0.5, 0.95, t)) * h,
        (th, t) => 0.012 * h * Math.sin(th * 9) * Math.sin(t * 23),
      );
      break;
  }
}

export function buildFacialHair(ctx: Ctx, head: Head) {
  const { p, pr, mat, b } = ctx;
  if (p.facialHair === 'none') return;
  const h = pr.headH;
  const taper = (th0: number, th1: number) => (th: number) =>
    Math.pow(clamp(Math.sin((Math.PI * (th - th0)) / (th1 - th0)), 0, 1), 0.5);
  const piece = (th0: number, th1: number, tMin: (th: number) => number, tMax: (th: number) => number,
    thick: (th: number, t: number) => number, rimTop: boolean) => {
    patch(b, {
      surf: head.surf, thickness: thick, theta0: th0, theta1: th1, tMin, tMax,
      cols: Math.max(6, Math.round(ctx.q.headRadial * ((th1 - th0) / (2 * Math.PI)) * 2)),
      rows: Math.max(3, Math.round(rows(ctx) * 0.6)), mat: mat.hair, bone: J.Head,
      rimBottom: true, rimTop,
    });
  };
  // Mustache
  {
    const a = 0.55, tp = taper(FRONT - a, FRONT + a);
    piece(FRONT - a, FRONT + a, (th) => 0.29 + 0.03 * (1 - tp(th)), () => 0.345, (th) => 0.022 * h * tp(th), true);
  }
  if (p.facialHair === 'goatee') {
    const a = 0.5, tp = taper(FRONT - a, FRONT + a);
    piece(FRONT - a, FRONT + a, () => 0, () => 0.235, (th, t) => (0.03 + 0.02 * (1 - t / 0.235)) * h * tp(th), true);
  }
  if (p.facialHair === 'beard') {
    const a = 1.65, tp = taper(FRONT - a, FRONT + a);
    const top = (th: number) => lerp(0.235, 0.5, smoothstep(0.35, 1.3, fromFront(th)));
    piece(FRONT - a, FRONT + a, () => 0, top, (th, t) => (0.03 + 0.04 * (1 - smoothstep(0, 0.2, t))) * h * tp(th), true);
  }
}

export function buildHat(ctx: Ctx, head: Head) {
  const { p, pr, mat, b, q } = ctx;
  const h = pr.headH;
  const S = head.surf;
  switch (p.hat) {
    case 'none':
      return;
    case 'beanie': {
      const hl = hairline(0.74, 0.6, 0.42);
      cap(ctx, head, mat.accent, (th) => hl(th) + 0.1, () => 0.1 * h);
      patch(b, {
        surf: S, thickness: () => 0.125 * h,
        theta0: BACK, theta1: BACK + 2 * Math.PI, tMin: hl, tMax: (th) => hl(th) + 0.1,
        cols: cols(ctx), rows: 3, mat: mat.accent, bone: J.Head, rimBottom: true, rimTop: true,
      });
      const top = madd(S.point(FRONT, 1), Y, 0.1 * h);
      ellipsoid(b, {
        center: top, axis: Y, front: Z, rLen: 0.07 * h, rU: 0.08 * h, rV: 0.08 * h,
        mat: mat.accent, bone: J.Head, radial: q.small, rings: q.smallRings,
      });
      break;
    }
    case 'cap': {
      const hl = hairline(0.78, 0.62, 0.5);
      cap(ctx, head, mat.accent, hl, () => 0.085 * h);
      const tb = 0.78;
      const front = normalize(add(Z, scale(Y, -0.18)));
      const c = add(madd(S.point(FRONT, tb), S.normal(FRONT, tb), 0.07 * h), scale(Z, 0.12 * h));
      ellipsoid(b, {
        center: c, axis: [1, 0, 0], front, rLen: pr.headW * 0.85, rU: 0.018 * h, rV: 0.3 * h,
        mat: mat.accent, bone: J.Head, radial: q.small + 4, rings: q.smallRings + 2,
      });
      ellipsoid(b, {
        center: madd(S.point(FRONT, 1), Y, 0.085 * h), axis: Y, front: Z,
        rLen: 0.02 * h, rU: 0.035 * h, rV: 0.035 * h,
        mat: mat.accent, bone: J.Head, radial: q.small, rings: q.smallRings,
      });
      break;
    }
    case 'helmet': {
      const hl = hairline(0.72, 0.38, 0.28);
      cap(ctx, head, mat.metal, hl, () => 0.11 * h);
      // Crest along the midline.
      const pts: Vec3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = lerp(0.78, 1, i / 8);
        pts.push(madd(S.point(FRONT, t), S.normal(FRONT, t), 0.1 * h));
      }
      for (let i = 7; i >= 0; i--) {
        const t = lerp(0.4, 1, i / 8);
        pts.push(madd(S.point(BACK, t), S.normal(BACK, t), 0.1 * h));
      }
      const path = polyPath(pts);
      loft(b, {
        path, front: (t) => normalize(sub(path.point(t), head.center)),
        shape: keyedShape([
          { t: 0, rx: 0.025 * h, rzF: 0.02 * h, rzB: 0.01 * h },
          { t: 0.3, rx: 0.03 * h, rzF: 0.12 * h, rzB: 0.01 * h },
          { t: 0.7, rx: 0.03 * h, rzF: 0.1 * h, rzB: 0.01 * h },
          { t: 1, rx: 0.025 * h, rzF: 0.02 * h, rzB: 0.01 * h },
        ]),
        spans: [{ t0: 0, t1: 1, mat: mat.accent, inflate: 1 }],
        radial: q.small, density: q.density, minRings: 10, capStart: true, capEnd: true, bone: J.Head,
      });
      // Nose guard.
      const g0 = madd(S.point(FRONT, 0.74), S.normal(FRONT, 0.74), 0.1 * h);
      const g1 = add(madd(S.point(FRONT, 0.47), S.normal(FRONT, 0.47), 0.02 * h), scale(Z, 0.075 * h));
      loft(b, {
        path: polyPath([g0, g1]), front: Z,
        shape: keyedShape([{ t: 0, rx: 0.035 * h, rzF: 0.012 * h }, { t: 1, rx: 0.025 * h, rzF: 0.01 * h }], 3),
        spans: [{ t0: 0, t1: 1, mat: mat.metal, inflate: 1 }],
        radial: q.small, density: 0, minRings: 2, capStart: true, capEnd: true, bone: J.Head,
      });
      break;
    }
  }
}
