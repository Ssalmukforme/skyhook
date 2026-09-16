// Own site only: the game is free because of the banners, so a blocker stops play until it is off.
// The CrazyGames build must stay playable with a blocker (portal rule), so this compiles away there.
// Both signals must agree, or a school/office network that filters ad domains would look like a blocker:
// extensions hide bait elements with ad-like class names AND refuse the request; a network filter only does the latter.
const OWN_SITE = import.meta.env?.VITE_PLATFORM !== 'crazygames';
const PROBE = OWN_SITE && 'https://www.highrevenueformat.com/c3115059976e3952e944444283e9ec4b/invoke.js';

function baitHidden() {
  const bait = document.createElement('div');
  bait.className = 'adsbox ad-banner pub_300x250 adsbygoogle';
  Object.assign(bait.style, { position: 'absolute', left: '-9999px', top: '0', width: '300px', height: '250px', pointerEvents: 'none' });
  document.body.append(bait);
  const hidden = bait.offsetHeight === 0 || bait.offsetParent === null || getComputedStyle(bait).display === 'none';
  bait.remove();
  return hidden;
}

async function probeBlocked() {
  try { await fetch(PROBE, { mode: 'no-cors', cache: 'no-store' }); return false; } catch { return true; }
}

export async function adblockActive() {
  if (!OWN_SITE) return false;
  return baitHidden() && await probeBlocked();
}
