import { App, Modal, Notice, Setting, Menu, setIcon } from "obsidian";
import SmartSyncPlugin from "./main";
import { DiffModal } from "./diffModal";
import { FileTree, FileTrees, Location, PLUGIN_ID, STATUS_ITEMS, Status, DiffType, SyncProfile } from "./const";
import { dirname } from "./util";

export class FileTreeModal extends Modal {
	fileTreeDiv: HTMLDivElement;
	statusIndicator: {
		div: HTMLDivElement;
		icon: HTMLSpanElement;
		text: HTMLSpanElement;
	};

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

		const container = contentEl.createDiv({ cls: "smart-sync-container" });

		// ============= HEADER =============
		const header = container.createDiv({ cls: "smart-sync-header" });
		const headerTop = header.createDiv({ cls: "smart-sync-header-top" });
		const headerBottom = header.createDiv({ cls: "smart-sync-header-bottom" });

		// TOP ROW: Status | Reload | Sync
		const statusEl = headerTop.createDiv({ cls: "smart-sync-status-indicator" });
		this.statusIndicator = {
			div: statusEl,
			icon: statusEl.createSpan({ cls: "smart-sync-status-icon" }),
			text: statusEl.createSpan({ cls: "smart-sync-status-text" }),
		};
		this.updateStatusIndicator();

		const reloadBtn = headerTop.createEl("button", {
			cls: "smart-sync-header-btn",
			attr: { "aria-label": "Reload file tree" },
		});
		setIcon(reloadBtn, "search");
		reloadBtn.createSpan({ text: "Reload" });
		reloadBtn.addEventListener("click", async () => {
			await this.plugin.operations.check();
			this.updateSyncButton();
		});

		this.syncButton = headerTop.createEl("button", {
			cls: ["smart-sync-header-btn", "mod-cta"],
			attr: { "aria-label": "Sync selected files" },
		});
		setIcon(this.syncButton, "refresh-cw");
		this.syncButtonLabel = this.syncButton.createSpan({ text: "Sync (0)" });
		this.syncButton.addEventListener("click", () => this.syncSelected());

		// BOTTOM ROW: Select All | Sync Profile | Maintenance
		const selectToggleBtn = headerBottom.createEl("button", {
			cls: "smart-sync-header-btn smart-sync-select-toggle-btn",
			attr: { "aria-label": "Toggle select all files" },
		});
		this.selectToggleIcon = selectToggleBtn.createSpan({ cls: "smart-sync-select-toggle-icon" });
		setIcon(this.selectToggleIcon, "square-check-big");
		this.selectToggleLabel = selectToggleBtn.createSpan({
			cls: "smart-sync-select-toggle-label",
			text: "Select All",
		});
		selectToggleBtn.addEventListener("click", () => this.toggleSelectAll());

		// Profile dropdown - native select
		const profileSelect = headerBottom.createEl("select", { cls: "dropdown" });
		[
			{ value: "default", label: "Default" },
			{ value: "push", label: "Push" },
			{ value: "pull", label: "Pull" },
			{ value: "replicateLocal", label: "Replicate Local" },
			{ value: "replicateRemote", label: "Replicate Remote" },
		].forEach(({ value, label }) => profileSelect.createEl("option", { value, text: label }));
		profileSelect.value = "default";
		profileSelect.addEventListener("change", () => this.applyProfile(profileSelect.value as SyncProfile));

		profileSelect.setAttribute("aria-label", "Sync profile");

		const maintenanceBtn = headerBottom.createEl("button", {
			cls: "smart-sync-header-btn",
			attr: { "aria-label": "Maintenance options" },
		});
		setIcon(maintenanceBtn, "sliders-horizontal");
		maintenanceBtn.onclick = (ev) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle("Test Connection")
					.setIcon("test-tube")
					.onClick(() => this.plugin.operations.test(true, true))
			);
			menu.addItem((item) =>
				item
					.setTitle("Clear Error States")
					.setIcon("octagon-x")
					.onClick(() => this.clearErrors())
			);
			menu.addItem((item) =>
				item
					.setTitle("Save Vault State")
					.setIcon("save")
					.onClick(() => this.plugin.saveState())
			);
			menu.addItem((item) =>
				item
					.setTitle("SmartSync Settings")
					.setIcon("settings")
					.onClick(() => this.openSettings())
			);
			menu.addItem((item) =>
				item
					.setTitle("Pause Sync")
					.setIcon("pause")
					.onClick(() => this.togglePause())
			);
			menu.showAtMouseEvent(ev);
		};

		// ============= FILES AREA =============
		this.fileTreeDiv = container.createDiv({ cls: "smart-sync-files-area" });

		this.fileTreeDiv.addEventListener("scroll", (e) => {
			this.plugin.lastScrollPosition = (e.target as HTMLElement).scrollTop;
		});

		if (!this.plugin.fileTrees) {
			this.plugin.operations.check().then(() => this.updateSyncButton());
		} else {
			this.renderFileTrees();
			this.updateSyncButton();
		}
	}

	private syncButton: HTMLButtonElement;
	private syncButtonLabel: HTMLSpanElement;
	private selectToggleIcon: HTMLSpanElement;
	private selectToggleLabel: HTMLSpanElement;

	private toggleSelectAll() {
		const allPaths = this.getAllFilePaths();
		const allSelected =
			allPaths.length > 0 && allPaths.every((path) => this.plugin.fileSelection[path]?.selected === true);

		if (allSelected) {
			for (const path of allPaths) {
				if (this.plugin.fileSelection[path]) {
					this.plugin.fileSelection[path].selected = false;
				}
			}
			setIcon(this.selectToggleIcon, "square-check-big");
			this.selectToggleLabel.textContent = "Select All";
		} else {
			for (const path of allPaths) {
				if (this.plugin.fileSelection[path]) {
					this.plugin.fileSelection[path].selected = true;
				}
			}
			setIcon(this.selectToggleIcon, "square");
			this.selectToggleLabel.textContent = "Select None";
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
		this.syncButtonLabel.textContent = `Sync (${count})`;
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

		const currentPaths = new Set<string>();
		const locations: (keyof FileTrees)[] = ["local", "remote"];
		const types: (keyof FileTree)[] = ["added", "modified", "deleted", "except"];

		for (const locationKey of locations) {
			for (const typeKey of types) {
				const files = this.plugin.fileTrees[locationKey][typeKey];
				for (const [path] of Object.entries(files)) {
					currentPaths.add(path);
					if (!this.plugin.fileSelection[path]) {
						this.plugin.fileSelection[path] = {
							location: typeKey === "except" ? undefined : locationKey,
							diffType: typeKey,
							selected: true,
							inverse: undefined,
						};
					}
				}
			}
		}

		for (const path of Object.keys(this.plugin.fileSelection)) {
			if (!currentPaths.has(path)) {
				delete this.plugin.fileSelection[path];
			}
		}
	}

	updateStatusIndicator() {
		const status = this.plugin.status;
		const statusItem = STATUS_ITEMS[status];
		setIcon(this.statusIndicator.icon, statusItem.lucide ?? "circle");
		this.statusIndicator.text.textContent = statusItem.label;
		this.statusIndicator.div.setCssProps({ color: statusItem.color });
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

		const locations: { key: keyof FileTrees; title: string; icon: string }[] = [
			{ key: "local", title: "Local", icon: "laptop" },
			{ key: "remote", title: "Remote", icon: "cloud" },
		];

		const types: Array<{ key: keyof FileTree; title: string; icon: string; color: string }> = [
			{ key: "added", title: "Added", icon: "file-plus", color: "green" },
			{ key: "modified", title: "Modified", icon: "file-pen", color: "orange" },
			{ key: "deleted", title: "Deleted", icon: "file-minus", color: "red" },
		];

		locations.forEach(({ key, title, icon }) => {
			const locationData = this.plugin.fileTrees[key];
			const hasChanges = Object.values(locationData).some((section) => Object.keys(section).length > 0);

			if (!hasChanges) return;

			const locationEl = this.fileTreeDiv.createDiv({ cls: "smart-sync-location" });
			const locationTitle = locationEl.createDiv({ cls: "smart-sync-location-title" });
			setIcon(locationTitle.createSpan({ cls: "smart-sync-location-icon" }), icon);
			locationTitle.createSpan({ text: title });

			types.forEach(({ key: typeKey, title: typeTitle, icon: typeIcon, color }) => {
				const files = locationData[typeKey];
				if (Object.keys(files).length === 0) return;

				const sectionEl = locationEl.createDiv({ cls: "smart-sync-section" });
				const sectionTitle = sectionEl.createDiv({
					cls: ["smart-sync-section-title", `smart-sync-section-${color}`],
				});
				setIcon(sectionTitle.createSpan({ cls: "smart-sync-section-icon" }), typeIcon);
				sectionTitle.createSpan({ text: ` ${typeTitle} (${Object.keys(files).length})` });

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
			const conflictLocationTitle = conflictLocationEl.createDiv({ cls: "smart-sync-location-title" });
			setIcon(conflictLocationTitle.createSpan({ cls: "smart-sync-location-icon" }), "swords");
			conflictLocationTitle.createSpan({ text: "Conflicts" });

			const conflictSectionEl = conflictLocationEl.createDiv({ cls: "smart-sync-section" });
			const conflictSectionTitle = conflictSectionEl.createDiv({
				cls: ["smart-sync-section-title", "smart-sync-section-purple"],
			});
			setIcon(conflictSectionTitle.createSpan({ cls: "smart-sync-section-icon" }), "triangle-alert");
			conflictSectionTitle.createSpan({ text: ` Both sides changed (${Object.keys(conflictFiles).length})` });

			const conflictFilesContainer = conflictSectionEl.createDiv({ cls: "smart-sync-files-list" });

			Object.keys(conflictFiles).forEach((path) => {
				this.renderConflictRow(conflictFilesContainer, path);
			});
		}

		this.fileTreeDiv.scrollTop = this.plugin.lastScrollPosition;
	}

	private renderFileRow(container: HTMLElement, path: string, _location: Location, type: DiffType) {
		const isSelected = this.plugin.fileSelection[path]?.selected === true;
		const isConflict = type === "except";
		const row = container.createDiv({
			cls: [
				"smart-sync-file-row",
				"HyperMD-list-line",
				isConflict ? "smart-sync-conflict-row" : "",
				isSelected ? "selected" : "",
			],
			attr: { "data-path": path },
		});

		// Checkbox
		const checkbox = row.createEl("input", {
			cls: "task-list-item-checkbox",
			type: "checkbox",
			attr: {
				type: "checkbox",
				"data-task": isSelected ? "x" : " ",
				checked: isSelected ? "" : null,
			},
		});
		checkbox.checked = isSelected;
		checkbox.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleFileSelection(path);
			const nowSelected = this.plugin.fileSelection[path]?.selected === true;
			checkbox.checked = nowSelected;
			checkbox.setAttribute("data-task", nowSelected ? "x" : " ");
			row.toggleClass("selected", nowSelected);
		});

		// File path
		const pathContainer = row.createDiv({ cls: "smart-sync-path-container" });

		if (!this.plugin.mobile) {
			const iconEl = pathContainer.createSpan({ cls: "smart-sync-file-icon" });
			setIcon(iconEl, this.getFileIcon(path));
		}

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

		// Inverse pill
		const isInverse = this.plugin.fileSelection[path]?.inverse === true;
		if (isInverse && _location && this.plugin.fileSelection[path]) {
			const inversePill = row.createDiv({
				cls: ["smart-sync-inverse-checkbox", "smart-sync-pill"],
				attr: { "aria-label": "Remove inverse action" },
			});
			// const pillIcon = inversePill.createSpan({ cls: "smart-sync-pill-icon" });
			// setIcon(pillIcon, this.getInversePillIcon(_location, type));
			inversePill.createSpan({ text: this.getInversePillText(_location, type) });
			inversePill.addEventListener("click", (e) => {
				e.stopPropagation();
				if (this.plugin.fileSelection[path]) {
					this.plugin.fileSelection[path].inverse = undefined;
					this.renderFileTrees();
				}
			});
		}

		// Context menu button
		const menuBtn = row.createDiv({ cls: "smart-sync-menu-btn", attr: { "aria-label": "File actions" } });
		setIcon(menuBtn, "more-vertical");
		menuBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.showContextMenu(e as MouseEvent, path, _location, type);
		});

		row.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.showContextMenu(e as MouseEvent, path, _location, type);
		});
	}

	private renderConflictRow(container: HTMLElement, path: string) {
		const isSelected = this.plugin.fileSelection[path]?.selected === true;
		const row = container.createDiv({
			cls: ["smart-sync-file-row", "smart-sync-conflict-row", isSelected ? "selected" : ""],
			attr: { "data-path": path },
		});

		// Checkbox
		const checkbox = row.createDiv({ cls: "smart-sync-checkbox" });
		setIcon(checkbox, isSelected ? "square-check-big" : "square");
		checkbox.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleFileSelection(path);
			const nowSelected = this.plugin.fileSelection[path]?.selected === true;
			setIcon(checkbox, nowSelected ? "square-check-big" : "square");
			row.toggleClass("selected", nowSelected);
		});

		// File path
		const pathContainer = row.createDiv({ cls: "smart-sync-path-container" });

		if (!this.plugin.mobile) {
			const iconEl = pathContainer.createSpan({ cls: "smart-sync-file-icon" });
			setIcon(iconEl, this.getFileIcon(path));
		}

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

		// Conflict resolution dropdown via Setting
		const selectWrapper = row.createDiv({ cls: "smart-sync-conflict-select-wrapper" });
		new Setting(selectWrapper).addDropdown((dropdown) => {
			dropdown
				.addOption("", "Choose location…")
				.addOption("local", "⬆️ Keep Local")
				.addOption("remote", "⬇️ Keep Remote");

			const currentLocation = this.plugin.fileSelection[path]?.location;
			dropdown.setValue(currentLocation ?? "");

			dropdown.onChange((value) => {
				if (this.plugin.fileSelection[path]) {
					this.plugin.fileSelection[path].location = (value || undefined) as Location | undefined;
				}
			});

			// Prevent row click propagation
			dropdown.selectEl.addEventListener("click", (e) => e.stopPropagation());
		});

		// Context menu button
		const menuBtn = row.createDiv({ cls: "smart-sync-menu-btn", attr: { "aria-label": "File actions" } });
		setIcon(menuBtn, "more-vertical");
		menuBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.showContextMenu(e as MouseEvent, path);
		});

		row.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.showContextMenu(e as MouseEvent, path);
		});
	}

	private showContextMenu(ev: MouseEvent, path: string, location?: Location, diffType?: DiffType): void {
		const menu = new Menu();

		const isInverse = this.plugin.fileSelection[path]?.inverse === true;
		if (location && diffType && diffType !== "except") {
			if (isInverse) {
				menu.addItem((item) =>
					item
						.setTitle("Remove inverse action")
						.setIcon("shuffle")
						.onClick(() => {
							if (this.plugin.fileSelection[path]) {
								this.plugin.fileSelection[path].inverse = undefined;
								this.renderFileTrees();
							}
						})
				);
			} else {
				menu.addItem((item) =>
					item
						.setTitle("Invert action")
						.setIcon("shuffle")
						.onClick(() => {
							if (this.plugin.fileSelection[path]) {
								this.plugin.fileSelection[path].inverse = true;
								this.renderFileTrees();
							}
						})
				);
			}
		}

		if (!path.startsWith(this.app.vault.configDir)) {
			menu.addItem((item) =>
				item
					.setTitle("Open in Obsidian")
					.setIcon("file-pen")
					.onClick(() => this.openFile(path))
			);
		}

		menu.addItem((item) =>
			item
				.setTitle("Open in Explorer")
				.setIcon("external-link")
				.onClick(() => this.openInExplorer(path))
		);
		menu.addItem((item) =>
			item
				.setTitle("Show Diff")
				.setIcon("file-diff")
				.onClick(() => this.showDiff(path, this.plugin.fileSelection[path]?.location))
		);

		menu.showAtMouseEvent(ev);
	}

	private getInversePillText(location: Location, diffType: DiffType): string {
		switch (location) {
			case "local":
				switch (diffType) {
					case "added":
						return "Delete local file"; //🗑️
					case "modified":
						return "Replace with remote"; //🔄
					case "deleted":
						return "Recreate from remote"; //♻️
					default:
						return "Inverse";
				}
			case "remote":
				switch (diffType) {
					case "added":
						return "Delete remote file"; //🗑️
					case "modified":
						return "Replace with local"; //🔄
					case "deleted":
						return "Recreate from local"; //♻️
					default:
						return "Inverse";
				}
			default:
				return "Inverse";
		}
	}
	private getInversePillIcon(location: Location, diffType: DiffType): string {
		switch (diffType) {
			case "added":
				return "trash";
			case "modified":
				return "replace";
			case "deleted":
				return "recycle";
			default:
				return "Inverse";
		}
	}

	private async syncSelected() {
		const selectedCount = Object.values(this.plugin.fileSelection).filter((v) => v.selected === true).length;
		if (selectedCount === 0) {
			new Notice("No files selected");
			return;
		}
		this.plugin.operations.sync();
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

	private getFileIcon(path: string): string {
		if (path.endsWith("/")) return "folder";
		const ext = path.split(".").pop()?.toLowerCase();
		switch (ext) {
			case "md":
				return "file-text";
			case "txt":
				return "file-text";
			case "pdf":
				return "file-scan";
			case "png":
			case "jpg":
			case "jpeg":
			case "gif":
			case "svg":
			case "webp":
				return "file-image";
			case "mp3":
			case "wav":
			case "ogg":
			case "flac":
				return "file-audio";
			case "mp4":
			case "avi":
			case "mov":
			case "mkv":
				return "file-video";
			case "zip":
			case "rar":
			case "7z":
			case "tar":
			case "gz":
				return "archive";
			case "js":
			case "ts":
			case "jsx":
			case "tsx":
			case "py":
			case "java":
			case "cpp":
			case "c":
			case "h":
			case "go":
			case "rs":
			case "rb":
			case "php":
			case "swift":
			case "kt":
				return "file-code";
			case "css":
			case "scss":
			case "sass":
			case "less":
				return "file-braces";
			case "json":
			case "jsonc":
				return "file-braces";
			case "yaml":
			case "yml":
			case "toml":
			case "ini":
			case "env":
				return "file-cog";
			case "xlsx":
			case "xls":
			case "csv":
			case "tsv":
				return "file-spreadsheet";
			default:
				return "file-question";
		}
	}

	private openInExplorer(path: string) {
		try {
			//@ts-ignore
			const basePath = this.app.vault.adapter.getBasePath().replaceAll("\\", "/");
			const directoryPath = dirname(path);
			const systemPath = encodeURI(`${basePath}/${directoryPath}`);
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
		const { contentEl } = this;
		contentEl.empty();
	}
}
