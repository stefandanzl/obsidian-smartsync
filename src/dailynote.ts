import { TFile, moment, normalizePath } from "obsidian";
import SmartSyncPlugin from "./main";
import { createFolderIfNotExists, logNotice } from "./util";
import { Status } from "./const";
import { DailyOfflineModal } from "./dailyModal";

export class DailyNoteManager {
    constructor(private plugin: SmartSyncPlugin) {
        this.plugin = plugin;
    }

    /**
     * Creates or updates a daily note, comparing local and remote content
     */
    async getDailyNote(filePath: string, remoteContent: string | undefined): Promise<[file: TFile, usedTemplate?: boolean]> {
        let finalContent = "";
        let usedTemplate = false;

        // Check if file exists locally
        const existingFile = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (existingFile instanceof TFile) {
            const localContent = await this.plugin.app.vault.read(existingFile);

            // Use remote content if it's longer, otherwise keep local
            // if (remoteContent && remoteContent.length > localContent.length) {
            if (localContent === remoteContent) {
                return [existingFile];
            }
            if (remoteContent !== undefined) {
                this.plugin.show("Modified Daily Note from the one on SmartSync");
                finalContent = remoteContent;
                // Update existing file instead of creating new one
                await this.plugin.app.vault.modify(existingFile, finalContent);
                return [existingFile];
            } else {
                return [existingFile];
            }
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
        console.log(templateFile);
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
        const momentDate = moment();
        const formattedDate = momentDate.format(format);

        const filePath = normalizePath(`${folder}/${formattedDate}.md`);
        const folderPath = filePath.split("/").slice(0, -1).join("/");
        console.log(folderPath);

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
            } else {
                console.error("Daily Note: no connection possible");
            }
        } catch (error) {
            console.log("Daily Note: Failed to fetch remote content due to connection error:", error);
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
        await this.plugin.app.workspace.getLeaf(middleClick).openFile(file);

        const editor = this.plugin.app.workspace.activeEditor?.editor;

        if (editor && this.plugin.settings.dailyNotesTimestamp && usedTemplate !== true) {
            let lastLine = editor.lastLine();
            const lastLineContent = editor.getLine(lastLine);
            editor.setLine(lastLine, lastLineContent + `\n\n${moment().format("HH:mm")} - `);
            lastLine = editor.lastLine();
            const lastLineLength = editor.getLine(lastLine).length;
            editor.setCursor({ line: lastLine, ch: lastLineLength });
        }
    }

    private getDailyNotePathInfo() {
        const folder = this.plugin.settings.dailyNotesFolder;
        const format = this.plugin.settings.dailyNotesFormat;
        return this.getDailyNotePath(folder, format);
    }

    /**
     * Main function to create/sync daily note
     */
    async dailyNote(middleClick = false) {
        try {
            // Handle offline scenarios
            if (this.plugin.status === Status.ERROR) {
                logNotice("Error detected! ❌\nClear error in SmartSync control modal and try to get Daily Note again!");
                return;
            }

            // Check if modal is already open - if so, don't create another
            if (this.plugin.dailyOfflineModal) {
                logNotice("Daily note modal already open - please use the modal options");
                return;
            }

            // Quick connection test
            // const connected = await this.establishConnection();
            const connected = await this.plugin.operations.test(false);
            if (!connected) {
                // Show modal instead of auto-retry
                this.plugin.dailyOfflineModal = new DailyOfflineModal(this.plugin.app, this.plugin, { middleClick });
                this.plugin.dailyOfflineModal.open();
                return;
            }

            const { filePath, folderPath } = this.getDailyNotePathInfo();

            await createFolderIfNotExists(this.plugin.app.vault, folderPath);

            const remoteContent = await this.getDailyNoteRemotely(filePath);
            const [dailyNote, usedTemplate] = await this.getDailyNote(filePath, remoteContent);

            await this.openNoteWithTimestamp(dailyNote, middleClick, usedTemplate);
        } catch (err) {
            console.error("Failed to create/open daily note:", err);
            // logNotice(`Daily note operation failed: ${err.message}`);
            throw new Error(`Daily note operation failed: ${err.message}`);
        }
    }
}
