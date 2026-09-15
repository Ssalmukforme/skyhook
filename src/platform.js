// Where the game runs. `npm run build` makes the own-site build ('web': Adsterra banners, Google Fonts).
// `npm run build:crazygames` makes the CrazyGames portal build ('crazygames'): CrazyGames SDK ads and banners,
// progress saved to the player's CrazyGames account, no third-party ads, fonts bundled, relative paths.
export const PLATFORM = import.meta.env?.VITE_PLATFORM === 'crazygames' ? 'crazygames' : 'web';

const sdk = () => globalThis.window?.CrazyGames?.SDK;
let active = false;
// Resolves once the SDK is usable (or is known to be unavailable, e.g. opened outside CrazyGames): the game never waits on a failure.
export const ready = PLATFORM !== 'crazygames' ? Promise.resolve() : (async () => {
  try { await sdk().init(); active = sdk().environment !== 'disabled'; } catch (error) { console.warn('CrazyGames SDK unavailable', error); }
})();
const cg = () => (active ? sdk() : null);
const quiet = fn => { try { return fn(); } catch (error) { console.warn('CrazyGames SDK call failed', error); } };

// Storage: on CrazyGames the data module follows the player's account (guests fall back to localStorage inside the SDK).
export const store = {
  getItem: key => (cg() ? cg().data.getItem(key) : localStorage.getItem(key)),
  setItem: (key, value) => (cg() ? cg().data.setItem(key, value) : localStorage.setItem(key, value)),
};

// Only state changes are reported (pause then home would otherwise send two stops, which the SDK throttles).
let inGameplay = false;
export const gameplayStart = () => { if (inGameplay) return; inGameplay = true; quiet(() => cg()?.game.gameplayStart()); };
export const gameplayStop = () => { if (!inGameplay) return; inGameplay = false; quiet(() => cg()?.game.gameplayStop()); };
export const loadingStart = () => quiet(() => cg()?.game.loadingStart());
export const loadingStop = () => quiet(() => cg()?.game.loadingStop());
export const happytime = () => quiet(() => cg()?.game.happytime());

// A midgame video ad at a natural break. Resolves when the ad ends or fails (the SDK reports its own 3-minute
// frequency cap as an error), so callers just `await` it before continuing. onStart/onEnd mute and unmute the game's audio.
export function midgameAd({ onStart, onEnd } = {}) {
  const s = cg();
  if (!s) return Promise.resolve();
  return new Promise(resolve => {
    let started = false, settled = false;
    const done = () => { if (settled) return; settled = true; if (started) onEnd?.(); resolve(); };
    try { s.ad.requestAd('midgame', { adStarted: () => { started = true; onStart?.(); }, adFinished: done, adError: done }); }
    catch (error) { console.warn('CrazyGames ad request failed', error); done(); }
  });
}

// A rewarded video ad the player chose to watch. Resolves true only when the ad played to the end;
// on adError (or no SDK) it resolves false and the caller must not give the reward.
export function rewardedAd({ onStart, onEnd } = {}) {
  const s = cg();
  if (!s) return Promise.resolve(false);
  return new Promise(resolve => {
    let started = false, settled = false;
    const done = rewarded => { if (settled) return; settled = true; if (started) onEnd?.(); resolve(rewarded); };
    try { s.ad.requestAd('rewarded', { adStarted: () => { started = true; onStart?.(); }, adFinished: () => done(true), adError: () => done(false) }); }
    catch (error) { console.warn('CrazyGames ad request failed', error); done(false); }
  });
}

// SDK banner in a container element (must already have its id and size, and be visible).
export async function requestBanner(id, width, height) {
  await ready;
  const s = cg();
  if (!s) return false;
  try { await s.banner.requestBanner({ id, width, height }); return true; } catch (error) { console.warn('CrazyGames banner failed', error); return false; }
}

// CrazyGames username for the leaderboard name field, when the player is logged in.
export async function playerName() {
  await ready;
  try { return (await cg()?.user.getUser())?.username ?? null; } catch { return null; }
}

// The portal's "mute audio" setting overrides the in-game sound toggle.
export function onMuteSetting(listener) {
  const s = cg();
  if (!s) return;
  const apply = settings => listener(!!settings?.muteAudio);
  apply(s.game.settings);
  quiet(() => s.game.addSettingsChangeListener(apply));
}
