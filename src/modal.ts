import { App, Modal, Notice } from "obsidian";
import SmartSyncPlugin from "./main";
import { DiffModal } from "./diffModal";
import { FileTree, FileTrees, Location, PLUGIN_ID, STATUS_ITEMS, Status, DiffType, SyncProfile } from "./const";
import { dirname } from "./util";

export class FileTreeModal extends Modal {
	fileTreeDiv: HTMLDivElement;
	dropdownContainer: HTMLDivElement;
	statusIndicator: HTMLSpanElement;

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

		// Sync Profile Dropdown
		const profileSelect = header.createEl("select", { cls: "smart-sync-header-btn" });
		profileSelect.createEl("option", { value: "default", text: "🔄 Default" });
		profileSelect.createEl("option", { value: "push", text: "⬆️ Push" });
		profileSelect.createEl("option", { value: "pull", text: "⬇️ Pull" });
		profileSelect.createEl("option", { value: "replicateLocal", text: "📋 Replicate Local" });
		profileSelect.createEl("option", { value: "replicateRemote", text: "🌐 Replicate Remote" });
		profileSelect.value = "default";
		profileSelect.addEventListener("change", (e) => {
			const profile = (e.target as HTMLSelectElement).value as SyncProfile;
			this.applyProfile(profile);
		});

		// Status indicator in the center
		this.statusIndicator = header.createSpan({
			cls: "smart-sync-status-indicator",
		});
		this.updateStatusIndicator();

		const reloadBtn = header.createEl("button", {
			text: "🔄 Reload",
			cls: ["smart-sync-header-btn", "smart-sync-header-btn-right"],
		});
		reloadBtn.addEventListener("click", async () => {
			await this.plugin.operations.check();
			this.updateSyncButton();
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

		// Right side - Maintenance button
		const rightActions = footer.createDiv({ cls: "smart-sync-footer-right" });

		// Maintenance Dropdown
		const maintenanceBtn = rightActions.createEl("button", {
			text: "🔧",
			cls: "smart-sync-footer-btn",
			title: "Maintenance",
		});
		this.createDropdown(maintenanceBtn, [
			{ label: "🔌 Test Connection", action: () => this.plugin.operations.test(true, true) },
			{ label: "❌ Clear Error States", action: () => this.clearErrors() },
			{ label: "💾 Save Vault State", action: () => this.plugin.saveState() },
			{ label: "⚙️ SmartSync Settings", action: () => this.openSettings() },
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
			this.plugin.operations.check().then(() => this.updateSyncButton());
		} else {
			this.renderFileTrees();
			this.updateSyncButton();
		}
	}

	private syncButton: HTMLButtonElement;

	private toggleSelectAll(btn: HTMLButtonElement) {
		const allPaths = this.getAllFilePaths();
		const allSelected =
			allPaths.length > 0 && allPaths.every((path) => this.plugin.fileSelection[path]?.selected === true);

		if (allSelected) {
			// Deselect all
			for (const path of allPaths) {
				if (this.plugin.fileSelection[path]) {
					this.plugin.fileSelection[path].selected = false;
				}
			}
			btn.textContent = "☑️ Select All";
		} else {
			// Select all
			for (const path of allPaths) {
				if (this.plugin.fileSelection[path]) {
					this.plugin.fileSelection[path].selected = true;
				}
			}
			btn.textContent = "☐ Select None";
		}
		this.renderFileTrees();
		this.updateSyncButton();
	}

	private toggleFileSelection(path: string) {
		if (this.plugin.fileSelection[path]) {
			this.plugin.fileSelection[path].selected = !this.plugin.fileSelection[path].selected;
		}
		this.updateSyncButton();
	}

	private updateSyncButton() {
		const count = Object.values(this.plugin.fileSelection).filter((v) => v.selected === true).length;
		this.syncButton.textContent = `🔄 Sync (${count})`;
	}

	private applyProfile(profile: SyncProfile) {
		for (const selection of Object.values(this.plugin.fileSelection)) {
			const location = selection.location;
			const diffType = selection.diffType;

			switch (profile) {
				case "push":
					if (location === "local") {
						selection.selected = true;
						selection.inverse = undefined;
					} else if (location === "remote") {
						selection.selected = false;
					}
					if (diffType === "except") {
						selection.location = "local";
					}
					break;
				case "pull":
					if (location === "local") {
						selection.selected = false;
					} else if (location === "remote") {
						selection.selected = true;
						selection.inverse = undefined;
					}
					if (diffType === "except") {
						selection.location = "remote";
					}
					break;
				case "replicateLocal":
					if (location === "local") {
						selection.selected = true;
						selection.inverse = undefined;
					} else if (location === "remote") {
						selection.selected = true;
						selection.inverse = true;
					}
					if (diffType === "except") {
						selection.location = "local";
					}
					break;
				case "replicateRemote":
					if (location === "local") {
						selection.selected = true;
						selection.inverse = true;
					} else if (location === "remote") {
						selection.selected = true;
						selection.inverse = undefined;
					}
					if (diffType === "except") {
						selection.location = "remote";
					}
					break;
				case "default":
					selection.selected = true;
					selection.inverse = undefined;
					if (diffType === "except") {
						selection.location = undefined;
					}
					break;
			}
		}
		this.renderFileTrees();
		this.updateSyncButton();
	}

	private initializeSelectedFiles() {
		if (!this.plugin.fileTrees) return;

		// First, collect all current paths from fileTrees
		const currentPaths = new Set<string>();
		const locations: (keyof FileTrees)[] = ["local", "remote"];
		const types: (keyof FileTree)[] = ["added", "modified", "deleted", "except"];

		for (const locationKey of locations) {
			for (const typeKey of types) {
				const files = this.plugin.fileTrees[locationKey][typeKey];
				for (const [path] of Object.entries(files)) {
					currentPaths.add(path);
					// Only add if not already present (preserve existing selections)
					if (!this.plugin.fileSelection[path]) {
						this.plugin.fileSelection[path] = {
							location: typeKey === "except" ? undefined : locationKey,
							diffType: typeKey,
							selected: true, // Default to selected
							inverse: undefined,
						};
					}
				}
			}
		}

		// Remove entries for files that are no longer in fileTrees
		for (const path of Object.keys(this.plugin.fileSelection)) {
			if (!currentPaths.has(path)) {
				delete this.plugin.fileSelection[path];
			}
		}
	}

	updateStatusIndicator() {
		const status = this.plugin.status;
		const statusItem = STATUS_ITEMS[status];
		this.statusIndicator.textContent = `${statusItem.emoji} ${statusItem.label}`;
		this.statusIndicator.setCssProps({ color: statusItem.color });
	}

	private getAllFilePaths(): string[] {
		const paths: string[] = [];
		if (!this.plugin.fileTrees) return paths;

		["remote", "local"].forEach((location) => {
			const locationData = this.plugin.fileTrees[location as keyof FileTrees];
			["added", "deleted", "modified"].forEach((type) => {
				Object.keys(locationData[type as keyof FileTree]).forEach((path) => {
					paths.push(path);
				});
			});
		});
		return paths;
	}

	private createDropdown(
		button: HTMLButtonElement,
		items: { label: string; action: () => void; updateLabel?: (itemEl: HTMLButtonElement) => void }[]
	): void {
		const dropdown = document.createElement("div");
		dropdown.addClass("smart-sync-dropdown");
		this.dropdownContainer.appendChild(dropdown);

		const dropdownContent = dropdown.createDiv({ cls: "smart-sync-dropdown-content" });

		items.forEach((item) => {
			const itemEl = dropdownContent.createEl("button", {
				text: item.label,
				cls: "smart-sync-dropdown-item",
			});
			if (item.updateLabel) {
				item.updateLabel(itemEl);
			}
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

	private async syncSelected() {
		const selectedCount = Object.values(this.plugin.fileSelection).filter((v) => v.selected === true).length;
		if (selectedCount === 0) {
			new Notice("No files selected");
			return;
		}
		this.plugin.operations.fullSync();
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

	private getInversePillText(location: Location, diffType: DiffType): string {
		switch (location) {
			case "local":
				switch (diffType) {
					case "added":
						return "🗑️ Delete";
					case "modified":
						return "🔄 Replace with remote";
					case "deleted":
						return "♻️ Recreate from remote";
					default:
						return "Inverse";
				}
			case "remote":
				switch (diffType) {
					case "added":
						return "🗑️ Delete";
					case "modified":
						return "🔄 Replace with local";
					case "deleted":
						return "♻️ Recreate from local";
					default:
						return "Inverse";
				}
			default:
				return "Inverse";
		}
	}

	renderFileTrees() {
		this.initializeSelectedFiles();
		this.fileTreeDiv.empty();

		this.plugin.log("=== Filetrees:===");
		this.plugin.log(JSON.stringify(this.plugin.fileTrees, null, 2));

		if (!this.plugin.fileTrees) {
			this.fileTreeDiv.createEl("p", { text: "Loading...", cls: "smart-sync-loading" });
			return;
		}

		const hasAnyChanges = ["remote", "local"].some((location) => {
			const locationData = this.plugin.fileTrees[location as keyof FileTrees];
			return Object.values(locationData).some((section) => Object.keys(section).length > 0);
		});

		if (!hasAnyChanges) {
			this.fileTreeDiv.createDiv({
				cls: "smart-sync-empty",
				text: "✓ No changes to sync",
			});
			this.plugin.sessionSynced = true;
			return;
		}

		// Render Local and Remote sections
		const locations: { key: keyof FileTrees; title: string; icon: string }[] = [
			{ key: "local", title: "Local", icon: "💻" },
			{ key: "remote", title: "Remote", icon: "☁️" },
		];

		const types: Array<{ key: keyof FileTree; title: string; icon: string; color: string }> = [
			{ key: "added", title: "Added", icon: "➕", color: "green" },
			{ key: "modified", title: "Modified", icon: "✏️", color: "orange" },
			{ key: "deleted", title: "Deleted", icon: "🗑️", color: "red" },
		];

		locations.forEach(({ key, title, icon }) => {
			const locationData = this.plugin.fileTrees[key];
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

		// ============= CONFLICTS SECTION =============
		const conflictFiles = this.plugin.fileTrees.local.except;
		const hasConflicts = Object.keys(conflictFiles).length > 0;

		if (hasConflicts) {
			const conflictLocationEl = this.fileTreeDiv.createDiv({ cls: "smart-sync-location" });
			conflictLocationEl.createDiv({ cls: "smart-sync-location-title", text: "⚔️ Conflicts" });

			const conflictSectionEl = conflictLocationEl.createDiv({ cls: "smart-sync-section" });
			conflictSectionEl.createDiv({
				cls: ["smart-sync-section-title", "smart-sync-section-purple"],
				text: `⚠️ Both sides changed (${Object.keys(conflictFiles).length})`,
			});

			const conflictFilesContainer = conflictSectionEl.createDiv({ cls: "smart-sync-files-list" });

			Object.keys(conflictFiles).forEach((path) => {
				// Render as conflict with both locations affected
				this.renderConflictRow(conflictFilesContainer, path);
			});
		}

		// Restore scroll position
		this.fileTreeDiv.scrollTop = this.plugin.lastScrollPosition;
	}

	private renderFileRow(container: HTMLElement, path: string, _location: Location, type: DiffType) {
		const isSelected = this.plugin.fileSelection[path]?.selected === true;
		const isConflict = type === "except";
		const row = container.createDiv({
			cls: ["smart-sync-file-row", isConflict ? "smart-sync-conflict-row" : "", isSelected ? "selected" : ""],
			attr: { "data-path": path },
		});

		// Checkbox
		const checkbox = row.createDiv({ cls: "smart-sync-checkbox" });
		checkbox.innerHTML = isSelected ? "☑️" : "☐";
		checkbox.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleFileSelection(path);
			const nowSelected = this.plugin.fileSelection[path]?.selected === true;
			checkbox.innerHTML = nowSelected ? "☑️" : "☐";
			row.toggleClass("selected", nowSelected);
		});

		// File path (clickable parts)
		const pathContainer = row.createDiv({ cls: "smart-sync-path-container" });

		// Icon
		if (!this.plugin.mobile)
			pathContainer.createSpan({ cls: "smart-sync-file-icon", text: this.getFileIcon(path) });

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

		// Inverse pill (only shown when inverse is true)
		const isInverse = this.plugin.fileSelection[path]?.inverse === true;
		if (isInverse && _location && this.plugin.fileSelection[path]) {
			const inversePill = row.createDiv({
				cls: ["smart-sync-inverse-checkbox", "smart-sync-pill"],
				text: this.getInversePillText(_location, type),
			});
			inversePill.setAttr("aria-label", "Remove inverse action");
			inversePill.addEventListener("click", (e) => {
				e.stopPropagation();
				if (this.plugin.fileSelection[path]) {
					this.plugin.fileSelection[path].inverse = undefined;
					this.renderFileTrees();
				}
			});
		}

		// Action menu button (three dots)
		const menuBtn = row.createDiv({ cls: "smart-sync-menu-btn", text: "⋮" });
		menuBtn.addEventListener("click", (e) => e.stopPropagation());

		this.createContextMenu(menuBtn, path, _location, type);
	}

	private renderConflictRow(container: HTMLElement, path: string) {
		const isSelected = this.plugin.fileSelection[path]?.selected === true;
		const row = container.createDiv({
			cls: ["smart-sync-file-row", "smart-sync-conflict-row", isSelected ? "selected" : ""],
			attr: { "data-path": path },
		});

		// Checkbox
		const checkbox = row.createDiv({ cls: "smart-sync-checkbox" });
		checkbox.innerHTML = isSelected ? "☑️" : "☐";
		checkbox.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleFileSelection(path);
			const nowSelected = this.plugin.fileSelection[path]?.selected === true;
			checkbox.innerHTML = nowSelected ? "☑️" : "☐";
			row.toggleClass("selected", nowSelected);
		});

		// Conflict icon + File path
		const pathContainer = row.createDiv({ cls: "smart-sync-path-container" });

		if (!this.plugin.mobile)
			pathContainer.createSpan({ cls: "smart-sync-file-icon", text: this.getFileIcon(path) });

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

		// Conflict resolution dropdown (choose location)
		const locationSelect = row.createEl("select", { cls: "smart-sync-action-select" });
		const blankOption = locationSelect.createEl("option", { value: "", text: "Choose location…" });
		locationSelect.createEl("option", { value: "local", text: "⬆️ Keep Local" });
		locationSelect.createEl("option", { value: "remote", text: "⬇️ Keep Remote" });

		const currentLocation = this.plugin.fileSelection[path]?.location;
		if (currentLocation) {
			locationSelect.value = currentLocation;
		} else {
			blankOption.selected = true;
		}

		locationSelect.addEventListener("change", (e) => {
			const location = (e.target as HTMLSelectElement).value as Location | "";
			if (this.plugin.fileSelection[path]) {
				if (location) {
					this.plugin.fileSelection[path].location = location as Location;
				} else {
					this.plugin.fileSelection[path].location = undefined;
				}
			}
		});

		locationSelect.addEventListener("click", (e) => e.stopPropagation());

		// Action menu button (three dots)
		const menuBtn = row.createDiv({ cls: "smart-sync-menu-btn", text: "⋮" });
		menuBtn.addEventListener("click", (e) => e.stopPropagation());

		this.createContextMenu(menuBtn, path);
	}

	private createContextMenu(button: HTMLElement, path: string, location?: Location, diffType?: DiffType): void {
		const menu = document.createElement("div");
		menu.addClass("smart-sync-context-menu");
		this.dropdownContainer.appendChild(menu);

		const items = [
			{ label: "📂 Open in Explorer", action: () => this.openInExplorer(path) },

			{ label: "🔍 Show Diff", action: () => this.showDiff(path, this.plugin.fileSelection[path]?.location) },
		];
		if (!path.startsWith(this.app.vault.configDir)) {
			items.unshift({ label: "📝 Open in Obsidian", action: () => this.openFile(path) });
		}

		// Add invert/remove inverse action option for regular files
		if (location && diffType && diffType !== "except") {
			const isInverse = this.plugin.fileSelection[path]?.inverse === true;
			if (isInverse) {
				items.unshift({
					label: "❌ Remove inverse action",
					action: () => {
						if (this.plugin.fileSelection[path]) {
							this.plugin.fileSelection[path].inverse = undefined;
							this.renderFileTrees();
						}
					},
				});
			} else {
				items.unshift({
					label: "🔄 Invert action",
					action: () => {
						if (this.plugin.fileSelection[path]) {
							this.plugin.fileSelection[path].inverse = true;
							this.renderFileTrees();
						}
					},
				});
			}
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
		// if (this.plugin.mobile) return "";
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

	private async openFile(path: string) {
		if (path.endsWith("/")) return;
		if (path.startsWith(this.app.vault.configDir)) return;
		if (!(await this.app.vault.adapter.exists(path))) return;
		this.app.workspace.openLinkText(path, "", "tab");
	}

	private showDiff(path: string, location: Location | undefined) {
		new DiffModal(this.app, this.plugin, path, location).open();
	}

	onClose() {
		this.dropdownContainer?.remove();
		const { contentEl } = this;
		contentEl.empty();
	}
}
