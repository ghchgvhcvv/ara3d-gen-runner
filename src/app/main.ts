import { generateCharacter, type Character } from '../core/character';
import { triangleCount } from '../core/mesh';
import { DEFAULT_PARAMS, PRESETS, randomParams, type CharacterParams } from '../core/params';
import { exportCharacter, type ExportFile, type ExportFormat } from '../export';
import { SECTIONS, type Control } from './schema';
import { Viewer } from './viewer';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

let params: CharacterParams = loadSaved() ?? { ...DEFAULT_PARAMS, name: 'Hero' };
let current: Character;
const viewer = new Viewer($<HTMLCanvasElement>('#viewport'));
const inputs = new Map<keyof CharacterParams, { set: (v: unknown) => void }>();

function loadSaved(): CharacterParams | null {
  try {
    const s = localStorage.getItem('3dgen.params');
    return s ? { ...DEFAULT_PARAMS, ...JSON.parse(s) } : null;
  } catch {
    return null;
  }
}

let pending = false;
function regenerate() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const t0 = performance.now();
    current = generateCharacter(params);
    const ms = performance.now() - t0;
    viewer.show(current);
    $('#stats').textContent =
      `${triangleCount(current.mesh).toLocaleString()} tris · ${(current.mesh.positions.length / 3).toLocaleString()} verts · ` +
      `${current.mesh.materials.length} materials · ${current.proportions.H.toFixed(2)} m · ${ms.toFixed(0)} ms`;
    try {
      localStorage.setItem('3dgen.params', JSON.stringify(params));
    } catch {
      /* storage unavailable */
    }
  });
}

function set<K extends keyof CharacterParams>(key: K, value: CharacterParams[K]) {
  params = { ...params, [key]: value };
  regenerate();
}

function buildControl(c: Control): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ctl' + (c.type === 'range' ? '' : ' wide');
  const label = document.createElement('span');
  label.textContent = c.label;
  row.append(label);
  const key = c.key;
  switch (c.type) {
    case 'range': {
      const input = Object.assign(document.createElement('input'), { type: 'range', min: c.min, max: c.max, step: c.step });
      const out = document.createElement('output');
      const show = (v: number) => (out.textContent = v.toFixed(2));
      input.addEventListener('input', () => {
        set(key, Number(input.value) as never);
        show(Number(input.value));
      });
      inputs.set(key, { set: (v) => { input.value = String(v); show(v as number); } });
      row.append(input, out);
      break;
    }
    case 'select': {
      const sel = document.createElement('select');
      for (const o of c.options) sel.append(new Option(o, o));
      sel.addEventListener('change', () => set(key, sel.value as never));
      inputs.set(key, { set: (v) => (sel.value = String(v)) });
      row.append(sel);
      break;
    }
    case 'color': {
      const input = Object.assign(document.createElement('input'), { type: 'color' });
      input.addEventListener('input', () => set(key, input.value as never));
      inputs.set(key, { set: (v) => (input.value = String(v)) });
      row.append(input);
      break;
    }
    case 'toggle': {
      const input = Object.assign(document.createElement('input'), { type: 'checkbox' });
      input.addEventListener('change', () => set(key, input.checked as never));
      inputs.set(key, { set: (v) => (input.checked = Boolean(v)) });
      row.append(input);
      break;
    }
  }
  return row;
}

function syncInputs() {
  for (const [k, i] of inputs) i.set(params[k]);
  $<HTMLInputElement>('#name').value = params.name;
  $<HTMLInputElement>('#seed').value = String(params.seed);
}

// --- Panel -------------------------------------------------------------------

const controls = $('#controls');
for (const sec of SECTIONS) {
  const d = document.createElement('details');
  d.open = !!sec.open;
  d.innerHTML = `<summary>${sec.title}</summary>`;
  const body = document.createElement('div');
  sec.controls.forEach((c) => body.append(buildControl(c)));
  d.append(body);
  controls.append(d);
}

const presetSel = $<HTMLSelectElement>('#preset');
presetSel.append(new Option('Presets…', ''));
for (const name of Object.keys(PRESETS)) presetSel.append(new Option(name, name));
presetSel.addEventListener('change', () => {
  const name = presetSel.value;
  if (!name) return;
  params = { ...DEFAULT_PARAMS, ...PRESETS[name], name };
  presetSel.value = '';
  syncInputs();
  regenerate();
});

/** Keep output settings when randomizing so a low-poly workflow stays low-poly. */
const keepOutput = () => ({ detail: params.detail, pose: params.pose, flatShading: params.flatShading, fingers: params.fingers });

$('#randomize').addEventListener('click', () => {
  const seed = Math.floor(Math.random() * 1e6);
  params = { ...randomParams(seed), ...keepOutput(), name: `character_${seed}` };
  syncInputs();
  regenerate();
});
$<HTMLInputElement>('#seed').addEventListener('change', (e) => {
  const seed = Number((e.target as HTMLInputElement).value) || 0;
  params = { ...randomParams(seed), ...keepOutput(), name: params.name };
  syncInputs();
  regenerate();
});
$<HTMLInputElement>('#name').addEventListener('input', (e) => {
  params = { ...params, name: (e.target as HTMLInputElement).value };
});
$<HTMLInputElement>('#wireframe').addEventListener('change', (e) => viewer.setWireframe((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('#skeleton').addEventListener('change', (e) => viewer.setSkeleton((e.target as HTMLInputElement).checked));

// --- Export ------------------------------------------------------------------

function download(file: ExportFile) {
  const url = URL.createObjectURL(new Blob([file.data as BlobPart], { type: file.mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

document.querySelectorAll<HTMLButtonElement>('#export button').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const format = btn.dataset.format as ExportFormat;
    const previewPng = format === 'zip' ? await viewer.snapshot() : undefined;
    const files = exportCharacter(current, format, { previewPng });
    // OBJ yields .obj + .mtl; stagger downloads so browsers don't drop the second one.
    files.forEach((f, i) => setTimeout(() => download(f), i * 300));
  }),
);

syncInputs();
regenerate();
