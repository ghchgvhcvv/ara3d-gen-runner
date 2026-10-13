/**
 * Body proportions and the humanoid skeleton. All body parts are positioned from
 * these joints, so the mesh and the rig always agree. Joint names follow the
 * Mixamo convention so exported rigs retarget easily.
 */
import { clamp, lerp, type Vec3 } from './math';
import type { CharacterParams } from './params';

export const JOINT_NAMES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End',
] as const;
export type JointName = (typeof JOINT_NAMES)[number];

const PARENT: Record<JointName, JointName | null> = {
  Hips: null, Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck',
  HeadTop_End: 'Head',
  LeftShoulder: 'Spine2', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm',
  RightShoulder: 'Spine2', RightArm: 'RightShoulder', RightForeArm: 'RightArm', RightHand: 'RightForeArm',
  LeftUpLeg: 'Hips', LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg', LeftToeBase: 'LeftFoot', LeftToe_End: 'LeftToeBase',
  RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg', RightToeBase: 'RightFoot', RightToe_End: 'RightToeBase',
};

export const J = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i])) as Record<JointName, number>;

export interface Joint {
  name: JointName;
  parent: number; // -1 for root
  position: Vec3; // world space, bind pose
}

export interface Skeleton {
  joints: Joint[];
}

/** Side-dependent joint lookup: side = +1 is the character's left (+X). */
export const sideJoint = (side: number, base: string): number =>
  J[((side > 0 ? 'Left' : 'Right') + base) as JointName];

export interface Proportions {
  H: number; // total height
  B: number; // ground to chin
  headH: number; // chin to crown
  headW: number; // head half-width
  headD: number; // head half-depth
  crotchY: number;
  hipJointY: number;
  hipX: number;
  kneeY: number;
  ankleY: number;
  neckBaseY: number;
  torsoLen: number;
  shoulderY: number;
  shoulderX: number;
  upperArm: number;
  foreArm: number;
  handLen: number;
  /** Unit arm direction for the left arm; mirror X for the right. */
  armDir: Vec3;
  footLen: number;
  footW: number;
  chinY: number;
  crownY: number;
}

export function computeProportions(p: CharacterParams): Proportions {
  const m = p.masculinity;
  const H = p.height;
  const headH = (H / 7.5) * p.headScale;
  const B = H - headH;
  const chibi = clamp((p.headScale - 1) / 1, 0, 1);
  const crotchY = clamp(0.535 * p.legLength, 0.4, 0.62) * B;
  const hipJointY = crotchY + 0.065 * B;
  const ankleY = 0.05 * B;
  const kneeY = ankleY + (hipJointY - ankleY) * 0.47;
  const neckBaseY = B * (1 - 0.035 * p.neckLength * (1 - 0.4 * chibi));
  const torsoLen = neckBaseY - crotchY;
  const angle = p.pose === 'A' ? (40 * Math.PI) / 180 : 0;
  return {
    H, B, headH,
    headW: headH * 0.385 * p.headWidth * (1 + 0.1 * chibi),
    headD: headH * 0.46 * (1 + 0.05 * chibi),
    crotchY, hipJointY, ankleY, kneeY, neckBaseY, torsoLen,
    hipX: lerp(0.062, 0.056, m) * B * p.hipWidth,
    shoulderY: crotchY + torsoLen * 0.9,
    shoulderX: lerp(0.104, 0.12, m) * B * p.shoulderWidth * (1 + 0.07 * p.muscle),
    upperArm: 0.212 * B * p.armLength,
    foreArm: 0.168 * B * p.armLength,
    handLen: 0.124 * B * p.handSize,
    armDir: [Math.cos(angle), -Math.sin(angle), 0],
    footLen: 0.185 * B * p.footSize,
    footW: 0.047 * B * p.footSize,
    chinY: B,
    crownY: B + headH,
  };
}

export function buildSkeleton(pr: Proportions): Skeleton {
  const pos = {} as Record<JointName, Vec3>;
  const { B, torsoLen: tl, crotchY: cy } = pr;
  pos.Hips = [0, pr.hipJointY, 0];
  pos.Spine = [0, cy + 0.4 * tl, 0];
  pos.Spine1 = [0, cy + 0.62 * tl, 0];
  pos.Spine2 = [0, cy + 0.8 * tl, 0];
  pos.Neck = [0, pr.neckBaseY - 0.02 * B, -0.005 * B];
  pos.Head = [0, pr.chinY + 0.22 * pr.headH, -0.1 * pr.headD];
  pos.HeadTop_End = [0, pr.crownY, 0];
  for (const s of [1, -1]) {
    const side = s > 0 ? 'Left' : 'Right';
    const d: Vec3 = [pr.armDir[0] * s, pr.armDir[1], 0];
    const sh: Vec3 = [s * pr.shoulderX, pr.shoulderY, 0];
    const el: Vec3 = [sh[0] + d[0] * pr.upperArm, sh[1] + d[1] * pr.upperArm, 0];
    const wr: Vec3 = [el[0] + d[0] * pr.foreArm, el[1] + d[1] * pr.foreArm, 0];
    pos[`${side}Shoulder` as JointName] = [s * pr.shoulderX * 0.3, pr.shoulderY + 0.01 * B, 0];
    pos[`${side}Arm` as JointName] = sh;
    pos[`${side}ForeArm` as JointName] = el;
    pos[`${side}Hand` as JointName] = wr;
    const ax = s * pr.hipX * 0.9;
    pos[`${side}UpLeg` as JointName] = [s * pr.hipX, pr.hipJointY, 0];
    pos[`${side}Leg` as JointName] = [s * pr.hipX * 0.95, pr.kneeY, 0.005 * B];
    pos[`${side}Foot` as JointName] = [ax, pr.ankleY, 0];
    pos[`${side}ToeBase` as JointName] = [ax, 0.02 * B, 0.5 * pr.footLen];
    pos[`${side}Toe_End` as JointName] = [ax, 0.02 * B, 0.76 * pr.footLen];
  }
  return {
    joints: JOINT_NAMES.map((name) => ({
      name,
      parent: PARENT[name] ? J[PARENT[name]!] : -1,
      position: pos[name],
    })),
  };
}
