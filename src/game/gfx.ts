// The graphics setting. High is the default; Low is the plainer look the game shipped with,
// which is lighter on phones and old computers.

import { prefs } from './save';

export type Quality = 'high' | 'low';

export function quality(): Quality {
  return prefs.get('gfx') === 'low' ? 'low' : 'high';
}

export function setQuality(q: Quality): void {
  prefs.set('gfx', q);
}
