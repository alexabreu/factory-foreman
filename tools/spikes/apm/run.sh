#!/usr/bin/env bash
# Spike B: can APM deploy a package that pnpm installed into node_modules, for
# claude, codex and copilot, and does `apm audit --ci` accept the result?
# Needs `apm` (pip install apm-cli==0.35.0) and pnpm. Writes only under a temp dir.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
cp -r "$here/stand-in-core" "$here/consumer" "$work/"
cd "$work/consumer"
git init -q
pnpm install --ignore-workspace --silent
echo "== node_modules/factory-foreman is a $( [ -L node_modules/factory-foreman ] && echo symlink || echo directory )"
apm install
echo "== files apm wrote:"
git ls-files --others --exclude-standard | { grep -vE '^(node_modules|apm_modules|\.apm-local)/' || true; } | sort
echo "== audit through the pnpm symlink:"
apm audit --ci -f json 2>/dev/null | node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); for (const c of d.checks) console.log(c.passed ? "pass" : "FAIL", c.name, "-", c.message)' || true

# The same package as a plain directory, to separate APM's behavior from pnpm's layout.
mkdir "$work/plain"
cd "$work/plain"
git init -q
cp -r "$work/stand-in-core/apm" vendor-apm
sed 's#./node_modules/factory-foreman/apm#./vendor-apm#' "$work/consumer/apm.yml" > apm.yml
apm install > /dev/null
echo "== audit from a plain directory:"
apm audit --ci -f json 2>/dev/null | node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); for (const c of d.checks) console.log(c.passed ? "pass" : "FAIL", c.name, "-", c.message)' || true
