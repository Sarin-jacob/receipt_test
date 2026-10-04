#!/usr/bin/env node
// Cuts a stable release: sets the version in package.json, adds a CHANGELOG.md
// section, commits, tags vX.Y.Z and pushes. GitHub Actions then deploys the tag
// to the stable channel and creates the GitHub release.
//   npm run release -- patch|minor|major|X.Y.Z [--yes] [--no-push]
//   node scripts/release.mjs notes vX.Y.Z    prints that version's changelog section
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { ROOT, git } from './build.mjs';

const PKG = join(ROOT, 'package.json'), LOG = join(ROOT, 'CHANGELOG.md');
const args = process.argv.slice(2);
const fail = msg => { console.error(`release: ${msg}`); process.exit(1); };
const sh = (...a) => execFileSync('git', a, { cwd: ROOT, stdio: 'inherit' });
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const heading = tag => new RegExp(`^## ${esc(tag)}(?![\\w.-])[^\\n]*\\n`, 'm');

if (args[0] === 'notes') {
  const tag = args[1] || fail('usage: release.mjs notes vX.Y.Z');
  const log = existsSync(LOG) ? readFileSync(LOG, 'utf8').replace(/\r\n/g, '\n') : '';
  const m = heading(tag).exec(log);
  const body = m ? log.slice(m.index + m[0].length).split(/^## /m)[0].trim() : '';
  process.stdout.write((body || `Release ${tag}.`) + '\n');
  process.exit(0);
}

const bump = args.find(a => !a.startsWith('-'));
if (!bump) fail('usage: npm run release -- patch|minor|major|X.Y.Z [--yes] [--no-push]');
const push = !args.includes('--no-push');

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') fail(`releases are cut from main, and you're on ${branch}`);
if (git('status', '--porcelain', '--untracked-files=no')) fail('commit or stash your changes first');
if (push) {
  if (git('fetch', '--quiet', '--tags', 'origin', 'main') === null) fail('could not fetch origin');
  const behind = +git('rev-list', '--count', 'HEAD..origin/main');
  if (behind) fail(`main is ${behind} commit(s) behind origin/main; pull first`);
}

const pkgText = readFileSync(PKG, 'utf8');
const current = JSON.parse(pkgText).version;
const [major, minor, patch] = current.split('.').map(Number);
const next = /^\d+\.\d+\.\d+$/.test(bump) ? bump
  : bump === 'major' ? `${major + 1}.0.0`
  : bump === 'minor' ? `${major}.${minor + 1}.0`
  : bump === 'patch' ? `${major}.${minor}.${patch + 1}`
  : fail(`"${bump}" is not patch, minor, major or a version like 1.4.0`);
const tag = `v${next}`;
const last = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*');
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
if (git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`)) fail(`${tag} already exists`);
if (last && !newer(next, last.slice(1))) fail(`${tag} is not newer than ${last}`);

// Changelog: keep a section that's already written for this version (just date
// it); otherwise list the commit subjects since the last release.
const today = new Date().toLocaleDateString('sv'); // YYYY-MM-DD, local time
const oldLog = existsSync(LOG) ? readFileSync(LOG, 'utf8').replace(/\r\n/g, '\n') : '# Changelog\n';
let newLog;
const existing = heading(tag).exec(oldLog);
if (existing) {
  newLog = /\d{4}-\d\d-\d\d/.test(existing[0]) ? oldLog : oldLog.replace(heading(tag), `## ${tag} (${today})\n`);
} else {
  const subjects = (git('log', '--no-merges', '--format=%s', last ? `${last}..HEAD` : 'HEAD') || '')
    .split('\n').filter(s => s && !s.startsWith('release: '));
  if (last && !subjects.length) fail(`nothing to release: no commits since ${last}`);
  const section = `## ${tag} (${today})\n\n${subjects.map(s => `- ${s}`).join('\n')}\n\n`;
  const at = oldLog.search(/^## /m);
  newLog = at < 0 ? `${oldLog.trimEnd()}\n\n${section}` : oldLog.slice(0, at) + section + oldLog.slice(at);
}

writeFileSync(PKG, pkgText.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`));
writeFileSync(LOG, newLog);
const restore = () => { writeFileSync(PKG, pkgText); if (existsSync(LOG)) writeFileSync(LOG, oldLog); };

console.log(`\nRelease ${tag}${last ? ` (previous: ${last})` : ' (first release)'}`);
console.log(`  package.json   ${current} → ${next}`);
console.log(`  CHANGELOG.md   ${existing ? 'uses the section already written' : 'new section from commit subjects'}; edit it now if you like`);
console.log(`Then: commit "release: ${tag}", tag ${tag}${push ? ', push main and the tag to origin' : ' (not pushed)'}.`);
if (push) console.log('GitHub Actions deploys the tag to the stable channel and creates the GitHub release.');

if (!args.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('\nContinue? [y/N] ')).trim().toLowerCase();
  rl.close();
  if (answer !== 'y' && answer !== 'yes') { restore(); fail('cancelled; nothing changed'); }
}

try {
  sh('add', 'package.json', 'CHANGELOG.md');
  if (git('diff', '--cached', '--quiet') === null) sh('commit', '--quiet', '-m', `release: ${tag}`);
  sh('tag', '-a', tag, '-m', tag);
} catch {
  fail('commit or tag failed; see the git output above');
}
if (!push) {
  console.log(`\nTagged ${tag} locally. Publish with: git push --atomic origin main ${tag}`);
  process.exit(0);
}
try {
  sh('push', '--atomic', 'origin', 'main', `refs/tags/${tag}`);
} catch {
  fail(`push failed; ${tag} is tagged locally. Retry with: git push --atomic origin main ${tag}`);
}
console.log(`\nReleased ${tag}. Deploy progress: https://github.com/${(git('remote', 'get-url', 'origin') || '').match(/github\.com[:/](.+?)(?:\.git)?$/)?.[1] ?? '<owner>/<repo>'}/actions`);
