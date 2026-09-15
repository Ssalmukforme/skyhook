// Adsterra banners, one snippet per size. Paste the whole "Get code" snippet between the backticks;
// an empty `code` means no ad and no reserved space. These snippets are public (they end up in the page anyway).
// `mobile` is used on screens up to 600px wide; `media` limits a slot to screens matching that query.
const BANNER_468 = `<script>
  atOptions = { 'key' : 'c3115059976e3952e944444283e9ec4b', 'format' : 'iframe', 'height' : 60, 'width' : 468, 'params' : {} };
</script>
<script src="https://www.highrevenueformat.com/c3115059976e3952e944444283e9ec4b/invoke.js"></script>`;
const BANNER_320 = `<script>
  atOptions = { 'key' : '361e3a41d2db0f8333a0a795167fae63', 'format' : 'iframe', 'height' : 50, 'width' : 320, 'params' : {} };
</script>
<script src="https://www.highrevenueformat.com/361e3a41d2db0f8333a0a795167fae63/invoke.js"></script>`;
const BANNER_300 = `<script>
  atOptions = { 'key' : '413a2673314b9f5283878a2effed1f02', 'format' : 'iframe', 'height' : 250, 'width' : 300, 'params' : {} };
</script>
<script src="https://www.highrevenueformat.com/413a2673314b9f5283878a2effed1f02/invoke.js"></script>`;
const BANNER_160 = `<script>
  atOptions = { 'key' : '263a566d4e99592040d5fa96a8fccf4c', 'format' : 'iframe', 'height' : 600, 'width' : 160, 'params' : {} };
</script>
<script src="https://www.highrevenueformat.com/263a566d4e99592040d5fa96a8fccf4c/invoke.js"></script>`;

export const AD_SLOTS = {
  // Start menu, in the top bar (under it on phones).
  menu: { width: 468, height: 60, code: BANNER_468, mobile: { width: 320, height: 50, code: BANNER_320 } },
  // Pause dialog.
  pause: { width: 300, height: 250, code: BANNER_300 },
  // Result screen, under the time.
  result: { width: 468, height: 60, code: BANNER_468, mobile: { width: 320, height: 50, code: BANNER_320 } },
  // During a run on phones: right under the touch pads. Nothing on wider screens.
  play: { width: 0, height: 0, code: ``, mobile: { width: 320, height: 50, code: BANNER_320 } },
  // Wide screens: one skyscraper over each side of the full-screen game (menu and HUD text move inward past them).
  side: { width: 160, height: 600, code: BANNER_160, media: '(min-width: 1440px) and (min-height: 680px)' },
};
