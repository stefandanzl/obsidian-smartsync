import { App, PluginSettingTab, Setting } from "obsidian";
import SmartSyncPlugin from "./main";

export class SmartSyncSettingsTab extends PluginSettingTab {
    plugin: SmartSyncPlugin;

    constructor(app: App, plugin: SmartSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName("SmartSync Server URL")
            .setDesc("Enter your SmartSync Server's URL (e.g., http://127.0.0.1)")
            .addText((text) =>
                text
                    .setPlaceholder("http://127.0.0.1")
                    .setValue(this.plugin.settings.url)
                    .onChange(async (value) => {
                        this.plugin.settings.url = value;
                        this.plugin.setClient();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("SmartSync Server Port")
            .setDesc("Optional: Enter your SmartSync Server's Port (default: 443)")
            .addText((text) =>
                text
                    .setPlaceholder("443")
                    .setValue(this.plugin.settings.port.toString())
                    .onChange(async (value) => {
                        const parseVal = parseInt(value, 10);
                        if (isNaN(parseVal)) {
                            console.error("Failed to parse port as a number.");
                            this.plugin.show("Invalid port number");
                        } else {
                            this.plugin.settings.port = parseVal;
                            this.plugin.setClient();
                            await this.plugin.saveSettings();
                        }
                    })
            );

        new Setting(containerEl)
            .setName("Auth Token (Optional)")
            .setDesc("Enter Bearer token if authentication is enabled on SmartSyncServer")
            .addText((text) =>
                text
                    .setPlaceholder("your-secret-token")
                    .setValue(this.plugin.settings.authToken)
                    .onChange(async (value) => {
                        this.plugin.settings.authToken = value;
                        this.plugin.setClient();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Apply and Test Server Config")
            .setDesc("Click Button to test Server connection")
            .addButton((button) =>
                button
                    .onClick(async () => {
                        this.plugin.setClient();
                        button.setButtonText((await this.plugin.operations.test(true, true)) ? "OK" : "FAIL");
                    })
                    .setButtonText(this.plugin.prevData.error ? "FAIL" : "OK")
            );

        new Setting(containerEl)
            .setName("Ignore Patterns")
            .setDesc("Enter ignore patterns (.gitignore style) - one pattern per line")
            .addTextArea((text) =>
                text
                    .setPlaceholder("*.exe\n*.log\nprevdata.json\n.obsidian/workspace.json\nnode_modules/")
                    .setValue(this.plugin.settings.ignorePatterns.join("\n"))
                    .onChange(async (value) => {
                        value = value.replace(/\r/g, "").replace(/\\/g, "/");
                        this.plugin.settings.ignorePatterns = value.split("\n").filter((v) => v !== "");
                        await this.plugin.saveSettings();
                        console.log("Settings saved:", this.plugin.settings.ignorePatterns);
                    })
            );


        new Setting(containerEl)
            .setName("Auto Interval Sync")
            .setDesc("Enable automatic syncing in intervals\nThis will override Mod Sync")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => {
                    this.plugin.settings.autoSync = value;
                    this.plugin.setAutoSync();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Auto Interval Sync periodic interval in seconds")
            .setDesc("Enter desired interval in seconds")
            .addText((text) =>
                text
                    .setPlaceholder("10")
                    .setValue(this.plugin.settings.autoSyncInterval.toString())
                    .onChange(async (value) => {
                        const parseVal = parseInt(value, 10);
                        if (isNaN(parseVal)) {
                            console.error("Failed to parse string as a number.");
                            this.plugin.show("Invalid number entered");
                        } else {
                            this.plugin.settings.autoSyncInterval = parseVal;

                            this.plugin.setAutoSync();

                            await this.plugin.saveSettings();
                        }
                    })
            );

        new Setting(containerEl)
            .setName("Enable Ribbons")
            .setDesc("Enable PULL Action on Obsidian Start - Reload App for changes to take effect")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.enableRibbons).onChange(async (value) => {
                    this.plugin.settings.enableRibbons = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Override disable ignore")
            .setDesc(
                "Enable this setting to sync ALL files, even excluded ones - useful for initial PULL or to replicate local state on other devices with PUSH"
            )
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.exclusionsOverride).onChange(async (value) => {
                    this.plugin.settings.exclusionsOverride = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Skip .obsidian sync on mobile")
            .setDesc("Recommended especially for mobile usage for faster file checking")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.skipHiddenMobile).onChange(async (value) => {
                    this.plugin.settings.skipHiddenMobile = value;
                    this.plugin.settings.skipHiddenDesktop = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Skip .obsidian sync on desktop")
            .setDesc("Will only apply to desktop version")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.skipHiddenDesktop).onChange(async (value) => {
                    this.plugin.settings.skipHiddenDesktop = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Remote Daily Notes Folder")
            .setDesc("")
            .addText((text) =>
                text
                    .setPlaceholder("Daily Notes")
                    .setValue(this.plugin.settings.dailyNotesFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.dailyNotesFolder = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Remote Daily Notes File Naming Template")
            .setDesc("Enter in moment syntax")
            .addText((text) =>
                text
                    .setPlaceholder("YYYY/YYYY-MM/YYYY-MM-DD ddd")
                    .setValue(this.plugin.settings.dailyNotesFormat)
                    .onChange(async (value) => {
                        this.plugin.settings.dailyNotesFormat = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Remote Daily Notes Template File")
            .setDesc("Enter path of file you want to be used as template when creating new Daily Note.")
            .addText((text) =>
                text
                    .setPlaceholder("Templates/Daily Notes")
                    .setValue(this.plugin.settings.dailyNotesTemplate)
                    .onChange(async (value) => {
                        this.plugin.settings.dailyNotesTemplate = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Daily Note add Timestamp")
            .setDesc("Move cursor to end of Daily Note and insert timestamp in form of 'HH:MM - '")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.dailyNotesTimestamp).onChange(async (value) => {
                    this.plugin.settings.dailyNotesTimestamp = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Debug Mode")
            .setDesc("Enable verbose logging to console")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.debugMode).onChange(async (value) => {
                    this.plugin.settings.debugMode = value;
                    console.log("DEBUG mode is ", value);
                    await this.plugin.saveSettings();
                })
            );

            
        new Setting(containerEl)
            .setName("Mod Sync")
            .setDesc("Enable Synchronization on modification")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.modSync).onChange(async (value) => {
                    this.plugin.settings.modSync = value;
                    this.plugin.setModSync();
                    await this.plugin.saveSettings();
                    // Refresh settings to show/hide ModSync configuration
                    this.display();
                })
            );

        // Advanced ModSync Configuration Section - Only show when ModSync is enabled
        if (this.plugin.settings.modSync) {
            containerEl.createEl("h2", { text: "ModSync Configuration" });
            containerEl.createEl("p", {
                text: "Configure automatic file synchronization behavior when changes are detected."
            });

            // Event Types Configuration
            containerEl.createEl("h3", { text: "Event Types" });
            containerEl.createEl("p", {
                text: "Choose which file change types should trigger automatic synchronization."
            });

            new Setting(containerEl)
                .setName("Track file creation")
                .setDesc("Sync new files when they are created")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.modSyncConfig.eventTypes?.create ?? true).onChange(async (value) => {
                        // Initialize eventTypes if it doesn't exist
                        if (!this.plugin.settings.modSyncConfig.eventTypes) {
                            this.plugin.settings.modSyncConfig.eventTypes = {
                                create: true,
                                modify: true,
                                delete: true,
                                rename: true,
                                raw: true
                            };
                        }
                        this.plugin.settings.modSyncConfig.eventTypes.create = value;
                        await this.plugin.saveSettings();
                        if (this.plugin.modSyncListener) {
                            this.plugin.modSyncListener.updateConfig({
                                eventTypes: this.plugin.settings.modSyncConfig.eventTypes
                            });
                        }
                    })
                );

            new Setting(containerEl)
                .setName("Track file modifications")
                .setDesc("Sync files when they are modified")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.modSyncConfig.eventTypes?.modify ?? true).onChange(async (value) => {
                        if (!this.plugin.settings.modSyncConfig.eventTypes) {
                            this.plugin.settings.modSyncConfig.eventTypes = {
                                create: true,
                                modify: true,
                                delete: true,
                                rename: true,
                                raw: true
                            };
                        }
                        this.plugin.settings.modSyncConfig.eventTypes.modify = value;
                        await this.plugin.saveSettings();
                        if (this.plugin.modSyncListener) {
                            this.plugin.modSyncListener.updateConfig({
                                eventTypes: this.plugin.settings.modSyncConfig.eventTypes
                            });
                        }
                    })
                );

            new Setting(containerEl)
                .setName("Track file deletions")
                .setDesc("Sync file deletions to remote")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.modSyncConfig.eventTypes?.delete ?? true).onChange(async (value) => {
                        if (!this.plugin.settings.modSyncConfig.eventTypes) {
                            this.plugin.settings.modSyncConfig.eventTypes = {
                                create: true,
                                modify: true,
                                delete: true,
                                rename: true,
                                raw: true
                            };
                        }
                        this.plugin.settings.modSyncConfig.eventTypes.delete = value;
                        await this.plugin.saveSettings();
                        if (this.plugin.modSyncListener) {
                            this.plugin.modSyncListener.updateConfig({
                                eventTypes: this.plugin.settings.modSyncConfig.eventTypes
                            });
                        }
                    })
                );

            new Setting(containerEl)
                .setName("Track file renames")
                .setDesc("Sync file renames/moves")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.modSyncConfig.eventTypes?.rename ?? true).onChange(async (value) => {
                        if (!this.plugin.settings.modSyncConfig.eventTypes) {
                            this.plugin.settings.modSyncConfig.eventTypes = {
                                create: true,
                                modify: true,
                                delete: true,
                                rename: true,
                                raw: true
                            };
                        }
                        this.plugin.settings.modSyncConfig.eventTypes.rename = value;
                        await this.plugin.saveSettings();
                        if (this.plugin.modSyncListener) {
                            this.plugin.modSyncListener.updateConfig({
                                eventTypes: this.plugin.settings.modSyncConfig.eventTypes
                            });
                        }
                    })
                );

            new Setting(containerEl)
                .setName("Track .obsidian/ folder changes")
                .setDesc("Sync changes in .obsidian/ folder (using raw events)")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.modSyncConfig.eventTypes?.raw ?? true).onChange(async (value) => {
                        if (!this.plugin.settings.modSyncConfig.eventTypes) {
                            this.plugin.settings.modSyncConfig.eventTypes = {
                                create: true,
                                modify: true,
                                delete: true,
                                rename: true,
                                raw: true
                            };
                        }
                        this.plugin.settings.modSyncConfig.eventTypes.raw = value;
                        await this.plugin.saveSettings();
                        if (this.plugin.modSyncListener) {
                            this.plugin.modSyncListener.updateConfig({
                                eventTypes: this.plugin.settings.modSyncConfig.eventTypes
                            });
                        }
                    })
                );

            // Sync Behavior Configuration
            containerEl.createEl("h3", { text: "Sync Behavior" });
            containerEl.createEl("p", {
                text: "Configure how automatic synchronization works."
            });

            new Setting(containerEl)
                .setName("Dry Run Mode")
                .setDesc("Enable dry run mode - logs what would be synced without actually syncing (USE FOR TESTING)")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.modSyncConfig.dryRun).onChange(async (value) => {
                        this.plugin.settings.modSyncConfig.dryRun = value;
                        await this.plugin.saveSettings();
                        // Update listener config immediately
                        if (this.plugin.modSyncListener) {
                            this.plugin.modSyncListener.updateConfig({
                                dryRun: value
                            });
                        }
                        // Show notification
                        const modeMessage = value ? "DRY RUN MODE ENABLED - No actual syncing will occur" : "Dry run mode disabled - Normal syncing active";
                        this.plugin.show(modeMessage, 5000);
                        console.log(`[ModSync] ${modeMessage}`);
                    })
                );

            new Setting(containerEl)
                .setName("Debounce Delay (milliseconds)")
                .setDesc("Wait time for file editing to pause before processing (default: 2000ms)")
                .addText((text) =>
                    text
                        .setPlaceholder("2000")
                        .setValue(this.plugin.settings.modSyncConfig.debounceDelay.toString())
                        .onChange(async (value) => {
                            const parseVal = parseInt(value, 10);
                            if (isNaN(parseVal) || parseVal < 500) {
                                this.plugin.show("Invalid value (minimum 500ms)");
                            } else {
                                this.plugin.settings.modSyncConfig.debounceDelay = parseVal;
                                await this.plugin.saveSettings();
                                if (this.plugin.modSyncListener) {
                                    this.plugin.modSyncListener.updateConfig({
                                        debounceDelay: parseVal
                                    });
                                }
                            }
                        })
                );
        }
    }
}
