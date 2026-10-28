/**
 * Headless "prompt -> character" export used by the GitHub Action.
 *
 *   PROMPT="a muscular soldier with a beard" DETAIL=medium OUT_DIR=out npx tsx scripts/prompt-export.ts
 *
 * Uses the real Ara 3D Gen pipeline (buildHuman + exportCharacter), so the GLB has the
 * 65-bone game rig, every animation clip, and the 34 facial blend shapes (including the 14
 * viseme_* lip-sync shapes). Writes character.glb, meta.json and params.json to OUT_DIR.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHuman } from '../src/core/human';
import { triangleCount } from '../src/core/mesh';
import { DEFAULT_PARAMS, PRESETS, randomParams, sanitizeParams, yearsToAge } from '../src/core/params';
import { exportCharacter } from '../src/export';
import { nodeLibrary } from './node-assets';
import { promptToParams } from './prompt-to-params';

const prompt = (process.env.PROMPT ?? process.argv[2] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'a friendly woman';
const detail = ['low', 'medium', 'high'].includes(process.env.DETAIL ?? '') ? (process.env.DETAIL as 'low' | 'medium' | 'high') : 'medium';
const out = process.env.OUT_DIR ?? 'out';

const lib = await nodeLibrary();
const { params: mapped, summary } = promptToParams(prompt, {
  defaults: DEFAULT_PARAMS,
  presets: PRESETS,
  catalog: lib.catalog,
  random: (seed) => randomParams(seed, lib.catalog),
  yearsToAge,
});
const params = sanitizeParams({
  ...mapped,
  name: 'character',
  detail,
  rig: 'game',
  restPose: 'A',
  animations: true,
  faceBones: true,
  faceShapes: true,
  speechShapes: true,
  teeth: DEFAULT_PARAMS.teeth,
  tongue: true,
});

const t0 = performance.now();
const ch = await buildHuman(lib, params);
const file = await exportCharacter(lib, ch, 'glb');
const ms = Math.round(performance.now() - t0);

/** Read the JSON chunk of a GLB to list what the file contains. */
function glbJson(data: Uint8Array): any {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + len)));
}
const gltf = glbJson(file.data);
const animations: string[] = (gltf.animations ?? []).map((a: { name: string }) => a.name);
const morphTargets: string[] = (gltf.meshes ?? []).flatMap((m: any) => m.extras?.targetNames ?? []);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'character.glb'), file.data);
writeFileSync(join(out, 'params.json'), JSON.stringify(params, null, 2));
writeFileSync(
  join(out, 'meta.json'),
  JSON.stringify(
    {
      prompt,
      title: prompt.charAt(0).toUpperCase() + prompt.slice(1),
      generator: 'Ara 3D Gen',
      summary,
      detail,
      heightCm: Math.round(ch.height * 100),
      triangles: triangleCount(ch.mesh),
      bytes: file.data.length,
      animations,
      morphTargets,
      hasLipSync: morphTargets.some((n) => n.startsWith('viseme_')),
      buildMs: ms,
    },
    null,
    2,
  ),
);
console.log(`ok: "${prompt}" -> ${(ch.height * 100).toFixed(0)} cm, ${triangleCount(ch.mesh)} tris, ${animations.length} clips, ${morphTargets.length} face shapes, ${(file.data.length / 1048576).toFixed(1)} MB in ${ms} ms`);
console.log(summary.map((s) => `  - ${s}`).join('\n'));
if (!morphTargets.some((n) => n.startsWith('viseme_'))) throw new Error('Export has no viseme_* shapes: lip-sync would not work.');
