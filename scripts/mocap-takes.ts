/**
 * Which CMU takes become which clips, and how they're cut. Takes are CMU trial ids
 * (subject_trial); see vendor/mocap/cmu/index.txt for descriptions.
 */
export interface MocapTake {
  /** Clip id: replaces the keyframed clip with that id, or adds a clip (see clips/index.ts). */
  id: string;
  take: string;
  loop: boolean;
  /** Seconds: start / end of the cut, and for loops the range (after start) to search for the cycle's end. */
  cut: { start?: number; end?: number; loopSearch?: [number, number]; neutral?: [number, number] };
  hands?: 'fist';
  /** Mirror left to right (e.g. a strafe left from a recorded strafe right). */
  mirror?: boolean;
}

export const MOCAP_TAKES: MocapTake[] = [
  { id: 'idle', take: '82_08', loop: true, cut: { start: 1.0, loopSearch: [3, 6.5] } },
  { id: 'walk', take: '02_01', loop: true, cut: { start: 0.3, loopSearch: [0.8, 1.3] } },
  { id: 'run', take: '09_01', loop: true, cut: { start: 0.2, loopSearch: [0.5, 0.8] } },
  { id: 'walk_back', take: '40_02', loop: true, cut: { start: 39.2, loopSearch: [0.9, 1.5] } },
  // CMU has sidesteps to the right only; the left one is the mirror image.
  { id: 'strafe_right', take: '41_02', loop: true, cut: { start: 4.0, loopSearch: [0.7, 1.4] } },
  { id: 'strafe_left', take: '41_02', loop: true, cut: { start: 4.0, loopSearch: [0.7, 1.4] }, mirror: true },
  { id: 'jump', take: '02_04', loop: false, cut: { start: 0.25, end: 2.35 } },
  { id: 'wave', take: '111_37', loop: true, cut: { start: 0.4, loopSearch: [1.2, 2.0] } },
  { id: 'cry', take: '79_72', loop: true, cut: { start: 2.0, loopSearch: [2.5, 4.0], neutral: [0, 0.5] } },
  { id: 'punch_low', take: '02_05', loop: false, cut: { start: 10.85, end: 12.4 }, hands: 'fist' },
];

/** Where setup-assets downloads each take: cgspeed's BVH conversion, mirrored on GitHub (zip per take). */
export const MOCAP_SOURCE = 'https://raw.githubusercontent.com/Shriinivas/cmubvh/main';
export const MOCAP_FILES: Record<string, string> = {
  '02_01': 'Sequence-001-009/02/Data/02_01.zip',
  '02_04': 'Sequence-001-009/02/Data/02_04.zip',
  '02_05': 'Sequence-001-009/02/Data/02_05.zip',
  '09_01': 'Sequence-001-009/09/Data/09_01.zip',
  '40_02': 'Sequence-040-045/40/Data/40_02.zip',
  '41_02': 'Sequence-040-045/41/Data/41_02.zip',
  '79_72': 'Sequence-076-080/79/Data/79_72.zip',
  '82_08': 'Sequence-081-085/82/Data/82_08.zip',
  '111_37': 'Sequence-102-111/111/Data/111_37.zip',
};
