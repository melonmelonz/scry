import { Store } from '../store.js';

export const gamePcStore = new Store({
  follow: true,
  running: false,
  liveAddress: null,
  label: 'IDLE',
  mode: 'ARM',
  inCart: false,
  offset: null,
  mirrored: false,
  trail: [],
  ts: 0,
});

export function publishGamePc(patch) {
  gamePcStore.update({ ...patch, ts: performance.now() });
}
