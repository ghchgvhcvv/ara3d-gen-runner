import {
  BOTTOMS, DETAILS, EARS, FACIAL_HAIR, HAIR_STYLES, HATS, POSES, SHOES, TOPS, type CharacterParams,
} from '../core/params';

type Key = keyof CharacterParams;

export type Control =
  | { key: Key; label: string; type: 'range'; min: number; max: number; step: number }
  | { key: Key; label: string; type: 'select'; options: readonly string[] }
  | { key: Key; label: string; type: 'color' }
  | { key: Key; label: string; type: 'toggle' };

const r = (key: Key, label: string, min: number, max: number, step = 0.01): Control => ({ key, label, type: 'range', min, max, step });
const s = (key: Key, label: string, options: readonly string[]): Control => ({ key, label, type: 'select', options });
const c = (key: Key, label: string): Control => ({ key, label, type: 'color' });
const t = (key: Key, label: string): Control => ({ key, label, type: 'toggle' });

export const SECTIONS: { title: string; open?: boolean; controls: Control[] }[] = [
  {
    title: 'Body', open: true,
    controls: [
      r('height', 'Height (m)', 1.0, 2.3), r('masculinity', 'Masculinity', 0, 1), r('muscle', 'Muscle', 0, 1),
      r('bodyFat', 'Body fat', 0, 1), r('headScale', 'Head scale', 0.85, 2.4), r('shoulderWidth', 'Shoulders', 0.8, 1.35),
      r('hipWidth', 'Hips', 0.8, 1.3), r('armLength', 'Arm length', 0.85, 1.15), r('legLength', 'Leg length', 0.85, 1.15),
      r('neckLength', 'Neck length', 0.6, 1.5), r('handSize', 'Hand size', 0.8, 1.3), r('footSize', 'Foot size', 0.8, 1.3),
    ],
  },
  {
    title: 'Face',
    controls: [
      r('headWidth', 'Head width', 0.85, 1.2), r('jawWidth', 'Jaw width', 0.7, 1.4), r('eyeSize', 'Eye size', 0.6, 2.2),
      r('eyeSpacing', 'Eye spacing', 0.8, 1.2), r('noseSize', 'Nose size', 0.4, 1.6), r('earSize', 'Ear size', 0.6, 1.6),
      s('ears', 'Ears', EARS),
    ],
  },
  { title: 'Hair', open: true, controls: [s('hairStyle', 'Style', HAIR_STYLES), s('facialHair', 'Facial hair', FACIAL_HAIR)] },
  {
    title: 'Outfit', open: true,
    controls: [
      s('top', 'Top', TOPS), s('bottom', 'Bottom', BOTTOMS), s('shoes', 'Shoes', SHOES), s('hat', 'Hat', HATS),
      t('belt', 'Belt'), t('gloves', 'Gloves'),
    ],
  },
  {
    title: 'Colors',
    controls: [
      c('skinColor', 'Skin'), c('hairColor', 'Hair'), c('eyeColor', 'Eyes'), c('topColor', 'Top'),
      c('bottomColor', 'Bottom'), c('shoeColor', 'Shoes'), c('accentColor', 'Accent'),
    ],
  },
  {
    title: 'Output', open: true,
    controls: [
      s('detail', 'Detail', DETAILS), s('pose', 'Pose', POSES), t('flatShading', 'Flat shading'), t('fingers', 'Fingers'),
    ],
  },
];
