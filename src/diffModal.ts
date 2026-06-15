import { App, Modal, Notice } from "obsidian";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, indentWithTab, standardKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { keymap, lineNumbers, drawSelection } from "@codemirror/view";
import SmartSyncPlugin from "./main";
import { Location } from "./const";
import { msToSeconds } from "./util";
import { oneDark } from "@codemirror/theme-one-dark";
import { tags } from "@lezer/highlight";

export class DiffModal extends Modal {
	mergeView: MergeView | undefined;
	loading = true;
	localMtime: number | null = null; // seconds since epoch
	remoteMtime: number | null = null; // seconds since epoch

	constructor(
		app: App,
		public plugin: SmartSyncPlugin,
		public filePath: string,
		public location: Location | undefined
	) {
		super(app);
	}

	async onOpen() {
		const { titleEl, contentEl, modalEl } = this;

		modalEl.addClass("smart-sync-diff-modal");
		titleEl.setText(`Diff: ${this.filePath}`);

		// Show loading message
		contentEl.createEl("p", {
			text: "Loading diff...",
			cls: "smart-sync-loading",
		});

		try {
			// Fetch both local and remote content (plus the local file's mtime)
			const [localContent, remoteContent, localStat] = await Promise.all([
				this.fetchLocalContent(),
				this.fetchRemoteContent(),
				this.app.vault.adapter.stat(this.filePath).catch(() => null),
			]);

			// Local mtime is reported in ms; store it in seconds to match FileEntry.mtime
			this.localMtime = localStat ? msToSeconds(localStat.mtime) : null;
			// Remote mtime comes from the last check's hash tree (already in seconds)
			this.remoteMtime = this.plugin.allFiles?.remote?.[this.filePath]?.mtime ?? null;

			this.loading = false;
			contentEl.empty();

			if (localContent === null && remoteContent === null) {
				contentEl.createEl("p", {
					text: "File not found locally or remotely.",
				});
				return;
			}

			// Create the merge view
			this.createMergeView(localContent || "", remoteContent || "");
		} catch (error) {
			this.loading = false;
			contentEl.empty();
			contentEl.createEl("p", {
				text: `Error loading diff: ${error}`,
				cls: "smart-sync-error",
			});
			console.error("Diff error:", error);
		}
	}

	/** Format an epoch-seconds timestamp as a local date/time string. */
	private formatDate(seconds: number | null): string {
		if (!seconds) return "—";
		return new Date(seconds * 1000).toLocaleString(undefined, {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	private async fetchLocalContent(): Promise<string | null> {
		try {
			if (await this.app.vault.adapter.exists(this.filePath)) {
				return await this.app.vault.adapter.read(this.filePath);
			}
			return null;
		} catch (error) {
			console.error("Error fetching local content:", error);
			return null;
		}
	}

	private async fetchRemoteContent(): Promise<string | null> {
		try {
			const response = await this.plugin.smartSyncClient.getFile(this.filePath);
			if (response.status === 200) {
				// Convert ArrayBuffer to string
				const decoder = new TextDecoder("utf-8");
				return decoder.decode(response.data);
			}
			return null;
		} catch (error) {
			console.error("Error fetching remote content:", error);
			return null;
		}
	}

	private createMergeView(localContent: string, remoteContent: string) {
		const { contentEl } = this;
		// Determine label/date order based on location
		const localDate = this.formatDate(this.localMtime);
		const remoteDate = this.formatDate(this.remoteMtime);
		const [leftLabel, rightLabel, leftDate, rightDate] =
			this.location === "local"
				? ["Remote", "Local", remoteDate, localDate] // local is new → goes right
				: ["Local", "Remote", localDate, remoteDate]; // remote is new → goes right

		// Add header showing which side is which
		const header = contentEl.createDiv({
			cls: "smart-sync-diff-header",
		});

		const leftEl = header.createSpan({ cls: "smart-sync-diff-header-left" });
		leftEl.createSpan({ cls: "smart-sync-diff-header-label", text: leftLabel });
		leftEl.createSpan({ cls: "smart-sync-diff-header-date", text: leftDate });

		const rightEl = header.createSpan({ cls: "smart-sync-diff-header-right" });
		rightEl.createSpan({ cls: "smart-sync-diff-header-label", text: rightLabel });
		rightEl.createSpan({ cls: "smart-sync-diff-header-date", text: rightDate });

		// Basic extensions for both editors
		const basicExtensions = [
			lineNumbers(),
			highlightSelectionMatches(),
			drawSelection(),
			keymap.of([...standardKeymap, indentWithTab, ...searchKeymap]),
			history(),
			search(),
			EditorView.lineWrapping,
			// oneDark,
			EditorView.theme(
				{
					"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
						{ backgroundColor: "var(--background-modifier-active-hover" },
				},
				{ dark: true }
			),
		];

		// Remote editor config (read-only)
		const remoteConfig = {
			doc: remoteContent,
			extensions: [...basicExtensions, EditorView.editable.of(true), EditorState.readOnly.of(true)],
		};

		// Local editor config (also read-only for viewing only)
		const localConfig = {
			doc: localContent,
			extensions: [...basicExtensions, EditorView.editable.of(true), EditorState.readOnly.of(true)],
		};

		const [leftConfig, rightConfig] =
			this.location === "local"
				? [remoteConfig, localConfig] // local is new → goes right
				: [localConfig, remoteConfig]; // remote is new → goes right

		// Create container for the merge view
		const mergeContainer = contentEl.createDiv({
			cls: "smart-sync-merge-view-container",
		});
		mergeContainer.addClasses(["cm-s-obsidian", "mod-cm6"]);

		// Create the MergeView
		this.mergeView = new MergeView({
			a: leftConfig, // Left side (local)
			b: rightConfig, // Right side (remote)
			parent: mergeContainer,
			collapseUnchanged: {
				minSize: 6,
				margin: 4,
			},
		});
	}

	onClose() {
		this.mergeView?.destroy();
		super.onClose();
	}
}
