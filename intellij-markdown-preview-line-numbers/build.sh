#!/usr/bin/env bash
# Builds the plugin against an installed IntelliJ IDEA, without Gradle.
# Usage: ./build.sh            -> builds markdown-line-numbers.zip
#        ./build.sh --install  -> builds and copies it into the IDE's plugins folder
# IDEA_HOME: the IDE installation (default: the JetBrains Toolbox one).
# IDEA_PLUGINS: the IDE's plugins folder (default: the newest ~/.local/share/JetBrains/IntelliJIdea*).
set -euo pipefail
cd "$(dirname "$0")"
IDEA_HOME="${IDEA_HOME:-$HOME/.local/share/JetBrains/Toolbox/apps/intellij-idea}"
NAME=markdown-line-numbers
OUT=$NAME.zip
[[ -f "$IDEA_HOME/build.txt" ]] || { echo "No IntelliJ IDEA in $IDEA_HOME. Set IDEA_HOME." >&2; exit 1; }
JAVAC=javac
command -v javac >/dev/null || JAVAC="$IDEA_HOME/jbr/bin/javac"

rm -rf build "$OUT"
mkdir -p build/classes "build/$NAME/lib"
CP="$IDEA_HOME/lib/*:$IDEA_HOME/plugins/markdown/lib/*"
"$JAVAC" -nowarn -d build/classes -cp "$CP" $(find src -name '*.java')
cp -r resources/. build/classes/
(cd build/classes && zip -qr "../$NAME/lib/$NAME.jar" .)
(cd build && zip -qr "../$OUT" "$NAME")
echo "Built $OUT for $(cat "$IDEA_HOME/build.txt")"

if [[ "${1:-}" == "--install" ]]; then
  PLUGINS="${IDEA_PLUGINS:-$(ls -d "$HOME"/.local/share/JetBrains/IntelliJIdea* | sort -V | tail -1)}"
  rm -rf "${PLUGINS:?}/$NAME"
  cp -r "build/$NAME" "$PLUGINS/"
  echo "Installed into $PLUGINS. Restart IntelliJ IDEA."
fi
