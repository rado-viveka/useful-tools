#!/usr/bin/env bash
# Packages the extension as a .vsix without needing vsce or Node.
# Usage: ./build.sh            -> builds markdown-line-numbers.vsix
#        ./build.sh --install  -> builds and installs it into VS Code
set -euo pipefail
cd "$(dirname "$0")"
OUT=markdown-line-numbers.vsix
rm -f "$OUT"
python3 -I - "$OUT" <<'PY'
import sys, zipfile
files = ['[Content_Types].xml', 'extension.vsixmanifest',
         'extension/package.json', 'extension/line-numbers.css', 'extension/line-numbers.js']
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(f)
PY
echo "Built $OUT"
if [[ "${1:-}" == "--install" ]]; then
  code --install-extension "$OUT" --force
  echo "Installed. Run 'Developer: Reload Window' in VS Code."
fi
