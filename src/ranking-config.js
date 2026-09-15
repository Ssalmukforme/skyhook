// Public client settings for the shared ssalmuk_ranking Supabase project. Publishable keys are meant to
// ship in browser bundles (access is limited by RLS and the two RPCs), so they live in the repo and every
// build, including Cloudflare Pages builds without a .env, can reach the leaderboard.
// VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY still override these to point a build elsewhere.
export const SUPABASE_URL = 'https://hneuvqrgbyqlfixmuyhk.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_J9wm77W2Nd9JHlBmirE8cA_WmcxCK-N';
