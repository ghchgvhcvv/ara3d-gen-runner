/** The crouch stance (idle, walk and run are motion capture: see mocap-data.ts). */
import { type Ch, type Clip } from './types';
import { fingers, side } from './helpers';

export const crouch: Clip = {
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
