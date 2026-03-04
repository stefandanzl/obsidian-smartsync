import { SmartSyncClient, ChecksumsResponse } from "./smartSync";
import SmartSyncPlugin from "./main";
import { sha256 } from "./util";
import { TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { FileList } from "./const";
import ignoreFactory from "ignore";

interface FileProcessor {
    (file: string): Promise<void>;
}

interface ConcurrencyProcessor {
    <T>(items: T[], worker: (item: T) => Promise<void>, limit: number): Promise<void>;
}

export class Checksum {
    allLocalFiles: FileList = {};
    hashDurations: Record<string, number> = {};

    constructor(public plugin: SmartSyncPlugin) {
        this.plugin = plugin;
    }

    // returns true if is excluded and false if is included
    isExcluded(filePath: string) {
        if (this.plugin.settings.exclusionsOverride) {
            return false;
        }

        try {
            const ig = ignoreFactory();

            // Add all patterns
            for (const pattern of this.plugin.settings.ignorePatterns) {
                ig.add(pattern);
            }

            // Add .obsidian skip if configured
            const addObsidian = this.plugin.mobile ? this.plugin.settings.skipHiddenMobile : this.plugin.settings.skipHiddenDesktop;

            if (addObsidian) {
                ig.add(".obsidian/");
            }

            return ig.ignores(filePath);
        } catch (error) {
            console.error("Ignore check error for path:", filePath, error);
            return false; // Don't exclude on error
        }
    }

    async getHiddenLocalFiles(path: string, exclude = true, concurrency = 15): Promise<void> {
        const { files, folders } = await this.plugin.app.vault.adapter.list(path);

        // Process files with concurrency control
        const processConcurrently: ConcurrencyProcessor = async (items, worker, limit) => {
            for (let i = 0; i < items.length; i += limit) {
                const chunk = items.slice(i, i + limit);
                await Promise.all(chunk.map(worker));
            }
        };

        const processFile: FileProcessor = async (file) => {
            try {
                if (exclude && this.isExcluded(file)) {
                    return;
                }
                const start = Date.now();
                const data = await this.plugin.app.vault.adapter.readBinary(file);
                this.allLocalFiles[file] = await sha256(data);
                this.hashDurations[file] = Date.now() - start;
            } catch (error) {
                console.error(`Error processing file ${file}:`, error);
            }
        };

        // Process folders recursively
        const processFolder = async (folder: string): Promise<void> => {
            const folderPath = `${folder}/`;

            if (exclude && this.isExcluded(folderPath)) {
                return;
            }

            try {
                this.allLocalFiles[folderPath] = "dir";
                await this.getHiddenLocalFiles(normalizePath(folder), exclude, concurrency);
            } catch (error) {
                console.error(`Error processing folder ${folder}:`, error);
            }
        };

        // Execute file and folder processing
        await Promise.all([processConcurrently(files, processFile, concurrency), processConcurrently(folders, processFolder, concurrency)]);
    }

    /**
     * Generate a hash tree of local files
     * @param exclude - Exclude hidden files and folders -
     * is used here also to differentiate when populating prevData
     * is used in getHiddenLocalFiles function
     * @returns Hash tree of local files
     * @async
     * @function generateLocalHashTree
     */
    generateLocalHashTree = async (exclude: boolean): Promise<{ files: FileList; end: number }> => {
        this.allLocalFiles = {};

        const localTFiles: TAbstractFile[] = this.plugin.app.vault.getAllLoadedFiles();

        //@ts-ignore little trick
        const fileCache = this.plugin.app.metadataCache.fileCache;

        this.plugin.log("=== FileCache ===");
        this.plugin.log(fileCache);

        // Initialize statistics for this run
        const hashStats = {
            totalFiles: 0,
            cachedHashes: 0,
            calculatedHashes: 0,
            skippedFiles: 0,
        };

        await Promise.all(
            localTFiles.map(async (element) => {
                try {
                    if (element instanceof TFile) {
                        const filePath = element.path;
                        hashStats.totalFiles++;
                        if (exclude && this.isExcluded(filePath)) {
                            hashStats.skippedFiles++;
                            return;
                        }
                        if (fileCache && filePath.endsWith(".md")) {
                            try {
                                const cacheHash = fileCache[filePath].hash;
                                if (!cacheHash) {
                                    throw new Error("empty fileCache");
                                }
                                this.allLocalFiles[filePath] = cacheHash;
                                hashStats.cachedHashes++;
                                return;
                            } catch (error) {
                                console.error("fileCache Error", element, error);
                            }
                        }
                        const start = Date.now();
                        const content = await this.plugin.app.vault.readBinary(element);
                        this.allLocalFiles[filePath] = await sha256(content);
                        hashStats.calculatedHashes++;
                        this.hashDurations[filePath] = Date.now() - start;
                        return;
                    } else if (element instanceof TFolder) {
                        const filePath = element.path + "/";
                        if (filePath === "//" || (exclude && this.isExcluded(filePath))) {
                            return;
                        }
                        this.allLocalFiles[filePath] = "dir";
                    } else {
                        console.error("NEITHER FILE NOR FOLDER? ", element);
                    }
                } catch (error) {
                    console.error("localTFiles Errororr", element, error);
                }
            })
        );
        const configDir = this.plugin.app.vault.configDir;
        this.allLocalFiles[configDir + "/"] = "dir";
        await this.getHiddenLocalFiles(configDir, exclude);

        // Store statistics in plugin for access from operations
        if (!this.plugin.hashStats) {
            this.plugin.hashStats = {
                local: {
                    totalFiles: 0,
                    cachedHashes: 0,
                    calculatedHashes: 0,
                    skippedFiles: 0,
                },
            };
        }
        this.plugin.hashStats.local = hashStats;

        this.plugin.log(`LOCAL HASH STATISTICS: ${JSON.stringify(hashStats, null, 2)}`);
        this.plugin.log(this.hashDurations);

        if (exclude) {
            this.plugin.localFiles = this.allLocalFiles;
        }

        return { files: this.allLocalFiles, end: Date.now() };
    };

    /**
     * Fetch checksums from SmartSyncServer
     * @param smartSyncClient - The SmartSync client instance
     * @returns Hash tree of remote files
     */
    generateRemoteHashTree = async (smartSyncClient: SmartSyncClient): Promise<{ files: FileList; end: number }> => {
        try {
            // Check if server is online
            const status = await smartSyncClient.getStatus();
            if (!status.online) {
                throw new Error("SmartSyncServer is offline");
            }

            this.plugin.log("Server is online, fetching checksums...");

            // Get all checksums from SmartSyncServer
            const response: ChecksumsResponse = await smartSyncClient.getChecksums();

            this.plugin.log(`Remote checksums received: ${response.file_count} files`);

            // Convert checksums object to FileList format
            // SmartSyncServer returns: { checksums: { "path/to/file": "hash123", ... }, file_count: N }
            // Server now returns full vault paths like "/My Notes/test.md"
            const remoteHashTree: FileList = {};

            for (const [filePath, checksum] of Object.entries(response.checksums)) {
                // Store paths as-is from server (full vault paths included)
                remoteHashTree[filePath] = checksum;
            }

            this.plugin.remoteFiles = remoteHashTree;

            return { files: remoteHashTree, end: Date.now() };
        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    };
}
