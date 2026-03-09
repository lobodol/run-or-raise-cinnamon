# run-or-raise — Cinnamon extension

A Cinnamon desktop extension that raises a window if the application is already running, or launches it otherwise. Shortcuts and matching rules are fully configurable via a plain text file.

## Installation

```bash
git clone https://github.com/lobodol/run-or-raise-cinnamon
cd run-or-raise-cinnamon
./install.sh
```

Then enable the extension in **System Settings → Extensions → Run or Raise**.

## Configuration

Shortcuts are defined in `~/.config/run-or-raise/shortcuts.conf` (created automatically on first run).

The file is **hot-reloaded** — changes take effect immediately without restarting Cinnamon.

### Format

```
shortcut,command,[wm_class],[title]
```

| Field | Required | Description |
|-------|----------|-------------|
| `shortcut` | yes | Key combination (X11 syntax) |
| `command` | yes | Command to run if no matching window is found |
| `wm_class` | no | Window class to match (case-sensitive) |
| `title` | no | Window title to match (case-sensitive) |

- Lines starting with `#` are comments; blank lines are ignored.
- `wm_class` and `title` accept **regular expressions** when wrapped in `/pattern/`.
- If neither `wm_class` nor `title` is provided, the first word of `command` is matched case-insensitively against the window's class and title.

### Examples

```conf
# Match by command name (firefox matched against wm_class and title)
<Super>f,firefox,,

# Match by wm_class
<Super>t,gnome-terminal,gnome-terminal-server,

# Match by wm_class + title regex (any Pidgin window except Buddy List)
<Super>KP_1,pidgin,Pidgin,/^((?!Buddy List).)*$/

# Launch a web app in Chromium, match by title
<Super>KP_2,chromium-browser --app=https://mail.google.com,mail.google.com,

# Run only (no window matching)
<Super>y,notify-send "Hello world"
```

### Finding a window's WM_CLASS

Run the following command and click the target window:

```bash
xprop WM_CLASS
```

Use the second value returned (e.g. `"Firefox"` → use `Firefox`).

You can also use Cinnamon's built-in Looking Glass tool (`Alt+F2` → `lg` → **Windows** tab).

## Debugging

Check logs with:

```bash
journalctl /usr/bin/cinnamon -f | grep run-or-raise
```

## Limitations

- **Layered shortcuts** (e.g. `<Super>e h e l l o`) are not supported and will be skipped.
- Window matching cycles through all open windows and raises the first match.
