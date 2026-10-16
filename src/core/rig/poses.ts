/**
 * Engine-neutral poses and motions for testing a rig (and the seed of the
 * animation system). Rotations are given about axes in the character's rest
 * frame (+X = character's left, +Y = up, +Z = forward) and applied at each
 * bone's head, so the same definitions work on every skeleton type.
 */
import type { Vec3 } from '../math';
import type { RigType } from './skeletons';

export interface Rot {
  axis: Vec3;
  deg: number;
}
/** Bone (game-rig name) -> rotations, applied in order. */
export type Pose = Record<string, Rot[]>;

export interface Motion {
  name: string;
  /** Seconds per loop. */
  duration: number;
  sample(t: number): Pose;
}

const X: Vec3 = [1, 0, 0], Y: Vec3 = [0, 1, 0], Z: Vec3 = [0, 0, 1];
const r = (axis: Vec3, deg: number): Rot[] => [{ axis, deg }];

export const POSES: Record<string, Pose> = {
  Rest: {},
  'Arms up': { LeftArm: r(Z, 115), RightArm: r(Z, -115), Spine1: r(X, -5) },
  Wave: { RightArm: r(Z, -120), RightForeArm: r(Z, -35), Head: r(Y, -12), Spine1: r(Z, 4) },
  Squat: {
    LeftUpLeg: r(X, -85), RightUpLeg: r(X, -85), LeftLeg: r(X, 100), RightLeg: r(X, 100),
    LeftFoot: r(X, -15), RightFoot: r(X, -15), Spine: r(X, 20), Spine1: r(X, 10),
    LeftArm: [{ axis: X, deg: -75 }, { axis: Y, deg: 25 }], RightArm: [{ axis: X, deg: -75 }, { axis: Y, deg: -25 }],
  },
  'Fist & point': (() => {
    // Fingers curl toward the palm: about -Z on the left hand, +Z on the right (A- and T-pose alike).
    const curl = (side: 'Left' | 'Right', fingers: string[]): Pose =>
      Object.fromEntries(fingers.flatMap((f) => [1, 2, 3].map((k) => [`${side}Hand${f}${k}`, r(Z, (side === 'Left' ? -1 : 1) * (k === 1 ? 70 : 85))])));
    return {
      ...curl('Left', ['Index', 'Middle', 'Ring', 'Pinky']),
      ...curl('Right', ['Middle', 'Ring', 'Pinky']),
      RightArm: [{ axis: Z, deg: -45 }, { axis: X, deg: -50 }],
    };
  })(),
};

const s = Math.sin;
export const MOTIONS: Record<string, Motion> = {
  Idle: {
    name: 'Idle',
    duration: 4,
    sample: (t) => {
      const a = (t / 4) * Math.PI * 2;
      return {
        Spine: r(X, 1.5 * s(a)), Spine2: r(X, 1.5 * s(a + 0.6)), Head: [{ axis: Y, deg: 12 * s(a * 0.5) }, { axis: X, deg: 3 * s(a) }],
        LeftArm: r(Z, 3 * s(a + 1)), RightArm: r(Z, -3 * s(a + 1)), LeftForeArm: r(X, -6), RightForeArm: r(X, -6),
      };
    },
  },
  Walk: {
    name: 'Walk',
    duration: 1.1,
    sample: (t) => {
      const a = (t / 1.1) * Math.PI * 2;
      const knee = (ph: number) => Math.max(0, s(a + ph)) * 55 + 5;
      return {
        Hips: r(Y, 6 * s(a)),
        Spine1: r(Y, -8 * s(a)),
        LeftUpLeg: r(X, -28 * s(a)), RightUpLeg: r(X, 28 * s(a)),
        LeftLeg: r(X, knee(Math.PI / 2 + Math.PI)), RightLeg: r(X, knee(Math.PI / 2)),
        LeftFoot: r(X, 10 * s(a + 0.5)), RightFoot: r(X, -10 * s(a + 0.5)),
        LeftArm: [{ axis: Z, deg: 12 }, { axis: X, deg: 25 * s(a) }], RightArm: [{ axis: Z, deg: -12 }, { axis: X, deg: -25 * s(a) }],
        LeftForeArm: r(X, -15 - 10 * Math.max(0, -s(a))), RightForeArm: r(X, -15 - 10 * Math.max(0, s(a))),
      };
    },
  },
};

/** Game-rig bone name -> bone in the chosen skeleton (the full MakeHuman rig uses its own names). */
export function boneFor(rig: RigType, name: string): string | undefined {
  if (rig !== 'full') return name;
  const side = name.startsWith('Left') ? '.L' : name.startsWith('Right') ? '.R' : '';
  const base = name.replace(/^(Left|Right)/, '');
  const MAP: Record<string, string> = {
    Hips: 'root', Spine: 'spine04', Spine1: 'spine03', Spine2: 'spine02', Neck: 'neck01', Head: 'head',
    Shoulder: 'clavicle', Arm: 'upperarm01', ForeArm: 'lowerarm01', Hand: 'wrist',
    UpLeg: 'upperleg01', Leg: 'lowerleg01', Foot: 'foot',
  };
  const f = /^Hand(Thumb|Index|Middle|Ring|Pinky)(\d)$/.exec(base);
  if (f) return `finger${['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].indexOf(f[1]) + 1}-${f[2]}${side}`;
  return MAP[base] ? MAP[base] + side : undefined;
}
