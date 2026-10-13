import { rng } from './math';

export const HAIR_STYLES = ['bald', 'buzz', 'short', 'spiky', 'long', 'ponytail', 'bun', 'mohawk', 'afro'] as const;
export const FACIAL_HAIR = ['none', 'mustache', 'goatee', 'beard'] as const;
export const TOPS = ['tshirt', 'tank', 'longsleeve', 'none'] as const;
export const BOTTOMS = ['pants', 'shorts', 'skirt'] as const;
export const SHOES = ['sneakers', 'boots'] as const;
export const HATS = ['none', 'cap', 'beanie', 'helmet'] as const;
export const EARS = ['round', 'pointed'] as const;
export const POSES = ['T', 'A'] as const;
export const DETAILS = ['low', 'medium', 'high'] as const;

export interface CharacterParams {
  name: string;
  seed: number;
  // Body
  height: number; // metres
  masculinity: number; // 0 = feminine .. 1 = masculine
  muscle: number; // 0..1
  bodyFat: number; // 0..1
  headScale: number; // 1 = realistic, ~2 = chibi
  shoulderWidth: number; // multipliers around 1
  hipWidth: number;
  armLength: number;
  legLength: number;
  neckLength: number;
  handSize: number;
  footSize: number;
  // Face
  headWidth: number;
  jawWidth: number;
  eyeSize: number;
  eyeSpacing: number;
  noseSize: number;
  earSize: number;
  ears: (typeof EARS)[number];
  // Hair
  hairStyle: (typeof HAIR_STYLES)[number];
  facialHair: (typeof FACIAL_HAIR)[number];
  // Outfit
  top: (typeof TOPS)[number];
  bottom: (typeof BOTTOMS)[number];
  shoes: (typeof SHOES)[number];
  hat: (typeof HATS)[number];
  belt: boolean;
  gloves: boolean;
  // Colours (sRGB hex)
  skinColor: string;
  hairColor: string;
  eyeColor: string;
  topColor: string;
  bottomColor: string;
  shoeColor: string;
  accentColor: string;
  // Output
  pose: (typeof POSES)[number];
  detail: (typeof DETAILS)[number];
  flatShading: boolean;
  fingers: boolean;
}

export const DEFAULT_PARAMS: CharacterParams = {
  name: 'character',
  seed: 1,
  height: 1.78,
  masculinity: 0.8,
  muscle: 0.45,
  bodyFat: 0.2,
  headScale: 1.15,
  shoulderWidth: 1,
  hipWidth: 1,
  armLength: 1,
  legLength: 1,
  neckLength: 1,
  handSize: 1,
  footSize: 1,
  headWidth: 1,
  jawWidth: 1,
  eyeSize: 1.1,
  eyeSpacing: 1,
  noseSize: 1,
  earSize: 1,
  ears: 'round',
  hairStyle: 'short',
  facialHair: 'none',
  top: 'tshirt',
  bottom: 'pants',
  shoes: 'sneakers',
  hat: 'none',
  belt: true,
  gloves: false,
  skinColor: '#d9a07a',
  hairColor: '#3b2a1e',
  eyeColor: '#3f6fb0',
  topColor: '#3d7dd8',
  bottomColor: '#2e3440',
  shoeColor: '#f1f1f1',
  accentColor: '#6b4a2b',
  pose: 'T',
  detail: 'medium',
  flatShading: false,
  fingers: true,
};

export const PRESETS: Record<string, Partial<CharacterParams>> = {
  Hero: {},
  Heroine: {
    height: 1.68, masculinity: 0.1, muscle: 0.3, bodyFat: 0.25, hairStyle: 'ponytail',
    hairColor: '#8a3b1f', topColor: '#c0392b', bottomColor: '#263238', shoes: 'boots',
    shoeColor: '#4e342e', eyeColor: '#2e7d32', top: 'tank', jawWidth: 0.85,
  },
  Chibi: {
    height: 1.2, headScale: 2.1, masculinity: 0.4, muscle: 0.1, bodyFat: 0.35, eyeSize: 1.7,
    hairStyle: 'spiky', hairColor: '#f2c94c', topColor: '#ff7043', bottomColor: '#5c6bc0',
    fingers: false, noseSize: 0.6,
  },
  Brute: {
    height: 2.0, masculinity: 1, muscle: 1, bodyFat: 0.5, shoulderWidth: 1.25, headScale: 0.95,
    jawWidth: 1.3, hairStyle: 'mohawk', facialHair: 'beard', top: 'none', bottom: 'pants',
    shoes: 'boots', skinColor: '#8d5524', hairColor: '#1b1b1b', bottomColor: '#5d4037',
    shoeColor: '#3e2723', eyeSize: 0.85, belt: true, gloves: true,
  },
  'Elf ranger': {
    height: 1.82, masculinity: 0.45, muscle: 0.35, bodyFat: 0.1, ears: 'pointed', earSize: 1.3,
    hairStyle: 'long', hairColor: '#e6d3a3', top: 'longsleeve', topColor: '#2e5e3a',
    bottomColor: '#4b3b2a', shoes: 'boots', shoeColor: '#3a2a1a', skinColor: '#f1d1b5',
    legLength: 1.08, eyeColor: '#6abf69', gloves: true, accentColor: '#7a5a34',
  },
  Knight: {
    masculinity: 0.9, muscle: 0.7, hat: 'helmet', facialHair: 'goatee', top: 'longsleeve',
    topColor: '#7b8794', bottomColor: '#3c4650', shoes: 'boots', shoeColor: '#555b62',
    gloves: true, accentColor: '#8a1c1c', hairStyle: 'short',
  },
  'Low-poly villager': {
    detail: 'low', flatShading: true, fingers: false, masculinity: 0.6, bodyFat: 0.45,
    hairStyle: 'short', facialHair: 'mustache', hat: 'beanie', top: 'longsleeve',
    topColor: '#a1887f', bottomColor: '#6d4c41', shoes: 'boots', shoeColor: '#4e342e',
    accentColor: '#c62828',
  },
};

const SKIN = ['#f6d7c3', '#f1c27d', '#e0ac69', '#c68642', '#a0663a', '#8d5524', '#5c3a21', '#3d2615'];
const HAIR = ['#0f0f0f', '#3b2a1e', '#6a4e2e', '#a67b5b', '#e6c27a', '#f2e3b3', '#b5452a', '#9e9e9e', '#5b3fa8', '#2a7ab0'];
const EYES = ['#3f6fb0', '#5b8c3a', '#6b4423', '#3b2a1e', '#808b96', '#2e7d6f'];
const CLOTH = ['#c0392b', '#2e86de', '#27ae60', '#8e44ad', '#f39c12', '#2c3e50', '#ecf0f1', '#7f8c8d', '#d35400', '#16a085', '#34495e', '#b03a2e', '#6d4c41', '#1e272e'];

/** Random character from a seed. Keeps output settings (detail, pose...) from `base`. */
export function randomParams(seed: number, base: CharacterParams = DEFAULT_PARAMS): CharacterParams {
  const r = rng(seed);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
  const range = (lo: number, hi: number) => lo + (hi - lo) * r();
  const masculinity = r() < 0.5 ? range(0, 0.35) : range(0.65, 1);
  const stylised = r() < 0.25;
  const fem = masculinity < 0.5;
  return {
    ...base,
    seed,
    height: stylised ? range(1.1, 1.5) : range(1.6, 1.95),
    masculinity,
    muscle: range(0, 0.9),
    bodyFat: range(0, 0.7),
    headScale: stylised ? range(1.6, 2.2) : range(0.95, 1.25),
    shoulderWidth: range(0.9, 1.15),
    hipWidth: range(0.9, 1.15),
    armLength: range(0.95, 1.05),
    legLength: range(0.92, 1.08),
    neckLength: range(0.85, 1.15),
    handSize: range(0.9, 1.1),
    footSize: range(0.9, 1.1),
    headWidth: range(0.9, 1.1),
    jawWidth: fem ? range(0.8, 1) : range(0.95, 1.3),
    eyeSize: stylised ? range(1.4, 1.9) : range(0.9, 1.3),
    eyeSpacing: range(0.9, 1.1),
    noseSize: range(0.7, 1.3),
    earSize: range(0.85, 1.2),
    ears: r() < 0.15 ? 'pointed' : 'round',
    hairStyle: pick(fem ? ['long', 'ponytail', 'bun', 'short', 'afro'] as const : HAIR_STYLES),
    facialHair: fem ? 'none' : pick(FACIAL_HAIR),
    top: pick(fem ? ['tshirt', 'tank', 'longsleeve'] as const : TOPS),
    bottom: pick(fem ? BOTTOMS : ['pants', 'shorts'] as const),
    shoes: pick(SHOES),
    hat: r() < 0.3 ? pick(['cap', 'beanie', 'helmet'] as const) : 'none',
    belt: r() < 0.5,
    gloves: r() < 0.2,
    skinColor: pick(SKIN),
    hairColor: pick(HAIR),
    eyeColor: pick(EYES),
    topColor: pick(CLOTH),
    bottomColor: pick(CLOTH),
    shoeColor: pick(CLOTH),
    accentColor: pick(CLOTH),
  };
}
