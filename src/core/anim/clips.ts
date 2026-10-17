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

export interface Sample {
  bones: Record<string, Ch>;
  root: Root;
}

export type ClipCategory = 'Idle & stance' | 'Locomotion' | 'Turns' | 'Actions' | 'Emotes';

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
  armOut: 4,
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
  armOut: 8,
};

function gait(g: Gait, p: number, reverse = false): Sample {
  const ph = reverse ? 1 - p : p;
  const c = (keys: number[]) => cyc(keys);
  const thigh = c(g.thigh), knee = c(g.knee), foot = c(g.foot), arm = c(g.arm), elbow = c(g.elbow), bob = c(g.bob);
  const out: Record<string, Ch> = {};
  const L = ph, R = ph + 0.5;
  side(out, 'UpLeg', [thigh(L), 0, 0], [thigh(R), 0, 0]);
  side(out, 'Leg', [knee(L), 0, 0], [knee(R), 0, 0]);
  side(out, 'Foot', [foot(L), 0, 0], [foot(R), 0, 0]);
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
    fingers(out, 85);
    side(out, 'HandThumb2', [40, 0, 0], [40, 0, 0]);
    return { bones: out, root: { ground: true } };
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
  id: 'wave', name: 'Wave', category: 'Emotes', duration: 2, loop: true,
  sample: (t) => {
    const a = (t / 2) * Math.PI * 2;
    const out: Record<string, Ch> = { Head: [2, -10, 6], Spine1: [0, -4, -3] };
    side(out, 'Arm', [2, 0, 3], [15, 0, 135]);
    side(out, 'ForeArm', [12, 0, 0], [35, 0, 25 * Math.sin(a * 2)]);
    side(out, 'Hand', [0, 0, 0], [0, 0, 10 * Math.sin(a * 2 + 0.6)]);
    fingers(out, 8);
    return { bones: out, root: { ground: true } };
  },
};

const cheer: Clip = {
  id: 'cheer', name: 'Cheer', category: 'Emotes', duration: 1.4, loop: true,
  sample: (t) => {
    const a = (t / 1.4) * Math.PI * 2;
    const pump = Math.sin(a * 2);
    const out: Record<string, Ch> = { Spine: [-6, 0, 0], Head: [-14, 0, 0] };
    side(out, 'Arm', [10, 0, 150 + 8 * pump], [10, 0, 150 + 8 * pump]);
    side(out, 'ForeArm', [25 + 15 * pump, 0, 0], [25 + 15 * pump, 0, 0]);
    side(out, 'Leg', [-8 - 6 * Math.abs(pump), 0, 0], [-8 - 6 * Math.abs(pump), 0, 0]);
    side(out, 'UpLeg', [5 + 4 * Math.abs(pump), 0, 0], [5 + 4 * Math.abs(pump), 0, 0]);
    fingers(out, 85);
    return { bones: out, root: { ground: true, lift: 0.03 * Math.max(0, pump) } };
  },
};

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
];

export const clipById = new Map(CLIPS.map((c) => [c.id, c]));

