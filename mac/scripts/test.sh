#!/usr/bin/env bash
# Runs the unit tests (swift-testing). With Xcode installed, plain `swift test` is enough. With only the Command
# Line Tools, swift-testing lives outside the compiler's default search paths, and the Tools' Foundation
# cross-import overlay for it has no module file, so this adds the paths and turns cross-import overlays off.
set -euo pipefail
cd "$(dirname "$0")/.."

developer_dir="$(xcode-select -p 2>/dev/null || true)"
frameworks="$developer_dir/Library/Developer/Frameworks"
plugins="$developer_dir/usr/lib/swift/host/plugins/testing"

if [[ "$developer_dir" == *CommandLineTools* && -d "$frameworks/Testing.framework" ]]; then
  exec swift test \
    -Xswiftc -F -Xswiftc "$frameworks" \
    -Xswiftc -plugin-path -Xswiftc "$plugins" \
    -Xswiftc -Xfrontend -Xswiftc -disable-cross-import-overlays \
    -Xlinker -rpath -Xlinker "$frameworks" \
    "$@"
fi

exec swift test "$@"
