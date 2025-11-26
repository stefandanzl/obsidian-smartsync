import { App, Modal } from "obsidian";
import Cloudr from "./main";
import { FileTree, FileTrees, Location, PLUGIN_ID, Status, Type } from "./const";

export class FileTreeModal extends Modal {
    fileTreeDiv: HTMLDivElement;
    pathRenderObject: Record<string, HTMLDivElement>;
    sectionRenderObject: Record<
        string,
        {
            type: Type;
            location: Location;
            element: HTMLDivElement;
            isEnabled: boolean;
        }
    >;
    constructor(
        app: App,
        public plugin: Cloudr
    ) {
        super(app);
    }

    onOpen() {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { titleEl, modalEl, contentEl, containerEl } = this;

        this.pathRenderObject = {};
        this.sectionRenderObject = {};

        modalEl.addClass("webdav-modal");
        titleEl.setText("WebDAV Control Panel");

        const mainDiv = contentEl.createDiv({ cls: "webdav-container" });

        const buttonDiv = mainDiv.createDiv({ cls: "webdav-button-container" });

        // Add button sections
        const basicSection = buttonDiv.createDiv({ cls: "webdav-button-section" });

        const advancedSection = buttonDiv.createDiv({ cls: "webdav-button-section advanced-section" });
        advancedSection.createEl("h3", { text: "Advanced", cls: "webdav-section-title" });

        let advancedEnabled = false;

        // Add clickable status bar as test button
        const statusBar = basicSection.createDiv({ cls: "webdav-status-bar clickable" });
        const statusText = statusBar.createSpan({ cls: "webdav-status-text" });
        statusText.setText("Ready");
        statusText.setCssStyles({
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        });

        statusBar.addEventListener("click", () => {
            this.plugin.operations.test();
        });

        // Add hover hint for clickable status
        statusBar.title = "Click to test connection";

        /**
         * CHECK Button
         */
        const checkButton = basicSection.createEl("button", {
            text: `🔍 CHECK ${Status.CHECK}`,
            cls: ["mod-cta", "webdav-button"],
        });
        checkButton.addEventListener("click", () => {
            this.plugin.operations.check();
        });

        /**
         * SYNC Button
         */
        const syncButton = basicSection.createEl("button", {
            text: `🔄 SYNC ${Status.SYNC}`,
            cls: ["mod-cta", "webdav-button"],
        });
        syncButton.addEventListener("click", async () => {
            // this.plugin.show("Synchronizing files with server ...")
            this.plugin.operations.fullSync();
        });

        /**
         * ADVANCED Button
         */
        const advancedButton = basicSection.createEl("button", {
            text: "⚡ ADVANCED",
            cls: ["mod-cta", "webdav-button"],
        });
        advancedButton.addEventListener("click", async () => {
            if (advancedEnabled) {
                this.plugin.show("Advanced Actions Buttons already enabled.");
                advancedEnabled = false;
                advancedSection.style.display = "none";
                return;
            }
            this.plugin.show("Warning! Use Advanced Actions carefully!");
            advancedEnabled = true;

            // Show advanced section
            advancedSection.style.display = "block";
        });

        /**
         * Webdav Settings Button
         */
        const openSettingsButton = advancedSection.createEl("button", {
            text: "⚙️ SETTINGS",
            cls: ["mod-cta", "webdav-button"],
        });
        openSettingsButton.addEventListener("click", () => {
            this.plugin.settingPrivate.openTabById(PLUGIN_ID);
            this.plugin.settingPrivate.open();
        });

        /**
         * PAUSE Button
         */
        const pauseButton = advancedSection.createEl("button", {
            text: `⏸️ PAUSE ${Status.PAUSE}`,
            cls: ["mod-cta", "webdav-button"],
        });
        pauseButton.addEventListener("click", () => {
            this.plugin.show("Toggling Pause");
            this.plugin.togglePause();
        });

        /**
         * ERROR Button
         */
        const errorButton = advancedSection.createEl("button", {
            text: `🚨 ERROR ${Status.ERROR}`,
            cls: ["mod-cta", "webdav-button"],
            title: "Clear the error status in your previous data storage",
        });
        errorButton.addEventListener("click", () => {
            this.plugin.show("Resetting Error status");
            this.plugin.prevData.error = false;
            this.plugin.setStatus(Status.NONE);
        });

        /**
         * SAVE Button
         */
        const saveButton = advancedSection.createEl("button", {
            text: `💾 SAVE ${Status.SAVE}`,
            cls: ["mod-cta", "webdav-button"],
        });
        saveButton.addEventListener("click", () => {
            this.plugin.show("Saving current vault file state for future synchronisation actions");
            this.plugin.saveState();
        });

        /**
         * PULL Button
         */
        const pullButton = advancedSection.createEl("button", {
            text: `⬇️ PULL ${Status.PULL}`,
            cls: ["mod-cta", "webdav-button"],
        });
        pullButton.addEventListener("click", async () => {
            this.plugin.operations.pull();
        });

        /**
         * PUSH Button
         */
        const pushButton = advancedSection.createEl("button", {
            text: `⬆️ PUSH ${Status.PUSH}`,
            cls: ["mod-cta", "webdav-button"],
        });
        pushButton.addEventListener("click", async () => {
            // this.plugin.show("Pushing files to server ...")
            this.plugin.operations.push();
        });

        const dupLocalBtn = advancedSection.createEl("button", {
            text: `📋 DUPLICATE LOCAL`,
            cls: ["mod-cta", "webdav-button", "button-danger"],
        });
        dupLocalBtn.addEventListener("click", async () => {
            await this.plugin.operations.duplicateLocal();
        });

        const dupWebBtn = advancedSection.createEl("button", {
            text: `🌐 DUPLICATE WEBDAV`,
            cls: ["mod-cta", "webdav-button", "button-danger"],
        });
        dupWebBtn.addEventListener("click", async () => {
            await this.plugin.operations.duplicateWebdav();
        });

        const containDiv = mainDiv.createDiv({ cls: "webdav-content" });

        // Update status based on plugin state
        const updateStatus = () => {
            const status = this.plugin.status;
            const statusMessages: Record<Status, string> = {
                [Status.NONE]: "Ready",
                [Status.TEST]: "Testing connection...",
                [Status.CHECK]: "Checking for changes...",
                [Status.SYNC]: "Synchronizing files...",
                [Status.AUTO]: "Auto-syncing...",
                [Status.SAVE]: "Saving state...",
                [Status.OFFLINE]: "Offline",
                [Status.ERROR]: "Error occurred",
                [Status.PULL]: "Pulling files...",
                [Status.PUSH]: "Pushing files...",
                [Status.PAUSE]: "Paused",
            };

            statusText.setText(`${status} ${statusMessages[status] || "Unknown status"}`);
            statusBar.className = `webdav-status-bar status-${status.toLowerCase()}`;
        };

        // Set initial status and create status updater
        updateStatus();

        // Override plugin's setStatus method to update our status bar
        const originalSetStatus = this.plugin.setStatus.bind(this.plugin);
        (this as any).originalSetStatus = originalSetStatus;
        this.plugin.setStatus = async (status: Status, show?: boolean, text?: string) => {
            await originalSetStatus(status, show, text);
            updateStatus();
        };

        this.fileTreeDiv = containDiv.createDiv({ cls: "webdav-file-tree" });
        // Save position
        this.fileTreeDiv.addEventListener("scroll", (e) => {
            this.plugin.lastScrollPosition = (e.target as HTMLElement).scrollTop;
        });

        if (!this.plugin.fileTrees) {
            this.plugin.operations.check();
        } else {
            this.renderFileTrees();
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        // Restore original setStatus method
        if ((this as any).originalSetStatus) {
            this.plugin.setStatus = (this as any).originalSetStatus;
        }
        this.plugin.modal;
    }

    renderFileTrees() {
        // Clear previous content
        this.fileTreeDiv.empty();
        const mainContainer = this.fileTreeDiv.createDiv({ cls: "sync-status" });

        // Check if there's anything to sync
        const hasAnyChanges = ["webdavFiles", "localFiles"].some((location) => {
            // IMPORTANT! NOT USING fileTrees here because it will be modified! For rendering using an original twin
            const locationData = this.plugin.fullFileTrees[location as keyof FileTrees];
            return Object.values(locationData).some((section) => Object.keys(section).length > 0);
        });

        if (!hasAnyChanges) {
            const emptyMessage = mainContainer.createDiv({ cls: "sync-empty-message" });
            emptyMessage.createDiv({
                cls: "sync-empty-text",
                text: "Nothing to sync ✓",
            });
            return mainContainer;
        }

        // Helper function to get appropriate icon for file type
        function getFileIcon(path: string): string {
            if (path.endsWith("/")) return "📁";

            const ext = path.split(".").pop()?.toLowerCase();
            switch (ext) {
                case "md":
                    return "📝";
                case "txt":
                    return "📄";
                case "pdf":
                    return "📕";
                case "png":
                case "jpg":
                case "jpeg":
                case "gif":
                case "svg":
                    return "🖼️";
                case "mp3":
                case "wav":
                case "ogg":
                    return "🎵";
                case "mp4":
                case "avi":
                case "mov":
                    return "🎬";
                case "zip":
                case "rar":
                case "7z":
                    return "📦";
                case "js":
                case "ts":
                case "jsx":
                case "tsx":
                    return "🟨";
                case "py":
                    return "🐍";
                case "java":
                    return "☕";
                case "cpp":
                case "c":
                case "h":
                    return "🔧";
                default:
                    return "📄";
            }
        }

        // Helper function to get section icon
        function getSectionIcon(type: string): string {
            switch (type.toLowerCase()) {
                case "added":
                    return "➕";
                case "deleted":
                    return "🗑️";
                case "modified":
                    return "✏️";
                case "except":
                    return "⚠️";
                default:
                    return "📄";
            }
        }

        // Helper function to render a section if it has entries
        function renderSection(
            plugin: Cloudr,
            parent: HTMLElement,
            title: string,
            data: Record<string, string>,
            parents: { location: Location; type: Type }
        ) {
            if (Object.keys(data).length === 0) return;

            const sectionDiv = parent.createDiv({ cls: "sync-section" });

            const titleDiv = sectionDiv.createDiv({
                cls: ["sync-section-title"],
                text: `${getSectionIcon(title)} ${title}`,
            });

            if (parents.location + parents.type in plugin.modal.sectionRenderObject) {
                if (!plugin.modal.sectionRenderObject[parents.location + parents.type].isEnabled) {
                    titleDiv.addClass("file-user-disabled");
                }
            } else {
                plugin.modal.sectionRenderObject[parents.location + parents.type] = {
                    type: parents.type,
                    location: parents.location as Location,
                    element: titleDiv,
                    isEnabled: true,
                };
            }

            titleDiv.onClickEvent((event) => {
                switch (event.button) {
                    case 0:
                        if (!plugin.modal.sectionRenderObject[parents.location + parents.type].isEnabled) {
                            // ENABLE
                            plugin.modal.sectionRenderObject[parents.location + parents.type].isEnabled = true;
                            plugin.modal.sectionRenderObject[parents.location + parents.type].element.removeClass("file-user-disabled");

                            Object.entries(plugin.tempExcludedFiles).forEach(([pa, { location, type, hash }]) => {
                                if (location === parents.location && type === parents.type) {
                                    delete plugin.tempExcludedFiles[pa];
                                    plugin.fileTrees[parents?.location as keyof FileTrees][parents?.type as keyof FileTree][pa] = hash;
                                    plugin.modal.pathRenderObject[pa]?.removeClass("file-user-disabled");
                                }
                            });
                        } else {
                            // DISABLE
                            plugin.modal.sectionRenderObject[parents.location + parents.type].isEnabled = false;
                            plugin.modal.sectionRenderObject[parents.location + parents.type].element.addClass("file-user-disabled");

                            Object.entries(plugin.fileTrees[parents.location][parents.type]).forEach(([pa, ha]) => {
                                plugin.tempExcludedFiles[pa] = {
                                    location: parents.location,
                                    type: parents.type,
                                    hash: ha,
                                };

                                delete plugin.fileTrees[parents.location][parents.type][pa];
                                plugin.modal.pathRenderObject[pa].addClass("file-user-disabled");
                            });
                        }

                        break;

                    default:
                        break;
                }
            });

            const contentDiv = sectionDiv.createDiv({ cls: "sync-section-content" });

            Object.keys(data).forEach((path) => {
                const classes = ["sync-file-entry"];
                if (path in plugin.tempExcludedFiles) {
                    if (plugin.tempExcludedFiles[path].type === "except") {
                        if (plugin.tempExcludedFiles[path].location === "localFiles") {
                            classes.push("file-user-upload");
                        } else {
                            classes.push("file-user-download");
                        }
                    } else {
                        classes.push("file-user-disabled");
                    }
                } else {
                    if (parents?.type === "except") {
                        classes.push("file-user-disabled");
                    }
                }
                const pathDiv = contentDiv.createDiv({
                    cls: classes,
                });

                // Add file icon and path
                const iconSpan = pathDiv.createSpan({ cls: "file-icon" });
                iconSpan.setText(getFileIcon(path));

                const pathSpan = pathDiv.createSpan({ cls: "file-path" });
                pathSpan.setText(path);

                plugin.modal.pathRenderObject[path] = pathDiv;

                pathDiv.onClickEvent((event) => {
                    switch (event.button) {
                        // Left Click
                        case 0:
                            if (!parents) {
                                return;
                            }

                            if (Object.keys(plugin.tempExcludedFiles).includes(path)) {
                                // ENABLE
                                const hash = plugin.tempExcludedFiles[path].hash;
                                delete plugin.tempExcludedFiles[path];
                                plugin.fileTrees[parents?.location as keyof FileTrees][parents?.type as keyof FileTree][path] = hash;
                                pathDiv.removeClass("file-user-disabled");
                                if (path.endsWith("/")) {
                                    Object.keys(plugin.tempExcludedFiles).forEach((pa) => {
                                        if (pa.startsWith(path)) {
                                            const ha = plugin.tempExcludedFiles[pa].hash;
                                            delete plugin.tempExcludedFiles[pa];
                                            plugin.fileTrees[parents?.location as keyof FileTrees][parents?.type as keyof FileTree][pa] =
                                                ha;
                                            plugin.modal.pathRenderObject[pa]?.removeClass("file-user-disabled");
                                        }
                                    });
                                }
                            } else {
                                // DISABLE
                                const hash = plugin.fileTrees[parents.location as keyof FileTrees][parents.type as keyof FileTree][path];

                                plugin.tempExcludedFiles[path] = { location: parents.location as Location, type: parents.type, hash: hash };

                                delete plugin.fileTrees[parents.location as keyof FileTrees][parents.type as keyof FileTree][path];
                                pathDiv.addClass("file-user-disabled");

                                if (path.endsWith("/")) {
                                    Object.entries(plugin.fileTrees[parents?.location as keyof FileTrees][parents.type]).forEach(
                                        ([pa, ha]) => {
                                            if (pa.startsWith(path)) {
                                                plugin.tempExcludedFiles[pa] = {
                                                    location: parents.location as Location,
                                                    type: parents.type,
                                                    hash: ha,
                                                };

                                                delete plugin.fileTrees[parents.location as keyof FileTrees][
                                                    parents.type as keyof FileTree
                                                ][pa];
                                                plugin.modal.pathRenderObject[pa].addClass("file-user-disabled");
                                            }
                                        }
                                    );
                                }
                            }

                            break;
                        // Middle Click
                        case 1:
                            if (
                                !(
                                    path.startsWith(plugin.app.vault.configDir) ||
                                    (parents?.type === "deleted" && parents?.location === "localFiles")
                                )
                            ) {
                                if (path.endsWith("/")) {
                                    //
                                } else {
                                    plugin.app.workspace.openLinkText(path, "", "tab"); //   openFile(file: TFile, openState?: OpenViewState)
                                }
                            }
                            break;
                        // Right Click
                        case 2:
                            if (!parents) {
                                return;
                            }
                            if (parents.type === "except") {
                                // check if defined
                                if (!Object.keys(plugin.tempExcludedFiles).includes(path)) {
                                    // UPLOAD
                                    const location: Location = "localFiles";
                                    const hash = plugin.fileTrees[location][parents.type][path];
                                    plugin.tempExcludedFiles[path] = {
                                        location,
                                        type: "except",
                                        hash,
                                    };
                                    plugin.fileTrees[location].modified[path] = hash;
                                    delete plugin.fileTrees.webdavFiles.except[path];
                                    delete plugin.fileTrees.localFiles.except[path];

                                    pathDiv.addClass("file-user-upload");
                                } else if (plugin.tempExcludedFiles[path].location === "localFiles") {
                                    // DOWNLOAD
                                    const location: Location = "webdavFiles";
                                    const hash = plugin.fileTrees[location][parents.type][path];
                                    plugin.tempExcludedFiles[path] = {
                                        location,
                                        type: "except",
                                        hash,
                                    };
                                    plugin.fileTrees[location].modified[path] = hash;
                                    delete plugin.fileTrees["localFiles"].modified[path];
                                    pathDiv.removeClass("file-user-upload");
                                    pathDiv.addClass("file-user-download");
                                } else if (plugin.tempExcludedFiles[path].location === "webdavFiles") {
                                    // RESET TO EXCEPT
                                    const hash = plugin.fileTrees.webdavFiles[parents.type][path];
                                    delete plugin.tempExcludedFiles[path];

                                    delete plugin.fileTrees["webdavFiles"].modified[path];
                                    pathDiv.removeClass("file-user-download");

                                    plugin.fileTrees.webdavFiles.except[path] = hash;
                                    plugin.fileTrees.localFiles.except[path] = hash;
                                }
                                return;
                            }

                            // sync: check if path is in tempExcluded
                            // save: don't save the current hash for path
                            console.log(plugin.tempExcludedFiles);
                            break;
                        default:
                            break;
                    }
                });
            });
        }

        // Render each location if it has any changes
        ["webdavFiles", "localFiles"].forEach((location) => {
            // IMPORTANT: using copy of fileTrees for rendering it in entirety and then adding formatting
            const locationData = this.plugin.fullFileTrees[location as keyof FileTrees];
            const hasChanges = Object.values(locationData).some((section) => Object.keys(section).length > 0);

            if (hasChanges) {
                const locationDiv = mainContainer.createDiv({ cls: "sync-location" });
                locationDiv.createDiv({
                    cls: "sync-location-title",
                    text: location === "webdavFiles" ? "☁️ Remote" : "💻 Local",
                });

                ["added", "deleted", "modified"].forEach((type) => {
                    renderSection(
                        this.plugin,
                        locationDiv,
                        type.charAt(0).toUpperCase() + type.slice(1),
                        locationData[type as keyof FileTree],
                        //@ts-ignore
                        { location, type }
                    );
                });
            }
        });

        if (Object.keys(this.plugin.fullFileTrees.localFiles.except).length > 0) {
            const locationDiv = mainContainer.createDiv({ cls: "sync-location" });
            locationDiv.createDiv({
                cls: "sync-location-title",
                text: "File exceptions",
            });
            renderSection(this.plugin, locationDiv, "Except", this.plugin.fullFileTrees.localFiles.except, {
                type: "except",
                location: "localFiles",
            });
        }
        // Restore scroll position after content is rendered
        this.fileTreeDiv.scrollTop = this.plugin.lastScrollPosition;
        // return mainContainer;
    }
}
