import { AssetLibrary, fetchSource, type CatalogItem } from '../core/assets';
import { autoSkin, buildHuman, type Character } from '../core/human';
import { triangleCount } from '../core/mesh';
import { ageToYears, DEFAULT_PARAMS, DETAILS, PRESETS, randomParams, yearsToAge, type HumanParams } from '../core/params';
import { GARMENTS, garmentById, PATTERNS } from '../core/garments';
import { MOTIONS, POSES } from '../core/rig/poses';
import { RIG_LABELS, type RigType } from '../core/rig/skeletons';
import { exportCharacter, type ExportFormat } from '../export';
import { Viewer } from './viewer';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

const lib = await new AssetLibrary(fetchSource(`${import.meta.env.BASE_URL}assets/`)).init();
const cat = lib.catalog;
const viewer = new Viewer($<HTMLCanvasElement>('#viewport'), (f) => lib.textureUrl(f));

let params: HumanParams = loadSaved() ?? { ...DEFAULT_PARAMS, name: 'Athletic man' };
let current: Character | undefined;
const sync: (() => void)[] = [];

function loadSaved(): HumanParams | null {
  try {
    const s = localStorage.getItem('3dgen.human');
    return s ? { ...DEFAULT_PARAMS, ...JSON.parse(s) } : null;
  } catch {
    return null;
  }
}

// --- Generation --------------------------------------------------------------

let gen = 0;
let queued = false;
function regenerate() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(async () => {
    queued = false;
    const my = ++gen;
    const t0 = performance.now();
    const ch = await buildHuman(lib, params);
    if (my !== gen) return; // a newer request superseded this one
    current = ch;
    viewer.show(ch);
    $('#loading').hidden = true;
    rigStatus.textContent = ch.rig
      ? `✓ Auto-rigged: ${ch.rig.bones.length} bones · ${ch.rig.restPose}-pose · 4 influences per vertex`
      : 'Rig off: static mesh export.';
    const skin = params.skin === 'auto' ? ` · skin: ${autoSkin(params, cat.skins).name}` : '';
    $('#stats').textContent =
      `${(ch.height * 100).toFixed(0)} cm · ${ageToYears(params.age).toFixed(0)} yrs · ` +
      `${triangleCount(ch.mesh).toLocaleString()} tris · ${ch.mesh.materials.length} materials · ` +
      `${(performance.now() - t0).toFixed(0)} ms${skin}`;
    try {
      localStorage.setItem('3dgen.human', JSON.stringify(params));
    } catch {
      /* storage unavailable */
    }
  });
}

function set(patch: Partial<HumanParams>) {
  params = { ...params, ...patch };
  regenerate();
}

function replaceAll(p: HumanParams) {
  params = p;
  sync.forEach((f) => f());
  regenerate();
}

// --- Controls ----------------------------------------------------------------

function slider(label: string, get: () => number, put: (v: number) => void, min = 0, max = 1, step = 0.01, fmt = (v: number) => v.toFixed(2)) {
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
  const out = el('output');
  const show = () => { input.value = String(get()); out.textContent = fmt(get()); };
  input.addEventListener('input', () => { put(Number(input.value)); out.textContent = fmt(Number(input.value)); });
  input.addEventListener('dblclick', () => { put(min < 0 ? 0 : (min + max) / 2); show(); });
  sync.push(show);
  show();
  return el('div', { className: 'ctl' }, el('span', { textContent: label }), input, out);
}

function color(label: string, key: 'skinTint' | 'hairTint' | 'outfitTint') {
  const input = el('input', { type: 'color' });
  input.addEventListener('input', () => set({ [key]: input.value }));
  sync.push(() => (input.value = params[key]));
  input.value = params[key];
  return el('div', { className: 'ctl wide' }, el('span', { textContent: label }), input);
}

function picker(items: CatalogItem[], key: keyof HumanParams, extra: { id: string; name: string }[] = []) {
  const grid = el('div', { className: 'picker' });
  const buttons = new Map<string, HTMLButtonElement>();
  for (const it of [...extra, ...items]) {
    const thumb = 'thumb' in it && it.thumb ? el('img', { src: lib.source.url!(it.thumb as string), alt: '', loading: 'lazy' }) : it.name;
    const b = el('button', { title: it.name }, thumb, el('span', { className: 'cap', textContent: it.name }));
    b.addEventListener('click', () => set({ [key]: it.id }));
    buttons.set(it.id, b);
    grid.append(b);
  }
  const show = () => buttons.forEach((b, id) => b.classList.toggle('on', params[key] === id));
  sync.push(show);
  show();
  // Cheap reactivity: re-highlight after any change.
  grid.addEventListener('click', () => requestAnimationFrame(show));
  return grid;
}

function section(title: string, open: boolean, ...kids: Node[]) {
  const d = el('details', { open });
  d.append(el('summary', { textContent: title }), el('div', {}, ...kids));
  return d;
}

const NONE = [{ id: 'none', name: 'None' }];
const macro = (label: string, key: keyof HumanParams) =>
  slider(label, () => params[key] as number, (v) => set({ [key]: v }));

const controls = $('#controls');
controls.append(
  section('Body', true,
    slider('Gender', () => params.gender, (v) => set({ gender: v }), 0, 1, 0.01, (v) => (v < 0.35 ? 'female' : v > 0.65 ? 'male' : 'mixed')),
    slider('Age', () => ageToYears(params.age), (v) => set({ age: yearsToAge(v) }), 12, 90, 1, (v) => `${v.toFixed(0)} y`),
    macro('Muscle', 'muscle'), macro('Weight', 'weight'), macro('Height', 'height'), macro('Proportions', 'proportions'),
    macro('Breast size', 'breastSize'), macro('Breast firmness', 'breastFirmness'),
  ),
  section('Ethnicity', false,
    el('div', { className: 'hint', textContent: 'Blended mix; also picks the matching skin texture in Auto mode.' }),
    macro('African', 'african'), macro('Asian', 'asian'), macro('Caucasian', 'caucasian'),
  ),
  section('Skin & eyes', true,
    picker(cat.skins, 'skin', [{ id: 'auto', name: 'Auto' }]), color('Skin tint', 'skinTint'),
    el('div', { className: 'sub', textContent: 'Eyes' }), picker(cat.eyes, 'eyes'),
    el('div', { className: 'sub', textContent: 'Eyebrows' }), picker(cat.eyebrows, 'eyebrows', NONE),
    el('div', { className: 'sub', textContent: 'Eyelashes' }), picker(cat.eyelashes, 'eyelashes', NONE),
  ),
  section('Hair', true, picker(cat.hair, 'hair', NONE), color('Hair tint', 'hairTint')),
  section('Clothing', true,
    el('div', { className: 'hint', textContent: 'Pick a full outfit, or "Separate pieces" to combine tops, bottoms, wrappers and accessories.' }),
    picker(cat.outfits, 'outfit', [{ id: 'none', name: 'Separate pieces' }]), color('Outfit tint', 'outfitTint'),
    piecesPanel(),
    el('div', { className: 'sub', textContent: 'Footwear' }),
    picker(cat.shoes, 'shoes', [{ id: 'none', name: 'Barefoot' }, { id: 'sandals', name: 'Sandals' }, { id: 'combat_boots', name: 'Combat boots' }]),
    el('div', { className: 'sub', textContent: 'Hat' }), picker(cat.hats, 'hat', NONE),
  ),
  section('Accessories', true, accessoriesPanel()),
);

// --- Separate pieces & accessories -------------------------------------------------

function selectRow(label: string, options: [string, string][], get: () => string, put: (v: string) => void) {
  const sel = el('select');
  for (const [v, l] of options) sel.append(new Option(l, v));
  sel.addEventListener('change', () => put(sel.value));
  sync.push(() => (sel.value = get()));
  sel.value = get();
  return el('div', { className: 'ctl wide' }, el('span', { textContent: label }), sel);
}

/** Pattern + colour controls for whichever garment currently fills a slot. */
function styleControls(current: () => string) {
  const box = el('div', { className: 'style-box' });
  let shown = '';
  const render = () => {
    const id = current();
    if (id === shown) {
      box.querySelectorAll<HTMLElement>('[data-sync]').forEach((e) => e.dispatchEvent(new Event('sync')));
      return;
    }
    shown = id;
    box.replaceChildren();
    const def = garmentById.get(id);
    if (!def) return;
    const st = () => params.garmentStyles[id] ?? {};
    const put = (patch: Record<string, string>) =>
      set({ garmentStyles: { ...params.garmentStyles, [id]: { ...st(), ...patch } } });
    if (def.patterns.length > 1) {
      const sel = el('select');
      sel.dataset.sync = '1';
      for (const p of def.patterns.filter((x) => PATTERNS.includes(x))) sel.append(new Option(p, p));
      sel.value = st().pattern ?? def.patterns[0];
      sel.addEventListener('change', () => put({ pattern: sel.value }));
      sel.addEventListener('sync', () => (sel.value = st().pattern ?? def.patterns[0]));
      box.append(el('div', { className: 'ctl wide' }, el('span', { textContent: 'Pattern' }), sel));
    }
    for (const [key, label, fallback] of [['color', 'Colour', def.color], ['color2', 'Accent', def.color2]] as const) {
      const input = el('input', { type: 'color', value: st()[key] ?? fallback });
      input.dataset.sync = '1';
      input.addEventListener('input', () => put({ [key]: input.value }));
      input.addEventListener('sync', () => (input.value = st()[key] ?? fallback));
      box.append(el('div', { className: 'ctl wide' }, el('span', { textContent: label }), input));
    }
  };
  sync.push(render);
  render();
  return box;
}

function piecesPanel() {
  const opts = (slot: 'top' | 'bottom', none: string): [string, string][] =>
    [['none', none], ...GARMENTS.filter((g) => g.slot === slot && g.id !== 'briefs').map((g) => [g.id, g.label] as [string, string])];
  const panel = el('div', { className: 'pieces' },
    el('div', { className: 'sub', textContent: 'Top' }),
    selectRow('Top', opts('top', 'None (shirtless / topless)'), () => params.top, (v) => set({ top: v })),
    styleControls(() => params.top),
    el('div', { className: 'hint', textContent: 'Topless is available for adult characters; under-18 female characters automatically get a top.' }),
    el('div', { className: 'sub', textContent: 'Bottom' }),
    selectRow('Bottom', opts('bottom', 'Briefs only'), () => params.bottom, (v) => set({ bottom: v })),
    styleControls(() => params.bottom),
  );
  const show = () => (panel.style.display = params.outfit === 'none' ? '' : 'none');
  sync.push(show);
  show();
  return panel;
}

function accessoriesPanel() {
  const wrap = el('div', {});
  for (const g of GARMENTS.filter((x) => x.slot === 'acc')) {
    const box = el('input', { type: 'checkbox' });
    box.addEventListener('change', () => {
      const has = params.accessories.includes(g.id);
      set({ accessories: has ? params.accessories.filter((a) => a !== g.id) : [...params.accessories, g.id] });
    });
    sync.push(() => (box.checked = params.accessories.includes(g.id)));
    box.checked = params.accessories.includes(g.id);
    const row = el('label', { className: 'acc' }, box, g.label);
    wrap.append(row);
    if (g.patterns.length > 1 || ['waist_sash', 'shoulder_drape'].includes(g.id)) {
      const st = styleControls(() => (params.accessories.includes(g.id) ? g.id : ''));
      wrap.append(st);
    }
  }
  return wrap;
}

// Detail sliders, grouped like MakeHuman: one section per category.
const categories = new Map<string, Node[]>();
for (const g of cat.sliders) {
  const list = categories.get(g.category) ?? [];
  list.push(el('div', { className: 'sub', textContent: g.group }));
  for (const s of g.sliders)
    list.push(
      slider(s.label, () => params.modifiers[s.id] ?? 0, (v) => set({ modifiers: { ...params.modifiers, [s.id]: v } }), s.bipolar ? -1 : 0, 1),
    );
  categories.set(g.category, list);
}
for (const [name, kids] of categories) controls.append(section(`${name} details`, false, ...kids));

const reset = el('button', { textContent: 'Reset detail sliders' });
reset.addEventListener('click', () => replaceAll({ ...params, modifiers: {} }));
const detail = el('select');
for (const d of DETAILS) detail.append(new Option({ low: 'Low (game LOD, ~5k tris)', medium: 'Medium (~30k tris)', high: 'High / HD (~120k tris, subdivided)' }[d], d));
detail.addEventListener('change', () => set({ detail: detail.value as HumanParams['detail'] }));
sync.push(() => (detail.value = params.detail));
detail.value = params.detail;
// --- Rig ------------------------------------------------------------------------

const rigStatus = el('div', { className: 'rig-status' });
const poseButtons = el('div', { className: 'pose-buttons' });
let activePose = 'Rest';
const markPose = () => poseButtons.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.name === activePose));
for (const name of Object.keys(POSES)) {
  const b = el('button', { textContent: name });
  b.dataset.name = name;
  b.addEventListener('click', () => {
    activePose = name;
    viewer.setPose(POSES[name]);
    markPose();
  });
  poseButtons.append(b);
}
for (const name of Object.keys(MOTIONS)) {
  const b = el('button', { textContent: `▶ ${name}` });
  b.dataset.name = `motion:${name}`;
  b.addEventListener('click', () => {
    activePose = `motion:${name}`;
    viewer.playMotion(MOTIONS[name]);
    markPose();
  });
  poseButtons.append(b);
}
markPose();
controls.append(section('Rig', true,
  el('div', { className: 'hint', textContent: 'Rigged automatically from the body: no markers needed. Exported GLB and FBX include the skeleton and skin weights (OBJ stays static).' }),
  selectRow('Skeleton', (Object.keys(RIG_LABELS) as RigType[]).map((k) => [k, RIG_LABELS[k]]), () => params.rig, (v) => set({ rig: v as RigType })),
  selectRow('Rest pose', [['A', 'A-pose (natural)'], ['T', 'T-pose (Mixamo / Unity Humanoid)']], () => params.restPose, (v) => set({ restPose: v as 'A' | 'T' })),
  el('label', { className: 'acc' }, (() => {
    const box = el('input', { type: 'checkbox' });
    box.addEventListener('change', () => set({ faceBones: box.checked }));
    sync.push(() => (box.checked = params.faceBones));
    return box;
  })(), 'Facial bones (jaw + eyes)'),
  el('div', { className: 'sub', textContent: 'Test the rig' }),
  poseButtons,
  rigStatus,
));

controls.append(section('Output', true, el('div', { className: 'ctl wide' }, el('span', { textContent: 'Detail' }), detail), reset));

// --- Header ------------------------------------------------------------------

const presetSel = $<HTMLSelectElement>('#preset');
presetSel.append(new Option('Presets…', ''));
for (const name of Object.keys(PRESETS)) presetSel.append(new Option(name, name));
presetSel.addEventListener('change', () => {
  const name = presetSel.value;
  if (!name) return;
  presetSel.value = '';
  replaceAll({ ...DEFAULT_PARAMS, ...PRESETS[name], name, detail: params.detail });
});

const nameInput = $<HTMLInputElement>('#name');
const seedInput = $<HTMLInputElement>('#seed');
sync.push(() => { nameInput.value = params.name; seedInput.value = String(params.seed); });
nameInput.addEventListener('input', () => (params = { ...params, name: nameInput.value }));
const randomize = (seed: number) => replaceAll({ ...randomParams(seed, cat), detail: params.detail, name: `character_${seed}` });
$('#randomize').addEventListener('click', () => randomize(Math.floor(Math.random() * 1e6)));
seedInput.addEventListener('change', () => randomize(Number(seedInput.value) || 0));

$<HTMLInputElement>('#wireframe').addEventListener('change', (e) => viewer.setWireframe((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('#skeleton').addEventListener('change', (e) => viewer.setSkeleton((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('#face').addEventListener('change', (e) => viewer.focusFace((e.target as HTMLInputElement).checked));

// --- Export ------------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>('#export button').forEach((btn) =>
  btn.addEventListener('click', async () => {
    if (!current) return;
    const all = document.querySelectorAll<HTMLButtonElement>('#export button');
    all.forEach((b) => (b.disabled = true));
    const label = btn.textContent;
    btn.textContent = 'Exporting…';
    try {
      const format = btn.dataset.format as ExportFormat;
      const previewPng = format === 'zip' ? await viewer.snapshot() : undefined;
      const file = await exportCharacter(lib, current, format, { previewPng });
      const url = URL.createObjectURL(new Blob([file.data as BlobPart], { type: file.mime }));
      const a = el('a', { href: url, download: file.name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert(`Export failed: ${(e as Error).message}`);
    } finally {
      btn.textContent = label;
      all.forEach((b) => (b.disabled = false));
    }
  }),
);

// URL options: #preset=<name>&face
const hash = new URLSearchParams(location.hash.slice(1));
const presetName = hash.get('preset');
if (presetName && PRESETS[presetName]) params = { ...DEFAULT_PARAMS, ...PRESETS[presetName], name: presetName, detail: params.detail };
sync.forEach((f) => f());
regenerate();
const poseName = hash.get('pose'), motionName = hash.get('motion');
if (poseName && POSES[poseName]) viewer.setPose(POSES[poseName]);
if (motionName && MOTIONS[motionName]) viewer.playMotion(MOTIONS[motionName]);
if (hash.has('skeleton')) {
  $<HTMLInputElement>('#skeleton').checked = true;
  viewer.setSkeleton(true);
}
if (hash.has('face')) {
  $<HTMLInputElement>('#face').checked = true;
  viewer.focusFace(true);
}
