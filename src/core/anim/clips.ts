/**
 * Animation clips, defined procedurally against the game-rig bone names.
 *
 * Channels are degrees about each bone's own axes in the "animation rest"
 * (relaxed arms): X = flex (+ swings the bone's tip forward: thigh forward,
 * spine lean forward, elbow bend, toes up; knee bend is negative), Y = twist
 * (+ turns left on vertical bones), Z = side (+ raises the left arm out).
 * Right-side values are written as the mirror of the left via `side()`.
 */
export type Ch = [number, number, number];

export interface Root {
  /** Metres (scaled to the character's height), in the character's rest frame. */
  x?: number;
  y?: number;
  z?: number;
  /** Degrees about world up (+ = turn left) and world X (+ = pitch forward). */
  yaw?: number;
  pitch?: number;
  /** 0..1: lowers the hips from standing height to lying height. */
  drop?: number;
  /** Keep the lowest foot on the floor (adjusts hip height after posing). */
  ground?: boolean;
  /** Metres added after grounding (jumps). */
  lift?: number;
}

/**
 * Hand IK target in "chest space": metres (at 1.8 m height) from the base of
 * the neck, axes following the chest (+X character's left, +Y up, +Z forward).
 * The shoulder joints sit about 0.1 m below and 0.2 m to each side of it.
 */
export interface HandTarget {
  pos: [number, number, number];
  /** Direction the elbow should point (chest space). */
  pole: [number, number, number];
  /** Optional hand orientation: direction from wrist to fingers, and palm normal (chest space). */
  dir?: [number, number, number];
  palm?: [number, number, number];
}

export interface Sample {
  bones: Record<string, Ch>;
  root: Root;
  ik?: { Left?: HandTarget; Right?: HandTarget };
  /** 0..1: wrap the thumb across the front of the index/middle fingers (fists). */
  thumbs?: { Left?: number; Right?: number };
}

export type ClipCategory = 'Idle & stance' | 'Locomotion' | 'Turns' | 'Actions' | 'Emotes' | 'Shooter';

export interface Clip {
  id: string;
  name: string;
  category: ClipCategory;
  duration: number;
  loop: boolean;
  /** Root-motion velocity (metres/second at 1.8 m height, character frame: +X left, +Z forward). */
  travel?: [number, number, number];
  sample(t: number): Sample;
}

// --- Curve helpers -----------------------------------------------------------------

/** Periodic Catmull-Rom through evenly spaced keys over phase 0..1. */
function cyc(keys: number[]): (p: number) => number {
  const n = keys.length;
  return (p) => {
    const x = (((p % 1) + 1) % 1) * n;
    const i = Math.floor(x), f = x - i;
    const k = (j: number) => keys[(((i + j) % n) + n) % n];
    const p0 = k(-1), p1 = k(0), p2 = k(1), p3 = k(2);
    return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
  };
}

/** Smooth (eased) interpolation through timed keys, clamped at the ends. */
function track(times: number[], values: number[]): (t: number) => number {
  return (t) => {
    if (t <= times[0]) return values[0];
    const n = times.length;
    if (t >= times[n - 1]) return values[n - 1];
    let i = 0;
    while (t > times[i + 1]) i++;
    const f = (t - times[i]) / (times[i + 1] - times[i]);
    const s = f * f * (3 - 2 * f);
    return values[i] + (values[i + 1] - values[i]) * s;
  };
}

const smoother = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Left/right channels: right is the mirror (twist and side negated). */
function side(out: Record<string, Ch>, bone: string, left: Ch, right: Ch) {
  out[`Left${bone}`] = left;
  out[`Right${bone}`] = [right[0], -right[1], -right[2]];
}

/** Relaxed, slightly curled fingers (game rig). */
function fingers(out: Record<string, Ch>, curl = 12) {
  for (const f of ['Index', 'Middle', 'Ring', 'Pinky'])
    for (let k = 1; k <= 3; k++) side(out, `Hand${f}${k}`, [curl * (k === 1 ? 0.8 : 1.1), 0, 0], [curl * (k === 1 ? 0.8 : 1.1), 0, 0]);
  side(out, 'HandThumb2', [8, 0, 0], [8, 0, 0]);
}

/**
 * Closed fists: fingers curl into the palm; the thumb is wrapped across the
 * front of the index/middle fingers by the evaluator (sample.thumbs).
 */
function fist(out: Record<string, Ch>, sides: ('Left' | 'Right')[] = ['Left', 'Right']) {
  for (const s of sides) {
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
      out[`${s}Hand${f}1`] = [80, 0, 0];
      out[`${s}Hand${f}2`] = [100, 0, 0];
      out[`${s}Hand${f}3`] = [65, 0, 0];
    }
    out[`${s}HandThumb2`] = [15, 0, 0];
    out[`${s}HandThumb3`] = [25, 0, 0];
  }
}
const FISTS = { Left: 1, Right: 1 };

/** Grip on a rifle: trigger finger along the guard (right), wrapped fingers. */
function grip(out: Record<string, Ch>, side: 'Left' | 'Right', trigger = false, curl = 1) {
  for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
    const t = trigger && f === 'Index';
    out[`${side}Hand${f}1`] = [(t ? 20 : 60) * curl, 0, 0];
    out[`${side}Hand${f}2`] = [(t ? 25 : 80) * curl, 0, 0];
    out[`${side}Hand${f}3`] = [(t ? 15 : 50) * curl, 0, 0];
  }
  out[`${side}HandThumb2`] = [30 * curl, 0, 0];
  out[`${side}HandThumb3`] = [20 * curl, 0, 0];
}

// --- Locomotion cycles ----------------------------------------------------------------

interface Gait {
  thigh: number[];
  knee: number[];
  foot: number[];
  arm: number[];
  elbow: number[];
  bob: number[]; // metres, 8 keys over the full cycle (two steps)
  pelvisYaw: number;
  spineLean: number;
  armOut: number;
  legIn: number;
}

const WALK: Gait = {
  thigh: [25, 18, 6, -8, -18, -8, 12, 24],
  knee: [-5, -15, -8, -5, -22, -58, -40, -10],
  foot: [15, 0, 0, -6, -20, -10, 5, 10],
  arm: [-18, -10, 0, 10, 18, 10, 0, -10],
  elbow: [10, 11, 14, 20, 25, 20, 14, 11],
  bob: [0, -0.018, -0.004, 0.012, 0, -0.018, -0.004, 0.012],
  pelvisYaw: 5,
  spineLean: 3,
  armOut: 2,
  legIn: 5,
};

const RUN: Gait = {
  thigh: [30, 12, -10, -25, -5, 35, 55, 42],
  knee: [-20, -42, -25, -18, -85, -110, -72, -35],
  foot: [10, 0, -12, -30, -20, 0, 15, 15],
  arm: [-32, -18, 4, 22, 28, 18, -4, -26],
  elbow: [72, 74, 80, 86, 88, 84, 78, 74],
  bob: [0, -0.04, -0.015, 0.035, 0, -0.04, -0.015, 0.035],
  pelvisYaw: 9,
  spineLean: 11,
  armOut: 6,
  legIn: 4,
};

function gait(g: Gait, p: number, reverse = false): Sample {
  const ph = reverse ? 1 - p : p;
  const c = (keys: number[]) => cyc(keys);
  const thigh = c(g.thigh), knee = c(g.knee), foot = c(g.foot), arm = c(g.arm), elbow = c(g.elbow), bob = c(g.bob);
  const out: Record<string, Ch> = {};
  const L = ph, R = ph + 0.5;
  // Thighs slightly adducted so the feet track under the body (the bind pose stands wide).
  side(out, 'UpLeg', [thigh(L), 0, -g.legIn], [thigh(R), 0, -g.legIn]);
  side(out, 'Leg', [knee(L), 0, 0], [knee(R), 0, 0]);
  side(out, 'Foot', [foot(L), 0, g.legIn * 0.8], [foot(R), 0, g.legIn * 0.8]);
  side(out, 'Arm', [arm(L), 0, g.armOut], [arm(R), 0, g.armOut]);
  side(out, 'ForeArm', [elbow(L), 0, 0], [elbow(R), 0, 0]);
  const twist = Math.sin(ph * Math.PI * 2) * g.pelvisYaw;
  out.Hips = [0, -twist, Math.sin(ph * Math.PI * 2 + Math.PI / 2) * 2];
  out.Spine = [g.spineLean * 0.4 * (reverse ? -1 : 1), twist * 0.6, 0];
  out.Spine1 = [g.spineLean * 0.4 * (reverse ? -1 : 1), twist * 0.6, 0];
  out.Spine2 = [g.spineLean * 0.2, twist * 0.2, 0];
  out.Head = [-g.spineLean * 0.6, -twist * 0.3, 0];
  fingers(out, g === RUN ? 25 : 12);
  // Walking keeps the stance foot planted; running has a flight phase so it uses its own bob.
  return { bones: out, root: g === RUN ? { y: bob(ph) } : { ground: true } };
}

// --- Clips -----------------------------------------------------------------------------

const idle: Clip = {
  id: 'idle', name: 'Idle', category: 'Idle & stance', duration: 3.2, loop: true,
  sample: (t) => {
    const a = (t / 3.2) * Math.PI * 2;
    const out: Record<string, Ch> = {
      Spine: [1.2 * Math.sin(a), 0, 0],
      Spine2: [1.5 * Math.sin(a + 0.7), 0, 0],
      Hips: [0, 0, 1.5 * Math.sin(a * 0.5)],
      Neck: [0, 0, -0.8 * Math.sin(a * 0.5)],
      Head: [2 * Math.sin(a + 1), 7 * Math.sin(a * 0.5), 0],
    };
    side(out, 'Arm', [2 * Math.sin(a), 0, 3 + Math.sin(a)], [2 * Math.sin(a + 0.4), 0, 3 + Math.sin(a + 0.4)]);
    side(out, 'ForeArm', [12 + 2 * Math.sin(a), 0, 0], [12 + 2 * Math.sin(a + 0.4), 0, 0]);
    side(out, 'Leg', [-3, 0, 0], [-3, 0, 0]);
    side(out, 'UpLeg', [0, 0, -3], [0, 0, -3]);
    fingers(out, 14);
    return { bones: out, root: { x: 0.008 * Math.sin(a * 0.5), y: 0.002 * Math.sin(a), ground: true } };
  },
};

const walk: Clip = { id: 'walk', name: 'Walk', category: 'Locomotion', duration: 1.1, loop: true, travel: [0, 0, 1.35], sample: (t) => gait(WALK, t / 1.1) };
const run: Clip = { id: 'run', name: 'Run', category: 'Locomotion', duration: 0.72, loop: true, travel: [0, 0, 3.6], sample: (t) => gait(RUN, t / 0.72) };
const walkBack: Clip = {
  id: 'walk_back', name: 'Walk backwards', category: 'Locomotion', duration: 1.25, loop: true, travel: [0, 0, -1.0],
  sample: (t) => gait({ ...WALK, arm: WALK.arm.map((x) => x * 0.6), spineLean: -4 }, t / 1.25, true),
};

const fall: Clip = {
  id: 'fall', name: 'Fall', category: 'Actions', duration: 1.9, loop: false,
  sample: (t) => {
    const T = [0, 0.25, 0.6, 0.85, 1.0, 1.9];
    const k = (v: number[]) => track(T, v)(t);
    const out: Record<string, Ch> = {
      Spine: [k([0, -5, -10, -4, -2, 0]), 0, 0],
      Spine1: [k([0, -3, -8, -3, -1, 0]), 0, 0],
      Neck: [k([0, 8, 18, 10, 4, -4]), 0, 0],
      Head: [k([0, 5, 12, 6, 0, -6]), k([0, 0, 0, 10, 12, 15]), 0],
    };
    side(out, 'UpLeg', [k([0, 25, 45, 22, 14, 8]), 0, k([0, 2, 6, 8, 8, 8])], [k([0, 22, 40, 26, 18, 12]), 0, k([0, 2, 5, 10, 10, 10])]);
    side(out, 'Leg', [k([0, -45, -60, -25, -15, -10]), 0, 0], [k([0, -40, -55, -30, -22, -18]), 0, 0]);
    side(out, 'Foot', [k([0, 10, 5, -10, -15, -20]), 0, 0], [k([0, 10, 5, -10, -15, -18]), 0, 0]);
    side(out, 'Arm', [k([0, 40, 60, 25, 0, -8]), 0, k([0, 15, 55, 45, 30, 22])], [k([0, 35, 55, 20, 0, -6]), 0, k([0, 15, 60, 50, 32, 25])]);
    side(out, 'ForeArm', [k([0, 20, 35, 20, 10, 6]), 0, 0], [k([0, 20, 30, 22, 12, 8]), 0, 0]);
    fingers(out, k([12, 20, 30, 20, 18, 18]));
    return {
      bones: out,
      root: { drop: k([0, 0.15, 0.55, 1, 0.96, 1]), pitch: k([0, -5, -50, -88, -84, -88]), z: k([0, -0.05, -0.25, -0.45, -0.46, -0.46]) },
    };
  },
};

function turn(id: string, name: string, angle: number): Clip {
  const steps = Math.max(1, Math.round(Math.abs(angle) / 45));
  const duration = 0.55 + Math.abs(angle) / 180 * 0.85;
  const leadSide = angle > 0 ? 'Left' : 'Right';
  const other = angle > 0 ? 'Right' : 'Left';
  return {
    id, name, category: 'Turns', duration, loop: false,
    sample: (t) => {
      const u = t / duration;
      const turnAmt = smoother((u - 0.05) / 0.85);
      const lead = Math.sin(Math.min(1, u / 0.6) * Math.PI); // upper body leads the turn
      const out: Record<string, Ch> = {
        Spine1: [2, angle * 0.06 * lead, 0],
        Spine2: [0, angle * 0.05 * lead, 0],
        Head: [0, Math.max(-25, Math.min(25, angle * 0.18 * lead)), 0],
      };
      // Alternating steps, starting with the leg on the turning side.
      let bob = 0;
      const lift: Record<string, number> = { Left: 0, Right: 0 };
      for (let i = 0; i < steps; i++) {
        const a = 0.05 + (i / steps) * 0.85, b = 0.05 + ((i + 1) / steps) * 0.85;
        if (u > a && u < b) {
          const s = Math.sin(((u - a) / (b - a)) * Math.PI);
          lift[i % 2 === 0 ? leadSide : other] = s;
          bob = -0.012 * s;
        }
      }
      side(out, 'UpLeg', [24 * lift.Left, 0, 0], [24 * lift.Right, 0, 0]);
      side(out, 'Leg', [-45 * lift.Left - 4, 0, 0], [-45 * lift.Right - 4, 0, 0]);
      side(out, 'Foot', [12 * lift.Left, 0, 0], [12 * lift.Right, 0, 0]);
      side(out, 'Arm', [6 * lift.Right, 0, 4], [6 * lift.Left, 0, 4]);
      side(out, 'ForeArm', [14, 0, 0], [14, 0, 0]);
      fingers(out, 14);
      return { bones: out, root: { yaw: angle * turnAmt, y: bob, ground: true } };
    },
  };
}

function strafe(dirLeft: boolean): Clip {
  const lead = dirLeft ? 'Left' : 'Right', trail = dirLeft ? 'Right' : 'Left';
  return {
    id: dirLeft ? 'strafe_left' : 'strafe_right', name: dirLeft ? 'Strafe left' : 'Strafe right', category: 'Locomotion',
    duration: 0.9, loop: true, travel: [dirLeft ? 1.1 : -1.1, 0, 0],
    sample: (t) => {
      const p = t / 0.9;
      const out: Record<string, Ch> = {};
      const legs: Record<string, { out: number; thigh: number; knee: number }> = {
        [lead]: { out: cyc([0, 10, 16, 12, 8, 6, 3, 0])(p), thigh: cyc([0, 10, 8, 0, 0, 0, 0, 0])(p), knee: cyc([-4, -28, -20, -6, -4, -4, -4, -4])(p) },
        [trail]: { out: cyc([0, -2, -4, -5, -7, -2, 3, 2])(p), thigh: cyc([0, 0, 0, 0, 6, 12, 6, 0])(p), knee: cyc([-4, -4, -4, -4, -8, -28, -20, -6])(p) },
      };
      side(out, 'UpLeg', [legs.Left.thigh, 0, legs.Left.out], [legs.Right.thigh, 0, legs.Right.out]);
      side(out, 'Leg', [legs.Left.knee, 0, 0], [legs.Right.knee, 0, 0]);
      side(out, 'Foot', [-legs.Left.knee * 0.3, 0, -legs.Left.out * 0.5], [-legs.Right.knee * 0.3, 0, -legs.Right.out * 0.5]);
      side(out, 'Arm', [8, 0, 6], [8, 0, 6]);
      side(out, 'ForeArm', [25, 0, 0], [25, 0, 0]);
      out.Spine = [4, 0, (dirLeft ? -1 : 1) * 2 * Math.sin(p * Math.PI * 2)];
      out.Head = [-2, 0, 0];
      fingers(out, 14);
      return { bones: out, root: { ground: true } };
    },
  };
}

const crouch: Clip = {
  id: 'crouch', name: 'Crouch idle', category: 'Idle & stance', duration: 3, loop: true,
  sample: (t) => {
    const a = (t / 3) * Math.PI * 2;
    const out: Record<string, Ch> = {
      Spine: [20 + Math.sin(a), 0, 0], Spine1: [8, 0, 0], Neck: [-10, 0, 0], Head: [-14, 6 * Math.sin(a * 0.5), 0],
    };
    side(out, 'UpLeg', [78, 0, 8], [78, 0, 8]);
    side(out, 'Leg', [-118, 0, 0], [-118, 0, 0]);
    side(out, 'Foot', [36, 0, 0], [36, 0, 0]);
    side(out, 'Arm', [32 + Math.sin(a), 0, 8], [32 + Math.sin(a + 0.5), 0, 8]);
    side(out, 'ForeArm', [55, 0, 0], [55, 0, 0]);
    fingers(out, 20);
    return { bones: out, root: { ground: true } };
  },
};

const jump: Clip = {
  id: 'jump', name: 'Jump', category: 'Actions', duration: 1.3, loop: false,
  sample: (t) => {
    const T = [0, 0.25, 0.4, 0.55, 0.75, 0.95, 1.1, 1.3];
    const k = (v: number[]) => track(T, v)(t);
    const out: Record<string, Ch> = {
      Spine: [k([0, 22, -5, 8, 10, 6, 24, 0]), 0, 0], Spine1: [k([0, 8, -4, 4, 4, 2, 8, 0]), 0, 0], Head: [k([0, -14, 4, -4, -6, -2, -14, 0]), 0, 0],
    };
    side(out, 'UpLeg', [k([0, 55, -5, 40, 35, 20, 58, 0]), 0, 4], [k([0, 55, -5, 40, 35, 20, 58, 0]), 0, 4]);
    side(out, 'Leg', [k([-3, -85, 0, -60, -50, -20, -88, -3]), 0, 0], [k([-3, -85, 0, -60, -50, -20, -88, -3]), 0, 0]);
    side(out, 'Foot', [k([0, 28, -35, -10, -10, 0, 30, 0]), 0, 0], [k([0, 28, -35, -10, -10, 0, 30, 0]), 0, 0]);
    side(out, 'Arm', [k([0, -40, 130, 90, 70, 30, 35, 0]), 0, k([4, 8, 10, 20, 20, 10, 8, 4])], [k([0, -40, 130, 90, 70, 30, 35, 0]), 0, k([4, 8, 10, 20, 20, 10, 8, 4])]);
    side(out, 'ForeArm', [k([12, 15, 10, 30, 30, 20, 30, 12]), 0, 0], [k([12, 15, 10, 30, 30, 20, 30, 12]), 0, 0]);
    fingers(out, 16);
    return { bones: out, root: { ground: true, lift: k([0, 0, 0.06, 0.38, 0.3, 0, 0, 0]) } };
  },
};

const punch: Clip = {
  id: 'punch', name: 'Punch', category: 'Actions', duration: 0.9, loop: false,
  sample: (t) => {
    const T = [0, 0.25, 0.4, 0.55, 0.9];
    const k = (v: number[]) => track(T, v)(t);
    const out: Record<string, Ch> = {
      Hips: [0, k([0, -4, 6, 5, 0]), 0],
      Spine1: [6, k([0, -6, 11, 9, 0]), 0],
      Spine2: [0, k([0, -3, 5, 4, 0]), 0],
      Head: [-6, k([0, 6, -12, -10, 0]), 0],
    };
    side(out, 'Arm', [55, 0, 12], [k([55, 55, 86, 84, 55]), 0, k([12, 14, 16, 16, 12])]);
    side(out, 'ForeArm', [120, 0, 0], [k([120, 125, 8, 15, 120]), 0, 0]);
    side(out, 'UpLeg', [14, 0, 4], [k([-6, -6, -10, -10, -6]), 0, 4]);
    side(out, 'Leg', [-20, 0, 0], [-8, 0, 0]);
    side(out, 'Foot', [6, 0, 0], [0, 0, 0]);
    fist(out);
    return { bones: out, root: { ground: true }, thumbs: FISTS };
  },
};

const hit: Clip = {
  id: 'hit', name: 'Hit reaction', category: 'Actions', duration: 0.8, loop: false,
  sample: (t) => {
    const T = [0, 0.1, 0.3, 0.8];
    const k = (v: number[]) => track(T, v)(t);
    const out: Record<string, Ch> = {
      Spine: [k([0, -18, -8, 0]), 0, 0], Spine1: [k([0, -12, -5, 0]), 0, 0], Neck: [k([0, -15, -5, 0]), 0, 0],
      Head: [k([0, -20, 5, 0]), k([0, 10, 4, 0]), 0],
    };
    side(out, 'Arm', [k([0, 25, 10, 0]), 0, k([3, 22, 10, 3])], [k([0, 20, 8, 0]), 0, k([3, 25, 10, 3])]);
    side(out, 'ForeArm', [k([12, 40, 22, 12]), 0, 0], [k([12, 35, 20, 12]), 0, 0]);
    side(out, 'UpLeg', [0, 0, 0], [k([0, -15, -10, 0]), 0, 0]);
    side(out, 'Leg', [-3, 0, 0], [k([-3, -22, -10, -3]), 0, 0]);
    fingers(out, k([14, 30, 20, 14]));
    return { bones: out, root: { ground: true, z: k([0, -0.04, -0.06, -0.05]) } };
  },
};

const wave: Clip = {
  id: 'wave', name: 'Wave', category: 'Emotes', duration: 1.6, loop: true,
  sample: (t) => {
    const a = (t / 1.6) * Math.PI * 2;
    const sw = Math.sin(a * 2); // two waves per loop
    const out: Record<string, Ch> = { Head: [0, -12, 4], Neck: [0, -4, 0], Spine1: [0, -6, -3], Spine2: [-2, 0, -2] };
    side(out, 'Shoulder', [0, 0, 0], [0, 0, 12]);
    side(out, 'Arm', [2, 0, 3], [0, 0, 0]);
    side(out, 'ForeArm', [12, 0, 0], [0, 0, 0]);
    side(out, 'Hand', [0, 0, 0], [0, 0, 0]);
    fingers(out, 4);
    side(out, 'HandThumb2', [0, 0, 0], [0, 0, 0]);
    return {
      bones: out,
      root: { ground: true },
      ik: {
        // Hand beside the head, forearm upright; the wave comes from the shoulder and wrist.
        Right: { pos: v(-0.36 - 0.05 * sw, 0.16, 0.06), pole: v(-0.6, -1, -0.2), dir: v(-0.25 * sw, 1, 0.05), palm: v(0, 0, 1) },
      },
    };
  },
};

const cheer: Clip = {
  id: 'cheer', name: 'Cheer', category: 'Emotes', duration: 1.2, loop: true,
  sample: (t) => {
    const ph = (t / 1.2) * 2; // two fist pumps (and hops) per loop
    const u = ph % 1;
    const pump = Math.sin(Math.min(1, u / 0.35) * Math.PI * 0.5) * (u < 0.35 ? 1 : 1 - (u - 0.35) / 0.65); // fast up, slow down
    const hop = Math.max(0, Math.sin(u * Math.PI * 2 - 0.3));
    const out: Record<string, Ch> = {
      Spine: [-5 - 3 * pump, 0, 0], Spine1: [-4 - 3 * pump, 0, 0], Spine2: [-3, 0, 0],
      Neck: [-8, 0, 0], Head: [-14 - 6 * pump, 0, 0],
    };
    side(out, 'Shoulder', [0, 0, 14 + 8 * pump], [0, 0, 14 + 8 * pump]);
    side(out, 'UpLeg', [10 * (1 - hop), 0, -2], [10 * (1 - hop), 0, -2]);
    side(out, 'Leg', [-18 * (1 - hop) - 4, 0, 0], [-18 * (1 - hop) - 4, 0, 0]);
    side(out, 'Foot', [8 * (1 - hop) - 12 * hop, 0, 0], [8 * (1 - hop) - 12 * hop, 0, 0]);
    fist(out);
    // Double fist pump: elbows bent out, fists driving up from head height to just above it.
    const up = 0.06 + 0.24 * pump;
    const wide = 0.36 - 0.04 * pump;
    return {
      bones: out,
      root: { ground: true, lift: 0.06 * hop },
      thumbs: FISTS,
      ik: {
        Left: { pos: v(wide, up, 0.12), pole: v(1, -0.5, -0.4), dir: v(0.1, 1, 0.15), palm: v(-0.3, 0, 1) },
        Right: { pos: v(-wide, up, 0.12), pole: v(-1, -0.5, -0.4), dir: v(-0.1, 1, 0.15), palm: v(0.3, 0, 1) },
      },
    };
  },
};

// --- Shooter (rifle) -----------------------------------------------------------------------
// Hands are placed by IK in chest space; the weapon itself is supplied by the game
// (attach it to RightHand). Right-handed, rifle along +Z.

type Hold = { Left: HandTarget; Right: HandTarget };
const v = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
const lerp3 = (a: [number, number, number], b: [number, number, number], t: number) => v(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

// Shouldered aim: stock in the right shoulder pocket, grip below the bore, support hand on the handguard.
const AIM: Hold = {
  Right: { pos: v(-0.13, -0.19, 0.22), pole: v(-1, -0.9, -0.2), dir: v(0.1, -0.55, 0.83), palm: v(1, 0, 0) },
  Left: { pos: v(-0.01, -0.13, 0.5), pole: v(0.4, -1, 0), dir: v(-0.35, 0.2, 0.91), palm: v(0, 1, 0) },
};
// Low ready: same hold, muzzle angled down ~40 degrees.
const READY: Hold = {
  Right: { pos: v(-0.15, -0.36, 0.17), pole: v(-1, -0.6, -0.4), dir: v(0.1, -0.75, 0.65), palm: v(1, 0, 0) },
  Left: { pos: v(0.03, -0.42, 0.4), pole: v(0.6, -1, 0), dir: v(-0.35, 0.05, 0.93), palm: v(0, 1, 0) },
};
// Sprint: rifle carried diagonally across the chest.
const SPRINT: Hold = {
  Right: { pos: v(-0.17, -0.42, 0.13), pole: v(-1, -0.5, -0.5), dir: v(0.3, -0.75, 0.55), palm: v(1, 0, 0) },
  Left: { pos: v(0.12, -0.2, 0.27), pole: v(0.8, -1, 0), dir: v(-0.6, 0.35, 0.7), palm: v(0, 1, 0) },
};

/** Upper body for a rifle hold: shoulders square, head on the sights when aiming. */
function rifleUpper(out: Record<string, Ch>, aiming: boolean, breathe = 0) {
  out.Spine1 = [(aiming ? 4 : 2) + breathe, (out.Spine1?.[1] ?? 0), 0];
  out.Spine2 = [(aiming ? 3 : 1) + breathe * 0.5, (out.Spine2?.[1] ?? 0), 0];
  out.Neck = [aiming ? 6 : 0, aiming ? -6 : 0, 0];
  out.Head = [aiming ? 10 : 4, aiming ? -8 : 0, aiming ? -4 : 0];
  grip(out, 'Right', true);
  grip(out, 'Left');
}

/** Bladed shooter stance (left foot forward). */
function stance(out: Record<string, Ch>, crouch = false) {
  if (crouch) {
    side(out, 'UpLeg', [72, 0, 4], [65, 0, 2]);
    side(out, 'Leg', [-105, 0, 0], [-120, 0, 0]);
    side(out, 'Foot', [30, 0, 0], [40, 0, 0]);
    out.Spine = [16, 0, 0];
  } else {
    side(out, 'UpLeg', [8, 0, -1], [-6, 0, 0]);
    side(out, 'Leg', [-8, 0, 0], [-4, 0, 0]);
    side(out, 'Foot', [2, 0, 0], [0, 0, 0]);
  }
}

const hold = (h: Hold, recoil = 0): Sample['ik'] => ({
  Right: { ...h.Right, pos: v(h.Right.pos[0], h.Right.pos[1] + recoil * 0.015, h.Right.pos[2] - recoil * 0.035) },
  Left: { ...h.Left, pos: v(h.Left.pos[0], h.Left.pos[1] + recoil * 0.02, h.Left.pos[2] - recoil * 0.03) },
});

function rifleLoop(id: string, name: string, duration: number, legs: (t: number) => Sample | null, h: Hold, aiming: boolean, travel?: [number, number, number], crouch = false): Clip {
  return {
    id, name, category: 'Shooter', duration, loop: true, travel,
    sample: (t) => {
      const base = legs(t);
      const out: Record<string, Ch> = {};
      if (base) for (const [k, ch] of Object.entries(base.bones)) if (/(UpLeg|Leg|Foot|ToeBase|Hips|Spine$)/.test(k)) out[k] = ch;
      if (!base) stance(out, crouch);
      if (crouch && base) {
        // Crouched stepping: deepen the knees on top of the gait.
        for (const s of ['Left', 'Right']) {
          out[`${s}UpLeg`] = [(out[`${s}UpLeg`]?.[0] ?? 0) * 0.5 + 62, 0, 4 * (s === 'Left' ? 1 : -1)];
          out[`${s}Leg`] = [(out[`${s}Leg`]?.[0] ?? 0) * 0.5 - 100, 0, 0];
          out[`${s}Foot`] = [(out[`${s}Foot`]?.[0] ?? 0) * 0.5 + 28, 0, 0];
        }
        out.Spine = [16, out.Spine?.[1] ?? 0, 0];
      }
      // Keep the chest (and the rifle) facing forward while the hips swing.
      const hipYaw = out.Hips?.[1] ?? 0;
      out.Spine1 = [0, -hipYaw * 0.6, 0];
      out.Spine2 = [0, -hipYaw * 0.4, 0];
      const breathe = Math.sin((t / duration) * Math.PI * 2) * (base ? 0 : 1);
      rifleUpper(out, aiming, breathe);
      return { bones: out, root: base ? { ...base.root, ground: true } : { ground: true }, ik: hold(h) };
    },
  };
}

const still = () => null;
const gaitOf = (g: Gait, d: number, reverse = false) => (t: number) => gait(g, t / d, reverse);
const strafeLegs = (left: boolean) => {
  const c = strafe(left);
  return (t: number) => c.sample(t);
};
const RIFLE_WALK: Gait = { ...WALK, arm: WALK.arm.map(() => 0), pelvisYaw: 3 };
const RIFLE_RUN: Gait = { ...RUN, arm: RUN.arm.map(() => 0), pelvisYaw: 5, spineLean: 8 };
const CROUCH_WALK: Gait = { ...WALK, thigh: WALK.thigh.map((x) => x * 0.8), knee: WALK.knee.map((x) => x * 0.6), bob: WALK.bob.map(() => 0) };

const rifleFire = (auto: boolean): Clip => ({
  id: auto ? 'rifle_fire_auto' : 'rifle_fire', name: auto ? 'Rifle fire (full auto)' : 'Rifle fire (single)', category: 'Shooter',
  duration: auto ? 0.4 : 0.45, loop: auto,
  sample: (t) => {
    const out: Record<string, Ch> = {};
    stance(out);
    // Recoil kick: sharp rise, quick settle (4 shots per loop for auto).
    const ph = auto ? (t % 0.1) / 0.1 : t / 0.45;
    const kick = auto ? Math.exp(-ph * 5) * 0.8 : track([0, 0.04, 0.12, 0.45], [0, 1, 0.35, 0])(t);
    rifleUpper(out, true);
    out.Spine2 = [3 - 3 * kick, 0, 0];
    out.Head = [10 - 3 * kick, -8, -4];
    return { bones: out, root: { ground: true }, ik: hold(AIM, kick) };
  },
});

const reload: Clip = {
  id: 'rifle_reload', name: 'Rifle reload', category: 'Shooter', duration: 2.2, loop: false,
  sample: (t) => {
    const out: Record<string, Ch> = {};
    stance(out);
    rifleUpper(out, false);
    // Rifle canted up a little; left hand: handguard -> magazine -> pouch -> magazine -> slap -> handguard.
    const T = [0, 0.3, 0.6, 1.0, 1.35, 1.6, 1.75, 2.2];
    const right = lerp3(READY.Right.pos, v(-0.13, -0.3, 0.24), track([0, 0.3, 1.9, 2.2], [0, 1, 1, 0])(t));
    const mag = v(-0.05, -0.44, 0.3), pouch = v(0.13, -0.68, 0.1), slap = v(-0.04, -0.36, 0.28);
    const pts = [READY.Left.pos, READY.Left.pos, mag, pouch, mag, slap, READY.Left.pos, READY.Left.pos];
    const lp = v(track(T, pts.map((p) => p[0]))(t), track(T, pts.map((p) => p[1]))(t), track(T, pts.map((p) => p[2]))(t));
    out.Head = [track([0, 0.3, 1.8, 2.2], [4, 22, 22, 4])(t), track([0, 0.3, 1.8, 2.2], [0, -10, -10, 0])(t), 0];
    const open = track([0, 0.5, 0.65, 0.9, 1.0, 1.6, 1.75], [1, 1, 0.3, 0.3, 1, 1, 1])(t);
    grip(out, 'Left', false, open);
    return {
      bones: out, root: { ground: true },
      ik: {
        Right: { ...READY.Right, pos: right },
        Left: { pos: lp, pole: v(0.5, -1, -0.2), dir: v(-0.3, -0.2, 0.9), palm: v(-0.2, 1, 0) },
      },
    };
  },
};

const grenade: Clip = {
  id: 'throw_grenade', name: 'Throw grenade', category: 'Shooter', duration: 1.5, loop: false,
  sample: (t) => {
    const T = [0, 0.35, 0.7, 0.85, 1.05, 1.5];
    const k = (vals: number[]) => track(T, vals)(t);
    const out: Record<string, Ch> = {
      Hips: [0, k([0, -15, -25, 10, 20, 0]), 0],
      Spine1: [k([0, -5, -12, 10, 15, 0]), k([0, -15, -25, 15, 20, 0]), 0],
      Head: [0, k([0, 10, 20, -10, -15, 0]), 0],
    };
    side(out, 'UpLeg', [k([6, 15, 20, 5, 0, 6]), 0, 0], [k([-4, -10, -15, 10, 15, -4]), 0, 0]);
    side(out, 'Leg', [k([-6, -10, -15, -20, -10, -6]), 0, 0], [k([-4, -20, -25, -5, -5, -4]), 0, 0]);
    side(out, 'Arm', [k([10, 50, 70, 40, 20, 10]), 0, k([4, 20, 25, 10, 5, 4])], [k([0, -20, -40, 110, 60, 0]), 0, k([4, 70, 95, 60, 20, 4])]);
    side(out, 'ForeArm', [k([12, 20, 20, 15, 15, 12]), 0, 0], [k([12, 90, 120, 20, 30, 12]), 0, 0]);
    side(out, 'Shoulder', [0, 0, 0], [0, 0, k([0, 8, 15, 10, 0, 0])]);
    fingers(out, 14);
    out.RightHandIndex1 = [k([14, 70, 70, 10, 10, 14]), 0, 0];
    out.RightHandMiddle1 = [k([14, 70, 70, 10, 10, 14]), 0, 0];
    out.RightHandRing1 = [k([14, 70, 70, 10, 10, 14]), 0, 0];
    return { bones: out, root: { ground: true } };
  },
};

const deathForward: Clip = {
  id: 'death_forward', name: 'Death (fall forward)', category: 'Shooter', duration: 1.7, loop: false,
  sample: (t) => {
    const T = [0, 0.2, 0.55, 0.8, 0.95, 1.7];
    const k = (vals: number[]) => track(T, vals)(t);
    const out: Record<string, Ch> = {
      Spine: [k([0, 15, 20, 5, 0, 0]), 0, 0], Spine1: [k([0, 10, 12, 4, 0, 0]), 0, 0],
      Neck: [k([0, 15, 10, -10, -15, -20]), 0, 0], Head: [k([0, 10, 5, -10, -15, -10]), k([0, 0, 0, 20, 30, 35]), 0],
    };
    side(out, 'UpLeg', [k([0, 40, 60, 10, 0, -2]), 0, k([0, 2, 4, 6, 6, 6])], [k([0, 35, 55, 15, 4, 2]), 0, k([0, 2, 4, 8, 8, 8])]);
    side(out, 'Leg', [k([0, -60, -90, -30, -10, -6]), 0, 0], [k([0, -55, -80, -35, -15, -10]), 0, 0]);
    side(out, 'Foot', [k([0, 10, 20, -10, -30, -40]), 0, 0], [k([0, 10, 20, -10, -30, -35]), 0, 0]);
    side(out, 'Arm', [k([0, 30, 70, 90, 75, 70]), 0, k([3, 10, 30, 40, 45, 45])], [k([0, 25, 60, 85, 80, 75]), 0, k([3, 10, 25, 35, 40, 40])]);
    side(out, 'ForeArm', [k([12, 30, 40, 30, 20, 20]), 0, 0], [k([12, 25, 35, 30, 25, 20]), 0, 0]);
    fingers(out, k([14, 30, 20, 15, 15, 15]));
    return { bones: out, root: { drop: k([0, 0.2, 0.6, 1, 0.97, 1]), pitch: k([0, 10, 45, 88, 86, 88]), z: k([0, 0.05, 0.2, 0.42, 0.44, 0.44]) } };
  },
};

// --- Pistol --------------------------------------------------------------------------------
// Two-handed isosceles grip: arms extended, support hand wrapped around the firing hand.
const PISTOL_AIM: Hold = {
  Right: { pos: v(-0.05, -0.14, 0.5), pole: v(-0.6, -1, 0), dir: v(0.05, -0.25, 0.97), palm: v(1, 0, 0) },
  Left: { pos: v(0.03, -0.17, 0.47), pole: v(0.6, -1, 0), dir: v(-0.45, -0.2, 0.87), palm: v(-0.6, 0.4, 0.2) },
};
const PISTOL_READY: Hold = {
  Right: { pos: v(-0.05, -0.46, 0.3), pole: v(-0.6, -1, 0), dir: v(0.05, -0.75, 0.66), palm: v(1, 0, 0) },
  Left: { pos: v(0.03, -0.48, 0.27), pole: v(0.6, -1, 0), dir: v(-0.45, -0.6, 0.6), palm: v(-0.6, 0.4, 0.2) },
};
function pistolUpper(out: Record<string, Ch>, aiming: boolean) {
  out.Spine1 = [aiming ? 6 : 3, 0, 0];
  out.Neck = [aiming ? 6 : 0, 0, 0];
  out.Head = [aiming ? 6 : 6, 0, 0];
  grip(out, 'Right', true);
  grip(out, 'Left');
}
const pistolIdle: Clip = {
  id: 'pistol_idle', name: 'Pistol idle (low ready)', category: 'Shooter', duration: 3, loop: true,
  sample: (t) => {
    const out: Record<string, Ch> = {};
    stance(out);
    pistolUpper(out, false);
    out.Spine = [Math.sin((t / 3) * Math.PI * 2), 0, 0];
    return { bones: out, root: { ground: true }, ik: PISTOL_READY };
  },
};
const pistolAim: Clip = {
  id: 'pistol_aim', name: 'Pistol aim', category: 'Shooter', duration: 2.5, loop: true,
  sample: (t) => {
    const out: Record<string, Ch> = {};
    stance(out);
    pistolUpper(out, true);
    out.Spine = [0.8 * Math.sin((t / 2.5) * Math.PI * 2), 0, 0];
    return { bones: out, root: { ground: true }, ik: PISTOL_AIM };
  },
};
const pistolFire: Clip = {
  id: 'pistol_fire', name: 'Pistol fire', category: 'Shooter', duration: 0.5, loop: false,
  sample: (t) => {
    const out: Record<string, Ch> = {};
    stance(out);
    pistolUpper(out, true);
    // Muzzle flip: hands rise and rotate up, then settle.
    const k = track([0, 0.04, 0.14, 0.5], [0, 1, 0.3, 0])(t);
    const flip = (h: HandTarget, up: number): HandTarget => ({
      ...h, pos: v(h.pos[0], h.pos[1] + 0.03 * k, h.pos[2] - 0.02 * k), dir: v(h.dir![0], h.dir![1] + up * k, h.dir![2]),
    });
    return { bones: out, root: { ground: true }, ik: { Right: flip(PISTOL_AIM.Right, 0.45), Left: flip(PISTOL_AIM.Left, 0.3) } };
  },
};

// --- Sword / knife ---------------------------------------------------------------------------
// The blade leaves the top of the fist (socket +Y). For the right hand that direction is
// dir x palm, so a hand target is built from the blade and edge directions we want.
const crossV = (a: [number, number, number], b: [number, number, number]) =>
  v(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
const normV = (a: [number, number, number]) => {
  const l = Math.hypot(...a) || 1;
  return v(a[0] / l, a[1] / l, a[2] / l);
};
/** Right-hand target holding a blade pointing `blade`, edge (knuckles) toward `edge`. */
function swordHand(pos: [number, number, number], blade: [number, number, number], edge: [number, number, number], pole: [number, number, number]): HandTarget {
  const B = normV(blade);
  const k = edge[0] * B[0] + edge[1] * B[1] + edge[2] * B[2];
  const F = normV(v(edge[0] - B[0] * k, edge[1] - B[1] * k, edge[2] - B[2] * k));
  return { pos, pole, dir: F, palm: crossV(B, F) };
}
function swordBody(out: Record<string, Ch>) {
  side(out, 'UpLeg', [14, 0, 2], [-10, 0, 2]);
  side(out, 'Leg', [-22, 0, 0], [-10, 0, 0]);
  side(out, 'Foot', [6, 0, 0], [0, 0, 0]);
  out.Spine = [6, 0, 0];
  side(out, 'Arm', [35, 0, 15], [0, 0, 0]);
  side(out, 'ForeArm', [75, 0, 0], [0, 0, 0]);
  fist(out, ['Left']);
  fist(out, ['Right']);
}
const swordIdle: Clip = {
  id: 'sword_idle', name: 'Sword idle (guard)', category: 'Actions', duration: 3, loop: true,
  sample: (t) => {
    const out: Record<string, Ch> = {};
    swordBody(out);
    const b = Math.sin((t / 3) * Math.PI * 2);
    out.Spine1 = [b, 0, 0];
    return {
      bones: out, root: { ground: true, lift: 0 }, thumbs: FISTS,
      ik: { Right: swordHand(v(-0.14, -0.31 + 0.01 * b, 0.32), v(0.05, 0.8, 0.6), v(0, -0.6, 0.8), v(-1, -0.8, -0.3)) },
    };
  },
};
const swordSlash: Clip = {
  id: 'sword_slash', name: 'Sword slash', category: 'Actions', duration: 1.0, loop: false,
  sample: (t) => {
    const T = [0, 0.3, 0.45, 0.6, 1.0];
    const k = (vals: number[]) => track(T, vals)(t);
    const out: Record<string, Ch> = {};
    swordBody(out);
    out.Hips = [0, k([0, -18, 5, 15, 0]), 0];
    out.Spine1 = [k([0, -4, 8, 10, 0]), k([0, -22, 8, 22, 0]), 0];
    out.Head = [0, k([0, 12, 0, -10, 0]), 0];
    const pos = v(k([-0.14, -0.32, -0.05, 0.16, -0.14]), k([-0.31, 0.12, -0.2, -0.5, -0.31]), k([0.32, 0.05, 0.45, 0.32, 0.32]));
    const blade = v(k([0.05, -0.3, 0.4, 0.6, 0.05]), k([0.8, 0.6, -0.1, -0.5, 0.8]), k([0.6, -0.7, 0.9, 0.6, 0.6]));
    const edge = v(k([0, 0.3, 0.6, 0.5, 0]), k([-0.6, 0.6, -0.5, -0.6, -0.6]), k([0.8, 0.5, 0.2, -0.2, 0.8]));
    return { bones: out, root: { ground: true }, thumbs: FISTS, ik: { Right: swordHand(pos, blade, edge, v(-1, -0.6, -0.3)) } };
  },
};
const swordBlock: Clip = {
  id: 'sword_block', name: 'Sword block', category: 'Actions', duration: 0.8, loop: false,
  sample: (t) => {
    const k = (vals: number[]) => track([0, 0.2, 0.8], vals)(t);
    const out: Record<string, Ch> = {};
    swordBody(out);
    out.Spine1 = [k([0, -6, -6]), 0, 0];
    out.Head = [k([0, -6, -6]), 0, 0];
    const pos = v(k([-0.14, -0.2, -0.2]), k([-0.31, 0.14, 0.14]), k([0.32, 0.28, 0.28]));
    const blade = v(k([0.05, 1, 1]), k([0.8, 0.15, 0.15]), k([0.6, 0.05, 0.05]));
    return { bones: out, root: { ground: true }, thumbs: FISTS, ik: { Right: swordHand(pos, blade, v(0, 1, 0.3), v(-1, -0.4, -0.3)) } };
  },
};

const SHOOTER: Clip[] = [
  pistolIdle,
  pistolAim,
  pistolFire,
  swordIdle,
  swordSlash,
  swordBlock,
  rifleLoop('rifle_idle', 'Rifle idle (low ready)', 3, still, READY, false),
  rifleLoop('rifle_aim', 'Rifle aim idle', 2.5, still, AIM, true),
  rifleFire(false),
  rifleFire(true),
  reload,
  rifleLoop('rifle_walk', 'Rifle walk (aiming)', 1.1, gaitOf(RIFLE_WALK, 1.1), AIM, true, [0, 0, 1.3]),
  rifleLoop('rifle_walk_back', 'Rifle walk back (aiming)', 1.25, gaitOf(RIFLE_WALK, 1.25, true), AIM, true, [0, 0, -1.0]),
  rifleLoop('rifle_strafe_left', 'Rifle strafe left (aiming)', 0.9, strafeLegs(true), AIM, true, [1.1, 0, 0]),
  rifleLoop('rifle_strafe_right', 'Rifle strafe right (aiming)', 0.9, strafeLegs(false), AIM, true, [-1.1, 0, 0]),
  rifleLoop('rifle_run', 'Rifle run', 0.72, gaitOf(RIFLE_RUN, 0.72), READY, false, [0, 0, 3.4]),
  rifleLoop('rifle_sprint', 'Rifle sprint', 0.62, gaitOf({ ...RIFLE_RUN, spineLean: 16, thigh: RUN.thigh.map((x) => x * 1.15) }, 0.62), SPRINT, false, [0, 0, 5.2]),
  rifleLoop('rifle_crouch_aim', 'Crouch aim idle', 2.5, still, AIM, true, undefined, true),
  rifleLoop('rifle_crouch_walk', 'Crouch walk (aiming)', 1.2, gaitOf(CROUCH_WALK, 1.2), AIM, true, [0, 0, 0.8], true),
  grenade,
  deathForward,
];

export const CLIPS: Clip[] = [
  idle,
  crouch,
  walk,
  run,
  walkBack,
  strafe(true),
  strafe(false),
  jump,
  fall,
  punch,
  hit,
  wave,
  cheer,
  turn('turn_left_45', 'Turn left 45°', 45),
  turn('turn_left_90', 'Turn left 90°', 90),
  turn('turn_right_45', 'Turn right 45°', -45),
  turn('turn_right_90', 'Turn right 90°', -90),
  turn('turn_360', 'Full turn 360°', 360),
  ...SHOOTER,
];

export const clipById = new Map(CLIPS.map((c) => [c.id, c]));

