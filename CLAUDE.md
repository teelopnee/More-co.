# More-co.

One repo for all of the owner's apps and design docs. The owner works from a tablet, phone or
computer and writes in Thai; reply in Thai.

## Layout

- `apps/<name>/`: one self-contained app per folder (own package.json, lockfile, tests, README).
  - `apps/jodwai/`: จดไว, React + Vite PWA that reads Thai bank slips on-device. See its README.
  - `apps/sunset-cove/`: อ่าวสนธยา, a single-file three.js sailing game (plain HTML, no build).
    It began as an artifact page and calls `window.claude?.hot` only when present; keep the
    doctype/charset/viewport tags and the `[hidden] { display: none !important; }` rule.
  - `apps/paewai/`: แปะไว้, a no-dependency PWA "brain dump" for the Samsung tablet (Edge panel +
    pop-up window), phones and iPhone. Thai natural-language dates in `src/lib/dates.js`; `npm test`,
    `npm run build`. Sync goes through the owner's own private GitHub repo (`src/lib/sync.js`,
    `src/lib/github.js`; token stored per device, never in the data or this repo). "ถาม Claude" works
    without a key by copy and paste: `src/lib/claude.js` writes the prompt (data, question, how to answer:
    a ```แปะไว้ block of "งาน:/โน้ต:/ซื้อ:/จ่าย:" lines; recordings under fixed ## headings) and
    `readPasted()` reads the pasted answer. The owner does not use an API key; the bundled official SDK
    in `src/vendor/anthropic.js` stays as an optional path.
    `src/vendor/` holds pre-bundled third-party code; regenerate it as the app README says.
    Voice notes (`src/lib/voice.js`, IndexedDB) are transcribed by the device's own speech recognition
    (optionally the owner's Gemini/OpenAI key; Claude takes no audio). They are summarized on the device
    with no AI (`src/lib/summarize.js`: TextRank/TextTiling + Thai meeting-note rules, a template per
    kind of recording, deletion-only node labels; tested against `tests/fixtures/*.txt`) into mind maps
    (`src/lib/mindmap.js`, `src/mapview.js`; nodes may carry `at` ms to play from); Claude is optional.
    Recordings keep bookmarks (`marks`, ms) and word times (`times`, [char offset, ms]); when the state
    outgrows localStorage it moves to IndexedDB (`paewai-state`, flag key `paewai:v1:idb`).
    Notes are cards on a board (`src/lib/notes.js`; still the `memos` list): title, colour, labels,
    checklist (`list: true`, lines "[ ] x" / "[x] y"), archive, a 7-day bin, and pictures. A note holds
    only `images: [{ id, w, h }]`; the files live in IndexedDB (`src/lib/media.js`, `paewai-media`) and
    in the sync repo as `media/<id>.jpg|png`, sent after the JSON so a picture there always has its note.
    The font is Sarabun, shipped in `src/fonts/` (OFL).
  - `apps/paewai-notch/`: the same แปะไว้ as an Android app (Java, Gradle in `android/`) with a pill
    over the camera notch (accessibility overlay) and a drop-down panel; it bundles `../paewai/src`
    into the APK, so web changes ship in both. It also records voice natively (`RecorderService`,
    foreground microphone service; Quick Settings tile and an "อัดเสียง" launcher icon for the side key). `npm run build` needs Java 17+ and `ANDROID_HOME`
    (CI has both; without an SDK it builds only the download page). Never commit a signing key:
    the stable key comes from the `PAEWAI_KEYSTORE_B64` / `PAEWAI_KEYSTORE_PASSWORD` secrets; without
    them the APK is a debug-signed preview that cannot install over an earlier build.
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
