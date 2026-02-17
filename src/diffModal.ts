import { App, Modal, Notice } from "obsidian";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
    history,
    indentWithTab,
    standardKeymap,
} from "@codemirror/commands";
import {
    highlightSelectionMatches,
    search,
    searchKeymap,
} from "@codemirror/search";
import { keymap, lineNumbers, drawSelection } from "@codemirror/view";
import SmartSyncPlugin from "./main";

export class DiffModal extends Modal {
    mergeView: MergeView | undefined;
    loading = true;

    constructor(
        app: App,
        public plugin: SmartSyncPlugin,
        public filePath: string
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
            // Fetch both local and remote content
            const [localContent, remoteContent] = await Promise.all([
                this.fetchLocalContent(),
                this.fetchRemoteContent(),
            ]);

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
            const response = await this.plugin.smartSyncClient.getFile(
                this.filePath
            );
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

        // Add header showing which side is which
        const header = contentEl.createDiv({
            cls: "smart-sync-diff-header",
        });
        header.createSpan({
            cls: "smart-sync-diff-header-local",
            text: "Local",
        });
        header.createSpan({
            cls: "smart-sync-diff-header-remote",
            text: "Remote",
        });

        // Basic extensions for both editors
        const basicExtensions = [
            lineNumbers(),
            highlightSelectionMatches(),
            drawSelection(),
            keymap.of([...standardKeymap, indentWithTab, ...searchKeymap]),
            history(),
            search(),
            EditorView.lineWrapping,
        ];

        // Remote editor config (read-only)
        const remoteConfig = {
            doc: remoteContent,
            extensions: [
                ...basicExtensions,
                EditorView.editable.of(false),
                EditorState.readOnly.of(true),
                EditorView.theme({
                    "&": { backgroundColor: "#1e1e1e" },
                }),
            ],
        };

        // Local editor config (also read-only for viewing only)
        const localConfig = {
            doc: localContent,
            extensions: [
                ...basicExtensions,
                EditorView.editable.of(false),
                EditorState.readOnly.of(true),
                EditorView.theme({
                    "&": { backgroundColor: "#1e1e1e" },
                }),
            ],
        };

        // Create container for the merge view
        const mergeContainer = contentEl.createDiv({
            cls: "smart-sync-merge-view-container",
        });
        mergeContainer.addClasses(["cm-s-obsidian", "mod-cm6"]);

        // Create the MergeView
        this.mergeView = new MergeView({
            a: remoteConfig, // Left side (remote)
            b: localConfig, // Right side (local)
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
