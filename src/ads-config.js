// Adsterra banners. In the Adsterra publisher dashboard: Websites → add skyhook.pages.dev → create a
// Banner ad unit of the size below → "Get code", then paste the whole snippet between the backticks.
// An empty `code` means no ad and no reserved space. These snippets are public (they end up in the page anyway).
// Ads are only shown on the start menu, the pause dialog and the result screen, never during a run.
export const AD_SLOTS = {
  // Start menu, bottom centre above the footer. `mobile` is used on screens narrower than 600px.
  menu: { width: 468, height: 60, code: ``, mobile: { width: 320, height: 50, code: `` } },
  // Pause dialog.
  pause: { width: 300, height: 250, code: `` },
  // Result screen, under the time.
  result: { width: 468, height: 60, code: ``, mobile: { width: 320, height: 50, code: `` } },
};
