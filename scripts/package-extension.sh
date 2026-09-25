#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
cd "$project_root"

node scripts/check-release.mjs

version="$(node -p "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')).version")"
output_dir="$project_root/dist"
output_file="$output_dir/actor-analytics-for-apify-$version.zip"

runtime_files=(manifest.json content.js interceptor.js styles.css logo.svg)
if [[ -d icons ]]; then
  runtime_files+=(icons)
fi

mkdir -p "$output_dir"
rm -f "$output_file"
zip -q -r "$output_file" "${runtime_files[@]}"

if unzip -Z1 "$output_file" | grep -Eq '(^|/)(\.git|__MACOSX|\.DS_Store)(/|$)'; then
  echo "Release archive contains forbidden metadata" >&2
  exit 1
fi

if [[ "$(unzip -Z1 "$output_file" | head -n 1)" != "manifest.json" ]]; then
  echo "manifest.json is not the first root entry in the archive" >&2
  exit 1
fi

echo "Created $output_file"

