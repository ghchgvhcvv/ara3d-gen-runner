/**
 * Turns a free-text prompt into Ara 3D Gen character params (a HumanParams object).
 *
 * Ara 3D Gen has no text input of its own: it takes presets, a random seed, sliders and
 * item ids. This file is the bridge. It reads words in the prompt (preset names, gender, age,
 * build, ethnicity, hair, beard, clothes, accessories, colours, expression, weapon...), starts from
 * a matching preset or a seeded random character, and overrides what the prompt names.
 *
 * It is deliberately free of runtime imports so it can be unit-tested; scripts/prompt-export.ts
 * passes in the real PRESETS, DEFAULT_PARAMS, randomParams and the asset catalog. Every item id it
 * picks is checked against that catalog, so an unknown id can never reach the generator.
 */
import type { HumanParams } from '../src/core/params';

interface Item { id: string }
export interface MapperContext {
  defaults: HumanParams;
  presets: Record<string, Partial<HumanParams>>;
  catalog: { hair: Item[]; outfits: Item[]; shoes: Item[]; hats: Item[]; eyes: Item[]; eyebrows: Item[] };
  random: (seed: number) => HumanParams;
  yearsToAge: (years: number) => number;
}
export interface MapperResult { params: HumanParams; summary: string[] }

const PROCEDURAL_HAIR = ['buzz', 'mohawk', 'cornrows', 'box_braids', 'none'];
const PROCEDURAL_SHOES = ['sandals', 'combat_boots', 'none'];

const COLOR_HEX: Record<string, string> = {
  black: '#16161a', white: '#ececea', red: '#c0262d', blue: '#2f5fb3', navy: '#1f2f5c', green: '#2f8f4e', yellow: '#e2b93b',
  orange: '#e0772a', purple: '#7a4bb5', pink: '#e86fa8', brown: '#6b4a2b', grey: '#8a9099', gray: '#8a9099', gold: '#d4a72c',
  silver: '#c4c9d0', beige: '#c9b48c', khaki: '#8f7a55', teal: '#2a8f8a', maroon: '#6a1b2a', cream: '#efe4c8',
};
const HAIR_COLOR: Record<string, string> = {
  black: '#15100c', brown: '#5a3e27', blonde: '#d8b45a', blond: '#d8b45a', red: '#a8421f', ginger: '#a8421f', grey: '#b9b2a8', gray: '#b9b2a8',
  white: '#e6e2da', silver: '#b9b2a8', blue: '#3a6ea5', pink: '#e86fa8', purple: '#8a5fc0', green: '#3fa34d',
};
const EYE_IDS: [RegExp, string[]][] = [
  [/\bblue eyes?\b/, ['lightblue', 'blue']], [/\bgreen eyes?\b/, ['green']], [/\b(grey|gray) eyes?\b/, ['grey']],
  [/\bice(-| )?(blue )?eyes?\b/, ['ice']], [/\b(dark|black) eyes?\b/, ['blackbrown', 'darkbrown']], [/\bbrown eyes?\b/, ['brownlight', 'brown']],
];

/** Phrase -> preset. First match wins, so put the specific ones first. */
const PRESET_WORDS: [RegExp, string][] = [
  [/\bfrsc\b|road safety|road marshal/, 'The FRSC Officer (Nigeria)'],
  [/police|\bcop\b|policeman|policewoman/, 'The Police Officer (Nigeria)'],
  [/yoruba warrior/, 'The Yoruba Warrior'],
  [/maasai|masai/, 'The Maasai Warrior'],
  [/zulu/, 'The Zulu Warrior'],
  [/dahomey|amazon warrior/, 'The Dahomey Warrior'],
  [/african warrior|tribal warrior/, 'The African Warrior'],
  [/soldier|army|military|commando/, 'The Soldier'],
  [/hacker|cyberpunk|techwear/, 'The Cyberpunk Hacker'],
  [/survivor|wasteland|post.?apocalyp/, 'The Wasteland Survivor'],
  [/adventurer|explorer|treasure hunter/, 'The Adventurer'],
  [/secret agent|\bspy\b|\bagent\b/, 'The Secret Agent'],
  [/detective|sleuth/, 'Detective'],
  [/business ?woman|female executive|ceo woman/, 'Businesswoman'],
  [/brute|bouncer|bodyguard|strongman/, 'Heavy brute'],
  [/\belder(ly)?\b|old man|grandfather|grandpa/, 'Elder'],
  [/\bteen(ager)?\b/, 'Teen'],
  [/athletic woman|sporty woman|female athlete/, 'Athletic woman'],
];

const FEMALE_WORDS = /\b(woman|women|female|girl|lady|she|her|mother|mum|mom|queen|princess|grandma|grandmother|actress|businesswoman|policewoman|waitress)\b/;
const MALE_WORDS = /\b(man|men|male|boy|guy|he|his|father|dad|king|prince|grandpa|grandfather|businessman|policeman|waiter|gentleman)\b/;

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1_000_000_000;
}

export function promptToParams(rawPrompt: string, ctx: MapperContext): MapperResult {
  const prompt = rawPrompt.toLowerCase().replace(/[^a-z0-9'\- ,.]/g, ' ').replace(/\s+/g, ' ').trim();
  const has = (re: RegExp) => re.test(prompt);
  const summary: string[] = [];
  const seed = hashSeed(prompt);

  // 1. Base: a named preset, or a plausible random character from the prompt's own seed.
  let base: HumanParams;
  const presetHit = PRESET_WORDS.find(([re]) => re.test(prompt));
  if (presetHit && ctx.presets[presetHit[1]]) {
    base = { ...ctx.defaults, ...ctx.presets[presetHit[1]] } as HumanParams;
    summary.push(`Preset: ${presetHit[1]}`);
  } else {
    base = { ...ctx.random(seed) };
    summary.push(`Random character (seed ${seed})`);
  }
  const p: HumanParams = { ...base, seed, name: 'character' };
  const ids = (list: Item[]) => new Set(list.map((i) => i.id));
  const catalogId = (list: Item[], ...candidates: (string | RegExp)[]): string | undefined => {
    for (const c of candidates) {
      const hit = typeof c === 'string' ? list.find((i) => i.id === c) : list.find((i) => c.test(i.id));
      if (hit) return hit.id;
    }
    return undefined;
  };

  // 2. Gender
  const female = FEMALE_WORDS.test(prompt), male = MALE_WORDS.test(prompt);
  if (female && !male) { p.gender = 0.04; summary.push('Female'); }
  else if (male && !female) { p.gender = 0.96; summary.push('Male'); }
  const isFemale = p.gender < 0.5;

  // 3. Age
  const yearsMatch = prompt.match(/\b(\d{2})[ -]?(?:years?[ -]?old|yo|y\/o)\b/);
  let years: number | undefined = yearsMatch ? Number(yearsMatch[1]) : undefined;
  if (years === undefined) {
    if (has(/\b(child|kid)\b/)) years = 12;
    else if (has(/\bteen(ager)?\b/)) years = 15;
    else if (has(/\b(boy|girl)\b/)) years = 16;
    else if (has(/\byoung\b/)) years = 22;
    else if (has(/middle[- ]aged/)) years = 45;
    else if (has(/\b(ancient|very old)\b/)) years = 88;
    else if (has(/\b(old|elderly|elder|grandma|grandmother|grandpa|grandfather|senior)\b/)) years = 75;
    else if (has(/\badult\b/)) years = 30;
  }
  if (years !== undefined) { p.age = ctx.yearsToAge(Math.min(90, Math.max(12, years))); summary.push(`${Math.round(Math.min(90, Math.max(12, years)))} years`); }

  // 4. Build
  if (has(/\b(muscular|buff|strong|ripped|athletic|bodybuilder)\b/)) { p.muscle = 0.88; p.weight = Math.min(p.weight, 0.55); summary.push('Muscular'); }
  if (has(/\b(slim|thin|skinny|slender|lean)\b/)) { p.weight = 0.2; p.muscle = Math.min(p.muscle, 0.4); summary.push('Slim'); }
  if (has(/\b(fat|heavy|chubby|plump|overweight|big)\b/)) { p.weight = 0.88; summary.push('Heavier build'); }
  if (has(/\b(tall|giant)\b/)) { p.height = 0.85; summary.push('Tall'); }
  if (has(/\b(petite|tiny)\b|\bshort (man|woman|guy|girl|boy|person)\b/)) { p.height = 0.15; summary.push('Short'); }

  // 5. Ethnicity (skin comes from the mix; eyes follow it unless the prompt names a colour)
  const mix = (a: number, s: number, c: number, label: string) => { p.african = a; p.asian = s; p.caucasian = c; summary.push(label); };
  if (has(/\b(african|black|nigerian|yoruba|igbo|hausa|ghanaian|kenyan|ethiopian|zulu|somali|congolese|jamaican)\b/)) {
    mix(0.97, 0.02, 0.01, 'African features');
    if (p.eyes !== 'blackbrown') p.eyes = catalogId(ctx.catalog.eyes, 'blackbrown', 'darkbrown') ?? p.eyes;
  } else if (has(/\b(asian|chinese|japanese|korean|vietnamese|thai|filipino|indian|east asian)\b/)) {
    mix(0.03, 0.94, 0.03, 'Asian features');
    p.eyes = catalogId(ctx.catalog.eyes, 'blackbrown', 'darkbrown') ?? p.eyes;
  } else if (has(/\b(white|caucasian|european|american|british|german|french|scandinavian)\b/)) {
    mix(0.02, 0.03, 0.95, 'Caucasian features');
  } else if (has(/\b(mixed|biracial|mixed.?race)\b/)) {
    mix(0.4, 0.1, 0.5, 'Mixed features');
  }
  for (const [re, candidates] of EYE_IDS) {
    if (re.test(prompt)) { const id = catalogId(ctx.catalog.eyes, ...candidates); if (id) { p.eyes = id; summary.push(`Eyes: ${id}`); } break; }
  }

  // 6. Hair
  const hairColorWord = prompt.match(/\b(black|brown|blonde?|red|ginger|gr[ae]y|white|silver|blue|pink|purple|green)[ -]hair(ed)?\b|\b(blonde?|ginger|red|gr[ae]y|white)[ -]haired\b/);
  const setHair = (id: string, label: string) => {
    const ok = PROCEDURAL_HAIR.includes(id) || ids(ctx.catalog.hair).has(id);
    if (ok) { p.hair = id; summary.push(label); }
  };
  if (has(/\b(bald|shaved head|no hair)\b/)) setHair('none', 'Bald');
  else if (has(/\bbox braids?\b/)) setHair('box_braids', 'Box braids');
  else if (has(/\bcornrows?\b/)) setHair('cornrows', 'Cornrows');
  else if (has(/\bmohawk\b/)) setHair('mohawk', 'Mohawk');
  else if (has(/\bafro\b/)) setHair('afro01', 'Afro');
  else if (has(/\bbraid(s|ed)?\b|\bplaits?\b/)) setHair('braid01', 'Braids');
  else if (has(/\bponytail\b/)) setHair('ponytail01', 'Ponytail');
  else if (has(/\bbob\b/)) setHair('bob02', 'Bob cut');
  else if (has(/\b(buzz|buzzcut|crew cut)\b/)) setHair('buzz', 'Buzz cut');
  else if (has(/\blong hair(ed)?\b/)) setHair('long01', 'Long hair');
  else if (has(/\bshort hair(ed)?\b/)) setHair('short02', 'Short hair');
  if (hairColorWord) {
    const w = (hairColorWord[1] ?? hairColorWord[3]) as string;
    const hex = HAIR_COLOR[w];
    if (hex) { p.hairColor = hex; p.hairTint = hex; summary.push(`${w} hair`); }
  }
  // 7. Facial hair
  if (has(/\bclean[- ]shaven\b/)) p.facialHair = 'none';
  else if (has(/\b(full|big|long|thick) beard\b/)) p.facialHair = 'full_beard';
  else if (has(/\bbeard(ed)?\b/)) p.facialHair = 'short_beard';
  else if (has(/\bgoatee\b/)) p.facialHair = 'goatee';
  else if (has(/\b(mustache|moustache)\b/)) p.facialHair = 'mustache';
  else if (has(/\bstubble\b/)) p.facialHair = 'stubble';
  if (p.facialHair !== base.facialHair) summary.push(`Facial hair: ${p.facialHair.replace('_', ' ')}`);
  if (isFemale && !has(/\bbeard|mustache|moustache|goatee|stubble\b/)) p.facialHair = 'none';

  // 8. Clothes. A colour word right before a clothing noun tints that item.
  const NOUN = '(suit|shirt|jacket|dress|uniform|outfit|tunic|top|trousers|pants|shorts|coat|vest|wrapper|cap|beret|hat)';
  const colorBefore = prompt.match(new RegExp(`\\b(${Object.keys(COLOR_HEX).join('|')})\\s+(?:\\w+\\s+)?${NOUN}\\b`));
  const clothesColor = colorBefore ? COLOR_HEX[colorBefore[1]] : undefined;
  const pattern = has(/\bkente\b/) ? 'kente' : has(/\badire\b/) ? 'adire' : has(/\basooke\b|\baso oke\b/) ? 'asooke' : undefined;

  const gendered = (suit: string) => catalogId(ctx.catalog.outfits, new RegExp(`^${isFemale ? 'female' : 'male'}_${suit}`), new RegExp(`${suit}`));
  const useOutfit = (id: string | undefined, label: string) => {
    if (!id) return false;
    p.outfit = id; p.top = 'none'; p.bottom = 'none'; summary.push(label); return true;
  };
  const proceduralSet: { top?: string; bottom?: string } = {};
  if (has(/\b(suit|formal|business|tuxedo|blazer)\b/) && !has(/\buniform\b/)) useOutfit(gendered('elegantsuit'), 'Formal suit');
  else if (has(/\b(sportswear|tracksuit|gym|jogger|athletic wear|sporty)\b/)) useOutfit(gendered('sportsuit'), 'Sportswear');
  else if (has(/\b(work ?suit|overalls|mechanic|worker|construction)\b/)) useOutfit(gendered('worksuit'), 'Work clothes');
  else if (has(/\b(casual|t-?shirt|jeans|hoodie)\b/)) useOutfit(gendered('casualsuit'), 'Casual clothes');
  if (has(/\btank top\b/)) proceduralSet.top = 'tank_top';
  if (has(/\b(fatigues?|camo|camouflage)\b/)) { proceduralSet.top = 'fatigue_shirt'; proceduralSet.bottom = 'fatigue_pants'; }
  if (has(/\buniform\b/) && !presetHit) { proceduralSet.top = 'uniform_shirt'; proceduralSet.bottom = 'uniform_trousers'; }
  if (has(/\btechwear\b/)) { proceduralSet.top = 'techwear_jacket'; proceduralSet.bottom = 'techwear_pants'; }
  if (has(/\b(tattered|ragged|torn clothes)\b/)) { proceduralSet.top = 'tattered_shirt'; proceduralSet.bottom = 'tattered_pants'; }
  if (has(/\blong tunic\b/)) proceduralSet.top = 'long_tunic'; else if (has(/\btunic\b/)) proceduralSet.top = 'tunic';
  if (has(/\bshorts\b/)) proceduralSet.bottom = 'cargo_shorts';
  if (has(/\bloincloth\b/)) proceduralSet.bottom = 'loincloth';
  if (has(/\blong wrapper\b/)) proceduralSet.bottom = 'wrapper_long'; else if (has(/\bwrapper\b/)) proceduralSet.bottom = 'wrapper_knee';
  if (has(/\b(trousers|pants)\b/) && !proceduralSet.bottom && (proceduralSet.top || has(/\btunic\b/))) proceduralSet.bottom = 'trousers';
  if (has(/\bshirtless|topless\b/)) { proceduralSet.top = 'none'; }
  if (proceduralSet.top || proceduralSet.bottom) {
    p.outfit = 'none';
    p.top = proceduralSet.top ?? (has(/\bshirtless|topless\b/) ? 'none' : 'tank_top');
    p.bottom = proceduralSet.bottom ?? 'trousers';
    summary.push(`Clothes: ${[p.top, p.bottom].filter((x) => x !== 'none').join(' + ').replace(/_/g, ' ')}`);
  }
  // Tint
  if (clothesColor || pattern) {
    if (p.outfit !== 'none') { if (clothesColor) { p.outfitTint = clothesColor; summary.push(`Outfit colour: ${colorBefore![1]}`); } }
    else {
      const style = { pattern: pattern ?? 'solid', ...(clothesColor ? { color: clothesColor } : {}) };
      for (const g of [p.top, p.bottom]) if (g && g !== 'none') p.garmentStyles = { ...p.garmentStyles, [g]: { ...p.garmentStyles[g], ...style } };
      summary.push(pattern ? `Pattern: ${pattern}` : `Clothes colour: ${colorBefore![1]}`);
    }
  }
  // Accessories (procedural garment ids from src/core/garments/catalog.ts)
  const ACCESSORIES: [RegExp, string][] = [
    [/\bhelmet\b/, 'helmet'], [/\bgoggles\b/, 'goggles'], [/\bvisor\b/, 'visor'], [/\bwatch\b/, 'watch'], [/\bberet\b/, 'beret'],
    [/\b(fila|traditional cap)\b/, 'fila_cap'], [/\b(utility )?belt\b/, 'utility_belt'], [/\b(tactical )?vest\b/, 'tactical_vest'],
    [/\bleather armou?r\b/, 'leather_armor'], [/\b(bead )?necklace\b/, 'bead_necklace'], [/\bcowrie\b/, 'cowrie_necklace'], [/\bheadband\b/, 'bead_headband'],
  ];
  const acc = new Set(p.accessories);
  for (const [re, id] of ACCESSORIES) if (re.test(prompt)) acc.add(id);
  if (acc.size !== p.accessories.length) { p.accessories = [...acc]; summary.push(`Accessories: ${p.accessories.join(', ').replace(/_/g, ' ')}`); }
  // Hat (MakeHuman hats from the catalog)
  if (has(/\bfedora\b/)) { const id = catalogId(ctx.catalog.hats, /^fedora/); if (id) { p.hat = id; summary.push('Fedora'); } }
  else if (has(/\b(hat|cap)\b/) && !has(/\b(fila|beret|helmet)\b/) && ctx.catalog.hats.length) { p.hat = ctx.catalog.hats[seed % ctx.catalog.hats.length].id; summary.push('Hat'); }
  // Shoes
  if (has(/\b(barefoot|bare feet|no shoes)\b/)) p.shoes = 'none';
  else if (has(/\b(sandals?)\b/)) p.shoes = 'sandals';
  else if (has(/\b(boots?|combat boots)\b/)) p.shoes = 'combat_boots';

  // 9. Extras
  if (has(/\btattoo(s|ed)?\b/)) p.tattoos = [...new Set([...(p.tattoos ?? []), has(/\bface (marks|tattoo)/) ? 'face_marks' : 'sleeve_r'])] as HumanParams['tattoos'];
  if (has(/\bhoops?\b/)) p.earrings = 'small_hoops'; else if (has(/\bearrings?\b/)) p.earrings = 'studs';
  if (has(/\bsword\b/)) p.weapon = 'sword'; else if (has(/\b(rifle|assault rifle)\b/)) p.weapon = 'rifle';
  else if (has(/\b(pistol|gun|handgun)\b/)) p.weapon = 'pistol'; else if (has(/\b(knife|dagger)\b/)) p.weapon = 'knife';
  if (p.weapon !== 'none' && p.weapon !== base.weapon) summary.push(`Holding: ${p.weapon}`);

  // 10. Expression (the resting face; the app can change it live)
  const EXPR: [RegExp, HumanParams['expression']][] = [
    [/\b(laughing|laughs?)\b/, 'laughing'], [/\b(smiling|smile|happy|cheerful|joyful)\b/, 'happy'], [/\b(angry|furious|mad)\b/, 'angry'],
    [/\b(sad|sorrowful|unhappy)\b/, 'sad'], [/\b(crying|tears)\b/, 'crying'], [/\b(surprised|shocked)\b/, 'surprised'],
    [/\b(afraid|scared|terrified|fearful)\b/, 'afraid'], [/\b(determined|serious|focused|fierce)\b/, 'determined'],
  ];
  const ex = EXPR.find(([re]) => re.test(prompt));
  if (ex) { p.expression = ex[1]; summary.push(`Expression: ${ex[1]}`); }

  // 11. Safety net: only ids that exist in this asset catalog reach the generator.
  const fixes: [keyof HumanParams, Set<string>][] = [
    ['outfit', new Set([...ids(ctx.catalog.outfits), 'none'])],
    ['hair', new Set([...ids(ctx.catalog.hair), ...PROCEDURAL_HAIR])],
    ['shoes', new Set([...ids(ctx.catalog.shoes), ...PROCEDURAL_SHOES])],
    ['hat', new Set([...ids(ctx.catalog.hats), 'none'])],
    ['eyes', ids(ctx.catalog.eyes)],
    ['eyebrows', new Set([...ids(ctx.catalog.eyebrows), 'none'])],
  ];
  for (const [key, valid] of fixes) {
    if (!valid.has(p[key] as string)) {
      const fallback = valid.has(base[key] as string) ? (base[key] as string) : valid.has(ctx.defaults[key] as string) ? (ctx.defaults[key] as string) : [...valid][0];
      (p as unknown as Record<string, unknown>)[key] = fallback;
    }
  }
  return { params: p, summary };
}
