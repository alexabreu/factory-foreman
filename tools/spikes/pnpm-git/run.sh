#!/usr/bin/env bash
# Spike D: can pnpm install one package from a subfolder of a GitHub repo at a
# tag, and can a CI runner without SSH keys reinstall it from the lockfile?
# Uses a public monorepo until factory-foreman has a tag:
#   REPO=vitejs/vite TAG=v8.3.7 SUB=packages/create-vite tools/spikes/pnpm-git/run.sh
# A developer machine where SSH to GitHub works is simulated with a git URL
# rewrite; a CI runner has no SSH. Each run uses its own pnpm store and cache.
set -uo pipefail
REPO=${REPO:-vitejs/vite} TAG=${TAG:-v8.3.7} SUB=${SUB:-packages/create-vite}
blockSsh='sh -c "echo SSH used >&2; exit 1"'
dev=(env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf GIT_CONFIG_VALUE_0=git@github.com: GIT_CONFIG_GLOBAL=/dev/null)
ci=(env GIT_CONFIG_COUNT=0 GIT_CONFIG_GLOBAL=/dev/null GIT_SSH_COMMAND="$blockSsh")
ciRewrite=(env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf GIT_CONFIG_VALUE_0=git@github.com: GIT_CONFIG_GLOBAL=/dev/null GIT_SSH_COMMAND="$blockSsh")
for who in dev ci; do
  for spec in "github:$REPO#$TAG&path:/$SUB" "git+https://github.com/$REPO.git#$TAG&path:/$SUB"; do
    work=$(mktemp -d) && cd "$work"
    export npm_config_store_dir="$work/store" npm_config_cache_dir="$work/cache"
    echo '{ "name": "spike-d", "private": true }' > package.json
    where=$([ "$who" = dev ] && echo "SSH works" || echo "there is no SSH")
    echo "== $spec, lockfile written where $where"
    eval "runner=(\"\${$who[@]}\")"
    if ! "${runner[@]}" pnpm add -D "$spec" --silent 2> err.txt; then echo "add: FAILED"; continue; fi
    grep -m1 -oE 'repo: [^,]+' pnpm-lock.yaml
    for mode in ci ciRewrite; do
      rm -rf node_modules store cache
      eval "runner=(\"\${$mode[@]}\")"
      if "${runner[@]}" pnpm install --frozen-lockfile --silent 2> err.txt; then r=ok; else r=FAILED; fi
      echo "  frozen install on a runner $([ "$mode" = ci ] && echo "with no SSH" || echo "with an https rewrite"): $r"
    done
  done
done
