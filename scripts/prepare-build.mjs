// Build during dependency install, but only on a build server.
//
// Cloudflare Workers Builds has two fields — a build command and a deploy
// command — and a project with only the deploy one set installs packages and
// then runs `wrangler deploy` against a dist/ that was never created. Wrangler
// reports "the directory specified by assets.directory does not exist", which
// names the symptom and not the cause. That cost this project four failed
// builds and an evening, because the fix is in a dashboard field rather than
// in the repository where it could be read, reviewed or fixed by anyone.
//
// npm runs `prepare` after `npm ci`, which is exactly what Cloudflare runs. So
// the build happens there and the deploy command cannot skip it, whatever it
// happens to say.
//
// Local installs are left alone: a developer running `npm install` wants
// packages, not a production bundle, and would also need the VITE_ variables
// this checks for.

import { execFileSync } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

// Two signals rather than one. CI is what build servers conventionally set;
// /opt/buildhome is Cloudflare's checkout path, and is here because being
// wrong in the "skip" direction is a deploy that silently ships nothing new.
const onBuildServer = Boolean(process.env.CI) || process.cwd().startsWith('/opt/buildhome')

if (!onBuildServer) {
  console.log('prepare: local install — skipping the production build. Run `npm run build` when you want one.')
  process.exit(0)
}

console.log('prepare: build server detected — checking the environment, then building.')
// Ordered deliberately: a bundle built without the VITE_ variables uploads
// perfectly and then tells every visitor login is not set up. Better to fail
// here, loudly, than to succeed into that.
execFileSync(process.execPath, ['scripts/check-deploy-env.mjs'], { stdio: 'inherit' })
execFileSync(npm, ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' })
console.log('prepare: dist/ is ready for the deploy command.')
