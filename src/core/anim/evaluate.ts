/**
 * Evaluates clips on any rig: forward kinematics in world space from an
 * "animation rest" (bind pose with relaxed arms), producing per-bone local
 * rotations and the root position. Shared by the viewer and the exporters,
 * so what you preview is exactly what gets exported.
 */
import type { Vec3 } from '../math';
import { boneFor } from '../rig/poses';
import { quatOf, type Rig } from '../rig/rig';
import type { Ch, Clip } from './clips';
import { qaxis, qconj, qfromTo, QI, qmul, qrot, type Q } from './quat';

export interface Frame {
  /** Local rotation per bone (relative to its parent), as exported / applied to three.js bones. */
  rot: Q[];
  /** Local position of root bones (parent = -1); other bones keep their rest offsets. */
  rootPos: Map<number, Vec3>;
}

/** Hips height when lying on the back (metres). */
const LYING_HEIGHT = 0.12;

export interface BakedClip {
  name: string;
  loop: boolean;
  times: number[];
  frames: Frame[];
}

export class Animator {
  readonly restLocal: Q[];
  private restOffset: Vec3[];
  private feet: number[];
  private restFootY: number;
  private restWorld: Q[];
  private animRest: Q[];
  private names: (string | null)[];
  private scale: number;

  constructor(readonly rig: Rig) {
    const B = rig.bones;
    this.restWorld = B.map((b) => quatOf(b.rot));
    this.restLocal = B.map((b, i) => (b.parent < 0 ? this.restWorld[i] : qmul(qconj(this.restWorld[b.parent]), this.restWorld[i])));
    // Game-rig name for each bone (so clips written against the game rig drive any skeleton).
    const gameNames = [
      'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
      ...['Left', 'Right'].flatMap((s) => [
        'Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase',
        ...['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3].map((k) => `Hand${f}${k}`)),
      ].map((n) => s + n)),
    ];
    const byBone = new Map<string, string>();
    for (const g of gameNames) {
      const b = boneFor(rig.type, g);
      if (b) byBone.set(b, g);
    }
    this.names = B.map((b) => byBone.get(b.name) ?? null);

    // Animation rest: arms lowered to a relaxed hang and elbows nearly straight
    // (MakeHuman's bind pose bends the elbows forward). Works from A- or T-pose binds.
    this.animRest = [...this.restWorld];
    const delta: (Q | null)[] = B.map(() => null);
    const dirOf = (i: number): Vec3 => {
      const b = B[i];
      return [b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]];
    };
    const armDir = new Map<string, Vec3>();
    B.forEach((b, i) => {
      const g = this.names[i];
      const inherited = b.parent >= 0 ? delta[b.parent] : null;
      if (g === 'LeftArm' || g === 'RightArm') {
        const s = g === 'LeftArm' ? 1 : -1;
        const target: Vec3 = [s * Math.sin((10 * Math.PI) / 180), -Math.cos((10 * Math.PI) / 180), 0.04];
        armDir.set(g, target);
        delta[i] = qfromTo(dirOf(i), target);
      } else if (g === 'LeftForeArm' || g === 'RightForeArm') {
        const up = armDir.get(g === 'LeftForeArm' ? 'LeftArm' : 'RightArm');
        const carried = inherited ?? QI;
        if (up) {
          // Straighten to the upper arm, keeping a natural ~10 degree forward bend.
          const now = qrot(carried, dirOf(i));
          const target: Vec3 = [up[0], up[1], up[2] + 0.18];
          delta[i] = qmul(qfromTo(now, target), carried);
        } else delta[i] = inherited;
      } else delta[i] = inherited;
      if (delta[i]) this.animRest[i] = qmul(delta[i]!, this.restWorld[i]);
    });
    let top = 0;
    for (const b of B) top = Math.max(top, b.head[1], b.tail[1]);
    this.scale = top / 1.8;
    // Bone offsets from their parent, in the parent's rest frame (for forward kinematics).
    this.restOffset = B.map((b) =>
      b.parent < 0 ? b.head : qrot(qconj(this.restWorld[b.parent]), [b.head[0] - B[b.parent].head[0], b.head[1] - B[b.parent].head[1], b.head[2] - B[b.parent].head[2]]));
    this.feet = B.map((_, i) => i).filter((i) => /^(Left|Right)(Foot|ToeBase|Toe_End)$/.test(this.names[i] ?? '') || /^(foot|toe\d-\d)\.[LR]$/.test(B[i].name));
    this.restFootY = Math.min(...this.feet.map((i) => B[i].head[1]));
  }

  /** Bind pose (no animation). */
  bind(): Frame {
    const rootPos = new Map<number, Vec3>();
    this.rig.bones.forEach((b, i) => b.parent < 0 && rootPos.set(i, b.head));
    return { rot: [...this.restLocal], rootPos };
  }

  frame(clip: Clip, time: number, opts: { rootMotion?: boolean } = {}): Frame {
    const B = this.rig.bones;
    const s = clip.sample(time);
    const world: Q[] = new Array(B.length);
    const rot: Q[] = new Array(B.length);
    const rootPos = new Map<number, Vec3>();
    const r = s.root;
    const rootRot = qmul(qaxis([0, 1, 0], r.yaw ?? 0), qaxis([1, 0, 0], r.pitch ?? 0));
    B.forEach((b, i) => {
      const g = this.names[i];
      const ch: Ch | undefined = g ? s.bones[g] : undefined;
      // Local channel rotation in the bone's own (animation-rest) frame: X flex, Y twist, Z side.
      const chq = ch ? qmul(qmul(qaxis([0, 0, 1], ch[2]), qaxis([0, 1, 0], ch[1])), qaxis([1, 0, 0], ch[0])) : QI;
      const base = qmul(this.animRest[i], chq);
      world[i] = b.parent < 0
        ? qmul(rootRot, base)
        : qmul(qmul(world[b.parent], qconj(this.animRest[b.parent])), base);
      rot[i] = b.parent < 0 ? world[i] : qmul(qconj(world[b.parent]), world[i]);
      if (b.parent < 0) {
        const k = this.scale;
        const drop = (r.drop ?? 0) * (LYING_HEIGHT - b.head[1]);
        const tr = opts.rootMotion && clip.travel ? clip.travel.map((v) => v * time * k) : [0, 0, 0];
        rootPos.set(i, [b.head[0] + (r.x ?? 0) * k + tr[0], b.head[1] + (r.y ?? 0) * k + drop + tr[1], b.head[2] + (r.z ?? 0) * k + tr[2]]);
      }
    });
    if (r.ground || r.lift) {
      // World positions by forward kinematics, then shift the root so the lowest foot rests on the floor.
      const pos: Vec3[] = new Array(B.length);
      B.forEach((b, i) => {
        if (b.parent < 0) pos[i] = rootPos.get(i)!;
        else {
          const o = qrot(world[b.parent], this.restOffset[i]);
          const p = pos[b.parent];
          pos[i] = [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
        }
      });
      const low = this.feet.length ? Math.min(...this.feet.map((i) => pos[i][1])) : this.restFootY;
      const shift = (r.ground ? this.restFootY - low : 0) + (r.lift ?? 0) * this.scale;
      for (const [i, p] of rootPos) rootPos.set(i, [p[0], p[1] + shift, p[2]]);
    }
    return { rot, rootPos };
  }

  /** Frames sampled at `fps` over the clip (inclusive end), quaternion signs kept continuous. */
  bake(clip: Clip, fps = 30, opts: { rootMotion?: boolean } = {}): { times: number[]; frames: Frame[] } {
    const n = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times: number[] = [], frames: Frame[] = [];
    for (let f = 0; f < n; f++) {
      const t = Math.min(clip.duration, f / fps);
      const fr = this.frame(clip, t, opts);
      if (frames.length) {
        const prev = frames[frames.length - 1];
        fr.rot = fr.rot.map((q, i) => {
          const p = prev.rot[i];
          return p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
        });
      }
      times.push(t);
      frames.push(fr);
    }
    return { times, frames };
  }
}
