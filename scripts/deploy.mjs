#!/usr/bin/env node
// Publishes one release channel to the gh-pages branch, leaving the others alone.
//   node scripts/deploy.mjs --channel beta     → <site>/beta/  (any commit)
//   node scripts/deploy.mjs --channel stable   → <site>/       (release tags only)
// Options: --no-push (commit to the local gh-pages branch only), --remote <name>,
// --force (deploy with uncommitted changes, or stable from an untagged commit).
// GitHub Actions runs this for every push to main (beta) and every v* tag (stable).
import { mkdtempSync, rmSync, readdirSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { ROOT, CHANNELS, build, versionInfo, git } from './build.mjs';

const BRANCH = 'gh-pages';
const { values: opt } = parseArgs({
  options: {
    channel: { type: 'string', default: 'beta' },
    remote: { type: 'string', default: 'origin' },
    'no-push': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
});
const fail = msg => { console.error(`deploy: ${msg}`); process.exit(1); };
// gh-pages holds build output byte for byte: no line-ending conversion on
// checkout or commit, whatever core.autocrlf says.
const run = (args, cwd = ROOT) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

const cfg = CHANNELS[opt.channel];
if (!cfg) fail(`unknown channel "${opt.channel}" (use ${Object.keys(CHANNELS).join(' or ')})`);
const info = versionInfo();
if (info.dirty && !opt.force) fail('you have uncommitted changes; commit them first (or pass --force)');
if (opt.channel === 'stable' && !info.released && !opt.force) {
  fail(`stable only deploys release tags, and HEAD is ${info.tag ?? 'untagged'} (package.json: ${info.pkgVersion}).\n`
    + 'Cut a release with: npm run release -- patch');
}

const tmp = mkdtempSync(join(tmpdir(), 'receipt-deploy-'));
const out = join(tmp, 'site'), wt = join(tmp, 'pages');
let worktree = false;
try {
  const r = build({ channel: opt.channel, out });

  // Check out gh-pages in a temporary worktree: the remote branch if there is
  // one, else a local one, else start it as an orphan branch.
  run(['worktree', 'prune']);
  if (git('ls-remote', '--exit-code', '--heads', opt.remote, BRANCH) !== null) {
    run(['fetch', '--quiet', opt.remote, `+refs/heads/${BRANCH}:refs/remotes/${opt.remote}/${BRANCH}`]);
    run(['worktree', 'add', '--quiet', '-B', BRANCH, wt, `${opt.remote}/${BRANCH}`]);
  } else if (git('rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`)) {
    run(['worktree', 'add', '--quiet', wt, BRANCH]);
  } else {
    run(['worktree', 'add', '--quiet', '--detach', wt]);
    run(['checkout', '--quiet', '--orphan', BRANCH], wt);
    run(['rm', '-r', '-f', '--quiet', '.'], wt);
  }
  worktree = true;

  // Replace this channel's files. Stable sits at the root, so it keeps the
  // other channels' folders.
  const target = join(wt, cfg.path);
  if (cfg.path) rmSync(target, { recursive: true, force: true });
  else {
    const keep = new Set(['.git', '.nojekyll', ...Object.values(CHANNELS).map(c => c.path.split('/')[0]).filter(Boolean)]);
    for (const f of readdirSync(wt)) if (!keep.has(f)) rmSync(join(wt, f), { recursive: true, force: true });
  }
  cpSync(out, target, { recursive: true });
  writeFileSync(join(wt, '.nojekyll'), '');

  run(['add', '--all'], wt);
  if (git('-C', wt, '-c', 'core.autocrlf=false', 'diff', '--cached', '--quiet') !== null) {
    console.log(`deploy: ${opt.channel} is already at v${r.version}, nothing to publish`);
  } else {
    run(['commit', '--quiet', '-m', `${opt.channel}: v${r.version}`, '-m', `Built from ${info.commit}.`], wt);
    if (opt['no-push']) console.log(`deploy: committed ${opt.channel} v${r.version} to local ${BRANCH} (not pushed)`);
    else {
      run(['push', '--quiet', opt.remote, `${BRANCH}:${BRANCH}`], wt);
      console.log(`deploy: published ${opt.channel} v${r.version}${siteUrl() ? ` → ${siteUrl()}${cfg.path}` : ''}`);
      pagesHint();
    }
  }
} catch (e) {
  console.error(`deploy: ${e.message}`);
  process.exitCode = 1; // not process.exit(): the worktree still has to be removed
} finally {
  if (worktree) git('worktree', 'remove', '--force', wt);
  rmSync(tmp, { recursive: true, force: true });
}

function repo() {
  const m = (git('remote', 'get-url', opt.remote) || '').match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m && { owner: m[1], name: m[2] };
}

function siteUrl() {
  const r = repo();
  if (!r) return '';
  const host = `${r.owner.toLowerCase()}.github.io`;
  return r.name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${r.name}/`;
}

// Pages must serve the gh-pages branch; say how to switch if it doesn't.
function pagesHint() {
  const r = repo();
  if (!r) return;
  let source;
  try {
    source = JSON.parse(execFileSync('gh', ['api', `repos/${r.owner}/${r.name}/pages`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).source;
  } catch { return; } // no gh CLI, not logged in, or Pages not enabled yet
  if (source?.branch === BRANCH && source.path === '/') return;
  console.log(`\nGitHub Pages is serving ${source?.branch ?? '?'}${source?.path ?? ''}, not ${BRANCH}/. Switch it once in Settings → Pages, or:\n`
    + `  gh api -X PUT repos/${r.owner}/${r.name}/pages -f "source[branch]=${BRANCH}" -f "source[path]=/"`);
}
