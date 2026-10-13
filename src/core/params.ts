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
  outfit: string;
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
