/** Emotes: wave, cheer, laugh, cry. */
import { type Ch, type Clip, type HandTarget } from './types';
import { fingers, fist, FISTS, side, v } from './helpers';

export const wave: Clip = {
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

export const cheer: Clip = {
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

/** Laughing: the body bounces with each "ha", the head tips back, a hand on the belly. */
export const laugh: Clip = {
  id: 'laugh', name: 'Laugh', category: 'Emotes', duration: 2.4, loop: true,
  sample: (t) => {
    const a = (t / 2.4) * Math.PI * 2;
    const ha = Math.abs(Math.sin(a * 6)); // six laughs per loop
    const out: Record<string, Ch> = {
      Spine: [-4 + 4 * ha, 0, 0], Spine1: [-3 + 3 * ha, 0, 0], Spine2: [-2, 0, 0],
      Neck: [-6, 0, 0], Head: [-12 + 5 * ha, 4 * Math.sin(a), 3 * Math.sin(a)],
    };
    side(out, 'Shoulder', [0, 0, 4 + 5 * ha], [0, 0, 4 + 5 * ha]);
    side(out, 'Arm', [8, 0, 6], [0, 0, 0]);
    side(out, 'ForeArm', [18, 0, 0], [0, 0, 0]);
    side(out, 'UpLeg', [4 * ha, 0, -2], [4 * ha, 0, -2]);
    side(out, 'Leg', [-6 * ha - 3, 0, 0], [-6 * ha - 3, 0, 0]);
    fingers(out, 16);
    return {
      bones: out,
      root: { ground: true },
      // Right hand resting on the belly.
      ik: { Right: { pos: v(-0.06, -0.5 + 0.01 * ha, 0.2), pole: v(-1, -0.6, -0.4), dir: v(1, -0.2, 0.2), palm: v(0, 0, -1) } },
    };
  },
};

/** Crying: head bowed, shoulders heaving with sobs, hands covering the face. */
export const cry: Clip = {
  id: 'cry', name: 'Cry', category: 'Emotes', duration: 3, loop: true,
  sample: (t) => {
    const a = (t / 3) * Math.PI * 2;
    // Uneven sobs: two quick heaves, then a slower breath.
    const sob = Math.max(0, Math.sin(a * 2)) ** 2 * 0.7 + Math.max(0, Math.sin(a * 4 + 1)) ** 3 * 0.3;
    const out: Record<string, Ch> = {
      Spine: [10 + 3 * sob, 0, 0], Spine1: [8 - 3 * sob, 0, 0], Spine2: [4 - 2 * sob, 0, 0],
      Neck: [16, 0, 0], Head: [14 + 4 * sob, 3 * Math.sin(a), 0],
    };
    side(out, 'Shoulder', [0, 0, 6 + 7 * sob], [0, 0, 6 + 7 * sob]);
    side(out, 'UpLeg', [0, 0, -2], [0, 0, -2]);
    side(out, 'Leg', [-4, 0, 0], [-4, 0, 0]);
    fingers(out, 10);
    const hand = (s: 1 | -1): HandTarget => ({
      pos: v(0.06 * s, 0.03 + 0.015 * sob, 0.2), pole: v(s, -1, -0.2), dir: v(-0.25 * s, 1, 0.15), palm: v(-0.2 * s, -0.1, -1),
    });
    return { bones: out, root: { ground: true }, ik: { Left: hand(1), Right: hand(-1) } };
  },
};
