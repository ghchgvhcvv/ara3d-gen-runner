/**
 * Motion-capture import (test): BVH files retargeted onto our skeletons.
 *
 * Retargeting copies each bone's world-space rotation relative to the source's rest pose. The
 * source rest (all channels zero) is not a clean T-pose (CMU's legs splay out), so every target
 * bone is first swung from our T-pose to the source's rest direction; the motion is applied on
 * top of that. Hips height and travel are scaled by leg length. Both use +Y up, +Z forward,
 * +X = the character's left.
 */
import type { Vec3 } from '../math';
import { fingers } from './clips/helpers';
import type { Ch, Clip, ClipCategory, Sample } from './clips/types';
import { qaxis, qmul, qrot, type Q } from './quat';

interface BvhJoint {
  name: string;
  parent: number;
  offset: Vec3;
  channels: string[];
  /** Offset of the first child (or end site): the bone's rest direction. */
  tip?: Vec3;
  /** Children (zero-length ones are followed to find the tip). */
  kids: number[];
}
export interface Bvh {
  joints: BvhJoint[];
  frames: Float32Array[];
  frameTime: number;
}

export function parseBvh(text: string): Bvh {
  const tok = text.split(/\s+/).filter(Boolean);
  let i = 0;
  const joints: BvhJoint[] = [];
  const stack: number[] = [];
  let endSite = false;
  while (i < tok.length && tok[i] !== 'MOTION') {
    const t = tok[i++];
    if (t === 'ROOT' || t === 'JOINT') {
      joints.push({ name: tok[i++], parent: stack.length ? stack[stack.length - 1] : -1, offset: [0, 0, 0], channels: [], kids: [] });
      if (joints.length > 1) joints[joints[joints.length - 1].parent].kids.push(joints.length - 1);
    } else if (t === 'End') {
      i++; // "Site"
      endSite = true;
    } else if (t === '{') {
      stack.push(endSite ? -2 : joints.length - 1);
    } else if (t === '}') {
      stack.pop();
      endSite = false;
    } else if (t === 'OFFSET') {
      const o: Vec3 = [+tok[i++], +tok[i++], +tok[i++]];
      const cur = stack[stack.length - 1];
      if (cur === -2) {
        // End site: the tip of the innermost joint.
        const owner = stack[stack.length - 2];
        if (owner >= 0 && !joints[owner].tip) joints[owner].tip = o;
      } else {
        joints[cur].offset = o;
      }
    } else if (t === 'CHANNELS') {
      const n = +tok[i++];
      joints[stack[stack.length - 1]].channels = tok.slice(i, i + n);
      i += n;
    }
  }
  // Tips: the first child with length, looking through zero-length joints (CMU's LHipJoint, FingerBase).
  const tipOf = (k: number): Vec3 | undefined => {
    for (const c of joints[k].kids) {
      if (Math.hypot(...joints[c].offset) > 1e-6) return joints[c].offset;
      const t = tipOf(c);
      if (t) return t;
    }
    return joints[k].tip;
  };
  for (let k = 0; k < joints.length; k++) joints[k].tip = tipOf(k);
  i++; // MOTION
  i++; // Frames:
  const nFrames = +tok[i++];
  i += 2; // Frame Time:
  const frameTime = +tok[i++];
  const nCh = joints.reduce((s, j) => s + j.channels.length, 0);
  const frames: Float32Array[] = [];
  for (let f = 0; f < nFrames && i + nCh <= tok.length; f++) {
    const row = new Float32Array(nCh);
    for (let c = 0; c < nCh; c++) row[c] = +tok[i++];
    frames.push(row);
  }
  return { joints, frames, frameTime };
}

/** CMU (cgspeed) joint names -> our game-rig bones. */
const CMU_MAP: Record<string, string> = {
  Hips: 'Hips', LowerBack: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Neck: 'Neck', Head: 'Head',
  LeftShoulder: 'LeftShoulder', LeftArm: 'LeftArm', LeftForeArm: 'LeftForeArm', LeftHand: 'LeftHand',
  RightShoulder: 'RightShoulder', RightArm: 'RightArm', RightForeArm: 'RightForeArm', RightHand: 'RightHand',
  LeftUpLeg: 'LeftUpLeg', LeftLeg: 'LeftLeg', LeftFoot: 'LeftFoot', LeftToeBase: 'LeftToeBase',
  RightUpLeg: 'RightUpLeg', RightLeg: 'RightLeg', RightFoot: 'RightFoot', RightToeBase: 'RightToeBase',
};

/** World rotations (per joint) and hips position (source units) for one BVH frame. */
function poseAt(bvh: Bvh, row: Float32Array): { world: Q[]; hips: Vec3 } {
  const world: Q[] = [];
  let c = 0;
  let hips: Vec3 = [0, 0, 0];
  bvh.joints.forEach((j, k) => {
    let q: Q = [0, 0, 0, 1];
    for (const ch of j.channels) {
      const v = row[c++];
      if (ch === 'Xposition') hips = [v, hips[1], hips[2]];
      else if (ch === 'Yposition') hips = [hips[0], v, hips[2]];
      else if (ch === 'Zposition') hips = [hips[0], hips[1], v];
      else if (ch === 'Xrotation') q = qmul(q, qaxis([1, 0, 0], v));
      else if (ch === 'Yrotation') q = qmul(q, qaxis([0, 1, 0], v));
      else if (ch === 'Zrotation') q = qmul(q, qaxis([0, 0, 1], v));
    }
    world[k] = j.parent < 0 ? q : qmul(world[j.parent], q);
  });
  return { world, hips };
}

export interface MocapSample {
  /** World rotation (relative to the source rest pose) per target bone. */
  rot: Record<string, Q>;
  /** Source rest direction per target bone (world). */
  dir: Record<string, Vec3>;
  /** Hips position in leg lengths (x/z relative to the start; y above the floor, 1 = standing). */
  hips: Vec3;
  /** Key for caching rest alignments. */
  key: string;
}

export interface MocapOptions {
  id: string;
  name: string;
  category: ClipCategory;
  loop: boolean;
  /** Seconds into the recording to start / end (end defaults to the recording's end). */
  start?: number;
  end?: number;
  /** Loops: search this range (seconds after start) for the frame that best matches the start. */
  loopSearch?: [number, number];
}

export function mocapClip(bvh: Bvh, o: MocapOptions): Clip {
  const ft = bvh.frameTime;
  const f0 = Math.min(bvh.frames.length - 1, Math.round((o.start ?? 0) / ft));
  let f1 = Math.min(bvh.frames.length - 1, Math.round((o.end ?? bvh.frames.length * ft) / ft));
  const poses = smooth(bvh.frames.map((row) => poseAt(bvh, row)), Math.round(0.025 / ft));
  const mapped = bvh.joints.map((j, k) => [CMU_MAP[j.name], k] as const).filter(([g]) => !!g) as [string, number][];
  if (o.loop && o.loopSearch) {
    // Seamless loop: the frame whose pose (and vertical hips) best matches the first frame.
    const a = poses[f0];
    let best = Infinity;
    for (let f = f0 + Math.round(o.loopSearch[0] / ft); f <= Math.min(bvh.frames.length - 1, f0 + Math.round(o.loopSearch[1] / ft)); f++) {
      const b = poses[f];
      let err = 0;
      for (const [, k] of mapped) {
        const d = Math.abs(a.world[k][0] * b.world[k][0] + a.world[k][1] * b.world[k][1] + a.world[k][2] * b.world[k][2] + a.world[k][3] * b.world[k][3]);
        err += 1 - Math.min(1, d);
      }
      if (err < best) [best, f1] = [err, f];
    }
  }
  // Leg length: rest drop from the hips to the lowest end site.
  const restPos: Vec3[] = [];
  bvh.joints.forEach((j, k) => (restPos[k] = j.parent < 0 ? [0, 0, 0] : (restPos[j.parent].map((x, d) => x + j.offset[d]) as Vec3)));
  let low = 0;
  bvh.joints.forEach((j, k) => (low = Math.min(low, restPos[k][1] + (j.tip?.[1] ?? 0))));
  const leg = -low;
  const duration = (f1 - f0) * ft;
  // Face +Z: along the travel for clips that move, else the way the hips face at the start.
  const p0 = poses[f0].hips, p1 = poses[f1].hips;
  const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) / leg / duration > 0.15;
  const fwd = moved ? [p1[0] - p0[0], 0, p1[2] - p0[2]] : qrot(poses[f0].world[0], [0, 0, 1]);
  const turn = qaxis([0, 1, 0], (-Math.atan2(fwd[0], fwd[2]) * 180) / Math.PI);
  for (const P of poses) {
    P.world = P.world.map((q) => qmul(turn, q));
    P.hips = qrot(turn, P.hips);
  }
  // In place: remove the straight-line travel between the first and last frame.
  const q0 = poses[f0].hips, q1 = poses[f1].hips;
  const vel: Vec3 = [(q1[0] - q0[0]) / duration, 0, (q1[2] - q0[2]) / duration];
  // Feet height (Foot and ToeBase joints and the toe tips) per frame; the lowest over the clip is the floor.
  const footJ = bvh.joints.map((j, k) => (/^(Left|Right)(Foot|ToeBase)$/.test(j.name) ? k : -1)).filter((k) => k >= 0);
  const footLow = poses.map((P) => {
    const pos: Vec3[] = [];
    bvh.joints.forEach((j, k) => {
      pos[k] = j.parent < 0 ? P.hips : (qrot(P.world[j.parent], j.offset).map((v, d) => v + pos[j.parent][d]) as Vec3);
    });
    let low = Infinity;
    for (const k of footJ) {
      low = Math.min(low, pos[k][1]);
      const tip = bvh.joints[k].tip;
      if (tip) low = Math.min(low, pos[k][1] + qrot(P.world[k], tip)[1]);
    }
    return low;
  });
  const floor = Math.min(...footLow.slice(f0, f1 + 1));
  // Travel in m/s at 1.8 m height (hips about 0.95 m up).
  const travel: [number, number, number] = [(vel[0] / leg) * 0.95, 0, (vel[2] / leg) * 0.95];
  const dir: Record<string, Vec3> = {};
  for (const [g, k] of mapped) {
    // Only the limbs differ in rest posture (CMU: arms out, legs apart). The trunk, clavicles and
    // head keep our own rest directions, which follow this body's anatomy.
    if (!/(Arm|Hand|Leg|Foot|ToeBase)$/.test(g)) continue;
    const tip = bvh.joints[k].tip ?? [0, 1, 0];
    const l = Math.hypot(...tip) || 1;
    dir[g] = [tip[0] / l, tip[1] / l, tip[2] / l];
  }
  const idle: Record<string, Ch> = {};
  fingers(idle, 14);
  return {
    id: o.id, name: o.name, category: o.category, duration, loop: o.loop,
    travel: Math.hypot(...travel) > 0.05 ? travel : undefined,
    sample: (t: number): Sample => {
      const x = f0 + Math.max(0, Math.min(duration, t)) / ft;
      const fa = Math.min(f1, Math.floor(x)), fb = Math.min(f1, fa + 1), w = x - fa;
      const A = poses[fa], B = poses[fb];
      const rot: Record<string, Q> = {};
      for (const [g, k] of mapped) rot[g] = slerp(A.world[k], B.world[k], w);
      const tt = (fa - f0 + w) * ft;
      const h = A.hips.map((v, d) => v + (B.hips[d] - v) * w);
      const hips: Vec3 = [(h[0] - q0[0] - vel[0] * tt) / leg, (h[1] - floor) / leg, (h[2] - q0[2] - vel[2] * tt) / leg];
      const mocap: MocapSample = { rot, dir, hips, key: o.id };
      return { bones: { ...idle }, root: {}, mocap } as Sample;
    },
  };
}

/** Light low-pass over +-r frames (capture noise), rotations and hips. */
function smooth(poses: { world: Q[]; hips: Vec3 }[], r: number): { world: Q[]; hips: Vec3 }[] {
  if (r < 1) return poses;
  return poses.map((P, f) => {
    const world = P.world.map((q0, k) => {
      const acc = [0, 0, 0, 0];
      for (let o = -r; o <= r; o++) {
        const q = poses[Math.max(0, Math.min(poses.length - 1, f + o))].world[k];
        const w = (r + 1 - Math.abs(o)) * (q[0] * q0[0] + q[1] * q0[1] + q[2] * q0[2] + q[3] * q0[3] < 0 ? -1 : 1);
        for (let d = 0; d < 4; d++) acc[d] += q[d] * w;
      }
      const l = Math.hypot(...acc);
      return [acc[0] / l, acc[1] / l, acc[2] / l, acc[3] / l] as Q;
    });
    const hips: Vec3 = [0, 0, 0];
    let n = 0;
    for (let o = -r; o <= r; o++) {
      const h = poses[Math.max(0, Math.min(poses.length - 1, f + o))].hips, w = r + 1 - Math.abs(o);
      for (let d = 0; d < 3; d++) hips[d] += h[d] * w;
      n += w;
    }
    return { world, hips: hips.map((v) => v / n) as Vec3 };
  });
}

function slerp(a: Q, b: Q, t: number): Q {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  d *= s;
  if (d > 0.9995) {
    const r: Q = [a[0] + (s * b[0] - a[0]) * t, a[1] + (s * b[1] - a[1]) * t, a[2] + (s * b[2] - a[2]) * t, a[3] + (s * b[3] - a[3]) * t];
    const l = Math.hypot(...r);
    return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
  }
  const th = Math.acos(d), sn = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / sn, kb = (Math.sin(t * th) / sn) * s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb, a[3] * ka + b[3] * kb];
}

