import { App, Modal, Notice, TFile } from "obsidian";
import SmartSyncPlugin from "./main";
import { logNotice } from "./util";
import { Status } from "./const";

interface DailyOfflineModalOptions {
    middleClick: boolean;
}

export class DailyOfflineModal extends Modal {
    private middleClick: boolean;
    private dailyNotePath: string;
    private dailyNoteExists: boolean;
    private retryCount: number = 0;

    constructor(
        app: App,
        public plugin: SmartSyncPlugin,
        options: DailyOfflineModalOptions
    ) {
        super(app);
        this.middleClick = options.middleClick;
        this.dailyNotePath = this.getDailyNotePath();
        this.dailyNoteExists = this.checkDailyNoteExists();
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        modalEl.addClass("smart-sync-daily-modal");

        contentEl.createEl("h2", { text: "📡 SmartSync - Connection Required" });

        const statusEl = contentEl.createDiv({ cls: "smart-sync-modal-status" });
        statusEl.createEl("p", { text: "Client seems offline. What do you want to do?" });

        // Show file info
        const fileInfo = contentEl.createDiv({ cls: "smart-sync-file-info" });
        fileInfo.createEl("p", {
            text: `📄 Daily Note: ${this.dailyNotePath.split("/").pop()}`,
        });
        fileInfo.createEl("p", {
            text: this.dailyNoteExists ? "ℹ️ Local file exists" : "ℹ️ No local file found",
            cls: this.dailyNoteExists ? "smart-sync-file-exists" : "smart-sync-file-missing",
        });

        // Buttons container
        const buttonContainer = contentEl.createDiv({ cls: "smart-sync-modal-buttons" });

        // Primary action (Open or Create)
        const primaryBtn = buttonContainer.createEl("button", {
            text: this.dailyNoteExists ? "📂 Open local note (no sync)" : "📝 Create new note (no sync)",
            cls: ["mod-cta", "smart-sync-modal-btn-primary"],
        });
        primaryBtn.addEventListener("click", () => this.handlePrimaryAction());

        // Retry button
        const retryBtn = buttonContainer.createEl("button", {
            text: "🔄 Retry connection",
            cls: "smart-sync-modal-btn-secondary",
        });
        retryBtn.addEventListener("click", () => this.handleRetry());

        // Cancel button
        const cancelBtn = buttonContainer.createEl("button", {
            text: "❌ Cancel",
            cls: "smart-sync-modal-btn-cancel",
        });
        cancelBtn.addEventListener("click", () => this.close());

        // Status footer
        this.statusFooter = contentEl.createDiv({ cls: "smart-sync-modal-footer" });
        this.updateStatusFooter();
    }

    private statusFooter: HTMLElement;

    private getDailyNotePath(): string {
        const folder = this.plugin.settings.dailyNotesFolder;
        const format = this.plugin.settings.dailyNotesFormat;
        const { filePath } = this.plugin.dailyNote.getDailyNotePath(folder, format);
        return filePath;
    }

    private checkDailyNoteExists(): boolean {
        const existingFile = this.app.vault.getAbstractFileByPath(this.dailyNotePath);
        return existingFile !== null;
    }

    private async handlePrimaryAction() {
        if (this.dailyNoteExists) {
            // Open existing local file
            const existingFile = this.app.vault.getAbstractFileByPath(this.dailyNotePath);
            if (existingFile instanceof TFile) {
                await this.app.workspace.getLeaf(this.middleClick).openFile(existingFile);
                logNotice("Opened local daily note (no sync)");
            }
        } else {
            // Create new note without server
            try {
                await this.plugin.dailyNote.getDailyNote(this.dailyNotePath, undefined);
                const newFile = this.app.vault.getAbstractFileByPath(this.dailyNotePath);
                if (newFile instanceof TFile) {
                    await this.app.workspace.getLeaf(this.middleClick).openFile(newFile);
                    logNotice("Created new daily note (no sync)");
                }
            } catch (error) {
                new Notice(`Failed to create daily note: ${error}`);
                return; // Don't close modal on error
            }
        }
        this.close();
    }

    private async handleRetry() {
        this.retryCount++;
        this.updateStatusFooter("Retrying...");

        try {
            const status = await this.plugin.smartSyncClient.getStatus();
            if (status && status.online) {
                // Connection successful - proceed with normal flow
                this.close();
                this.plugin.dailyNote.dailyNote(this.middleClick);
                return;
            }
        } catch (error) {
            console.log("Retry failed:", error);
        }

        // Still offline - update footer
        this.updateStatusFooter("Connection failed. Try again.");
    }

    private updateStatusFooter(message?: string) {
        if (!this.statusFooter) return;

        const baseMessage = message || "Ready to retry";
        const retryInfo = this.retryCount > 0 ? ` | Retries: ${this.retryCount}` : "";
        this.statusFooter.textContent = `${baseMessage}${retryInfo}`;
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        // Notify dailynote.ts that modal is closed
        this.plugin.dailyOfflineModal = null;
    }
}
