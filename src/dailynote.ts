import { TFile, moment, normalizePath } from "obsidian";
import SmartSyncPlugin from "./main";
import { createFolderIfNotExists, logNotice } from "./util";
import { Status, STATUS_ITEMS } from "./const";

export class DailyNoteManager {
    private ignoreConnection: boolean; //currently unused

    constructor(private plugin: SmartSyncPlugin) {
        this.plugin = plugin;
        this.ignoreConnection = false; //set statically
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
        } catch (err) {
            this.plugin.show("Daily Note File Error: ", err);

            console.error(`Failed to create daily note at '${filePath}':`, err);
            throw new Error(`Failed to create daily note: ${err.message}`);
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
     * Establishes connection with retry logic
     */
    private async establishConnection(): Promise<boolean> {
        const maxRetries = 5;
        const timeout = 2000; // 500ms timeout
        let retryCount = 0;
        let connected = false;

        while (retryCount < maxRetries && !connected) {
            try {
                connected = await Promise.race([
                    this.plugin.smartSyncClient.getStatus().then((status) => status.online),
                    new Promise<never>((_resolve, reject) => {
                        setTimeout(() => reject(new Error("Connection timeout")), timeout);
                    }),
                ]);

                if (connected) break;
            } catch (error) {
                console.log(`Connection attempt ${retryCount + 1} failed: ${error.message}`);
            }
            retryCount++;
            logNotice(`Connection attempt ${retryCount}/${maxRetries} failed ⌛`, 1800);

            if (retryCount <= maxRetries && !connected) {
                await new Promise((resolve) => setTimeout(resolve, timeout));
            }
        }

        return !!connected;
    }

    /**
     * Handles offline status checks and existing file opening
     */
    private async handleOfflineStatus(middleClick: boolean): Promise<boolean> {
        const folder = this.plugin.settings.dailyNotesFolder;
        const format = this.plugin.settings.dailyNotesFormat;
        const { filePath } = this.getDailyNotePath(folder, format);

        // Check if daily note already exists locally
        const existingFile = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (existingFile instanceof TFile) {
            logNotice("Opening existing daily note\nCurrently not online ");
            await this.plugin.app.workspace.getLeaf(middleClick).openFile(existingFile);
            return true; // Handled offline case
        } else {
            logNotice("Cant use Daily Notes feature: Status must be " + Status.NONE);
            return true; // Can't proceed
        }
    }

    /**
     * Handles connection failure by checking for existing local file
     */
    private async handleConnectionFailure(middleClick: boolean): Promise<boolean> {
        const folder = this.plugin.settings.dailyNotesFolder;
        const format = this.plugin.settings.dailyNotesFormat;
        const { filePath } = this.getDailyNotePath(folder, format);

        const existingFile = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (existingFile instanceof TFile) {
            logNotice(
                "Opening existing daily note\nCurrently NO INTERNET CONNECTION!🚩\nContent could be older than remote!\nMERGE CONTENT MANUALLY!",
                8000
            );

            await this.plugin.app.workspace.getLeaf(middleClick).openFile(existingFile);
            return true; // Handled with existing file
        } else {
            logNotice("No internet connection.\nClick Daily Notes again to FORCE new note without connecting to server.", 8000);
            this.ignoreConnection = true;
            return true; // Can't proceed
        }
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
                logNotice("Error detected! ❌\nClear error in webdav control modal and try to get Daily Note again!");
                // this.plugin.show(this.plugin.message, 5000);
                return;
            }

            if (!this.ignoreConnection) {
                if (this.plugin.status !== Status.NONE && this.plugin.status !== Status.OFFLINE) {
                    const waitTime = 3;
                    logNotice(
                        `SmartSync plugin currently busy with ${STATUS_ITEMS[this.plugin.status].label} ${this.plugin.status}!\nTrying automatically again in ${waitTime} seconds ...`,
                        1000 * waitTime
                    );
                    await sleep(1000 * waitTime);
                    //@ts-ignore
                    if (this.plugin.status !== Status.NONE) {
                        this.plugin.show(
                            `SmartSync plugin currently busy with ${STATUS_ITEMS[this.plugin.status].label} ${this.plugin.status}!\nTry again later - check statusbar icon for info!`
                        );
                        return;
                    }
                }
                const connected = await this.establishConnection();
                if (!connected) {
                    if (await this.handleConnectionFailure(middleClick)) {
                        return;
                    }
                }
            }

            this.ignoreConnection = false;
            const { filePath, folderPath } = this.getDailyNotePathInfo();

            await createFolderIfNotExists(this.plugin.app.vault, folderPath);

            const remoteContent = await this.getDailyNoteRemotely(filePath);
            const [dailyNote, usedTemplate] = await this.getDailyNote(filePath, remoteContent);

            await this.openNoteWithTimestamp(dailyNote, middleClick, usedTemplate);
        } catch (err) {
            console.error("Failed to create/open daily note:", err);
            logNotice(`Daily note operation failed: ${err.message}`);
            throw new Error(`Daily note operation failed: ${err.message}`);
        }
    }
}
