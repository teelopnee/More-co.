# More-co.

One repo for all of the owner's apps and design docs. The owner works from a tablet, phone or
computer and writes in Thai; reply in Thai.

## Layout

- `apps/<name>/`: one self-contained app per folder (own package.json, lockfile, tests, README).
  - `apps/jodwai/`: จดไว, React + Vite PWA that reads Thai bank slips on-device. See its README.
  - `apps/sunset-cove/`: อ่าวสนธยา, a single-file three.js sailing game (plain HTML, no build).
    It began as an artifact page and calls `window.claude?.hot` only when present; keep the
    doctype/charset/viewport tags and the `[hidden] { display: none !important; }` rule.
- `docs/*.md`: design docs. `docs/odd-space-gdd.md` is the source of truth for the ODD-SPACE
  game (Godot 4); `docs/originals/*.docx` is a frozen copy, do not edit it.
- `scripts/build-site.mjs`: installs, tests and builds every app into `_site/` and writes the
  home page. `--skip-tests`, `--only=a,b`.
- `.github/workflows/ci.yml` + `.github/scripts/automerge.sh`: CI, auto-merge and publishing.

## What happens when you push

Every push runs `node scripts/build-site.mjs` (all tests of all apps). On `claude/*` and `ccr-*`
branches that pass, CI merges the branch into `main` by itself and `main` is published to
GitHub Pages at `https://teelopnee.github.io/More-co./<app>/`.

So a push is a release:

- Run the app's tests and build (or `node scripts/build-site.mjs`) before pushing.
- Only push work that is finished and working; there is no review step before it goes live.
- After pushing, check the run in Actions. If the auto-merge job fails (merge conflict with newer
  `main`, tests failing after the merge, or changes under `.github/workflows/`, which the built-in
  token may not push), tell the owner and offer to open a PR or rebase onto `main`.
- The repository variable `AUTO_MERGE=off` turns auto-merge off; then open a PR as usual.

## Adding an app

Create `apps/<name>/`; CI picks it up with no config change.

- With package.json: `npm ci`, `npm test` if defined, `npm run build`; `dist/` is published
  (override with `"output"` in `app.json`). Vite apps need `base: './'`.
- Without package.json: the folder is published as-is.
- The home-page card uses the README's first `#` heading and first paragraph, or `app.json`
  `title` / `description` / `icon`.
- Every app is served from a sub-path, so all URLs must be relative. Pages need
  `<!doctype html>`, `<meta charset="utf-8">` and a viewport meta (the owner mostly uses a
  tablet).

Large binary projects (e.g. a Godot project with generated 3D/audio assets) should get their own
repository with Git LFS rather than living here; ask the owner first.
