#!/usr/bin/env bash
# Run LOCALLY exactly what CI (.github/workflows/typecheck.yml) would run for
# the commits about to be pushed — plus `ui:check` on the UI files that
# changed — so a push can never turn TypeScript Check red on a gate the local
# run never saw.
#
# Why: agents used to run one green vitest file and push; TypeScript Check then
# failed on a sibling wiring spec that still pinned the old source text
# (toolbar glass capsules, 2026-10-19). This script runs the same CI gates,
# decided from the changed set:
#   1. Native deps (expo install --check + check-native-deps) — when
#      package.json / lock / app.config / plugins / modules change
#   2. npm run ts-check
#   3. npm run test:v2  (full suite = CI; --changed-tests scopes to nearby specs)
#   4. embed web+ota build — when embed/ changes
#   5. ui:check on changed UI sources (done-gate; not a CI job)
#
# Changed set = committed diff from the merge-base with origin/main PLUS the
# working tree (staged, unstaged, untracked), minus package-lock.json.
#
# Usage (viewer repo root — also before commit, not only before push):
#   npm run verify:push
#   npm run verify:push -- --base <sha>
#   npm run verify:push -- --changed-tests
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

BASE=""
CHANGED_TESTS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE="${2:-}"
      shift 2
      ;;
    --changed-tests)
      CHANGED_TESTS=1
      shift
      ;;
    *)
      echo "usage: $0 [--base <sha>] [--changed-tests]" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$BASE" ]]; then
  git fetch origin main --quiet
  BASE=$(git merge-base origin/main HEAD)
fi
echo "verify:push: base $BASE"

CHANGED_FILE=$(mktemp)
UI_LIST=$(mktemp)
SPEC_LIST=$(mktemp)
trap 'rm -f "$CHANGED_FILE" "$UI_LIST" "$SPEC_LIST"' EXIT
{
  git diff --name-only "$BASE" -- . ':(exclude)package-lock.json'
  git diff --name-only -- . ':(exclude)package-lock.json'
  git diff --name-only --cached -- . ':(exclude)package-lock.json'
  git ls-files --others --exclude-standard -- . ':(exclude)package-lock.json'
} | sort -u >"$CHANGED_FILE"

if [[ ! -s "$CHANGED_FILE" ]]; then
  echo "verify:push GREEN — nothing changed since $BASE"
  exit 0
fi

CLASSIFY=$(CHANGED_FILE="$CHANGED_FILE" node <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const files = fs.readFileSync(process.env.CHANGED_FILE, 'utf8').trim().split('\n').filter(Boolean)

const isDoc = (f) => f.startsWith('docs/') || f.endsWith('.md')
const isNative = (f) =>
  f === 'package.json' ||
  f === 'package-lock.json' ||
  f === 'app.config.ts' ||
  f === 'app.config.js' ||
  f.startsWith('plugins/') ||
  f.startsWith('modules/')
const isEmbed = (f) => f.startsWith('embed/')
const isCode = (f) =>
  isNative(f) ||
  isEmbed(f) ||
  f.startsWith('src/') ||
  f.startsWith('app/') ||
  f.startsWith('scripts/') ||
  f.startsWith('locales/') ||
  f.startsWith('shared/') ||
  f.startsWith('.github/')
const isUi = (f) => {
  if (f.includes('/__tests__/') || f.endsWith('.spec.ts') || f.endsWith('.spec.tsx')) return false
  return (
    ((f.startsWith('src/') || f.startsWith('app/') || f.startsWith('embed/src/')) &&
      (f.endsWith('.ts') || f.endsWith('.tsx'))) ||
    (f.startsWith('locales/') && f.endsWith('.json'))
  )
}

const code = files.filter((f) => !isDoc(f) && isCode(f))
if (code.length === 0 && files.every(isDoc)) {
  console.log(JSON.stringify({ skip: 'docs' }))
  process.exit(0)
}
// Anything unknown counts as code — never skip a gate by accident.
const effective = code.length > 0 ? code : files.filter((f) => !isDoc(f))

function nearbySpecs(changed) {
  const out = new Set()
  const addDir = (d) => {
    if (!fs.existsSync(d)) return
    for (const name of fs.readdirSync(d)) {
      if (name.endsWith('.spec.ts') || name.endsWith('.spec.tsx')) out.add(path.join(d, name))
    }
  }
  for (const f of changed) {
    if (f.endsWith('.spec.ts') || f.endsWith('.spec.tsx')) {
      if (fs.existsSync(f)) out.add(f)
      continue
    }
    if (!/^(src|embed\/src|scripts|shared|app)\//.test(f)) continue
    if (!fs.existsSync(f)) continue
    const dir = path.dirname(f)
    const parent = path.dirname(dir)
    // Whole neighbouring __tests__ — wiring specs read sibling .tsx by name.
    addDir(path.join(dir, '__tests__'))
    addDir(path.join(parent, '__tests__'))
  }
  return [...out].sort()
}

console.log(
  JSON.stringify({
    skip: null,
    count: files.length,
    native: effective.some(isNative),
    embed: effective.some(isEmbed),
    ui: effective.filter(isUi),
    specs: nearbySpecs(effective),
  }),
)
NODE
)

if echo "$CLASSIFY" | grep -q '"skip":"docs"'; then
  echo "verify:push GREEN — only docs/** or *.md changed, nothing affected"
  exit 0
fi

# Bash 3.2 (macOS /bin/bash) has no mapfile — lists live in temp files above.
NATIVE=$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(j.native?'1':'0')" "$CLASSIFY")
EMBED=$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(j.embed?'1':'0')" "$CLASSIFY")
COUNT=$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.count))" "$CLASSIFY")
node -e "JSON.parse(process.argv[1]).ui.forEach(f=>console.log(f))" "$CLASSIFY" >"$UI_LIST"
node -e "JSON.parse(process.argv[1]).specs.forEach(f=>console.log(f))" "$CLASSIFY" >"$SPEC_LIST"
UI_COUNT=$(wc -l <"$UI_LIST" | tr -d ' ')
SPEC_COUNT=$(wc -l <"$SPEC_LIST" | tr -d ' ')

echo "verify:push: $COUNT changed path(s) since $BASE"

NATIVE_RESULT="skipped"
TC_RESULT="skipped"
TEST_RESULT="skipped"
EMBED_RESULT="skipped"
UI_RESULT="skipped"
RC=0

if [[ "$NATIVE" == "1" ]]; then
  echo "verify:push: native dependencies aligned"
  if npx expo install --check && node scripts/check-native-deps.mjs; then
    NATIVE_RESULT="ok"
  else
    NATIVE_RESULT="RED"
    RC=1
  fi
fi

echo "verify:push: ts-check"
if npm run ts-check; then
  TC_RESULT="ok"
else
  TC_RESULT="RED"
  RC=1
fi

echo "verify:push: unit tests"
if [[ $CHANGED_TESTS -eq 1 && "$SPEC_COUNT" -gt 0 ]]; then
  echo "verify:push: vitest $SPEC_COUNT related spec(s) (--changed-tests)"
  # shellcheck disable=SC2046
  if npx vitest run $(cat "$SPEC_LIST"); then
    TEST_RESULT="ok"
  else
    TEST_RESULT="RED"
    RC=1
  fi
else
  if [[ $CHANGED_TESTS -eq 1 ]]; then
    echo "verify:push: --changed-tests found no nearby specs — full test:v2"
  fi
  if npm run test:v2; then
    TEST_RESULT="ok"
  else
    TEST_RESULT="RED"
    RC=1
  fi
fi

if [[ "$EMBED" == "1" ]]; then
  echo "verify:push: embed build"
  if npm run build:embed:web && npm run build:embed:ota; then
    EMBED_RESULT="ok"
  else
    EMBED_RESULT="RED"
    RC=1
  fi
fi

if [[ "$UI_COUNT" -gt 0 ]]; then
  echo "verify:push: ui:check — $UI_COUNT file(s)"
  # shellcheck disable=SC2046
  if npm run ui:check -- $(cat "$UI_LIST"); then
    UI_RESULT="ok"
  else
    UI_RESULT="RED"
    RC=1
  fi
fi

if [[ $RC -eq 0 ]]; then VERDICT=GREEN; else VERDICT=RED; fi
echo "verify:push $VERDICT — native: $NATIVE_RESULT, ts-check: $TC_RESULT, tests: $TEST_RESULT, embed: $EMBED_RESULT, ui:check: $UI_RESULT"
exit $RC
