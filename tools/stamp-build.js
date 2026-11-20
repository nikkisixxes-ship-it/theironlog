#!/usr/bin/env node
// Stamp a release: node tools/stamp-build.js <release-id>
// Sets, in step:
//   - index.html  <meta name="ironlog-build" content="<id>">
//   - index.html  every local script/style link -> "<file>?v=<id>"
//   - version.json {"build":"<id>"}  (what open pages check for updates)
// Run it before every release; a release id must be new each time (for
// example the date plus a letter: 2026-11-20a). Refuses ids with characters
// that would need escaping.
'use strict';
const fs = require('fs'), path = require('path');
const id = process.argv[2];
if (!id || !/^[A-Za-z0-9._-]{1,40}$/.test(id)) { console.error('usage: node tools/stamp-build.js <release-id>  (letters, digits, . _ -)'); process.exit(2); }
const root = path.resolve(__dirname, '..');
const idx = path.join(root, 'index.html');
let html = fs.readFileSync(idx, 'utf8');
if (!/<meta name="ironlog-build" content="[^"]*">/.test(html)) { console.error('index.html has no <meta name="ironlog-build">'); process.exit(1); }
html = html.replace(/<meta name="ironlog-build" content="[^"]*">/, '<meta name="ironlog-build" content="' + id + '">');
let n = 0;
html = html.replace(/(<script\b[^>]*\bsrc="|<link\b[^>]*\bhref=")([^"]+)(")/g, (m, a, url, z) => {
  if (/^(https?:)?\/\//.test(url) || /^data:/.test(url)) return m;          // other sites: unchanged
  const file = url.split('?')[0];
  if (!/\.(js|css)$/.test(file)) return m;
  n++; return a + file + '?v=' + id + z;
});
fs.writeFileSync(idx, html);
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ build: id }) + '\n');
console.log('stamped ' + n + ' local scripts/styles and version.json with ' + id);
