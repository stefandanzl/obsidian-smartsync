import { App, Modal, Notice } from "obsidian";
import SmartSyncPlugin from "./main";
import { FileTree, FileTrees, Location, PLUGIN_ID, Status, Type } from "./const";
import { dirname } from "./util";

type ExplicitAction = "push" | "pull" | "default";
type FileSelection = Set<string>;

export class FileTreeModal extends Modal {
    fileTreeDiv: HTMLDivElement;
    selectedFiles: FileSelection = new Set();
    fileExplicitActions: Map<string, ExplicitAction> = new Map();
    dropdownContainer: HTMLDivElement;

    constructor(
        app: App,
        public plugin: SmartSyncPlugin
    ) {
        super(app);
    }

    onOpen() {
        const { titleEl, modalEl, contentEl } = this;

        modalEl.addClass("smart-sync-modal");
        titleEl.setText("SmartSync");

        // Container for floating dropdowns (context menus)
        this.dropdownContainer = contentEl.createDiv({ cls: "smart-sync-dropdowns-container" });

        const container = contentEl.createDiv({ cls: "smart-sync-container" });

        // ============= HEADER =============
        const header = container.createDiv({ cls: "smart-sync-header" });

        const selectToggleBtn = header.createEl("button", {
            text: "☑️ Select All",
            cls: "smart-sync-header-btn",
        });
        selectToggleBtn.addEventListener("click", () => this.toggleSelectAll(selectToggleBtn));

        const reloadBtn = header.createEl("button", {
            text: "🔄 Reload",
            cls: "smart-sync-header-btn",
        });
        reloadBtn.addEventListener("click", () => {
            this.plugin.operations.check();
        });

        // ============= FILES AREA =============
        this.fileTreeDiv = container.createDiv({ cls: "smart-sync-files-area" });

        // Save scroll position
        this.fileTreeDiv.addEventListener("scroll", (e) => {
            this.plugin.lastScrollPosition = (e.target as HTMLElement).scrollTop;
        });

        // ============= FOOTER =============
        const footer = container.createDiv({ cls: "smart-sync-footer" });

        // Left side - empty for balance
        footer.createDiv({ cls: "smart-sync-footer-spacer" });

        // Center - Sync Button
        this.syncButton = footer.createEl("button", {
            text: `🔄 Sync (0)`,
            cls: ["smart-sync-footer-btn", "smart-sync-primary-btn"],
        });
        this.syncButton.addEventListener("click", () => this.syncSelected());

        // Right side - Action buttons
        const rightActions = footer.createDiv({ cls: "smart-sync-footer-right" });

        // Special Actions Dropdown
        const specialActionsBtn = rightActions.createEl("button", {
            text: "⚡ Actions",
            cls: "smart-sync-footer-btn",
        });
        this.createDropdown(specialActionsBtn, [
            {
                label: "📋 Replicate Local → Remote",
                action: () => this.confirmAndRun("Replicate local on remote", () => this.plugin.operations.duplicateLocal()),
            },
            {
                label: "🌐 Replicate Remote → Local",
                action: () => this.confirmAndRun("Replicate remote on local", () => this.plugin.operations.duplicateRemote()),
            },
            { label: "⬆️ Push Selected", action: () => this.confirmAndRun("Push selected files", () => this.pushSelected()) },
            { label: "⬇️ Pull Selected", action: () => this.confirmAndRun("Pull selected files", () => this.pullSelected()) },
        ]);

        // Maintenance Dropdown
        const maintenanceBtn = rightActions.createEl("button", {
            text: "🔧",
            cls: "smart-sync-footer-btn",
            title: "Maintenance",
        });
        this.createDropdown(maintenanceBtn, [
            { label: "❌ Clear Error States", action: () => this.clearErrors() },
            { label: "💾 Save Vault State", action: () => this.plugin.saveState() },
            { label: "⚙️ Settings", action: () => this.openSettings() },
            { label: "⏸️ Pause Sync", action: () => this.togglePause() },
        ]);

        // Close dropdowns when clicking outside
        document.addEventListener("click", (e) => {
            if (!(e.target as HTMLElement).closest(".smart-sync-dropdown, .smart-sync-menu-btn")) {
                this.closeAllDropdowns();
            }
        });

        // Load and render files
        if (!this.plugin.fileTrees) {
            this.plugin.operations.check();
        } else {
            this.renderFileTrees();
        }
    }

    private syncButton: HTMLButtonElement;

    private toggleSelectAll(btn: HTMLButtonElement) {
        const allPaths = this.getAllFilePaths();
        const allSelected = allPaths.length > 0 && this.selectedFiles.size === allPaths.length;

        if (allSelected) {
            this.selectedFiles.clear();
            btn.textContent = "☑️ Select All";
        } else {
            allPaths.forEach((path) => this.selectedFiles.add(path));
            btn.textContent = "☐ Select None";
        }
        this.renderFileTrees();
        this.updateSyncButton();
    }

    private toggleFileSelection(path: string) {
        if (this.selectedFiles.has(path)) {
            this.selectedFiles.delete(path);
        } else {
            this.selectedFiles.add(path);
        }
        this.updateSyncButton();
    }

    private updateSyncButton() {
        const count = this.selectedFiles.size;
        this.syncButton.textContent = `🔄 Sync (${count})`;
    }

    private getAllFilePaths(): string[] {
        const paths: string[] = [];
        if (!this.plugin.fullFileTrees) return paths;

        ["remoteFiles", "localFiles"].forEach((location) => {
            const locationData = this.plugin.fullFileTrees![location as keyof FileTrees];
            ["added", "deleted", "modified"].forEach((type) => {
                Object.keys(locationData[type as keyof FileTree]).forEach((path) => {
                    paths.push(path);
                });
            });
        });
        return paths;
    }

    private createDropdown(button: HTMLButtonElement, items: { label: string; action: () => void }[]): void {
        const dropdown = document.createElement("div");
        dropdown.addClass("smart-sync-dropdown");
        this.dropdownContainer.appendChild(dropdown);

        const dropdownContent = dropdown.createDiv({ cls: "smart-sync-dropdown-content" });

        items.forEach((item) => {
            const itemEl = dropdownContent.createEl("button", {
                text: item.label,
                cls: "smart-sync-dropdown-item",
            });
            itemEl.addEventListener("click", (e) => {
                e.stopPropagation();
                this.closeAllDropdowns();
                item.action();
            });
        });

        button.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = dropdown.hasClass("open");
            this.closeAllDropdowns();
            if (!isOpen) {
                const rect = button.getBoundingClientRect();
                // Position above the button
                dropdown.style.bottom = window.innerHeight - rect.top + 8 + "px";
                dropdown.style.left = rect.left + rect.width / 2 - 90 + "px";
                dropdown.addClass("open");
            }
        });
    }

    private closeAllDropdowns() {
        this.dropdownContainer.querySelectorAll(".smart-sync-dropdown.open").forEach((el) => {
            el.removeClass("open");
            (el as HTMLElement).style.bottom = "";
            (el as HTMLElement).style.left = "";
        });
        this.dropdownContainer.querySelectorAll(".smart-sync-context-menu.open").forEach((el) => {
            el.removeClass("open");
            (el as HTMLElement).style.top = "";
            (el as HTMLElement).style.right = "";
        });
    }

    private confirmAndRun(actionName: string, action: () => void) {
        const confirm = new Modal(this.app);
        confirm.contentEl.createEl("p", {
            text: `Are you sure you want to ${actionName.toLowerCase()}?`,
            cls: "smart-sync-confirm-text",
        });

        const btnContainer = confirm.contentEl.createDiv({ cls: "smart-sync-confirm-buttons" });

        const yesBtn = btnContainer.createEl("button", {
            text: "Yes",
            cls: ["mod-cta", "smart-sync-confirm-btn"],
        });
        yesBtn.addEventListener("click", () => {
            action();
            confirm.close();
        });

        const noBtn = btnContainer.createEl("button", {
            text: "No",
            cls: "smart-sync-confirm-btn",
        });
        noBtn.addEventListener("click", () => confirm.close());

        confirm.open();
    }

    private async syncSelected() {
        if (this.selectedFiles.size === 0) {
            new Notice("No files selected");
            return;
        }
        this.plugin.operations.fullSync();
    }

    private async pushSelected() {
        new Notice(`Pushing ${this.selectedFiles.size} files`);
    }

    private async pullSelected() {
        new Notice(`Pulling ${this.selectedFiles.size} files`);
    }

    private clearErrors() {
        this.plugin.prevData.error = false;
        this.plugin.setStatus(Status.NONE);
        new Notice("Error states cleared");
    }

    private openSettings() {
        this.plugin.settingPrivate.openTabById(PLUGIN_ID);
        this.plugin.settingPrivate.open();
    }

    private togglePause() {
        this.plugin.togglePause();
    }

    renderFileTrees() {
        this.fileTreeDiv.empty();

        if (!this.plugin.fullFileTrees) {
            this.fileTreeDiv.createEl("p", { text: "Loading...", cls: "smart-sync-loading" });
            return;
        }

        const hasAnyChanges = ["remoteFiles", "localFiles"].some((location) => {
            const locationData = this.plugin.fullFileTrees![location as keyof FileTrees];
            return Object.values(locationData).some((section) => Object.keys(section).length > 0);
        });

        if (!hasAnyChanges) {
            this.fileTreeDiv.createDiv({
                cls: "smart-sync-empty",
                text: "✓ No changes to sync!",
            });
            return;
        }

        // Render Local and Remote sections
        const locations: { key: keyof FileTrees; title: string; icon: string }[] = [
            { key: "localFiles", title: "Local", icon: "💻" },
            { key: "remoteFiles", title: "Remote", icon: "☁️" },
        ];

        const types: Array<{ key: keyof FileTree; title: string; icon: string; color: string }> = [
            { key: "added", title: "Added", icon: "➕", color: "green" },
            { key: "modified", title: "Modified", icon: "✏️", color: "orange" },
            { key: "deleted", title: "Deleted", icon: "🗑️", color: "red" },
        ];

        locations.forEach(({ key, title, icon }) => {
            const locationData = this.plugin.fullFileTrees![key];
            const hasChanges = Object.values(locationData).some((section) => Object.keys(section).length > 0);

            if (!hasChanges) return;

            const locationEl = this.fileTreeDiv.createDiv({ cls: "smart-sync-location" });
            locationEl.createDiv({ cls: "smart-sync-location-title", text: `${icon} ${title}` });

            types.forEach(({ key: typeKey, title: typeTitle, icon: typeIcon, color }) => {
                const files = locationData[typeKey];
                if (Object.keys(files).length === 0) return;

                const sectionEl = locationEl.createDiv({ cls: "smart-sync-section" });
                sectionEl.createDiv({
                    cls: ["smart-sync-section-title", `smart-sync-section-${color}`],
                    text: `${typeIcon} ${typeTitle} (${Object.keys(files).length})`,
                });

                const filesContainer = sectionEl.createDiv({ cls: "smart-sync-files-list" });

                Object.keys(files).forEach((path) => {
                    this.renderFileRow(filesContainer, path, key, typeKey);
                });
            });
        });

        // Restore scroll position
        this.fileTreeDiv.scrollTop = this.plugin.lastScrollPosition;
    }

    private renderFileRow(container: HTMLElement, path: string, _location: Location, _type: Type) {
        const row = container.createDiv({
            cls: ["smart-sync-file-row", this.selectedFiles.has(path) ? "selected" : ""],
            attr: { "data-path": path },
        });

        // Checkbox
        const checkbox = row.createDiv({ cls: "smart-sync-checkbox" });
        checkbox.innerHTML = this.selectedFiles.has(path) ? "☑️" : "☐";
        checkbox.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleFileSelection(path);
            checkbox.innerHTML = this.selectedFiles.has(path) ? "☑️" : "☐";
            row.toggleClass("selected", this.selectedFiles.has(path));
        });

        // File path (clickable parts)
        const pathContainer = row.createDiv({ cls: "smart-sync-path-container" });

        // Icon
        const icon = path.endsWith("/") ? "📁" : this.getFileIcon(path);
        pathContainer.createSpan({ cls: "smart-sync-file-icon", text: icon });

        // Split path into directory and filename
        const lastSlash = path.lastIndexOf("/");
        if (lastSlash > 0) {
            const dirPart = path.substring(0, lastSlash + 1);
            const filePart = path.substring(lastSlash + 1);

            const dirEl = pathContainer.createSpan({ cls: "smart-sync-path-dir", text: dirPart });
            dirEl.addEventListener("click", () => this.openInExplorer(path));

            const fileEl = pathContainer.createSpan({ cls: "smart-sync-path-file", text: filePart });
            fileEl.addEventListener("click", () => this.openFile(path));
        } else {
            const fileEl = pathContainer.createSpan({ cls: "smart-sync-path-file", text: path });
            fileEl.addEventListener("click", () => this.openFile(path));
        }

        // Explicit action dropdown (now to the right of path)
        const actionSelect = row.createEl("select", { cls: "smart-sync-action-select" });
        const blankOption = actionSelect.createEl("option", { value: "", text: "" });
        actionSelect.createEl("option", { value: "push", text: "⬆️ Push" });
        actionSelect.createEl("option", { value: "pull", text: "⬇️ Pull" });

        const currentAction = this.fileExplicitActions.get(path);
        if (currentAction) {
            actionSelect.value = currentAction;
        } else {
            blankOption.selected = true;
        }

        actionSelect.addEventListener("change", (e) => {
            const action = (e.target as HTMLSelectElement).value as ExplicitAction;
            if (action) {
                this.fileExplicitActions.set(path, action);
            } else {
                this.fileExplicitActions.delete(path);
            }
        });

        actionSelect.addEventListener("click", (e) => e.stopPropagation());

        // Action menu button (three dots)
        const menuBtn = row.createDiv({ cls: "smart-sync-menu-btn", text: "⋮" });
        menuBtn.addEventListener("click", (e) => e.stopPropagation());

        this.createContextMenu(menuBtn, path);
    }

    private createContextMenu(button: HTMLElement, path: string): void {
        const menu = document.createElement("div");
        menu.addClass("smart-sync-context-menu");
        this.dropdownContainer.appendChild(menu);

        const items = [
            { label: "📂 Open in Explorer", action: () => this.openInExplorer(path) },

            { label: "🔍 Show Diff", action: () => this.showDiff(path) },
        ];
        if (!path.startsWith(this.app.vault.configDir)) {
            items.unshift({ label: "📝 Open in Obsidian", action: () => this.openFile(path) });
        }

        items.forEach((item) => {
            const itemEl = menu.createEl("button", {
                text: item.label,
                cls: "smart-sync-context-item",
            });
            itemEl.addEventListener("click", (e) => {
                e.stopPropagation();
                this.closeAllDropdowns();
                item.action();
            });
        });

        button.addEventListener("click", (e) => {
            e.stopPropagation();
            this.closeAllDropdowns();
            const rect = button.getBoundingClientRect();
            menu.style.top = rect.bottom + 4 + "px";
            menu.style.right = window.innerWidth - rect.right + "px";
            menu.addClass("open");
        });
    }

    private getFileIcon(path: string): string {
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

    private openInExplorer(path: string) {
        // Get the resource path which is in app://vault-id/path format
        // const tFile = this.app.vault.getAbstractFileByPath(path);

        try {
            //@ts-ignore No longer in Obsidian API included
            // var resourcePath = this.app.vault.adapter.getFullPath(tFile.path);
            //@ts-ignore No longer in Obsidian API included
            const basePath = this.app.vault.adapter.getBasePath().replaceAll("\\", "/");

            console.log(basePath);
            // console.log(resourcePath);

            // const systemPath = decodeURIComponent(urlMatch[1]);
            // var resourcePath = resourcePath.replaceAll("\\", "/");
            const directoryPath = dirname(path);
            console.log(directoryPath);

            const systemPath = encodeURI(`${basePath}/${directoryPath}`);
            console.log("enocded ", systemPath);
            // Open with file:/// protocol for system file explorer
            window.open(`file:///${systemPath}`, "_blank");
        } catch (error) {
            console.error("error, ", error);
        }
    }

    private openFile(path: string) {
        if (path.endsWith("/")) return;
        if (path.startsWith(this.app.vault.configDir)) return;
        this.app.workspace.openLinkText(path, "", "tab");
    }

    private showDiff(path: string) {
        new Notice(`Showing diff for ${path}`);
    }

    onClose() {
        this.dropdownContainer?.remove();
        const { contentEl } = this;
        contentEl.empty();
    }
}
