import { WebDAVClient } from "./webdav";
import Cloudr from "./main";
import { extname, sha256 } from "./util";
import { TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { FileList, WebDAVDirectoryItem, Exclusions } from "./const";

interface FileProcessor {
    (file: string): Promise<void>;
}

interface ConcurrencyProcessor {
    <T>(items: T[], worker: (item: T) => Promise<void>, limit: number): Promise<void>;
}

export class Checksum {
    localFiles: FileList = {};

    constructor(public plugin: Cloudr) {
        this.plugin = plugin;
    }

    refineObject(data: WebDAVDirectoryItem[], exclusions: Exclusions) {
        const refinedObject: FileList = {};

        data.forEach((item) => {
            // console.log(item)
            const { filename, props } = item;

            // const isDirectory = type === "directory";
            // const fullPath = isDirectory ? filename + "/" : filename;

            // const fullPath = filename;

            if (this.isExcluded(filename)) {
                return; // Skip excluded files and folders
            }
            if (props && props.checksum) {
                const checksum = props.checksum;
                refinedObject[filename] = checksum;
            } else {
                refinedObject[filename] = "";
            }
        });
        return refinedObject;
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
            // Check if the file path starts with the base path
            if (filePath.startsWith(basePath)) {
                // Remove the base path from the file path
                const relativePath: string = filePath.substring(basePath.length).replace(/^\//, "");
                removedBase[relativePath] = checksum;
            } else {
                // If the file path doesn't start with the base path, keep it unchanged
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
                this.localFiles[file] = await sha256(data);
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
                this.localFiles[folderPath] = "";
                await this.getHiddenLocalFiles(normalizePath(folder), exclude, concurrency);
            } catch (error) {
                console.error(`Error processing folder ${folder}:`, error);
            }
        };

        // Execute file and folder processing
        await Promise.all([processConcurrently(files, processFile, concurrency), processConcurrently(folders, processFolder, concurrency)]);
    }

    /**
     * Generate a hash tree of the local files
     * @param exclude - Exclude hidden files and folders -
     * is used here also to differentiate when populating prevData
     * is used in the getHiddenLocalFiles function
     * @returns Hash tree of the local files
     * @async
     * @function generateLocalHashTree
     */
    generateLocalHashTree = async (exclude: boolean) => {
        // const rootFolder = self.basePath;
        // const checksumTable = {};
        this.localFiles = {};

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
                // const filePath = element.path
                try {
                    // console.log("FILE",element)
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
                                this.localFiles[filePath] = cacheHash;
                                hashStats.cachedHashes++;
                                return;
                            } catch (error) {
                                console.error("fileCache Error", element, error);
                            }
                        }
                        const content = await this.plugin.app.vault.readBinary(element);
                        this.localFiles[filePath] = await sha256(content);
                        hashStats.calculatedHashes++;
                        return;
                    } else if (element instanceof TFolder) {
                        const filePath = element.path + "/";
                        if ((exclude && this.isExcluded(filePath)) || filePath === "//") {
                            return;
                        }
                        this.localFiles[filePath] = "";
                    } else {
                        console.error("NEITHER FILE NOR FOLDER? ", element);
                    }
                } catch (error) {
                    console.error("localTFiles Errororr", element, error);
                }
            })
        );
        // if (!this.plugin.settings.skipHidden) {
        const configDir = this.plugin.app.vault.configDir;

        this.localFiles[configDir + "/"] = "";
        await this.getHiddenLocalFiles(configDir, exclude);
        // }

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
            this.plugin.localFiles = this.localFiles;
        }
        return this.localFiles;
    };

    // Fetch directory contents from webdav
    generateWebdavHashTree = async (webdavClient: WebDAVClient, rootFolder: string, exclusions: Exclusions): Promise<FileList> => {
        try {
            const exists = await webdavClient.exists(rootFolder);
            if (exists) {
                this.plugin.log("ROOTFOLDER DOES EXIST");
            } else {
                this.plugin.log("DOES NOT EXIST");
                await webdavClient.createDirectory(rootFolder);
            }
        } catch (error) {
            console.error("ERROR: generatessWebdavHashTree", error);
            // return error;
        }

        // exclusions.directories = exclusions.directories || [];
        // exclusions.directories.push("node_modules", ".git", "plugins/remotely-sync", "remotely-sync/src", "obsidian-cloudr");

        try {
            // Get directory contents - deep true, details true
            // const contents = await webdavClient.getDirectoryContents(rootFolder, {
            //   deep: true,
            //   details: true,
            // }); //details: true

            const contents = await webdavClient.getDirectory(rootFolder, "infinity");

            const refinedResult = this.refineObject(contents, exclusions);

            const webdavHashtree = this.removeBase(refinedResult, rootFolder);
            // writeFileSync("out/output-webdav2.json", JSON.stringify(refinedResult, null, 2));
            this.plugin.log("webdav: ", webdavHashtree);
            this.plugin.webdavFiles = webdavHashtree;
            return webdavHashtree;
        } catch (error) {
            console.error("Error:", error);
            return error;
        }
    };
}
