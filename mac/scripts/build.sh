#!/usr/bin/env bash
# Builds Standby.app (universal when the toolchain can cross-compile, otherwise Apple silicon only), signs it ad hoc,
# and packs it into public/downloads/Standby.dmg. Intermediates go to mac/.build and mac/dist.
#
#   scripts/build.sh                 build the app and the DMG
#   scripts/build.sh --screenshots   also render the landing page's PNGs into public/landing/v2/app/
#   scripts/build.sh --icons         re-render Resources/AppIcon.iconset from the app's own drawing first
set -euo pipefail

cd "$(dirname "$0")/.."
MAC_DIR="$(pwd)"
REPO_DIR="$(cd .. && pwd)"

VERSION="1.0"
BUILD="1"
BUNDLE_ID="co.evanhe.standby"
DIST="$MAC_DIR/dist"
APP="$DIST/Standby.app"
DMG_DIR="$REPO_DIR/public/downloads"
DMG="$DMG_DIR/Standby.dmg"
SCREENSHOT_DIR="$REPO_DIR/public/landing/v2/app"

render_screenshots=false
render_icons=false
for arg in "$@"; do
  case "$arg" in
    --screenshots) render_screenshots=true ;;
    --icons) render_icons=true ;;
    *) echo "Unknown option: $arg" >&2; exit 64 ;;
  esac
done

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# 1. Compile ---------------------------------------------------------------------------------------------------------
step "Compiling (release)"
swift build -c release --triple arm64-apple-macosx14.0 --scratch-path .build/release-arm64
binaries=(".build/release-arm64/release/Standby")
if swift build -c release --triple x86_64-apple-macosx14.0 --scratch-path .build/release-x86_64; then
  binaries+=(".build/release-x86_64/release/Standby")
else
  echo "warning: the x86_64 build failed; this build is Apple silicon only." >&2
fi

rm -rf "$DIST"
mkdir -p "$DIST"
if [[ ${#binaries[@]} -gt 1 ]]; then
  lipo -create -output "$DIST/Standby" "${binaries[@]}"
else
  cp "${binaries[0]}" "$DIST/Standby"
fi
lipo -info "$DIST/Standby"

# 2. Icon ------------------------------------------------------------------------------------------------------------
if $render_icons || [[ ! -d Resources/AppIcon.iconset ]]; then
  step "Rendering the app icon"
  rm -rf Resources/AppIcon.iconset
  "${binaries[0]}" --render-icon Resources/AppIcon.iconset
fi
iconutil -c icns Resources/AppIcon.iconset -o "$DIST/AppIcon.icns"

# 3. Bundle ----------------------------------------------------------------------------------------------------------
step "Assembling Standby.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/Fonts" "$APP/Contents/Resources/Google"
mv "$DIST/Standby" "$APP/Contents/MacOS/Standby"
mv "$DIST/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cp Resources/Fonts/*.ttf Resources/Fonts/*.txt "$APP/Contents/Resources/Fonts/"
cp Resources/Google/*.png "$APP/Contents/Resources/Google/"
printf 'APPL????' > "$APP/Contents/PkgInfo"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>Standby</string>
  <key>CFBundleExecutable</key><string>Standby</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>Standby</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${BUILD}</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>© 2026 Evan He</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST
plutil -lint "$APP/Contents/Info.plist" >/dev/null

# 4. Google client (never printed) ------------------------------------------------------------------------------------
if [[ -f Config.local.json ]]; then
  client_id="$(plutil -extract googleClientId raw -o - Config.local.json 2>/dev/null || true)"
  client_secret="$(plutil -extract googleClientSecret raw -o - Config.local.json 2>/dev/null || true)"
  if [[ -n "$client_id" && -n "$client_secret" ]]; then
    cp Config.local.json "$APP/Contents/Resources/GoogleClient.json"
    echo "Google client: bundled from Config.local.json"
  else
    echo "Google client: Config.local.json is incomplete, so this build runs on sample data only"
  fi
  unset client_id client_secret
else
  echo "Google client: none (no Config.local.json), so this build runs on sample data only"
fi

# 5. Sign ------------------------------------------------------------------------------------------------------------
step "Signing (ad hoc)"
codesign --force --deep --sign - --timestamp=none "$APP"
codesign --verify --deep --strict "$APP"
echo "Signature OK"

# 6. Screenshots -----------------------------------------------------------------------------------------------------
if $render_screenshots; then
  step "Rendering screenshots into public/landing/v2/app/"
  mkdir -p "$SCREENSHOT_DIR"
  "$APP/Contents/MacOS/Standby" --render-screenshots "$SCREENSHOT_DIR"
fi

# 7. Disk image ------------------------------------------------------------------------------------------------------
step "Building Standby.dmg"
STAGING="$DIST/dmg"
rm -rf "$STAGING"
mkdir -p "$STAGING" "$DMG_DIR"
cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
rm -f "$DMG"
hdiutil create -volname "Standby" -srcfolder "$STAGING" -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$DMG" >/dev/null
rm -rf "$STAGING"
hdiutil verify "$DMG" >/dev/null 2>&1 && echo "DMG verified"

step "Done"
du -sh "$APP" | awk '{print "Standby.app  " $1}'
ls -lh "$DMG" | awk '{print "Standby.dmg  " $5 "  " $9}'
