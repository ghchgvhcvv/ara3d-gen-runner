/**
 * Headless export.
 *   npm run export -- --preset Hero --out out
 *   npm run export -- --random 42 --formats glb,fbx
 *   npm run export -- --params my.params.json --detail high
 *   npm run export -- --all-presets --out out
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateCharacter } from '../src/core/character';
import { triangleCount } from '../src/core/mesh';
import { DEFAULT_PARAMS, PRESETS, randomParams, type CharacterParams } from '../src/core/params';
import { exportCharacter, type ExportFormat } from '../src/export';

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = opt('out') ?? 'out';
const formats = (opt('formats') ?? 'glb,fbx,obj,zip').split(',') as ExportFormat[];

const jobs: CharacterParams[] = [];
const overrides: Partial<CharacterParams> = {};
if (opt('detail')) overrides.detail = opt('detail') as CharacterParams['detail'];
if (opt('pose')) overrides.pose = opt('pose') as CharacterParams['pose'];

if (args.includes('--all-presets')) {
  for (const [name, p] of Object.entries(PRESETS)) jobs.push({ ...DEFAULT_PARAMS, ...p, name, ...overrides });
} else if (opt('params')) {
  jobs.push({ ...DEFAULT_PARAMS, ...JSON.parse(readFileSync(opt('params')!, 'utf8')), ...overrides });
} else if (opt('random')) {
  const seed = Number(opt('random'));
  jobs.push({ ...randomParams(seed), name: `random_${seed}`, ...overrides });
} else {
  const name = opt('preset') ?? 'Hero';
  if (!PRESETS[name]) throw new Error(`Unknown preset "${name}". Options: ${Object.keys(PRESETS).join(', ')}`);
  jobs.push({ ...DEFAULT_PARAMS, ...PRESETS[name], name, ...overrides });
}

mkdirSync(out, { recursive: true });
for (const params of jobs) {
  const t0 = performance.now();
  const ch = generateCharacter(params);
  const ms = (performance.now() - t0).toFixed(0);
  const written: string[] = [];
  for (const f of formats)
    for (const file of exportCharacter(ch, f)) {
      writeFileSync(join(out, file.name), file.data);
      written.push(`${file.name} (${(file.data.length / 1024).toFixed(0)} KB)`);
    }
  console.log(`${params.name}: ${triangleCount(ch.mesh)} tris, ${ch.mesh.materials.length} materials, generated in ${ms} ms`);
  console.log(`  -> ${written.join(', ')}`);
}
