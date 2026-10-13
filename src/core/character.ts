/**
 * Character generator: params -> skeleton + single multi-material mesh.
 */
import {
  ellipsoid, keyedShape, linePath, loft, loftSurface, polyPath, resolveLayers,
  type Layer, type Shape,
} from './loft';
import { MeshBuilder, type MeshData } from './mesh';
import {
  add, clamp, cross, hexToRgb, lerp, madd, normalize, rgbToHex, rng, scale, shade, type Vec3,
} from './math';
import type { CharacterParams } from './params';
import type { Surface } from './patch';
import {
  buildSkeleton, computeProportions, J, sideJoint, type Proportions, type Skeleton,
} from './skeleton';
import { buildFacialHair, buildHair, buildHat } from './hair';

export interface Quality {
  radial: number; // limbs
  torsoRadial: number;
  headRadial: number;
  density: number; // rings per metre
  small: number; // radial segments for small details
  smallRings: number;
}

const QUALITY: Record<CharacterParams['detail'], Quality> = {
  low: { radial: 8, torsoRadial: 12, headRadial: 12, density: 14, small: 6, smallRings: 4 },
  medium: { radial: 14, torsoRadial: 22, headRadial: 22, density: 34, small: 8, smallRings: 6 },
  high: { radial: 20, torsoRadial: 32, headRadial: 32, density: 60, small: 12, smallRings: 9 },
};

export interface Mats {
  skin: number; lips: number; eyeWhite: number; iris: number; pupil: number; hair: number;
  top: number; bottom: number; shoes: number; sole: number; accent: number; metal: number; gold: number;
}

export interface Head {
  surf: Surface;
  center: Vec3;
}

export interface Ctx {
  b: MeshBuilder;
  p: CharacterParams;
  pr: Proportions;
  q: Quality;
  mat: Mats;
  rand: () => number;
}

export interface Character {
  mesh: MeshData;
  skeleton: Skeleton;
  proportions: Proportions;
  params: CharacterParams;
}

const Z: Vec3 = [0, 0, 1];
const Y: Vec3 = [0, 1, 0];
const X: Vec3 = [1, 0, 0];

function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  return rgbToHex([lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)]);
}
const luminance = (hex: string) => {
  const c = hexToRgb(hex);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

export function generateCharacter(p: CharacterParams): Character {
  const b = new MeshBuilder();
  const pr = computeProportions(p);
  const skeleton = buildSkeleton(pr);
  const q = QUALITY[p.detail];
  const mat: Mats = {
    skin: b.material({ name: 'Skin', color: p.skinColor, roughness: 0.65, metalness: 0 }),
    lips: b.material({ name: 'Lips', color: mix(shade(p.skinColor, 0.78), '#9c3b3b', 0.35), roughness: 0.5, metalness: 0 }),
    eyeWhite: b.material({ name: 'EyeWhite', color: '#f3f0ea', roughness: 0.3, metalness: 0 }),
    iris: b.material({ name: 'Iris', color: p.eyeColor, roughness: 0.3, metalness: 0 }),
    pupil: b.material({ name: 'Pupil', color: '#111111', roughness: 0.2, metalness: 0 }),
    hair: b.material({ name: 'Hair', color: p.hairColor, roughness: 0.8, metalness: 0 }),
    top: b.material({ name: 'Top', color: p.topColor, roughness: 0.85, metalness: 0 }),
    bottom: b.material({ name: 'Bottom', color: p.bottomColor, roughness: 0.85, metalness: 0 }),
    shoes: b.material({ name: 'Shoes', color: p.shoeColor, roughness: 0.6, metalness: 0 }),
    sole: b.material({
      name: 'Sole',
      color: p.shoes === 'boots' ? shade(p.shoeColor, 0.45) : luminance(p.shoeColor) > 0.75 ? '#5a5a5a' : '#f2f2f2',
      roughness: 0.9, metalness: 0,
    }),
    accent: b.material({ name: 'Accent', color: p.accentColor, roughness: 0.7, metalness: 0 }),
    metal: b.material({ name: 'Metal', color: '#a7b0ba', roughness: 0.35, metalness: 0.85 }),
    gold: b.material({ name: 'Gold', color: '#d4af37', roughness: 0.35, metalness: 0.9 }),
  };
  const ctx: Ctx = { b, p, pr, q, mat, rand: rng(p.seed) };

  buildTorso(ctx);
  for (const s of [1, -1]) {
    buildArm(ctx, s);
    buildHand(ctx, s);
    buildLeg(ctx, s);
    buildFoot(ctx, s);
  }
  if (p.bottom === 'skirt') buildSkirt(ctx);
  buildNeck(ctx);
  const head = buildHead(ctx);
  buildFace(ctx, head);
  buildHair(ctx, head);
  buildFacialHair(ctx, head);
  buildHat(ctx, head);

  return { mesh: b.build(p.flatShading), skeleton, proportions: pr, params: p };
}

// ---------------------------------------------------------------------------
// Torso

/** Torso parameter where the waistband sits (0 = crotch, 1 = neck base). */
const WAIST_U = 0.34;

function torsoShape(ctx: Ctx): (u: number) => Shape {
  const { p, pr } = ctx;
  const { B } = pr;
  const m = p.masculinity, mu = p.muscle, f = p.bodyFat;
  const chestRx = (lerp(0.098, 0.112, m) + 0.012 * mu + 0.012 * f) * B * lerp(1, p.shoulderWidth, 0.5);
  const waistRx = (lerp(0.074, 0.09, m) + 0.004 * mu + 0.035 * f) * B;
  const hipRx = (lerp(0.12, 0.102, m) + 0.025 * f) * B * p.hipWidth;
  const neckR = neckRadius(ctx);
  const base = keyedShape([
    { t: 0, rx: hipRx * 0.72, rzF: 0.05 * B, rzB: 0.056 * B, n: 2.2 },
    { t: 0.1, rx: hipRx * 0.96, rzF: 0.055 * B, rzB: (lerp(0.08, 0.068, m) + 0.01 * f) * B, n: 2.2 },
    { t: 0.2, rx: hipRx, rzF: (0.058 + 0.01 * f) * B, rzB: (lerp(0.076, 0.066, m) + 0.008 * f) * B, n: 2.2 },
    { t: 0.34, rx: waistRx, rzF: (0.056 + 0.035 * f) * B, rzB: 0.056 * B, n: 2.25 },
    { t: 0.48, rx: lerp(waistRx, chestRx, 0.45), rzF: (0.06 + 0.03 * f) * B, rzB: 0.058 * B, n: 2.3 },
    { t: 0.62, rx: chestRx * 0.97, rzF: (0.064 + 0.012 * mu) * B, rzB: 0.062 * B, n: 2.35 },
    { t: 0.74, rx: chestRx, rzF: (0.068 + 0.012 * mu) * B, rzB: 0.066 * B, n: 2.35 },
    { t: 0.84, rx: chestRx * (1 + 0.04 * mu), rzF: 0.062 * B, rzB: 0.066 * B, n: 2.4 },
    { t: 0.93, rx: pr.shoulderX * 0.9, rzF: 0.052 * B, rzB: 0.054 * B, n: 2.4 },
    { t: 1, rx: neckR * 2.1, rzF: neckR * 1.25, rzB: neckR * 1.45, n: 2.2 },
  ]);
  const bust = (1 - m) * 0.2 * (1 + 0.5 * f);
  const pecs = m * mu * 0.06;
  const g = (x: number, w: number) => Math.exp(-((x / w) ** 2));
  return (u) => {
    const s = base(u);
    const kb = bust * g(u - 0.69, 0.075);
    const kp = pecs * g(u - 0.74, 0.07);
    if (kb + kp < 1e-4) return s;
    return {
      ...s,
      mod: (th) => {
        const a = th - Math.PI / 2; // 0 at the front
        return 1 + kb * (g(a - 0.62, 0.36) + g(a + 0.62, 0.36)) + kp * (g(a - 0.55, 0.5) + g(a + 0.55, 0.5));
      },
    };
  };
}

function torsoLayers(ctx: Ctx): Layer[] {
  const { p, mat } = ctx;
  const layers: Layer[] = [{ t0: 0, t1: WAIST_U + 0.02, mat: mat.bottom, inflate: 1.035, priority: 1 }];
  if (p.top !== 'none') layers.push({ t0: WAIST_U - 0.01, t1: 1, mat: mat.top, inflate: 1.05, priority: 2 });
  else if (p.masculinity < 0.5) layers.push({ t0: 0.6, t1: 0.8, mat: mat.top, inflate: 1.03, priority: 2 });
  if (p.belt) layers.push({ t0: WAIST_U - 0.04, t1: WAIST_U + 0.03, mat: mat.accent, inflate: 1.08, priority: 3 });
  return layers;
}

function buildTorso(ctx: Ctx) {
  const { b, pr, q, p, mat } = ctx;
  const path = linePath([0, pr.crotchY, 0], [0, pr.neckBaseY, 0]);
  const shape = torsoShape(ctx);
  loft(b, {
    path, shape, front: Z,
    spans: resolveLayers({ mat: mat.skin, inflate: 1 }, torsoLayers(ctx)),
    radial: q.torsoRadial, density: q.density, minRings: 2,
    capStart: true, capEnd: true,
    bone: (u) => (u < 0.22 ? J.Hips : u < 0.5 ? J.Spine : u < 0.75 ? J.Spine1 : J.Spine2),
  });
  if (p.belt) {
    // Buckle on the front of the belt.
    const u = WAIST_U - 0.005;
    const s = shape(u);
    const y = pr.crotchY + u * pr.torsoLen;
    ellipsoid(b, {
      center: [0, y, s.rzF * 1.08 + 0.003 * pr.B], axis: Z, front: Y,
      rLen: 0.006 * pr.B, rU: 0.022 * pr.B, rV: 0.017 * pr.B, n: 4,
      mat: mat.gold, bone: J.Hips, radial: q.small, rings: q.smallRings,
    });
  }
}

function buildSkirt(ctx: Ctx) {
  const { b, pr, q, mat } = ctx;
  const shape = torsoShape(ctx);
  const topU = WAIST_U - 0.01;
  const yTop = pr.crotchY + topU * pr.torsoLen;
  const yBot = pr.kneeY + 0.03 * pr.B;
  const tHip = ((topU - 0.2) * pr.torsoLen) / (yTop - yBot);
  const sw = shape(topU), sh = shape(0.12);
  loft(b, {
    path: linePath([0, yTop, 0], [0, yBot, 0]), front: Z,
    shape: keyedShape([
      { t: 0, rx: sw.rx * 1.06, rzF: sw.rzF * 1.06, rzB: sw.rzB * 1.06, n: 2.2 },
      { t: tHip, rx: sh.rx * 1.1, rzF: sh.rzF * 1.12, rzB: sh.rzB * 1.12, n: 2.2 },
      { t: 1, rx: sh.rx * 1.42, rzF: sh.rzF * 1.9, rzB: sh.rzB * 1.75, n: 2.1 },
    ]),
    spans: [{ t0: 0, t1: 1, mat: mat.bottom, inflate: 1 }],
    radial: q.torsoRadial, density: q.density, minRings: 3, bone: J.Hips,
  });
}

// ---------------------------------------------------------------------------
// Neck & head

function neckRadius(ctx: Ctx): number {
  const { p, pr } = ctx;
  const r = (lerp(0.04, 0.048, p.masculinity) + 0.01 * p.muscle + 0.005 * p.bodyFat) * pr.B;
  return Math.min(r, pr.headW * 0.6);
}

function buildNeck(ctx: Ctx) {
  const { b, pr, q, mat } = ctx;
  const r = neckRadius(ctx);
  loft(b, {
    path: linePath([0, pr.neckBaseY - 0.04 * pr.B, -0.005 * pr.B], [0, pr.chinY + pr.headH * 0.3, -pr.headD * 0.25]),
    front: Z,
    shape: keyedShape([{ t: 0, rx: r * 1.15, rzF: r * 1.1 }, { t: 0.45, rx: r, rzF: r * 0.95 }, { t: 1, rx: r * 0.95, rzF: r * 0.9 }]),
    spans: [{ t0: 0, t1: 1, mat: mat.skin, inflate: 1 }],
    radial: q.radial, density: q.density, minRings: 2, bone: J.Neck,
  });
}

function buildHead(ctx: Ctx): Head {
  const { b, p, pr, q, mat } = ctx;
  const W = pr.headW, D = pr.headD;
  const jaw = p.jawWidth * lerp(0.9, 1.05, p.masculinity);
  const k = (t: number, rx: number, rzF: number, rzB: number, oz: number) => ({
    t, rx: rx * W, rzF: rzF * D, rzB: rzB * D, oz: oz * D, n: 2.15,
  });
  const shape = keyedShape([
    k(0.0, 0.3 * jaw, 0.2, 0.2, 0.36),
    k(0.05, 0.52 * jaw, 0.38, 0.45, 0.27),
    k(0.14, 0.7 * jaw, 0.6, 0.68, 0.14),
    k(0.26, 0.8 * lerp(1, jaw, 0.6), 0.76, 0.82, 0.07),
    k(0.4, 0.9, 0.9, 0.93, 0.02),
    k(0.55, 0.97, 0.97, 0.98, 0),
    k(0.7, 1.0, 0.97, 1.0, -0.02),
    k(0.82, 0.95, 0.9, 0.98, -0.04),
    k(0.91, 0.8, 0.73, 0.84, -0.05),
    k(0.97, 0.52, 0.46, 0.55, -0.05),
    k(1.0, 0, 0, 0, -0.05),
  ]);
  const path = linePath([0, pr.chinY, 0], [0, pr.crownY, 0]);
  const rings = [7, 14, 22][['low', 'medium', 'high'].indexOf(p.detail)];
  loft(b, {
    path, shape, front: Z,
    spans: [
      { t0: 0, t1: 0.8, mat: mat.skin, inflate: 1 },
      { t0: 0.8, t1: 1, mat: mat.skin, inflate: 1, warp: (s) => Math.sin((s * Math.PI) / 2) },
    ],
    radial: q.headRadial, density: rings / pr.headH, minRings: 2,
    capStart: true, bone: J.Head,
  });
  return { surf: loftSurface(path, shape, Z), center: [0, pr.chinY + pr.headH * 0.55, 0] };
}

const FRONT = Math.PI / 2;

function buildFace(ctx: Ctx, head: Head) {
  const { b, p, pr, q, mat } = ctx;
  const h = pr.headH;
  const chibi = clamp(p.headScale - 1, 0, 1);
  const S = head.surf;
  const tEye = lerp(0.53, 0.47, chibi);
  const r = h * 0.052 * p.eyeSize;
  const spread = 0.42 * p.eyeSpacing * lerp(1, 1.12, chibi);

  for (const s of [1, -1]) {
    // Eyes: white, iris, pupil. Iris/pupil face forward (+Z).
    const th = FRONT - s * spread;
    const sp = S.point(th, tEye), n = S.normal(th, tEye);
    const c = madd(sp, n, -r * 0.58);
    const eye = (center: Vec3, rLen: number, rad: number, m: number) =>
      ellipsoid(b, { center, axis: Z, front: Y, rLen, rU: rad, rV: rad, mat: m, bone: J.Head, radial: q.small + 4, rings: q.smallRings + 2 });
    eye(c, r * 0.92, r, mat.eyeWhite);
    eye(madd(c, Z, r * 0.7), r * 0.32, r * 0.58, mat.iris);
    eye(madd(c, Z, r * 0.9), r * 0.16, r * 0.28, mat.pupil);

    // Brows
    const tb = tEye + (r / h) * 1.7 + 0.03;
    const thb = th + s * 0.03;
    const bp = S.point(thb, tb), bn = S.normal(thb, tb);
    let along = normalize(cross(Y, bn));
    along = normalize(add(along, scale(Y, -s * 0.12 * (along[0] > 0 ? 1 : -1))));
    ellipsoid(b, {
      center: madd(bp, bn, 0.004 * h), axis: along, front: bn,
      rLen: r * 1.15, rU: r * lerp(0.17, 0.27, p.masculinity), rV: r * 0.25,
      mat: mat.hair, bone: J.Head, radial: q.small, rings: q.smallRings,
    });

    // Ears
    if (p.hat !== 'helmet') {
      const the = s > 0 ? 0 : Math.PI;
      const ep = S.point(the, 0.5), en = S.normal(the, 0.5);
      const es = p.earSize;
      if (p.ears === 'round') {
        ellipsoid(b, {
          center: madd(madd(ep, en, 0.006 * h), Z, -0.04 * h), axis: normalize([0, 1, -0.2]), front: en,
          rLen: h * 0.13 * es, rU: h * 0.08 * es, rV: h * 0.03,
          mat: mat.skin, bone: J.Head, radial: q.small, rings: q.smallRings,
        });
      } else {
        const base = madd(madd(ep, en, -0.01 * h), Z, -0.03 * h);
        const tip = add(base, add(scale(Y, h * 0.3 * es), add(scale(en, h * 0.17 * es), scale(Z, -h * 0.14 * es))));
        loft(b, {
          path: linePath(base, tip), front: en,
          shape: keyedShape([
            { t: 0, rx: h * 0.08 * es, rzF: h * 0.03, n: 2 },
            { t: 0.35, rx: h * 0.085 * es, rzF: h * 0.025 },
            { t: 1, rx: h * 0.004, rzF: h * 0.004 },
          ]),
          spans: [{ t0: 0, t1: 1, mat: mat.skin, inflate: 1 }],
          radial: q.small, density: 0, minRings: q.smallRings, capStart: true, bone: J.Head,
        });
      }
    }
  }

  // Nose: a bridge-to-tip loft plus a rounded tip.
  const ns = p.noseSize;
  const tTip = lerp(0.39, 0.4, chibi);
  const bridge = madd(S.point(FRONT, tEye - 0.02), S.normal(FRONT, tEye - 0.02), -0.012 * h);
  const tipBase = S.point(FRONT, tTip);
  const tip = add(tipBase, scale(Z, h * 0.06 * ns * lerp(1, 0.6, chibi)));
  loft(b, {
    path: linePath(bridge, tip), front: Z,
    shape: keyedShape([
      { t: 0, rx: h * 0.025 * ns, rzF: h * 0.012, rzB: h * 0.03 },
      { t: 0.75, rx: h * 0.04 * ns, rzF: h * 0.02 * ns, rzB: h * 0.04 },
      { t: 1, rx: h * 0.03 * ns, rzF: h * 0.012 * ns, rzB: h * 0.04 },
    ]),
    spans: [{ t0: 0, t1: 1, mat: mat.skin, inflate: 1 }],
    radial: q.small, density: 0, minRings: q.smallRings - 1, capEnd: true, bone: J.Head,
  });
  ellipsoid(b, {
    center: madd(tip, Y, -h * 0.012), axis: X, front: Z,
    rLen: h * 0.05 * ns, rU: h * 0.03 * ns, rV: h * 0.032 * ns,
    mat: mat.skin, bone: J.Head, radial: q.small, rings: q.smallRings,
  });

  // Mouth
  const tm = lerp(0.265, 0.28, chibi);
  const mp = S.point(FRONT, tm), mn = S.normal(FRONT, tm);
  ellipsoid(b, {
    center: madd(mp, mn, -0.004 * h), axis: X, front: Z,
    rLen: pr.headW * 0.3 * lerp(1, 0.85, p.masculinity) * lerp(1, 0.7, chibi),
    rU: h * lerp(0.026, 0.017, p.masculinity), rV: h * 0.022,
    mat: mat.lips, bone: J.Head, radial: q.small, rings: q.smallRings,
  });
}

// ---------------------------------------------------------------------------
// Limbs

function buildArm(ctx: Ctx, s: number) {
  const { b, p, pr, q, mat } = ctx;
  const { B } = pr;
  const m = p.masculinity, mu = p.muscle, f = p.bodyFat;
  const d: Vec3 = [pr.armDir[0] * s, pr.armDir[1], 0];
  const sh: Vec3 = [s * pr.shoulderX, pr.shoulderY, 0];
  const inner: Vec3 = [s * pr.shoulderX * 0.45, pr.shoulderY - 0.01 * B, 0];
  const el = madd(sh, d, pr.upperArm);
  const wr = madd(el, d, pr.foreArm);
  const path = polyPath([inner, sh, el, wr]);
  const [, tS, tE] = path.tAt;
  const rUp = (lerp(0.03, 0.034, m) + 0.012 * mu + 0.01 * f) * B;
  const shape = keyedShape([
    { t: 0, rx: 0.045 * B, rzF: 0.045 * B },
    { t: tS, rx: rUp * 1.35, rzF: rUp * 1.3 },
    { t: lerp(tS, tE, 0.3), rx: rUp * 1.05, rzF: rUp * 1.12 },
    { t: lerp(tS, tE, 0.9), rx: rUp * 0.85, rzF: rUp * 0.88 },
    { t: tE, rx: 0.027 * B * (1 + 0.2 * mu), rzF: 0.03 * B },
    { t: lerp(tE, 1, 0.25), rx: 0.03 * B * (1 + 0.3 * mu + 0.2 * f), rzF: 0.032 * B * (1 + 0.2 * mu) },
    { t: 1, rx: 0.016 * B, rzF: 0.021 * B },
  ]);
  const layers: Layer[] = [];
  if (p.top === 'tshirt') layers.push({ t0: 0, t1: lerp(tS, tE, 0.45), mat: mat.top, inflate: 1.08, priority: 1 });
  if (p.top === 'longsleeve') layers.push({ t0: 0, t1: 0.985, mat: mat.top, inflate: 1.07, priority: 1 });
  if (p.gloves) layers.push({ t0: 0.92, t1: 1, mat: mat.accent, inflate: 1.12, priority: 2 });
  loft(b, {
    path, shape, front: Z,
    spans: resolveLayers({ mat: mat.skin, inflate: 1 }, layers),
    radial: q.radial, density: q.density, minRings: 2, capEnd: true,
    bone: (t) => sideJoint(s, t < tS ? 'Shoulder' : t < tE ? 'Arm' : 'ForeArm'),
  });
}

function buildHand(ctx: Ctx, s: number) {
  const { b, p, pr, q, mat } = ctx;
  const { B } = pr;
  const hs = p.handSize;
  const d: Vec3 = [pr.armDir[0] * s, pr.armDir[1], 0];
  const wr = madd([s * pr.shoulderX, pr.shoulderY, 0], d, pr.upperArm + pr.foreArm);
  const palmDown = scale(cross(d, Z), s); // palm normal
  const m = p.gloves ? mat.accent : mat.skin;
  const bone = sideJoint(s, 'Hand');
  const palmLen = pr.handLen * (p.fingers ? 0.52 : 0.95);
  const start = madd(wr, d, -0.01 * B);
  const k = B * hs;
  const palmKeys = p.fingers
    ? [
        { t: 0, rx: 0.014 * k, rzF: 0.021 * k },
        { t: 0.25, rx: 0.015 * k, rzF: 0.026 * k },
        { t: 0.8, rx: 0.013 * k, rzF: 0.029 * k },
        { t: 1, rx: 0.009 * k, rzF: 0.027 * k },
      ]
    : [
        { t: 0, rx: 0.014 * k, rzF: 0.021 * k },
        { t: 0.2, rx: 0.015 * k, rzF: 0.026 * k },
        { t: 0.55, rx: 0.014 * k, rzF: 0.029 * k },
        { t: 0.85, rx: 0.011 * k, rzF: 0.026 * k },
        { t: 1, rx: 0.003 * k, rzF: 0.012 * k },
      ];
  loft(b, {
    path: linePath(start, madd(wr, d, palmLen)), front: Z,
    shape: keyedShape(palmKeys, 2.4),
    spans: [{ t0: 0, t1: 1, mat: m, inflate: 1 }],
    radial: q.radial, density: q.density * 1.5, minRings: 3, capStart: true, capEnd: true, bone,
  });

  const finger = (base: Vec3, dir: Vec3, len: number, r: number) =>
    loft(b, {
      path: linePath(madd(base, dir, -0.01 * B), madd(base, dir, len)), front: palmDown,
      shape: keyedShape([
        { t: 0, rx: r, rzF: r * 0.9 },
        { t: 0.6, rx: r * 0.92, rzF: r * 0.85 },
        { t: 0.88, rx: r * 0.8, rzF: r * 0.75 },
        { t: 1, rx: r * 0.15, rzF: r * 0.15 },
      ]),
      spans: [{ t0: 0, t1: 1, mat: m, inflate: 1 }],
      radial: Math.max(5, q.small - 2), density: 0, minRings: q.smallRings, capStart: true, bone,
    });

  if (p.fingers) {
    const knuckle = madd(wr, d, palmLen * 0.9);
    const offs = [0.019, 0.0065, -0.0065, -0.019];
    const lens = [0.44, 0.48, 0.45, 0.36];
    const rads = [0.0072, 0.0077, 0.0072, 0.0062];
    offs.forEach((o, i) => {
      const base = madd(knuckle, Z, o * k);
      const dir = normalize(madd(d, Z, o * 2.2));
      finger(base, dir, lens[i] * pr.handLen, rads[i] * k);
    });
  }
  const thumbBase = madd(madd(madd(wr, d, palmLen * (p.fingers ? 0.3 : 0.18)), Z, 0.02 * k), palmDown, 0.004 * k);
  const thumbDir = normalize(add(add(scale(d, 0.55), scale(Z, 0.7)), scale(palmDown, 0.35)));
  finger(thumbBase, thumbDir, pr.handLen * 0.38, 0.0088 * k);
}

function buildLeg(ctx: Ctx, s: number) {
  const { b, p, pr, q, mat } = ctx;
  const { B } = pr;
  const m = p.masculinity, mu = p.muscle, f = p.bodyFat;
  const top: Vec3 = [s * pr.hipX * 0.85, pr.hipJointY + 0.045 * B, 0];
  const knee: Vec3 = [s * pr.hipX * 0.95, pr.kneeY, 0.005 * B];
  const ankle: Vec3 = [s * pr.hipX * 0.9, pr.ankleY, 0];
  const path = polyPath([top, knee, ankle]);
  const tK = path.tAt[1];
  const tr = (lerp(0.062, 0.056, m) + 0.012 * mu + 0.022 * f) * B;
  const calf = lerp(tK, 1, 0.2);
  const shape = keyedShape([
    { t: 0, rx: tr, rzF: tr * 0.95, rzB: tr },
    { t: tK * 0.15, rx: tr * 1.05, rzF: tr, rzB: tr * 1.05 },
    { t: tK * 0.5, rx: tr * 0.85, rzF: tr * 0.88, rzB: tr * 0.82 },
    { t: tK * 0.85, rx: tr * 0.66, rzF: tr * 0.7, rzB: tr * 0.6 },
    { t: tK, rx: 0.038 * B, rzF: 0.042 * B, rzB: 0.036 * B },
    { t: calf, rx: (0.04 + 0.006 * mu + 0.006 * f) * B, rzF: 0.036 * B, rzB: (0.05 + 0.008 * mu) * B },
    { t: lerp(tK, 1, 0.5), rx: 0.034 * B, rzF: 0.03 * B, rzB: 0.036 * B },
    { t: lerp(tK, 1, 0.85), rx: 0.024 * B, rzF: 0.024 * B, rzB: 0.024 * B },
    { t: 1, rx: 0.023 * B, rzF: 0.025 * B, rzB: 0.025 * B },
  ]);
  const layers: Layer[] = [];
  if (p.bottom === 'pants') layers.push({ t0: 0, t1: 0.985, mat: mat.bottom, inflate: 1.045, priority: 1 });
  if (p.bottom === 'shorts') layers.push({ t0: 0, t1: tK * 0.6, mat: mat.bottom, inflate: 1.06, priority: 1 });
  if (p.bottom === 'skirt') layers.push({ t0: 0, t1: tK * 0.25, mat: mat.bottom, inflate: 1.03, priority: 1 });
  if (p.shoes === 'boots') layers.push({ t0: lerp(tK, 1, 0.4), t1: 1, mat: mat.shoes, inflate: 1.16, priority: 2 });
  loft(b, {
    path, shape, front: Z,
    spans: resolveLayers({ mat: mat.skin, inflate: 1 }, layers),
    radial: q.radial, density: q.density, minRings: 2, capEnd: true,
    bone: (t) => sideJoint(s, t < tK ? 'UpLeg' : 'Leg'),
  });
}

function buildFoot(ctx: Ctx, s: number) {
  const { b, pr, q, mat } = ctx;
  const { B, footLen: L, footW: w } = pr;
  const x = s * pr.hipX * 0.9;
  const sole = 0.01 * B;
  const hb = 0.018 * B;
  const cy = sole + hb;
  const heel = -0.24 * L, toe = 0.76 * L;
  const bone = (t: number) => sideJoint(s, t < 0.6 ? 'Foot' : 'ToeBase');
  loft(b, {
    path: linePath([x, cy, heel], [x, cy, toe]), front: Y,
    shape: keyedShape([
      { t: 0, rx: 0.55 * w, rzF: 0.02 * B, rzB: 0.7 * hb },
      { t: 0.07, rx: 0.8 * w, rzF: 0.04 * B, rzB: hb },
      { t: 0.3, rx: 0.85 * w, rzF: 0.043 * B, rzB: hb },
      { t: 0.55, rx: w, rzF: 0.027 * B, rzB: hb },
      { t: 0.8, rx: 0.98 * w, rzF: 0.014 * B, rzB: hb },
      { t: 0.94, rx: 0.82 * w, rzF: 0.01 * B, rzB: 0.85 * hb },
      { t: 1, rx: 0.4 * w, rzF: 0.004 * B, rzB: 0.5 * hb },
    ], 2.4),
    spans: [{ t0: 0, t1: 1, mat: mat.shoes, inflate: 1 }],
    radial: q.radial, density: q.density, minRings: 4, capStart: true, capEnd: true, bone,
  });
  loft(b, {
    path: linePath([x, sole, heel - 0.008 * B], [x, sole, toe + 0.008 * B]), front: Y,
    shape: keyedShape([
      { t: 0, rx: 0.5 * w, rzF: sole },
      { t: 0.08, rx: 0.85 * w, rzF: sole },
      { t: 0.55, rx: 1.06 * w, rzF: sole },
      { t: 0.9, rx: 0.95 * w, rzF: sole },
      { t: 1, rx: 0.45 * w, rzF: sole },
    ], 5),
    spans: [{ t0: 0, t1: 1, mat: mat.sole, inflate: 1 }],
    radial: q.radial, density: q.density, minRings: 4, capStart: true, capEnd: true, bone,
  });
}

