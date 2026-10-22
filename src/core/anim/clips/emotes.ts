/** Emotes: wave, cheer. */
import { type Ch, type Clip } from './types';
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
