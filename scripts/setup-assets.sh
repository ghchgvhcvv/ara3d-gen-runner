#!/usr/bin/env bash
# Downloads the CC0 MakeHuman source data into vendor/ and builds public/assets.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p vendor
if [ ! -d vendor/mh/makehuman/data ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/makehumancommunity/makehuman.git vendor/mh
  git -C vendor/mh sparse-checkout set makehuman/data
fi
if [ ! -d vendor/sys/skins ]; then
  mkdir -p vendor/dl vendor/sys
  curl -L --fail -o vendor/dl/sys.zip \
    https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
  unzip -q -o vendor/dl/sys.zip -d vendor/sys
fi
npx tsx scripts/build-assets.ts
