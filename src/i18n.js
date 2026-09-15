// Two languages, two pages: / is Korean and /en/ is English. The page's <html lang> picks the language,
// so each URL always shows (and gets indexed in) one language. Strings live next to their use as t(ko, en).
export const LANG = globalThis.document?.documentElement.lang === 'en' ? 'en' : 'ko';
export const t = (ko, en) => (LANG === 'en' ? en : ko);

// Map display text: maps.js keeps the Korean fields plus nameEn / taglineEn / traitEn.
export function localizeMaps(maps) {
  if (LANG !== 'en') return;
  for (const m of maps) Object.assign(m, { name: m.nameEn, tagline: m.taglineEn, trait: m.traitEn, en: `DISTRICT ${m.no}` });
}
