/**
 * All animation clips, in the order the app and exporters list them.
 * Each set lives in its own module; add new sets as new files and list them here.
 */
import { type Clip } from './types';
import { strafe, turn } from './gait';
import { crouch, idle, run, walk, walkBack } from './basic';
import { fall, hit, jump, jumpAir, jumpLand, jumpRunning, jumpStart, punch } from './actions';
import { cheer, cry, laugh, wave } from './emotes';
import { PISTOL, RIFLE } from './shooter';
import { MELEE } from './melee';
import { VEHICLES } from './vehicles';
import { REACTIONS } from './reactions';
import { withFaces } from './faces';
export * from './types';

export const CLIPS: Clip[] = withFaces([
  idle,
  crouch,
  walk,
  run,
  walkBack,
  strafe(true),
  strafe(false),
  jump,
  jumpStart,
  jumpAir,
  jumpLand,
  jumpRunning,
  fall,
  punch,
  hit,
  ...REACTIONS,
  wave,
  cheer,
  laugh,
  cry,
  turn('turn_left_45', 'Turn left 45°', 45),
  turn('turn_left_90', 'Turn left 90°', 90),
  turn('turn_right_45', 'Turn right 45°', -45),
  turn('turn_right_90', 'Turn right 90°', -90),
  turn('turn_360', 'Full turn 360°', 360),
  ...PISTOL,
  ...MELEE,
  ...RIFLE,
  ...VEHICLES,
]);

export const clipById = new Map(CLIPS.map((c) => [c.id, c]));
