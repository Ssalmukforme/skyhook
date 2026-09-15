import { AD_SLOTS } from './ads-config.js';
import { t } from './i18n.js';
import { PLATFORM, requestBanner } from './platform.js';

// Each banner runs in its own iframe, so Adsterra's global `atOptions` of one slot never clobbers another
// and the ad script cannot touch the game page. A slot loads when its screen becomes visible
// (hidden screens never intersect), and reloads at most once a minute when the screen is shown again,
// so a banner never reloads in the middle of a run.
// `?ads-preview` in the URL draws dashed boxes for slots that have no code yet, to check the layout.
const preview = new URLSearchParams(location.search).has('ads-preview');
const RELOAD_MS = 60_000;
const narrow = matchMedia('(max-width: 600px)');
const loaded = new WeakMap();
// CrazyGames allows SDK banners only on screens players stay on, never during a run: the menu and the result screen.
const PORTAL_SLOTS = new Set(['menu', 'result']);
let bannerCount = 0;

function unitFor(name) {
  const slot = AD_SLOTS[name];
  if (!slot || (slot.media && !matchMedia(slot.media).matches)) return null;
  if (PLATFORM === 'crazygames' && !PORTAL_SLOTS.has(name)) return null;
  const unit = narrow.matches && slot.mobile ? slot.mobile : slot;
  if (!unit.width) return null;
  // A desktop banner never squeezes onto a phone: without a mobile unit the slot stays empty there.
  if (narrow.matches && !slot.mobile && unit.width > innerWidth - 32) return null;
  if (PLATFORM === 'crazygames') return unit;
  return unit.code.trim() || preview ? unit : null;
}

function frame({ width, height, code }) {
  const iframe = document.createElement('iframe');
  Object.assign(iframe, { width, height, title: t('광고', 'Advertisement'), scrolling: 'no' });
  iframe.setAttribute('frameborder', '0');
  iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body>${code}</body></html>`;
  return iframe;
}

function fill(slot) {
  const unit = unitFor(slot.dataset.ad), size = unit ? `${unit.width}x${unit.height}` : '';
  const last = loaded.get(slot);
  if (last && last.size === size && performance.now() - last.at < RELOAD_MS) return;
  slot.replaceChildren();
  slot.classList.toggle('filled', !!unit);
  if (!unit) { loaded.delete(slot); slot.style.removeProperty('--ad-w'); slot.style.removeProperty('--ad-h'); return; }
  slot.style.setProperty('--ad-w', `${unit.width}px`); slot.style.setProperty('--ad-h', `${unit.height}px`);
  if (PLATFORM === 'crazygames') {
    // The SDK fills a container it finds by id; if no banner comes back the slot collapses again.
    const box = Object.assign(document.createElement('div'), { id: `cg-banner-${++bannerCount}` });
    Object.assign(box.style, { width: `${unit.width}px`, height: `${unit.height}px` }); slot.append(box);
    // The SDK refuses containers that are not fully on screen yet, so wait for the screen to finish appearing.
    const collapse = () => { if (box.isConnected) { slot.replaceChildren(); slot.classList.remove('filled'); loaded.delete(slot); } };
    setTimeout(() => {
      if (!box.isConnected || !slot.checkVisibility({ opacityProperty: true })) { collapse(); return; }
      requestBanner(box.id, unit.width, unit.height).then(ok => { if (!ok) collapse(); });
    }, 600);
  } else if (unit.code.trim()) slot.append(frame(unit));
  else slot.append(Object.assign(document.createElement('span'), { className: 'ad-placeholder', textContent: `AD ${size}` }));
  loaded.set(slot, { size, at: performance.now() });
}

// Side skyscrapers float over the edges of the game; body.side-ads moves the menu and HUD text inward past them.
function updateSideMargins() { document.body.classList.toggle('side-ads', !!unitFor('side')); }

// Clicking a banner moves keyboard focus into its iframe, which would swallow A/D/Enter/Esc.
// Hand focus back to the game when the pointer leaves the ad or the player returns from the ad's tab.
function releaseFocus() {
  const active = document.activeElement;
  if (active?.tagName === 'IFRAME' && active.closest('.ad-slot')) { active.blur(); window.focus(); }
}

const slots = [...document.querySelectorAll('.ad-slot[data-ad]')];
const observer = new IntersectionObserver(entries => entries.forEach(e => e.isIntersecting && fill(e.target)));
slots.forEach(slot => { observer.observe(slot); slot.addEventListener('pointerleave', releaseFocus); });
document.addEventListener('visibilitychange', releaseFocus);
updateSideMargins();
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { updateSideMargins(); slots.forEach(slot => { if (slot.checkVisibility()) fill(slot); }); }, 200);
});
