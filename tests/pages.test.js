import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAPS } from '../src/maps.js';

// index.html (Korean) and en/index.html (English) are the same game with different text:
// main.js looks elements up by id, so both pages must keep exactly the same ids and data hooks.
const ko = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const en = readFileSync(new URL('../en/index.html', import.meta.url), 'utf8');
const hooks = html => [...html.matchAll(/\s(id|data-[a-z-]+)="([^"]*)"/g)].map(m => `${m[1]}=${m[2]}`);

test('Korean and English pages share every id and data hook', () => {
  assert.deepEqual(hooks(en), hooks(ko));
  assert.match(ko, /<html lang="ko">/); assert.match(en, /<html lang="en">/);
});

test('English page has no Korean left except the link back to it', () => {
  const text = en.replaceAll('한국어', '').replaceAll('스카이훅', '');
  assert.deepEqual(text.match(/[가-힣]+/g), null);
});

test('both pages point search engines at each other', () => {
  for (const html of [ko, en]) {
    assert.match(html, /hreflang="ko" href="https:\/\/skyhook\.pages\.dev\/"/);
    assert.match(html, /hreflang="en" href="https:\/\/skyhook\.pages\.dev\/en\/"/);
    JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  }
  assert.match(ko, /rel="canonical" href="https:\/\/skyhook\.pages\.dev\/"/);
  assert.match(en, /rel="canonical" href="https:\/\/skyhook\.pages\.dev\/en\/"/);
});

test('every map has English name, tagline and trait', () => {
  for (const m of MAPS) for (const key of ['nameEn', 'taglineEn', 'traitEn']) assert.ok(m[key]?.trim(), `${m.id} is missing ${key}`);
});
