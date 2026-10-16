import type { Catalog } from './assets';
import { rng } from './math';

export const DETAILS = ['low', 'medium', 'high'] as const;
export type Detail = (typeof DETAILS)[number];

export interface HumanParams {
  name: string;
  seed: number;
  // Macro body controls, 0..1 (MakeHuman conventions)
  gender: number; // 0 female .. 1 male
  age: number; // 0.1875 = 11y, 0.5 = 25y, 1 = 90y
  muscle: number;
  weight: number;
  height: number;
  proportions: number; // 0 uncommon .. 1 idealised
  african: number;
  asian: number;
  caucasian: number;
  breastSize: number;
  breastFirmness: number;
  /** Detail sliders: slider id -> value (-1..1 bipolar, 0..1 unipolar). */
  modifiers: Record<string, number>;
  // Appearance ('auto' / 'none' where noted)
  skin: string; // skin id or 'auto'
  skinTint: string;
  eyes: string;
  eyebrows: string; // id or 'none'
  eyelashes: string;
  hair: string;
  hairTint: string;
  /** MakeHuman outfit id, or 'none' to dress with separate pieces below. */
  outfit: string;
  /** Procedural top / bottom garment ids or 'none' (used when outfit is 'none'). 'none' top = shirtless/topless. */
  top: string;
  bottom: string;
  /** Procedural accessories (garment ids). */
  accessories: string[];
  /** Per-garment pattern / colour overrides. */
  garmentStyles: Record<string, { pattern?: string; color?: string; color2?: string }>;
  /** MakeHuman shoes id, 'sandals', 'combat_boots' or 'none' (barefoot). */
  shoes: string;
  hat: string;
  outfitTint: string;
  // Output
  detail: Detail;
}

export const DEFAULT_PARAMS: HumanParams = {
  name: 'character',
  seed: 1,
  gender: 1,
  age: 0.5,
  muscle: 0.6,
  weight: 0.5,
  height: 0.5,
  proportions: 0.7,
  african: 0.1,
  asian: 0.1,
  caucasian: 0.8,
  breastSize: 0.5,
  breastFirmness: 0.5,
  modifiers: {},
  skin: 'auto',
  skinTint: '#ffffff',
  eyes: 'brownlight',
  eyebrows: 'eyebrow001',
  eyelashes: 'eyelashes01',
  hair: 'short02',
  hairTint: '#ffffff',
  outfit: 'male_casualsuit01',
  top: 'none',
  bottom: 'none',
  accessories: [],
  garmentStyles: {},
  shoes: 'shoes01',
  hat: 'none',
  outfitTint: '#ffffff',
  detail: 'medium',
};

/** MakeHuman age value <-> years. */
export function ageToYears(a: number): number {
  if (a < 0.1875) return 1 + (a / 0.1875) * 10;
  if (a < 0.5) return 11 + ((a - 0.1875) / 0.3125) * 14;
  return 25 + ((a - 0.5) / 0.5) * 65;
}
export function yearsToAge(y: number): number {
  if (y < 11) return ((y - 1) / 10) * 0.1875;
  if (y < 25) return 0.1875 + ((y - 11) / 14) * 0.3125;
  return 0.5 + ((y - 25) / 65) * 0.5;
}

export const PRESETS: Record<string, Partial<HumanParams>> = {
  'Athletic man': {},
  'Athletic woman': {
    gender: 0, muscle: 0.6, weight: 0.45, height: 0.55, african: 0.15, asian: 0.15, caucasian: 0.7, breastSize: 0.55, hair: 'ponytail01',
    outfit: 'female_sportsuit01', shoes: 'shoes03', eyebrows: 'eyebrow010', eyelashes: 'eyelashes02', eyes: 'green',
  },
  'Businesswoman': {
    gender: 0, age: 0.6, muscle: 0.45, weight: 0.5, height: 0.6, hair: 'bob02', outfit: 'female_elegantsuit01',
    shoes: 'shoes02', eyebrows: 'eyebrow011', eyelashes: 'eyelashes03', african: 0.8, asian: 0.1, caucasian: 0.1,
  },
  'Heavy brute': {
    gender: 1, age: 0.62, muscle: 0.95, weight: 0.85, height: 0.72, proportions: 0.4, african: 0.85, asian: 0.05, caucasian: 0.1, hair: 'none',
    outfit: 'male_worksuit01', shoes: 'shoes04', eyebrows: 'eyebrow003',
    modifiers: { 'head/head-fat': 0.4, 'chin/chin-width': 0.5, 'neck/neck-scale-horiz': 0.5, 'chin/chin-prominent': 0.4 },
  },
  Elder: {
    gender: 1, age: 0.95, muscle: 0.35, weight: 0.55, height: 0.4, hair: 'short04', outfit: 'male_elegantsuit01',
    shoes: 'shoes02', hat: 'fedora01', eyebrows: 'eyebrow006', african: 0.1, asian: 0.1, caucasian: 0.8,
  },
  Teen: {
    gender: 0.1, age: 0.42, muscle: 0.45, weight: 0.4, height: 0.5, hair: 'long01', outfit: 'female_casualsuit02',
    shoes: 'shoes03', eyes: 'lightblue', african: 0.05, asian: 0.75, caucasian: 0.2,
  },
  'The Adventurer': {
    gender: 0, age: 0.52, muscle: 0.65, weight: 0.38, height: 0.58, proportions: 0.85, breastSize: 0.55,
    african: 0.05, asian: 0.05, caucasian: 0.9, hair: 'braid01', eyes: 'brownlight', eyebrows: 'eyebrow010', eyelashes: 'eyelashes02',
    outfit: 'none', top: 'tank_top', bottom: 'cargo_shorts', shoes: 'combat_boots', accessories: ['utility_belt'],
    garmentStyles: { tank_top: { pattern: 'solid', color: '#3b6f73' }, cargo_shorts: { pattern: 'khaki', color: '#8f7a55' } },
  },
  'The Secret Agent': {
    gender: 1, age: 0.6, muscle: 0.62, weight: 0.45, height: 0.5, proportions: 0.9,
    african: 0.05, asian: 0.05, caucasian: 0.9, hair: 'short04', eyes: 'lightblue', eyebrows: 'eyebrow007',
    outfit: 'male_elegantsuit01', shoes: 'shoes02', accessories: ['watch'],
  },
  'The Soldier': {
    gender: 1, age: 0.55, muscle: 0.8, weight: 0.55, height: 0.5, african: 0.3, asian: 0.1, caucasian: 0.6,
    hair: 'short03', eyebrows: 'eyebrow003', outfit: 'none', top: 'fatigue_shirt', bottom: 'fatigue_pants',
    shoes: 'combat_boots', accessories: ['tactical_vest', 'helmet', 'belt'],
  },
  'The Cyberpunk Hacker': {
    gender: 0.15, age: 0.45, muscle: 0.45, weight: 0.35, height: 0.5, african: 0.05, asian: 0.85, caucasian: 0.1,
    hair: 'bob02', hairTint: '#d080ff', eyes: 'ice', eyebrows: 'eyebrow012', eyelashes: 'eyelashes03',
    outfit: 'none', top: 'techwear_jacket', bottom: 'techwear_pants', shoes: 'combat_boots', accessories: ['visor', 'neon_accents'],
  },
  'The Wasteland Survivor': {
    gender: 0.9, age: 0.62, muscle: 0.75, weight: 0.4, height: 0.5, proportions: 0.45, african: 0.15, asian: 0.1, caucasian: 0.75,
    hair: 'short01', eyebrows: 'eyebrow005', outfit: 'none', top: 'tattered_shirt', bottom: 'tattered_pants', shoes: 'combat_boots',
    accessories: ['leather_armor', 'goggles', 'arm_wraps', 'belt', 'crossed_straps'],
    modifiers: { 'chin/chin-prominent': 0.3, 'head/head-square': 0.3 },
  },
  'The African Warrior': {
    gender: 1, age: 0.52, muscle: 0.85, weight: 0.45, height: 0.48, proportions: 0.85, african: 1, asian: 0, caucasian: 0,
    hair: 'none', eyebrows: 'eyebrow001', outfit: 'none', top: 'none', bottom: 'wrapper_knee', shoes: 'sandals',
    accessories: ['leather_armor', 'bead_necklace', 'arm_cuffs', 'belt'],
    garmentStyles: { wrapper_knee: { pattern: 'ankara', color: '#c2410c', color2: '#1e3a8a' } },
  },
  'The Yoruba Warrior': {
    gender: 1, age: 0.55, muscle: 0.75, weight: 0.5, height: 0.48, african: 1, asian: 0, caucasian: 0,
    hair: 'none', eyebrows: 'eyebrow003', outfit: 'none', top: 'long_tunic', bottom: 'trousers', shoes: 'sandals',
    accessories: ['crossed_straps', 'cowrie_necklace', 'cowrie_armbands', 'amulets', 'fila_cap'],
    garmentStyles: {
      long_tunic: { pattern: 'asooke', color: '#4b1d3f', color2: '#d9b25f' },
      trousers: { pattern: 'asooke', color: '#4b1d3f', color2: '#d9b25f' },
      fila_cap: { pattern: 'asooke', color: '#4b1d3f', color2: '#d9b25f' },
    },
  },
  'The Maasai Warrior': {
    gender: 1, age: 0.45, muscle: 0.6, weight: 0.3, height: 0.6, proportions: 0.8, african: 1, asian: 0, caucasian: 0,
    hair: 'none', eyebrows: 'eyebrow001', outfit: 'none', top: 'none', bottom: 'wrapper_knee', shoes: 'sandals',
    accessories: ['shoulder_drape', 'bead_collar', 'bead_armbands', 'bead_headband'],
    garmentStyles: { wrapper_knee: { pattern: 'shuka', color: '#c81e1e', color2: '#1a2a6a' }, shoulder_drape: { pattern: 'shuka', color: '#c81e1e', color2: '#1a2a6a' } },
  },
  'The Zulu Warrior': {
    gender: 1, age: 0.5, muscle: 0.9, weight: 0.5, height: 0.5, african: 1, asian: 0, caucasian: 0,
    hair: 'none', eyebrows: 'eyebrow003', outfit: 'none', top: 'none', bottom: 'hide_aprons', shoes: 'none',
    accessories: ['fur_bands', 'feather_headband', 'bead_necklace'],
    garmentStyles: { hide_aprons: { pattern: 'hide', color: '#5a3a22', color2: '#1a1410' }, feather_headband: { pattern: 'leopard' } },
  },
  'The Dahomey Warrior': {
    gender: 0, age: 0.5, muscle: 0.8, weight: 0.42, height: 0.5, proportions: 0.85, breastSize: 0.45, african: 1, asian: 0, caucasian: 0,
    hair: 'none', eyes: 'brown', eyebrows: 'eyebrow011', eyelashes: 'eyelashes02', outfit: 'none',
    top: 'tunic', bottom: 'wrapper_knee', shoes: 'sandals', accessories: ['waist_sash', 'amulet_bandolier', 'arm_guards', 'amulets'],
    garmentStyles: {
      tunic: { pattern: 'asooke', color: '#1f2f5c', color2: '#c9a24a' },
      wrapper_knee: { pattern: 'kente', color: '#1d6b3a', color2: '#a61b1b' },
      waist_sash: { pattern: 'solid', color: '#9b1c1c' },
    },
  },
  Detective: {
    gender: 0.95, age: 0.65, muscle: 0.55, weight: 0.5, height: 0.55, african: 0.2, asian: 0.6, caucasian: 0.2, hair: 'short01', outfit: 'male_casualsuit05',
    hat: 'fedora_cocked', shoes: 'shoes06', eyes: 'grey', eyebrows: 'eyebrow007',
  },
};

const pick = <T,>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)];

/** Random but plausible human. Keeps output settings from `base`. */
export function randomParams(seed: number, cat: Catalog, base: HumanParams = DEFAULT_PARAMS): HumanParams {
  const r = rng(seed);
  const range = (lo: number, hi: number) => lo + (hi - lo) * r();
  const bell = (s: number) => (r() + r() + r() - 1.5) * s; // ~normal, mean 0
  const female = r() < 0.5;
  const ids = (items: { id: string; tags: string[] }[], tag?: string) =>
    items.filter((i) => !tag || i.tags.some((t) => t.toLowerCase() === tag) || !i.tags.some((t) => /^(male|female)$/i.test(t))).map((i) => i.id);
  const FEMALE_HAIR = ['bob01', 'bob02', 'braid01', 'long01', 'ponytail01', 'afro01', 'short02'];
  const MALE_HAIR = ['short01', 'short02', 'short03', 'short04', 'afro01', 'none'];
  // Ethnic mix: usually dominated by one group.
  const mix = [r() ** 3, r() ** 3, r() ** 3];
  mix[Math.floor(r() * 3)] += 1;
  const sum = mix[0] + mix[1] + mix[2];

  const modifiers: Record<string, number> = {};
  const sliders = cat.sliders.filter((g) => /face|head|nose|mouth|eye|ear|chin|cheek|forehead/i.test(g.category + g.group)).flatMap((g) => g.sliders);
  for (let i = 0; i < 18 && sliders.length; i++) {
    const s = pick(r, sliders);
    modifiers[s.id] = s.bipolar ? Math.max(-1, Math.min(1, bell(0.55))) : range(0, 0.5);
  }
  const outfits = ids(cat.outfits, female ? 'female' : 'male');
  return {
    ...base,
    seed,
    gender: female ? range(0, 0.15) : range(0.85, 1),
    age: yearsToAge(range(18, 70)),
    muscle: range(0.3, 0.9),
    weight: range(0.3, 0.8),
    height: range(0.3, 0.8),
    proportions: range(0.4, 0.9),
    african: mix[0] / sum,
    asian: mix[1] / sum,
    caucasian: mix[2] / sum,
    breastSize: range(0.3, 0.8),
    breastFirmness: range(0.3, 0.8),
    modifiers,
    skin: 'auto',
    skinTint: '#ffffff',
    eyes: pick(r, cat.eyes).id,
    eyebrows: pick(r, cat.eyebrows).id,
    eyelashes: pick(r, cat.eyelashes).id,
    hair: pick(r, female ? FEMALE_HAIR : MALE_HAIR),
    hairTint: '#ffffff',
    outfit: outfits.length ? pick(r, outfits) : 'none',
    shoes: pick(r, cat.shoes).id,
    hat: r() < 0.15 && cat.hats.length ? pick(r, cat.hats).id : 'none',
    outfitTint: '#ffffff',
  };
}
