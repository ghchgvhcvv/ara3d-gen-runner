/**
 * Test set of CMU motion-capture clips (mocap.cmu.edu; free to use, cgspeed BVH conversion).
 * Files are fetched from `assets/mocap/` at runtime and added to the clip list.
 */
import { CLIPS, clipById } from './clips';
import { mocapClip, parseBvh, type MocapOptions } from './mocap';

const SET: (Omit<MocapOptions, 'category'> & { file: string })[] = [
  { file: '02_01.bvh', id: 'mocap_walk', name: 'Walk (CMU)', loop: true, start: 0.3, loopSearch: [0.8, 1.3] },
  { file: '09_01.bvh', id: 'mocap_run', name: 'Run (CMU)', loop: true, start: 0.2, loopSearch: [0.5, 0.8] },
  { file: '02_05.bvh', id: 'mocap_punch', name: 'Punches (CMU)', loop: false },
  { file: '05_02.bvh', id: 'mocap_dance', name: 'Dance (CMU)', loop: false },
  { file: '13_11.bvh', id: 'mocap_jump', name: 'Forward jump (CMU)', loop: false },
  { file: '13_01.bvh', id: 'mocap_sit', name: 'Sit and stand (CMU)', loop: false },
];

let loaded: Promise<void> | undefined;

/** Fetch, parse and register the test clips (once). Missing files are skipped. */
export function loadMocapClips(assetsUrl: string): Promise<void> {
  return (loaded ??= Promise.all(
    SET.map(async ({ file, ...o }) => {
      try {
        const r = await fetch(new URL(`mocap/${file}`, assetsUrl));
        if (!r.ok) return undefined;
        return mocapClip(parseBvh(await r.text()), { ...o, category: 'Mocap (test)' });
      } catch {
        return undefined;
      }
    }),
  ).then((clips) => {
    for (const c of clips) if (c && !clipById.has(c.id)) (CLIPS.push(c), clipById.set(c.id, c));
  }));
}
