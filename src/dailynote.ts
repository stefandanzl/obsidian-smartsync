import { Notice, TFile, WorkspaceLeaf, moment, normalizePath } from "obsidian";
import SmartSyncPlugin from "./main";
import { createFolderIfNotExists, logNotice, sha256 } from "./util";
import { FileEntry, Status } from "./const";
import { DailyOfflineModal } from "./dailyModal";

export class DailyNoteManager {
	constructor(private plugin: SmartSyncPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Creates or updates a daily note, comparing local and remote content
	 */
	async getDailyNote(
		filePath: string,
		remoteContent: string | undefined,
		remoteFileEntry: FileEntry | undefined
	): Promise<[file: TFile, usedTemplate?: boolean]> {
		let finalContent = "";
		let usedTemplate = false;

		// Check if file exists locally
		const existingFile = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (existingFile instanceof TFile) {
			const localBinary = await this.plugin.app.vault.readBinary(existingFile);
			const localHash = await sha256(localBinary);

			// Use remote content if it's longer, otherwise keep local
			// if (remoteContent && remoteContent.length > localContent.length) {
			if (remoteFileEntry && remoteFileEntry.hash === localHash) {
				return [existingFile];
			}
			const prevFileEntry = this.plugin.prevData.files[filePath] ?? undefined;
			if (remoteContent !== undefined && remoteFileEntry !== undefined) {
				if (!prevFileEntry || prevFileEntry.hash !== remoteFileEntry.hash) {
					this.plugin.show("Updated Daily Note from SmartSync");
					await this.plugin.app.vault.modify(existingFile, remoteContent);
					// local now equals remote → record as the synced baseline
					this.plugin.prevData.files[filePath] = remoteFileEntry;
					await this.plugin.savePrevData();
				}
			}
			return [existingFile];
		}

		// If file doesn't exist, use remote content or template
		// finalContent = remoteContent || (await this.getTemplateContent());

		try {
			if (remoteContent) {
				finalContent = remoteContent;
				this.plugin.show("Fetching Daily Note from remote content");
			} else {
				const templateContent = await this.getTemplateContent();
				if (templateContent === undefined) {
					throw new Error("Template File Error");
				}
				finalContent = templateContent;
				usedTemplate = true;
				this.plugin.show("Creating new Daily Note with template");
			}
			const file = await this.plugin.app.vault.create(filePath, finalContent);
			return [file, usedTemplate];
		} catch (error) {
			this.plugin.show(`Daily Note File Error: ${error}`);

			console.error(`Failed to create daily note at '${filePath}':`, error);
			throw new Error(`Failed to create daily note: ${error}`);
		}
	}

	/**
	 * Gets template content if specified
	 */
	private async getTemplateContent(): Promise<string | undefined> {
		// const templatePath = this.plugin.settings.dailyNotesFolder;
		let templatePath = this.plugin.settings.dailyNotesTemplate;
		if (!templatePath) {
			this.plugin.show("Error: No template path for Daily Notes provided!");
			return undefined;
		}

		if (!templatePath.endsWith(".md")) {
			templatePath = templatePath + ".md";
		}

		const templateFile = this.plugin.app.vault.getAbstractFileByPath(templatePath);
		// console.log(templateFile);
		if (templateFile instanceof TFile) {
			return await this.plugin.app.vault.read(templateFile);
		}
		this.plugin.show("Error with template file!");
		return undefined;
	}

	/**
	 * Generates the daily note path based on format and folder
	 */
	getDailyNotePath(folder: string, format: string) {
		//@ts-ignore
		const momentDate = moment();
		const formattedDate = momentDate.format(format);

		const filePath = normalizePath(`${folder}/${formattedDate}.md`);
		const folderPath = filePath.split("/").slice(0, -1).join("/");
		// console.log(folderPath);

		return { filePath, folderPath };
	}

	/**
	 * Fetches daily note content from SmartSyncServer
	 */
	async getDailyNoteRemotely(dailyNotePath: string): Promise<string | undefined> {
		try {
			const remotePath = normalizePath(dailyNotePath);
			const response = await this.plugin.smartSyncClient.getFile(remotePath);
			if (response.status === 200 && response.data) {
				return new TextDecoder().decode(response.data);
			}
			console.error("Daily Note: unexpected response status", response.status);
		} catch (error) {
			console.error("Daily Note: failed to fetch remote content:", error);
		}
		return undefined;
	}

	testSettings() {
		console.log(this.plugin.settings.dailyNotesFolder);
	}

	/**
	 * Opens the daily note and adds timestamp if configured
	 */
	private async openNoteWithTimestamp(file: TFile, middleClick: boolean, usedTemplate?: boolean): Promise<void> {
		let leaf: WorkspaceLeaf | undefined = undefined;

		if (!middleClick) {
			const markdownLeaves = this.plugin.app.workspace.getLeavesOfType("markdown");
			for (const l of markdownLeaves) {
				//@ts-ignore no API
				const path = l.view.getState()["file"] ?? "";
				if (path && file.path === path) {
					leaf = l;
					break;
				}
			}
		}

		if (middleClick || !leaf) {
			leaf = this.plugin.app.workspace.getLeaf(middleClick);
			await leaf.openFile(file);
		} else {
			// Existing leaf in another split: properly activate it
			this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
			// revealLeaf ensures the leaf's split/tab is brought forward
			this.plugin.app.workspace.revealLeaf(leaf);
		}

		// IMPORTANT: grab the editor from the *leaf we found*, not from activeEditor —
		// activeEditor may still point at the previously-focused split until Obsidian
		// processes the focus change.
		//@ts-ignore - editor lives on MarkdownView
		const editor = leaf.view?.editor;

		if (editor && this.plugin.settings.dailyNotesTimestamp && usedTemplate !== true) {
			let lastLine = editor.lastLine();
			const lastLineContent = editor.getLine(lastLine);
			//@ts-ignore
			const newLineContent = `${moment().format("HH:mm")} - `;
			if (lastLineContent !== newLineContent) {
				editor.setLine(lastLine, lastLineContent + `\n\n` + newLineContent);
			}
			lastLine = editor.lastLine();
			const lastLineLength = editor.getLine(lastLine).length;

			leaf.setEphemeralState({
				line: lastLine,
				focus: true,
			});

			// Defer cursor placement AND focus so Obsidian's own focus handling
			// (from setActiveLeaf + ephemeral state) has settled first.
			setTimeout(() => {
				editor.setCursor({ line: lastLine, ch: lastLineLength });
				editor.focus();
			}, 50);

			function keydownCallback(ev: KeyboardEvent) {
				leaf!.setEphemeralState({
					match: { content: "", matches: [] },
				});
				removeEventListener("keydown", keydownCallback);
			}

			addEventListener("keydown", keydownCallback);
		}
	}

	/**
	 * Main function to create/sync daily note
	 */
	async dailyNote(middleClick = false) {
		try {
			// Handle offline scenarios
			if (this.plugin.status === Status.ERROR) {
				logNotice(
					"Error detected! ❌\nClear error in SmartSync control modal and try to get Daily Note again!"
				);
				return;
			}

			// Check if modal is already open - if so, don't create another
			if (this.plugin.dailyOfflineModal) {
				logNotice("Daily note modal already open - please use the modal options");
				return;
			}

			// Quick connection test
			if (!this.plugin.settings.dailyNotesFormat) {
				new Notice("The setting 'Daily Notes Format' can not be left empty!");
				throw new Error("setting 'daily notes format' can not be left empty");
			}
			const { filePath, folderPath } = this.getDailyNotePath(
				this.plugin.settings.dailyNotesFolder,
				this.plugin.settings.dailyNotesFormat
			);

			let connected = false;
			let remoteFileEntry: FileEntry | undefined;
			try {
				const { checksums } = await this.plugin.smartSyncClient.getSelectiveChecksums([filePath]);
				connected = true;
				remoteFileEntry = checksums[filePath];
			} catch (error) {
				this.plugin.log("No connection to server");
			}

			if (!connected) {
				if (this.plugin.dailyOfflineModal) {
					return;
				}
				// Show modal instead of auto-retry
				this.plugin.dailyOfflineModal = new DailyOfflineModal(this.plugin.app, this.plugin, { middleClick });
				this.plugin.dailyOfflineModal.open();
				return;
			}
			await createFolderIfNotExists(this.plugin.app.vault, folderPath);

			let remoteContent = undefined;
			if (connected && !!remoteFileEntry) {
				remoteContent = await this.getDailyNoteRemotely(filePath);
			}
			const [dailyNote, usedTemplate] = await this.getDailyNote(filePath, remoteContent, remoteFileEntry);

			await this.openNoteWithTimestamp(dailyNote, middleClick, usedTemplate);
		} catch (err) {
			console.error("Failed to create/open daily note:", err);
			// logNotice(`Daily note operation failed: ${err.message}`);
			throw new Error(`Daily note operation failed: ${err.message}`);
		}
	}
}
