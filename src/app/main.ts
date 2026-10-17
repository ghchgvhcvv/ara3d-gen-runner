import { AssetLibrary, fetchSource, type CatalogItem } from '../core/assets';
import { autoSkin, buildHuman, type Character } from '../core/human';
import { triangleCount } from '../core/mesh';
import { ageToYears, DEFAULT_PARAMS, DETAILS, PRESETS, randomParams, yearsToAge, type HumanParams } from '../core/params';
import { GARMENTS, garmentById, PATTERNS } from '../core/garments';
import { CLIPS, clipById } from '../core/anim/clips';
import { RIG_LABELS, type RigType } from '../core/rig/skeletons';
import { DEFAULT_EXPORT, MODE_LABELS, planExport, runExport, type ExportSettings } from '../export';
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
const exportSettings: ExportSettings = loadExportSettings();
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
    animBar.style.display = ch.rig ? '' : 'none';
    renderExport();
    if (ch.rig && !viewer.playing && activeClip !== 'bind') playClip(activeClip);
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
  if ('age' in patch) sync.forEach((f) => f());
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
    selectRow('Bottom', opts('bottom', 'None'), () => params.bottom, (v) => set({ bottom: v })),
    styleControls(() => params.bottom),
    underwearToggle(),
  );
  const show = () => (panel.style.display = params.outfit === 'none' ? '' : 'none');
  sync.push(show);
  show();
  return panel;
}

/** Underwear on/off. Off (bottomless) is only possible for adult characters. */
function underwearToggle() {
  const box = el('input', { type: 'checkbox' });
  const note = el('div', { className: 'hint' });
  box.addEventListener('change', () => set({ underwear: box.checked }));
  const show = () => {
    const minor = ageToYears(params.age) < 18;
    box.checked = params.underwear || minor;
    box.disabled = minor;
    note.textContent = minor
      ? 'Under-18 characters always wear underwear.'
      : 'Untick for no underwear (bottomless), adults only. Also applies under wrappers, aprons and loincloths.';
  };
  sync.push(show);
  show();
  return el('div', {}, el('label', { className: 'acc' }, box, 'Underwear (briefs)'), note);
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
// --- Animation bar ----------------------------------------------------------------------

// Animation bar: Idle plays by default ("rigged idle").
const animBar = $('#anim-bar');
const progress = el('div', { className: 'anim-progress' }, el('div'));
let activeClip = 'idle';
const animButtons = new Map<string, HTMLButtonElement>();
const playClip = (id: string) => {
  activeClip = id;
  viewer.play(id === 'bind' ? null : clipById.get(id) ?? null);
  animButtons.forEach((b, k) => b.classList.toggle('on', k === id));
  more.value = QUICK.includes(id) ? '' : id;
  more.classList.toggle('on', !QUICK.includes(id));
};
// Quick buttons for the most common clips, everything else in a grouped dropdown.
const QUICK = ['bind', 'idle', 'walk', 'run'];
for (const id of QUICK) {
  const b = el('button', { textContent: id === 'bind' ? 'Bind pose' : clipById.get(id)!.name });
  b.addEventListener('click', () => playClip(id));
  animButtons.set(id, b);
  animBar.append(b);
}
const more = el('select', { title: 'All animations' });
more.append(new Option('More animations…', ''));
for (const cat of [...new Set(CLIPS.map((c) => c.category))]) {
  const g = el('optgroup', { label: cat });
  for (const c of CLIPS.filter((x) => x.category === cat && !QUICK.includes(x.id))) g.append(new Option(c.name, c.id));
  more.append(g);
}
more.addEventListener('change', () => more.value && playClip(more.value));
animBar.append(more);
const rmBox = el('input', { type: 'checkbox' });
rmBox.addEventListener('change', () => setExport({ rootMotion: rmBox.checked }));
viewer.rootMotion = exportSettings.rootMotion;
const rmLabel = el('label', { className: 'acc rm', title: 'Locomotion clips travel forward / sideways (also used for export)' }, rmBox, 'Root motion');
const speed = el('select', { title: 'Playback speed' });
for (const s of ['0.25', '0.5', '1', '1.5']) speed.append(new Option(`${s}×`, s));
speed.value = '1';
speed.addEventListener('change', () => (viewer.speed = Number(speed.value)));
animBar.append(rmLabel, speed, progress);
viewer.onTick = (clip, t) => {
  (progress.firstChild as HTMLElement).style.width = clip ? `${(t / clip.duration) * 100}%` : '0%';
};

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

function loadExportSettings(): ExportSettings {
  try {
    return { ...DEFAULT_EXPORT, ...JSON.parse(localStorage.getItem('3dgen.export') ?? '{}') };
  } catch {
    return { ...DEFAULT_EXPORT };
  }
}
function saveExportSettings() {
  try {
    localStorage.setItem('3dgen.export', JSON.stringify(exportSettings));
  } catch {
    /* storage unavailable */
  }
}
function setExport(patch: Partial<ExportSettings>) {
  Object.assign(exportSettings, patch);
  saveExportSettings();
  viewer.rootMotion = exportSettings.rootMotion;
  // Rigged modes need a skeleton.
  if (exportSettings.mode !== 'static' && params.rig === 'none') set({ rig: 'game' });
  renderExport();
}

const exportPanel = $('#export-panel');
const summaryText = $('#export-summary-text');
const goBtn = $<HTMLButtonElement>('#export-go');
$('#export-summary').addEventListener('click', () => {
  exportPanel.hidden = !exportPanel.hidden;
  renderExport();
});

/** Rebuild the export panel and the export-bar summary from the current plan. */
function renderExport() {
  rmBox.checked = exportSettings.rootMotion;
  if (!current) return;
  const plan = planExport(current, exportSettings);
  summaryText.textContent = plan.summary;
  goBtn.textContent = `⬇ ${plan.download}`;
  goBtn.title = `Download ${plan.download}`;
  if (exportPanel.hidden) return;
  const s = exportSettings;
  const h = (t: string) => el('div', { className: 'xp-h', textContent: t });
  const radio = <T extends string>(value: T, current: T, label: string, on: (v: T) => void, extra: Record<string, unknown> = {}) => {
    const b = el('button', { className: 'seg' + (value === current ? ' on' : ''), textContent: label, ...extra });
    b.addEventListener('click', () => on(value));
    return b;
  };
  const check = (label: string, val: boolean, on: (v: boolean) => void) => {
    const box = el('input', { type: 'checkbox', checked: val });
    box.addEventListener('change', () => on(box.checked));
    return el('label', { className: 'acc' }, box, label);
  };
  const select = (opts: [string, string][], val: string, on: (v: string) => void) => {
    const sel = el('select');
    for (const [v, l] of opts) sel.append(new Option(l, v));
    sel.value = val;
    sel.addEventListener('change', () => on(sel.value));
    return sel;
  };

  const kids: Node[] = [];
  const close = el('button', { className: 'xp-close', textContent: '✕', title: 'Close' });
  close.addEventListener('click', () => {
    exportPanel.hidden = true;
  });
  kids.push(el('div', { className: 'xp-title' }, el('span', { textContent: 'Export' }), close));

  // 1. Mode
  kids.push(h('1 · What to export'));
  const cards = el('div', { className: 'xp-cards' });
  for (const m of ['static', 'rigged', 'animated'] as const) {
    const c = el('button', { className: 'xp-card' + (plan.settings.mode === m ? ' on' : '') },
      el('b', { textContent: MODE_LABELS[m].title }), el('span', { textContent: MODE_LABELS[m].blurb }));
    c.addEventListener('click', () => setExport({ mode: m }));
    cards.append(c);
  }
  kids.push(cards);

  // 2. Rig
  if (s.mode !== 'static') {
    kids.push(h('2 · Skeleton'));
    kids.push(el('div', { className: 'ctl wide' }, el('span', { textContent: 'Skeleton' }),
      select((['game', 'game_lite', 'full'] as RigType[]).map((k) => [k, RIG_LABELS[k]]), params.rig === 'none' ? 'game' : params.rig, (v) => set({ rig: v as RigType }))));
    kids.push(el('div', { className: 'ctl wide' }, el('span', { textContent: 'Rest pose' }),
      select([['A', 'A-pose (natural)'], ['T', 'T-pose (Mixamo / Unity Humanoid)']], params.restPose, (v) => set({ restPose: v as 'A' | 'T' }))));
    kids.push(check('Facial bones (jaw + eyes)', params.faceBones, (v) => set({ faceBones: v })));
    if (current.rig) kids.push(el('div', { className: 'rig-status', textContent: `✓ Auto-rigged: ${current.rig.bones.length} bones · ${current.rig.restPose}-pose bind · 4 weights per vertex` }));
  }

  // 3. Animations
  if (s.mode === 'animated') {
    kids.push(h('3 · Animations'));
    const allBtn = el('button', { className: 'mini', textContent: 'All' });
    allBtn.addEventListener('click', () => setExport({ clips: CLIPS.map((c) => c.id) }));
    const noneBtn = el('button', { className: 'mini', textContent: 'None' });
    noneBtn.addEventListener('click', () => setExport({ clips: [] }));
    kids.push(el('div', { className: 'xp-row' }, el('span', { className: 'hint', textContent: `${s.clips.length} of ${CLIPS.length} selected` }), allBtn, noneBtn));
    const cats = [...new Set(CLIPS.map((c) => c.category))];
    for (const cat of cats) {
      const grid = el('div', { className: 'xp-clips' });
      for (const c of CLIPS.filter((x) => x.category === cat)) {
        const on = s.clips.includes(c.id);
        const box = el('input', { type: 'checkbox', checked: on });
        box.addEventListener('change', () => setExport({ clips: on ? s.clips.filter((x) => x !== c.id) : [...s.clips, c.id] }));
        const play = el('button', { className: 'mini', textContent: '▶', title: `Preview ${c.name}` });
        play.addEventListener('click', () => playClip(c.id));
        grid.append(el('label', { className: 'xp-clip' }, box, el('span', { textContent: c.name }), el('small', { textContent: `${c.duration.toFixed(1)}s ${c.loop ? '↻' : ''}` }), play));
      }
      const ids = CLIPS.filter((x) => x.category === cat).map((x) => x.id);
      const allOn = ids.every((id) => s.clips.includes(id));
      const catBtn = el('button', { className: 'xp-cat', textContent: `${cat} ${allOn ? '☑' : '☐'}`, title: allOn ? `Deselect all ${cat}` : `Select all ${cat}` });
      catBtn.addEventListener('click', () =>
        setExport({ clips: allOn ? s.clips.filter((c) => !ids.includes(c)) : [...new Set([...s.clips, ...ids])] }));
      kids.push(catBtn, grid);
    }
    kids.push(el('div', { className: 'xp-row' },
      radio('embedded', s.packaging, 'One file, all clips inside', (v) => setExport({ packaging: v })),
      radio('separate', s.packaging, 'Zip: one file per clip', (v) => setExport({ packaging: v }))));
    if (s.packaging === 'separate') kids.push(check('Include the mesh in every clip file (bigger; off = skeleton + animation only)', s.clipMesh, (v) => setExport({ clipMesh: v })));
    kids.push(check('Root motion (walk / run / strafe travel instead of playing in place)', s.rootMotion, (v) => setExport({ rootMotion: v })));
    kids.push(check('Mark looping clips in their names ("Walk-loop", auto-loops in Godot)', s.loopSuffix, (v) => setExport({ loopSuffix: v })));
  }

  // 4. Format
  kids.push(h(`${s.mode === 'static' ? '2' : s.mode === 'rigged' ? '3' : '4'} · Format`));
  kids.push(el('div', { className: 'xp-row' },
    radio('glb', s.format, 'GLB', (v) => setExport({ format: v }), { title: 'glTF binary: web, Godot, Blender, three.js' }),
    radio('fbx', s.format, 'FBX', (v) => setExport({ format: v }), { title: 'Unity, Unreal, Maya, 3ds Max, Blender' }),
    radio('obj', s.format, 'OBJ', (v) => setExport({ format: v }), {
      title: s.mode === 'static' ? 'Wavefront OBJ + textures (static)' : 'OBJ cannot store a rig or animations',
      disabled: s.mode !== 'static',
    }),
    radio('all', s.format, 'All formats', (v) => setExport({ format: v }), { title: 'Every format in one zip' })));

  // Summary of exactly what will be downloaded
  kids.push(h('You will download'));
  const list = el('ul', { className: 'xp-files' });
  for (const f of plan.files)
    list.append(el('li', { className: f.kind === 'meta' ? 'meta' : '' }, el('code', { textContent: f.path }), el('span', { textContent: f.desc })));
  kids.push(el('div', { className: 'xp-download' }, el('b', { textContent: plan.download }), el('span', { className: 'hint', textContent: plan.zipped ? `zip with ${plan.files.length} items` : 'single file' })), list);
  for (const n of plan.notes) kids.push(el('div', { className: 'xp-note', textContent: `ⓘ ${n}` }));
  const dl = el('button', { className: 'primary xp-go', textContent: `⬇ Download ${plan.download}` });
  dl.addEventListener('click', doExport);
  kids.push(dl);
  exportPanel.replaceChildren(...kids);
}

async function doExport() {
  if (!current) return;
  const plan = planExport(current, exportSettings);
  const buttons = [goBtn, ...exportPanel.querySelectorAll<HTMLButtonElement>('.xp-go')];
  const labels = buttons.map((b) => b.textContent);
  buttons.forEach((b) => {
    b.disabled = true;
    b.textContent = 'Exporting…';
  });
  try {
    const previewPng = plan.zipped ? await viewer.snapshot() : undefined;
    const file = await runExport(lib, current, plan, { previewPng });
    const url = URL.createObjectURL(new Blob([file.data as BlobPart], { type: file.mime }));
    const a = el('a', { href: url, download: file.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    alert(`Export failed: ${(e as Error).message}`);
  } finally {
    buttons.forEach((b, i) => {
      b.disabled = false;
      b.textContent = labels[i];
    });
  }
}
goBtn.addEventListener('click', doExport);

// URL options: #preset=<name>&face
const hash = new URLSearchParams(location.hash.slice(1));
const presetName = hash.get('preset');
if (presetName && PRESETS[presetName]) params = { ...DEFAULT_PARAMS, ...PRESETS[presetName], name: presetName, detail: params.detail };
sync.forEach((f) => f());
regenerate();
const clipName = hash.get('clip');
if (clipName && clipById.has(clipName)) activeClip = clipName;
if (hash.has('skeleton')) {
  $<HTMLInputElement>('#skeleton').checked = true;
  viewer.setSkeleton(true);
}
if (hash.has('export')) exportPanel.hidden = false;
if (hash.has('face')) {
  $<HTMLInputElement>('#face').checked = true;
  viewer.focusFace(true);
}
