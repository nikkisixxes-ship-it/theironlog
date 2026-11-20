# Release folders (do not edit)

Each folder here, `releases/<release-id>/`, holds the exact scripts and styles of one published release of IRON LOG, plus `MANIFEST.json` (SHA-256 of each file). `index.html` loads its files only from its own release's folder.

## Rules
- **Never change a published folder.** `tools/stamp-build.js` refuses to reuse a release id. A new release always gets a new folder.
- **Edit code in `src/`**, then publish with `node tools/stamp-build.js <new-id>`.
  - The id must be new each time, for example `2026-11-21a`.
  - Commit `index.html`, `version.json` and the new `releases/<id>/` together.
- **The `.js`/`.css` files at the top level are frozen copies of `cd84dd0`.** That was the live release before release folders existed. They are kept so a page still open or cached on that version gets matching files. Don't edit them.

## Keeping old releases
- A page needs its release folder while it is loading. That includes a page reopened from a browser's saved copy: GitHub Pages lets browsers keep a page for up to 10 minutes, and a phone may reopen a saved page later than that.
- The app loads all its files when it starts. It fetches no more app files later.
- **Keep every release for at least 30 days, and always keep the last 5.** Each release is about 2 MB.
- After that, older folders may be deleted in a normal commit. Never delete the folder named in the current `version.json`.
- The frozen top-level files may be deleted once 30 days have passed since the first release-folder release went live.
