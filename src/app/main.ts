import { AssetLibrary, fetchSource, type CatalogItem } from '../core/assets';
import { autoSkin, buildHuman, type Character } from '../core/human';
import { triangleCount } from '../core/mesh';
import { ageToYears, DEFAULT_PARAMS, DETAILS, PRESETS, randomParams, yearsToAge, type HumanParams } from '../core/params';
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
    picker(cat.outfits, 'outfit'), color('Outfit tint', 'outfitTint'),
    el('div', { className: 'sub', textContent: 'Shoes' }), picker(cat.shoes, 'shoes', NONE),
    el('div', { className: 'sub', textContent: 'Hat' }), picker(cat.hats, 'hat', NONE),
  ),
);

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

sync.forEach((f) => f());
regenerate();
if (location.hash === '#face') {
  $<HTMLInputElement>('#face').checked = true;
  viewer.focusFace(true);
}
