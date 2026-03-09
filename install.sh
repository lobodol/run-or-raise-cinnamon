#!/usr/bin/env bash
set -e

UUID="run-or-raise@lobodol"
TARGET="$HOME/.local/share/cinnamon/extensions/$UUID"

mkdir -p "$TARGET"
cp metadata.json extension.js "$TARGET/"

echo "Installed to $TARGET"
echo ""
echo "Enable the extension in:"
echo "  System Settings → Extensions → Run or Raise"
echo ""
echo "Then configure shortcuts in:"
echo "  ~/.config/run-or-raise/shortcuts.conf"
echo ""
echo "To reload Cinnamon after changes: Alt+F2 → r → Enter"
