#!/usr/bin/env bash
# Merges a tested claude/* or ccr-* branch into main, so work from any Claude session goes
# live without anyone pressing "merge". Run by .github/workflows/ci.yml after every app's
# tests have passed on that branch.
#
# Env: BRANCH (required), HAS_PAT ("true" when secrets.AUTOMERGE_TOKEN is set),
#      GH_TOKEN (to start the publish run), WORKFLOW_FILE (default ci.yml).
set -euo pipefail

: "${BRANCH:?BRANCH is required}"
repo="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}"
compare="$repo/compare/main...${BRANCH}?expand=1"

note() { printf '%s\n' "$*" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
fail() {
  echo "::error::$1"
  note "### ❌ $1"
  if [ -n "${2:-}" ]; then note "$2"; fi
  exit 1
}

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'

if ! git ls-remote --exit-code --heads origin main >/dev/null; then
  echo "::warning::ยังไม่มี branch main จึงยังไม่รวมอัตโนมัติ"
  note "### ⏸ ยังไม่มี branch \`main\`"
  note "สร้าง \`main\` จาก \`$BRANCH\` แล้วตั้งเป็น default branch ก่อน (ดูขั้นตอนใน README)"
  exit 0
fi

head="origin/$BRANCH"
pushed=
for attempt in 1 2 3 4 5; do
  git fetch --quiet --no-tags origin \
    "+refs/heads/main:refs/remotes/origin/main" \
    "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"

  if git merge-base --is-ancestor "$head" origin/main; then
    echo "main มีงานจาก $BRANCH ครบแล้ว"
    note "### ✅ \`main\` มีงานจาก \`$BRANCH\` ครบแล้ว"
    exit 0
  fi

  # The built-in token may not change workflow files (GitHub blocks it), so say so up front.
  if [ "${HAS_PAT:-false}" != true ] && ! git diff --quiet "origin/main...$head" -- .github/workflows; then
    fail "branch นี้แก้ไฟล์ใน .github/workflows จึงต้องกด merge เอง" \
      "GitHub ไม่ให้ระบบอัตโนมัติแก้ไฟล์ workflow ด้วยสิทธิ์ปกติ กดเปิด PR แล้ว merge ได้ที่ $compare (หรือเพิ่ม secret \`AUTOMERGE_TOKEN\` ตาม README เพื่อให้รวมเองได้ทุกกรณี)"
  fi

  git checkout --quiet -B main origin/main
  if git merge-base --is-ancestor origin/main "$head"; then
    # main hasn't moved since the branch started: the result is exactly what was just tested.
    git merge --quiet --ff-only "$head"
  else
    if ! git merge --no-ff --no-edit -m "Merge $BRANCH into main" "$head"; then
      git merge --abort || true
      fail "รวม $BRANCH เข้า main ไม่ได้ เพราะแก้ไฟล์เดียวกันชนกับงานอื่น" \
        "เปิด PR ที่ $compare แล้วให้ Claude ช่วยแก้ conflict"
    fi
    echo "::group::main มีงานใหม่ระหว่างนี้ ทดสอบผลที่รวมแล้วอีกรอบ"
    node scripts/build-site.mjs || fail "ทดสอบหลังรวมกับ main ไม่ผ่าน" "เปิด PR ที่ $compare เพื่อดูว่าชนกับงานไหน"
    echo "::endgroup::"
  fi

  if git push --quiet origin main; then
    pushed=1
    break
  fi
  echo "main เพิ่งถูกแก้ระหว่างนี้ ลองใหม่ (รอบ $attempt)"
  sleep $((attempt * 5))
done
[ -n "$pushed" ] || fail "ส่งขึ้น main ไม่สำเร็จหลังลอง 5 ครั้ง" "กด Re-run jobs ในหน้า Actions อีกครั้ง"

# Pushes made with the built-in token don't start new workflow runs, so start the publish run directly.
if [ "${HAS_PAT:-false}" != true ]; then
  gh workflow run "${WORKFLOW_FILE:-ci.yml}" --ref main
fi
note "### ✅ รวม \`$BRANCH\` เข้า \`main\` แล้ว กำลังเผยแพร่ขึ้นเว็บ"
