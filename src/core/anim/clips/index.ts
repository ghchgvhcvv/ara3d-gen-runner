/**
 * All animation clips, in the order the app and exporters list them.
 * Each set lives in its own module; add new sets as new files and list them here.
 */
import { type Clip } from './types';
import { turn } from './gait';
import { crouch, idle, walkBack } from './basic';
import { fall, hit, jumpAir, jumpLand, jumpRunning, jumpStart, punch } from './actions';
import { cheer, laugh, wave } from './emotes';
import { PISTOL, RIFLE } from './shooter';
import { MELEE } from './melee';
import { VEHICLES } from './vehicles';
import { REACTIONS } from './reactions';
import { withFaces } from './faces';
import { MOCAP_DATA } from './mocap-data';
import { clipFromMocap } from '../mocap';
export * from './types';

/** Motion-captured clips (CMU, see clips/mocap-data.ts); the rest are keyframed. */
const mocap = (id: string, name: string, category: Clip['category']): Clip => clipFromMocap(MOCAP_DATA[id], { id, name, category });

export const CLIPS: Clip[] = withFaces(
  [
    idle,
    crouch,
    mocap('walk', 'Walk', 'Locomotion'),
    mocap('run', 'Run', 'Locomotion'),
    walkBack,
    mocap('strafe_left', 'Strafe left', 'Locomotion'),
    mocap('strafe_right', 'Strafe right', 'Locomotion'),
    mocap('jump', 'Jump', 'Actions'),
    jumpStart,
    jumpAir,
    jumpLand,
    jumpRunning,
    fall,
    punch,
    mocap('punch_low', 'Low punch', 'Actions'),
    hit,
    ...REACTIONS,
    wave,
    cheer,
    laugh,
    mocap('cry', 'Cry', 'Emotes'),
    turn('turn_left_45', 'Turn left 45°', 45),
    turn('turn_left_90', 'Turn left 90°', 90),
    turn('turn_right_45', 'Turn right 45°', -45),
    turn('turn_right_90', 'Turn right 90°', -90),
    turn('turn_360', 'Full turn 360°', 360),
    ...PISTOL,
    ...MELEE,
    ...RIFLE,
    ...VEHICLES,
  ],
);

export const clipById = new Map(CLIPS.map((c) => [c.id, c]));
