import SmartSyncPlugin from "./main";
import { SmartSyncSettingsTab } from "./settings";

// Type alias for the default export
type SmartSync = SmartSyncPlugin;
import { Compare } from "./compare";
import { Checksum } from "./checksum";
import { Operations } from "./operations";
import { Platform, setIcon } from "obsidian";
import { Status } from "./const";
import { DailyNoteManager } from "./dailynote";

export async function launcher(plugin: SmartSync) {
    await plugin.loadSettings();
    plugin.doLog = false;

    // plugin adds a settings tab so the user can configure various aspects of the plugin
    plugin.addSettingTab(new SmartSyncSettingsTab(plugin.app, plugin));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugin.settingPrivate = (this.app as any).setting;
    plugin.tempExcludedFiles = {};

    plugin.compare = new Compare(plugin);
    plugin.checksum = new Checksum(plugin);
    plugin.operations = new Operations(plugin);
    plugin.dailyNote = new DailyNoteManager(plugin);

    plugin.mobile = Platform.isMobileApp;
    plugin.settings.exclusionsOverride = false;
    plugin.setBaseRemotePath();
    plugin.prevPath = `${plugin.app.vault.configDir}/plugins/smartSync/prevdata.json`;
    // console.log(plugin.prevPath)

    plugin.allFiles = {
        local: {},
        remote: {},
    };

    if (plugin.settings.enableRibbons) {
        plugin.addRibbonIcon("calendar", "Open Daily Note with SmartSync", (event: MouseEvent) => {
            let middleCick = false;
            if (event.button === 1) {
                event.preventDefault();
                middleCick = true;
            } else if (event.button === 0 && event.ctrlKey) {
                event.preventDefault();
                middleCick = true;
            }

            plugin.dailyNote.dailyNote(middleCick);
        });

        plugin.addRibbonIcon("arrow-down-up", "Check and Sync with SmartSync", async () => {
            await plugin.operations.check();
            await plugin.operations.fullSync();
        });

        plugin.addRibbonIcon("settings-2", "Open SmartSync Control Panel", () => {
            plugin.displayModal();
        });
    }

    try {
        plugin.prevData = JSON.parse(await plugin.app.vault.adapter.read(plugin.prevPath));
        // prevData.date = new Date(prevData.date)
        // plugin.prevData = prevData

        plugin.log("PREVDATA LOADED: ", plugin.prevData);
    } catch (error) {
        plugin.prevData = {
            error: true,
            files: {},
            date: Date.now(),
            except: {},
        };

        plugin.app.vault.adapter.write(plugin.prevPath, JSON.stringify(plugin.prevData, null, 2));
        console.error("ERROR LOADING PREVIOUS DATA! RESET prevdata.json to {error: true, files: {}} \n", error);
        plugin.show("Failed to read previous data\nThis is to be expected if the plugin is new", 5000);
    }

    // plugin adds a status bar item to the bottom of the app. Does not work on mobile apps.

    plugin.statusBar = plugin.addStatusBarItem();

    plugin.statusBar2 = plugin.addStatusBarItem();
    plugin.statusBar2.setText("");

    plugin.loadingTotal = -1;

    // In your main plugin class
    plugin.statusBar = plugin.addStatusBarItem();
    plugin.statusBar.addClass("plugin-sync"); // Main container class
    plugin.statusBar.setAttribute("aria-label", "Uninitialized");
    plugin.statusBar.setAttribute("data-tooltip-position", "top");

    // Create inner container
    const innerDiv = plugin.statusBar.createDiv("status-bar-item-segment");

    // Create span for icon
    plugin.iconSpan = innerDiv.createSpan({
        cls: ["status-bar-item-icon", "sync-status-icon"],
    });

    // Set the icon
    setIcon(plugin.iconSpan, "refresh-cw-off");

    // Or if you need more control over the classes:
    plugin.statusBar.addClass("status-bar-item", "plugin-sync");

    // Or more Obsidian-style
    plugin.statusBar.onClickEvent(() => {
        // Your click handler
        plugin.displayModal();
    });

    plugin.addCommand({
        id: "daily-note",
        name: "Create Daily Note with SmartSync",
        icon: "calendar",
        callback: async () => {
            plugin.dailyNote.dailyNote();
        },
    });

    plugin.addCommand({
        id: "display-smartSync-modal",
        name: "Open SmartSync Control Panel modal",
        icon: "settings-2",
        callback: async () => {
            plugin.displayModal();
        },
    });

    plugin.addCommand({
        id: "smartSync-check",
        name: "Check for file changes",
        icon: "search",
        callback: async () => {
            plugin.operations.check();
        },
    });

    /*
    plugin.addCommand({
        id: "smartSync-push",
        name: "Force PUSH all File changes",
        callback: async () => {
            plugin.operations.push();
        },
    });

    plugin.addCommand({
        id: "smartSync-pull",
        name: "Force PULL all File changes",
        callback: async () => {
            plugin.operations.pull();
        },
    });
    */

    plugin.addCommand({
        id: "smartSync-fullsync",
        name: "Full Sync",
        icon: "arrow-down-up",
        callback: async () => {
            await plugin.operations.fullSync();
        },
    });

    plugin.addCommand({
        id: "smartSync-check-fullsync",
        name: "Check and Full Sync",
        icon: "arrow-down-up",
        callback: async () => {
            await plugin.operations.check(false, true);
            await plugin.operations.fullSyncSilent();
        },
    });

    plugin.addCommand({
        id: "save-prev",
        name: "Save State",
        callback: async () => {
            plugin.saveState();
        },
    });

    plugin.addCommand({
        id: "reset-error",
        name: "Reset Error state",
        callback: async () => {
            // plugin.prevData.error= false
            plugin.setError(false);
        },
    });

    plugin.addCommand({
        id: "toggle-pause",
        name: "Toggle Pause for all activities",
        icon: "pause",
        callback: () => {
            plugin.togglePause();
        },
    });

    plugin.setStatus(Status.NONE);
    plugin.setClient();

    if (plugin.settings.liveSync) {
        plugin.setLiveSync();
    }

    if (plugin.settings.autoSync) {
        plugin.setAutoSync();
    }
}
