/** Services shared by the UI modules. */
import type { AssetLibrary, Catalog } from '../../core/assets';
import type { Engine } from '../engine';
import type { Viewer } from '../viewer';
import type { Store } from './store';

export interface Ctx {
  lib: AssetLibrary;
  cat: Catalog;
  viewer: Viewer;
  engine: Engine;
  store: Store;
  /** Resolves once no build is running (so exports and shares match the controls). */
  whenIdle(): Promise<void>;
  /** Play a clip in the viewer (set by the animation bar once it exists). */
  playClip(id: string): void;
}
