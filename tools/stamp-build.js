#!/usr/bin/env node
// Publish a release: node tools/stamp-build.js <release-id>
//
// WHAT IT DOES
//   1. Copies every local script/style that index.html loads, from src/, into
//      a NEW folder releases/<release-id>/ (plus MANIFEST.json with each
//      file's SHA-256). A release folder is IMMUTABLE: if it already exists
//      the tool stops (choose a new id) -- it never changes or deletes a
//      published release.
//   2. Points index.html at that folder ("releases/<id>/app-core.js", ...)
//      and sets <meta name="ironlog-build" content="<id>">.
//   3. Writes version.json {"build":"<id>"} -- what open pages check.
//   4. Checks the result: every reference resolves to a file in the new
//      folder whose bytes match its MANIFEST entry and src/.
//
// WHY: a page always loads the files of its OWN release, even if its HTML
// came from a browser cache and the next release went live meanwhile
// (a query string like app-core.js?v=A would still fetch today's file).
//
// RETENTION: releases/<id>/ folders are kept. Never edit or delete the
// current or recent ones (see releases/README.md for when old ones may go).
// The .js/.css files at the top level are frozen copies of the release that
// was live before release folders existed (cd84dd0), kept for pages still
// open on it; edit code in src/ only.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const id = process.argv[2];
const root = path.resolve(process.argv[3] || path.join(__dirname, '..'));
const die = m => { console.error('stamp-build: ' + m); process.exit(1); };
if (!id || !/^[A-Za-z0-9._-]{1,40}$/.test(id)) { console.error('usage: node tools/stamp-build.js <release-id>   (letters, digits, . _ -; new for every release)'); process.exit(2); }
const idxPath = path.join(root, 'index.html'), srcDir = path.join(root, 'src'), relDir = path.join(root, 'releases', id);
if (fs.existsSync(relDir)) die('releases/' + id + ' already exists. Published releases are never changed -- use a new release id.');
let html = fs.readFileSync(idxPath, 'utf8');
if (!/<meta name="ironlog-build" content="[^"]*">/.test(html)) die('index.html has no <meta name="ironlog-build">');

// Local script/style references (other sites are left alone).
const REF = /(<script\b[^>]*\bsrc="|<link\b[^>]*\bhref=")([^"]+)(")/g;
const files = [];
html.replace(REF, (m, a, url) => {
  if (/^(https?:)?\/\//.test(url) || /^data:/.test(url)) return m;
  const base = path.basename(url.split('?')[0]);
  if (!/\.(js|css)$/.test(base)) return m;
  if (!files.includes(base)) files.push(base);
  return m;
});
if (!files.length) die('index.html references no local scripts/styles');
for (const f of files) if (!fs.existsSync(path.join(srcDir, f))) die('src/' + f + ' is missing');

// 1. The immutable release folder.
fs.mkdirSync(relDir, { recursive: true });
const manifest = { build: id, files: {} };
for (const f of files) {
  const buf = fs.readFileSync(path.join(srcDir, f));
  fs.writeFileSync(path.join(relDir, f), buf);
  manifest.files[f] = crypto.createHash('sha256').update(buf).digest('hex');
}
fs.writeFileSync(path.join(relDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');

// 2. index.html -> this release's folder.
html = html.replace(/<meta name="ironlog-build" content="[^"]*">/, '<meta name="ironlog-build" content="' + id + '">');
html = html.replace(REF, (m, a, url, z) => {
  if (/^(https?:)?\/\//.test(url) || /^data:/.test(url)) return m;
  const base = path.basename(url.split('?')[0]);
  if (!/\.(js|css)$/.test(base)) return m;
  return a + 'releases/' + id + '/' + base + z;
});
fs.writeFileSync(idxPath, html);
// 3. What open pages check.
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ build: id }) + '\n');

// 4. Verify.
const out = fs.readFileSync(idxPath, 'utf8');
let n = 0;
out.replace(REF, (m, a, url) => {
  if (/^(https?:)?\/\//.test(url) || /^data:/.test(url)) return m;
  if (!/\.(js|css)$/.test(url)) return m;
  if (url.indexOf('releases/' + id + '/') !== 0) die('reference not in this release: ' + url);
  const f = path.join(root, url), base = path.basename(url);
  const h = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  if (h !== manifest.files[base]) die('checksum mismatch: ' + url);
  n++; return m;
});
console.log('Release ' + id + ': ' + n + ' scripts/styles copied to releases/' + id + '/, index.html and version.json updated.');
console.log('Commit index.html, version.json and releases/' + id + '/ together. Keep earlier releases/ folders.');
