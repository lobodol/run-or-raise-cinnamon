const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const CONFIG_PATH = GLib.get_home_dir() + '/.config/run-or-raise/shortcuts.conf';
const CONFIG_DIR  = GLib.get_home_dir() + '/.config/run-or-raise';

/**
 * Config format (one shortcut per line, comments start with #):
 *
 *   shortcut,command,[wm_class],[title]
 *
 * - wm_class and title are optional and case-sensitive
 * - if neither is set, the first word of command (lowercased) is matched
 *   against the window's wm_class and title (both lowercased)
 * - wm_class and title support regex when wrapped in /pattern/
 * - a line with only shortcut,command is "run only" (no raising)
 *
 * Examples:
 *   <Super>f,firefox,,
 *   <Super>r,gnome-terminal,gnome-terminal-server,
 *   <Super>KP_1,pidgin,Pidgin,/^((?!Buddy List).)*$/
 *   <Super>y,notify-send Hello world
 */

function RunOrRaise(uuid) {
    this._uuid = uuid;
    this._shortcuts = [];
    this._registeredIds = [];
    this._configMonitor = null;
}

RunOrRaise.prototype = {

    enable: function() {
        this._ensureConfigFile();
        this._loadAndRegister();
        this._watchConfig();
    },

    disable: function() {
        this._unregisterAll();
        if (this._configMonitor) {
            this._configMonitor.cancel();
            this._configMonitor = null;
        }
    },

    // -------------------------------------------------------------------------
    // Config
    // -------------------------------------------------------------------------

    _ensureConfigFile: function() {
        let dir = Gio.File.new_for_path(CONFIG_DIR);
        if (!dir.query_exists(null)) {
            dir.make_directory_with_parents(null);
        }

        let file = Gio.File.new_for_path(CONFIG_PATH);
        if (!file.query_exists(null)) {
            let defaultContent = [
                '# Run or Raise shortcuts',
                '# Format: shortcut,command,[wm_class],[title]',
                '#',
                '# Examples:',
                '# <Super>e,nautilus,,',
                '# <Super>t,gnome-terminal,gnome-terminal-server,',
                '# <Super>f,firefox,,',
                '',
            ].join('\n');
            file.replace_contents(defaultContent, null, false, Gio.FileCreateFlags.NONE, null);
        }
    },

    _loadConfig: function() {
        this._shortcuts = [];

        let file = Gio.File.new_for_path(CONFIG_PATH);
        if (!file.query_exists(null)) return;

        let [ok, contents] = file.load_contents(null);
        if (!ok) return;

        let text = contents instanceof Uint8Array
            ? new TextDecoder().decode(contents)
            : contents.toString();

        let lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (!line || line.startsWith('#')) continue;

            // Split into at most 4 fields on comma
            let parts = line.split(',');
            if (parts.length < 2) {
                global.logWarning('[run-or-raise] Invalid line ' + (i + 1) + ': ' + line);
                continue;
            }

            let binding = parts[0].trim();
            let command  = parts[1].trim();
            let wmClass  = parts.length > 2 ? parts[2].trim() : '';
            let title    = parts.length > 3 ? parts[3].trim() : '';

            // Skip layered shortcuts (contain a space outside angle brackets)
            if (this._isLayeredShortcut(binding)) {
                global.log('[run-or-raise] Skipping layered shortcut (not supported): ' + binding);
                continue;
            }

            if (!binding || !command) {
                global.logWarning('[run-or-raise] Invalid line ' + (i + 1) + ': ' + line);
                continue;
            }

            this._shortcuts.push({ binding, command, wmClass, title });
        }

        global.log('[run-or-raise] Loaded ' + this._shortcuts.length + ' shortcut(s)');
    },

    _isLayeredShortcut: function(binding) {
        // A layered shortcut has spaces between key tokens, e.g. "<Super>e h e l l o"
        // A normal binding may have spaces only inside <...> tokens
        let stripped = binding.replace(/<[^>]*>/g, '');
        return stripped.includes(' ');
    },

    // -------------------------------------------------------------------------
    // Registration
    // -------------------------------------------------------------------------

    _loadAndRegister: function() {
        this._unregisterAll();
        this._loadConfig();

        for (let i = 0; i < this._shortcuts.length; i++) {
            let s = this._shortcuts[i];
            let id = 'run-or-raise-' + i;

            let command = s.command;
            let wmClass = s.wmClass;
            let title   = s.title;
            let runOnly = !wmClass && !title && s.command === s.command; // see _runOrRaise

            let added = Main.keybindingManager.addHotKey(
                id,
                s.binding,
                () => this._runOrRaise(command, wmClass, title)
            );

            if (added) {
                this._registeredIds.push(id);
            } else {
                global.logWarning('[run-or-raise] Could not register: ' + s.binding);
            }
        }
    },

    _unregisterAll: function() {
        for (let i = 0; i < this._registeredIds.length; i++) {
            Main.keybindingManager.removeHotKey(this._registeredIds[i]);
        }
        this._registeredIds = [];
    },

    // -------------------------------------------------------------------------
    // Config hot-reload
    // -------------------------------------------------------------------------

    _watchConfig: function() {
        let file = Gio.File.new_for_path(CONFIG_PATH);
        this._configMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._configMonitor.connect('changed', () => {
            global.log('[run-or-raise] Config changed, reloading...');
            this._loadAndRegister();
        });
    },

    // -------------------------------------------------------------------------
    // Core logic
    // -------------------------------------------------------------------------

    _runOrRaise: function(command, wmClass, title) {
        // "run only" when shortcut,command (no wm_class, no title fields at all)
        // We still try raise if wm_class/title were given but empty strings mean
        // "match by command name"
        let window = this._findWindow(command, wmClass, title);

        if (window) {
            this._raiseWindow(window);
        } else {
            this._launch(command);
        }
    },

    _findWindow: function(command, wmClass, title) {
        let windows = global.display.get_tab_list(Meta.TabList.NORMAL, null);

        for (let i = 0; i < windows.length; i++) {
            if (this._windowMatches(windows[i], command, wmClass, title)) {
                return windows[i];
            }
        }
        return null;
    },

    _windowMatches: function(win, command, wmClass, title) {
        let winClass = win.get_wm_class() || '';
        let winTitle = win.get_title() || '';

        // No criteria: match command name against both wm_class and title (lowercased)
        if (!wmClass && !title) {
            let name = command.split(' ')[0].split('/').pop().toLowerCase();
            return winClass.toLowerCase().includes(name) ||
                   winTitle.toLowerCase().includes(name);
        }

        // Match wm_class (if provided)
        if (wmClass && !this._matchPattern(winClass, wmClass)) {
            return false;
        }

        // Match title (if provided)
        if (title && !this._matchPattern(winTitle, title)) {
            return false;
        }

        return true;
    },

    _matchPattern: function(str, pattern) {
        if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
            try {
                let regex = new RegExp(pattern.slice(1, -1));
                return regex.test(str);
            } catch (e) {
                global.logWarning('[run-or-raise] Invalid regex: ' + pattern);
                return false;
            }
        }
        return str.includes(pattern);
    },

    _raiseWindow: function(window) {
        let workspace = window.get_workspace();
        if (workspace) {
            workspace.activate(global.get_current_time());
        }
        if (window.minimized) {
            window.unminimize(global.get_current_time());
        }
        window.activate(global.get_current_time());
    },

    _launch: function(command) {
        try {
            GLib.spawn_command_line_async(command);
        } catch (e) {
            global.logError('[run-or-raise] Failed to launch "' + command + '": ' + e.message);
        }
    },
};

let _instance = null;

function init(metadata) {
    _instance = new RunOrRaise(metadata.uuid);
}

function enable() {
    _instance.enable();
}

function disable() {
    _instance.disable();
}
