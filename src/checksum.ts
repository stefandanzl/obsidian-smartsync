import { SmartSyncClient, ChecksumsResponse } from "./smartSync";
import SmartSyncPlugin from "./main";
import { extname, sha256 } from "./util";
import { TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { FileList, Exclusions } from "./const";

interface FileProcessor {
    (file: string): Promise<void>;
}

interface ConcurrencyProcessor {
    <T>(items: T[], worker: (item: T) => Promise<void>, limit: number): Promise<void>;
}

export class Checksum {
    remoteFiles: FileList = {};

    constructor(public plugin: SmartSyncPlugin) {
        this.plugin = plugin;
    }

    // returns true if is excluded and false if is included
    isExcluded(filePath: string) {
        const { extensions, directories, markers }: Exclusions = this.plugin.settings.exclusions;

        if (this.plugin.settings.exclusionsOverride) {
            return false;
        }
        const directoriesMod = structuredClone(directories); // necessary because otherwise original array will be manipulated!

        if (this.plugin.mobile) {
            if (this.plugin.settings.skipHiddenMobile) {
                directoriesMod.push(this.plugin.app.vault.configDir + "/");
            }
        } else {
            if (this.plugin.settings.skipHiddenDesktop) {
                directoriesMod.push(this.plugin.app.vault.configDir + "/");
            }
        }

        const folders = filePath.split("/");
        if (!filePath.endsWith("/")) {
            folders.pop();
        }
        if (folders.some((folder) => directoriesMod.includes(folder))) {
            return true;
        }
        if (
            folders.some((folder) => {
                filePath.endsWith(folder + "/");
                return true;
            })
        )
            if (extensions.length > 0) {
                // Check file extensions
                const extension = extname(filePath).toLowerCase();
                if (extensions.includes(extension)) {
                    return true;
                }
            }

        // Check markers
        if (markers.some((marker) => filePath.includes(marker))) {
            return true;
        }

        return false;
    }

    removeBase(fileChecksums: FileList, basePath: string) {
        const removedBase: FileList = {};

        for (const [filePath, checksum] of Object.entries(fileChecksums)) {
            // Check if file path starts with base path
            if (filePath.startsWith(basePath)) {
                // Remove base path from file path
                const relativePath: string = filePath.substring(basePath.length).replace(/^\//, "");
                removedBase[relativePath] = checksum;
            } else {
                // If file path doesn't start with base path, keep it unchanged
                removedBase[filePath] = checksum;
            }
        }

        return removedBase;
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

                const data = await this.plugin.app.vault.adapter.readBinary(file);
                this.remoteFiles[file] = await sha256(data);
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
                this.remoteFiles[folderPath] = "";
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
    generateLocalHashTree = async (exclude: boolean) => {
        this.remoteFiles = {};

        const localTFiles: TAbstractFile[] = this.plugin.app.vault.getAllLoadedFiles();

        //@ts-ignore little trick
        const fileCache = this.plugin.app.metadataCache.fileCache;

        this.plugin.log(fileCache);

        // Initialize statistics for this run
        const hashStats = {
            totalFiles: 0,
            cachedHashes: 0,
            calculatedHashes: 0,
            skippedFiles: 0
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
                                this.remoteFiles[filePath] = cacheHash;
                                hashStats.cachedHashes++;
                                return;
                            } catch (error) {
                                console.error("fileCache Error", element, error);
                            }
                        }
                        const content = await this.plugin.app.vault.readBinary(element);
                        this.remoteFiles[filePath] = await sha256(content);
                        hashStats.calculatedHashes++;
                        return;
                    } else if (element instanceof TFolder) {
                        const filePath = element.path + "/";
                        if ((exclude && this.isExcluded(filePath)) || filePath === "//") {
                            return;
                        }
                        this.remoteFiles[filePath] = "";
                    } else {
                        console.error("NEITHER FILE NOR FOLDER? ", element);
                    }
                } catch (error) {
                    console.error("localTFiles Errororr", element, error);
                }
            })
        );
        const configDir = this.plugin.app.vault.configDir;
        this.remoteFiles[configDir + "/"] = "";
        await this.getHiddenLocalFiles(configDir, exclude);

        // Store statistics in plugin for access from operations
        if (!this.plugin.hashStats) {
            this.plugin.hashStats = {
                local: {
                    totalFiles: 0,
                    cachedHashes: 0,
                    calculatedHashes: 0,
                    skippedFiles: 0
                }
            };
        }
        this.plugin.hashStats.local = hashStats;

        this.plugin.log(`LOCAL HASH STATISTICS: ${JSON.stringify(hashStats, null, 2)}`);

        if (exclude) {
            this.plugin.localFiles = this.remoteFiles;
        }
        return this.remoteFiles;
    };

    /**
     * Fetch checksums from SmartSyncServer
     * @param smartSyncClient - The SmartSync client instance
     * @param basePath - The base remote path to prepend to file paths
     * @returns Hash tree of remote files
     */
    generateRemoteHashTree = async (smartSyncClient: SmartSyncClient, basePath: string): Promise<FileList> => {
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
            const remoteHashTree: FileList = {};

            for (const [filePath, checksum] of Object.entries(response.checksums)) {
                // Store relative paths only (remove base path if present)
                const relativePath = filePath.startsWith(basePath)
                    ? filePath.substring(basePath.length).replace(/^\//, "")
                    : filePath;
                remoteHashTree[relativePath] = checksum;
            }

            this.plugin.remoteFiles = remoteHashTree;
            return remoteHashTree;
        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    };
}
