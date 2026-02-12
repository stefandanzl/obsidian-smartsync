import SmartSyncPlugin from "./main";
import { SmartSyncClient } from "./smartSync";
import { join, dirname, calcDuration, logNotice } from "./util";
import { normalizePath } from "obsidian";
import { Controller, FileList, Status, STATUS_ITEMS } from "./const";

export class Operations {
    constructor(public plugin: SmartSyncPlugin) {
        this.plugin = plugin;
    }

    /**
     * Configure and create SmartSync client
     */
    configSmartSync(url: string, port: number, authToken?: string): SmartSyncClient {
        if (!url) {
            throw new Error("Missing SmartSync URL");
        }

        return new SmartSyncClient({
            serverUrl: url,
            port: port || 443,
            authToken,
        });
    }

    async downloadFiles(filesMap: FileList): Promise<void> {
        if (!filesMap || Object.keys(filesMap).length === 0) {
            this.plugin.log("No files to download");
            return;
        }

        // First attempt for all files
        const results = await Promise.all(
            Object.entries(filesMap).map(async ([filePath, _]) => ({
                filePath,
                success: await this.downloadFile(filePath),
            }))
        );

        // Filter out failed downloads and retry them
        const failedDownloads = results.filter((r) => !r.success);
        if (failedDownloads.length > 0) {
            console.log(`Retrying ${failedDownloads.length} failed downloads...`);
            await Promise.all(failedDownloads.map(({ filePath }) => this.downloadFile(filePath)));
        }
    }

    private async downloadFile(filePath: string): Promise<boolean> {
        try {
            if (filePath.endsWith("/")) {
                await this.ensureLocalDirectory(filePath);
                this.plugin.processed();
                return true;
            }

            const remotePath = join(this.plugin.baseRemotePath, filePath);

            // Verify remote file exists by checking if server is online
            const status = await this.plugin.smartSyncClient.getStatus();
            if (!status.online) {
                console.error(`Remote server is offline, cannot download ${remotePath}`);
                return false;
            }

            // Download with retry
            const fileData = await this.downloadWithRetry(remotePath);
            if (fileData.status !== 200) {
                throw new Error(`Failed to download ${remotePath}: ${fileData.status}`);
            }
            /// app.vault.adapter.writeBinary("AAA/AAA/A1.md","TEST")
            await this.plugin.app.vault.adapter.writeBinary(filePath, fileData.data);
            this.plugin.processed();
            return true;
        } catch (error) {
            this.plugin.log(`Error downloading ${filePath}:`, error);
            return false;
        }
    }

    // Helper methods
    private async downloadWithRetry(
        remotePath: string,
        maxRetries = 2
    ): Promise<{
        data: ArrayBuffer;
        status: number;
    }> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.plugin.smartSyncClient.getFile(remotePath);
            } catch (error) {
                if (attempt === maxRetries) throw error;
                console.log(`Retry ${attempt} for ${remotePath}`);
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        throw new Error(`Failed to download after ${maxRetries} attempts`);
    }

    private async ensureLocalDirectory(path: string): Promise<void> {
        const exists = await this.plugin.app.vault.adapter.exists(path);
        if (!exists) {
            console.log(`Creating local directory: ${path}`);
            await this.plugin.app.vault.createFolder(path);
        }
    }

    /**
     * Upload files to SmartSyncServer
     */
    async uploadFiles(fileChecksums: FileList): Promise<void> {
        if (!fileChecksums || Object.keys(fileChecksums).length === 0) {
            this.plugin.log("No files to upload");
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for (const [localFilePath, _] of Object.entries(fileChecksums)) {
            await this.uploadFile(localFilePath);
        }

        console.log("Upload completed");
    }

    /**
     * Upload a single file to SmartSyncServer
     */
    private async uploadFile(localFilePath: string): Promise<void> {
        try {
            if (localFilePath.endsWith("/")) {
                await this.ensureRemoteDirectory(localFilePath);
                return;
            }

            const fileContent = await this.plugin.app.vault.adapter.readBinary(normalizePath(localFilePath));
            const remoteFilePath = join(this.plugin.baseRemotePath, localFilePath);

            await this.plugin.smartSyncClient.uploadFile(remoteFilePath, fileContent);
            this.plugin.processed();
            this.plugin.log(`Uploaded: ${localFilePath} to ${remoteFilePath}`);
        } catch (error) {
            console.error(`Error uploading ${localFilePath}:`, error);
        }
    }

    /**
     * Delete files from SmartSyncServer
     */
    async deleteFilesRemote(fileTree: FileList): Promise<void> {
        if (!fileTree || Object.keys(fileTree).length === 0) {
            this.plugin.log("No files to delete on remote");
            return;
        }

        const failedPaths: string[] = [];

        const deleteFile = async (path: string): Promise<void> => {
            const cleanPath = path.endsWith("/") ? path.replace(/\/$/, "") : path;
            const fullPath = join(this.plugin.baseRemotePath, cleanPath);

            try {
                const response = await this.plugin.smartSyncClient.deleteFile(fullPath);
                if (response !== 200 && response !== 204 && response !== 404) {
                    console.log(fullPath, " Error status: ", response);
                    failedPaths.push(fullPath);
                    return;
                }
                this.plugin.processed();
            } catch (error) {
                console.error(`Delete failed for ${cleanPath}:`, error);
                failedPaths.push(fullPath);
            }
        };

        const retryDelete = async (path: string): Promise<void> => {
            try {
                const status = await this.plugin.smartSyncClient.getStatus();
                if (!status.online) {
                    console.log(`Server offline for ${path}, skipping delete retry`);
                    this.plugin.processed();
                    return;
                }

                const response = await this.plugin.smartSyncClient.deleteFile(path);
                if (response === 200 || response === 204 || response === 404) {
                    this.plugin.processed();
                    console.log(`Retry successful: ${path}`);
                } else {
                    console.log(`Delete still failed for ${path}, status: ${response}`);
                }
            } catch (error) {
                console.error(`Final delete attempt failed for ${path}:`, error);
            }
        };

        // First attempt for all files
        await Promise.all(Object.keys(fileTree).map(deleteFile));

        // Retry failed deletions
        if (failedPaths.length > 0) {
            console.log(`Retrying ${failedPaths.length} failed deletions...`);
            await Promise.all(failedPaths.map(retryDelete));
        }
    }

    /**
     * Delete files from local storage
     */
    async deleteFilesLocal(fileTree: FileList): Promise<void> {
        if (!fileTree || Object.keys(fileTree).length === 0) {
            this.plugin.log("No files to delete locally");
            return;
        }

        for (const file of Object.keys(fileTree)) {
            await this.deleteLocalFile(file);
        }
    }

    private async deleteLocalFile(file: string): Promise<void> {
        try {
            if (this.plugin.mobile) {
                await this.plugin.app.vault.adapter.trashLocal(file);
            } else {
                await this.plugin.app.vault.adapter.trashSystem(file);
            }
            this.plugin.processed();
        } catch (error) {
            console.error(`Error deleting local file ${file}:`, error);
        }
    }

    private async ensureRemoteDirectory(path: string): Promise<void> {
        try {
            console.log(`Creating remote directory: ${path}`);
            const cleanPath = path.replace(/\/$/, ""); // Remove trailing slash for folder creation
            const fullPath = join(this.plugin.baseRemotePath, cleanPath);
            const response = await this.plugin.smartSyncClient.createFolder(fullPath);
            if (!response) {
                throw new Error(`Failed to create remote directory ${path}`);
            }
            this.plugin.processed();
        } catch (error) {
            console.error(`Error creating remote directory ${path}:`, error);
        }
    }

    async test(show = true) {
        console.log("[TEST] Starting connection test, show:", show);
        try {
            this.plugin.setStatus(Status.TEST);
            show && this.plugin.show(`${Status.TEST} Testing ...`);

            console.log("[TEST] Getting server status...");
            const status = await this.plugin.smartSyncClient.getStatus();
            console.log("[TEST] Server status response:", status);

            // Check if online field exists and is true
            if (status && status.online === true) {
                console.log("[TEST] Connection successful!");
                show && this.plugin.show("Connection successful");
                // ALWAYS set status to NONE after successful test, regardless of show parameter
                this.plugin.setStatus(Status.NONE);

                if (this.plugin.prevData.error) {
                    this.plugin.show("Clear your ERROR state manually!");
                    this.plugin.setStatus(Status.ERROR);
                }
                return true;
            }
            console.log("[TEST] Connection failed, status.online:", status?.online);
            show && this.plugin.show("Connection failed: Server is offline");
            this.plugin.setStatus(Status.OFFLINE);

            return false;
        } catch (error) {
            console.error("[TEST] Connection test failed with error:", error);
            show && this.plugin.show(`SmartSync connection test failed. Error: ${error}`);
            console.error("Failed miserably", error);
            this.plugin.setStatus(Status.ERROR);
            this.plugin.setError(true);
            return false;
        }
    }

    /**
     * This creates a list of files with predefined actions to take
     * @param show
     * @param exclude
     * @returns
     */
    async check(show = true, exclude = true) {
        if (this.plugin.status !== Status.NONE && this.plugin.status !== Status.OFFLINE) {
            show && this.plugin.show(`Checking not possible, currently ${this.plugin.status}`);
            return;
        }

        this.plugin.setStatus(Status.CHECK);
        show && this.plugin.show(`${Status.CHECK} Checking ...`);

        let response;
        const stats = {
            startTime: Date.now(),
            testTime: 0,
            remoteScanTime: 0,
            localScanTime: 0,
            compareTime: 0,
            totalTime: 0,
            fileCounts: {
                remote: 0,
                local: 0
            },
            hashStats: {
                totalFiles: 0,
                cachedHashes: 0,
                calculatedHashes: 0,
                skippedFiles: 0
            }
        };

        try {
            // Test connection
            const testStart = Date.now();
            response = await this.test(false);
            stats.testTime = Date.now() - testStart;

            if (!response) {
                show &&
                    logNotice(
                        `Testing failed, can't continue Check action!\nStatus: ${STATUS_ITEMS[this.plugin.status].label} ${this.plugin.status}`
                    );
                return false;
            }

            this.plugin.checkTime = Date.now();

            // Generate file hash trees with timing
            const remoteStart = Date.now();
            const remotePromise = this.plugin.checksum.generateRemoteHashTree(
                this.plugin.smartSyncClient,
                this.plugin.baseRemotePath
            );

            const localStart = Date.now();
            const localPromise = this.plugin.checksum.generateLocalHashTree(exclude);
            stats.localScanTime = Date.now() - localStart;

            const [remoteFiles, localFiles] = await Promise.all([remotePromise, localPromise]);
            stats.remoteScanTime = Date.now() - remoteStart;
            stats.fileCounts.remote = Object.keys(remoteFiles).length;
            stats.fileCounts.local = Object.keys(localFiles).length;

            // Update hash statistics from checksum
            if (this.plugin.hashStats && this.plugin.hashStats.local) {
                stats.hashStats = this.plugin.hashStats.local;
            }

            // Compare file trees
            const compareStart = Date.now();
            this.plugin.allFiles.local = localFiles;
            this.plugin.allFiles.remote = remoteFiles;
            this.plugin.fileTrees = await this.plugin.compare.compareFileTrees(remoteFiles, localFiles);
            stats.compareTime = Date.now() - compareStart;

            const ok = this.dangerCheck();

            this.plugin.fullFileTrees = structuredClone(this.plugin.fileTrees);

            // Calculate total time
            stats.totalTime = Date.now() - stats.startTime;

            // Log performance statistics
            console.log(`=== CHECK PERFORMANCE STATISTICS ===`);
            console.log(`Total time: ${stats.totalTime}ms`);
            console.log(`Connection test: ${stats.testTime}ms`);
            console.log(`Remote scan: ${stats.remoteScanTime}ms (${stats.fileCounts.remote} files)`);
            console.log(`Local scan: ${stats.localScanTime}ms (${stats.fileCounts.local} files)`);
            console.log(`Comparison: ${stats.compareTime}ms`);
            console.log(`Files per second (Remote): ${Math.round((stats.fileCounts.remote / stats.remoteScanTime) * 1000)}`);
            console.log(`Files per second (Local): ${Math.round((stats.fileCounts.local / stats.localScanTime) * 1000)}`);

            // Log hash statistics
            if (stats.hashStats) {
                const hashPercentage = stats.hashStats.totalFiles > 0
                    ? Math.round((stats.hashStats.cachedHashes / stats.hashStats.totalFiles) * 100)
                    : 0;
                console.log(`\n=== HASH OPTIMIZATION STATISTICS ===`);
                console.log(`Total files processed: ${stats.hashStats.totalFiles}`);
                console.log(`Hashes from cache: ${stats.hashStats.cachedHashes} (${hashPercentage}%)`);
                console.log(`Hashes calculated: ${stats.hashStats.calculatedHashes}`);
                console.log(`Files skipped (excluded): ${stats.hashStats.skippedFiles}`);
                console.log(`Cache efficiency: ${hashPercentage}% - Higher is better!`);
                console.log(`===============================`);
            }

            show && ok && this.plugin.show(`Finished checking files after ${calcDuration(this.plugin.checkTime)} s`);
            if (show && ok) {
                if (this.plugin.calcTotal(this.plugin.fileTrees.localFiles.except) > 0) {
                    this.plugin.show(
                        "Found file sync exceptions! Open SmartSync Control Panel and either PUSH/PULL or resolve each case separately!",
                        5000
                    );
                }
            }
            this.plugin.lastScrollPosition = 0;
            this.plugin.tempExcludedFiles = {};
            this.plugin.modal?.renderFileTrees();
            ok && this.plugin.setStatus(Status.NONE);
            return true;
        } catch (error) {
            console.error("CHECK ERROR: ", error);
            show && this.plugin.show("CHECK ERROR: " + error);
            this.plugin.setError(true);
            response ? this.plugin.setStatus(Status.ERROR) : this.plugin.setStatus(Status.OFFLINE);
            throw error;
        }
    }

    /**
     * Main Sync function for this plugin. This manages all file exchanging
     * @param controller
     * @param show
     * @returns
     */
    async sync(controller: Controller, show = true) {
        console.log("[SYNC] Starting sync, show:", show, "controller:", controller);
        if (this.plugin.prevData.error) {
            console.log("[SYNC] Blocked by error state");
            show && this.plugin.show("Error detected - please clear in control panel or force action by retriggering action");
            return;
        }

        try {
            console.log("[SYNC] Testing connection...");
            if (!(await this.test(false))) {
                console.log("[SYNC] Connection test failed, aborting sync");
                show && this.plugin.show("Connection Problem detected!");
                return;
            }
            console.log("[SYNC] Connection test passed, current status:", this.plugin.status);

            if (this.plugin.status !== Status.NONE) {
                show && this.plugin.show(`Operation not possible, currently working on '${this.plugin.status}'`);
                return;
            }
            if (!this.plugin.fileTrees) {
                show && this.plugin.show("Checking files before operation...");
                const response = await this.check(show);
                console.log("SYNC CHECK FAIL CORRECT");
                if (!response) {
                    return;
                }
            }

            this.plugin.setStatus(Status.SYNC);

            // Calculate total operations needed
            const operationsToCount = [];

            if (controller.remote) {
                if (controller.remote.added) operationsToCount.push(this.plugin.fileTrees.remoteFiles.added);
                if (controller.remote.modified) operationsToCount.push(this.plugin.fileTrees.remoteFiles.modified);
                if (controller.remote.deleted) operationsToCount.push(this.plugin.fileTrees.remoteFiles.deleted);
                if (controller.remote.except) operationsToCount.push(this.plugin.fileTrees.remoteFiles.except);
            }

            if (controller.local) {
                if (controller.local.added) operationsToCount.push(this.plugin.fileTrees.localFiles.added);
                if (controller.local.modified) operationsToCount.push(this.plugin.fileTrees.localFiles.modified);
                if (controller.local.deleted) operationsToCount.push(this.plugin.fileTrees.localFiles.deleted);
                if (controller.local.except) operationsToCount.push(this.plugin.fileTrees.localFiles.except);
            }

            const total = this.plugin.calcTotal(...operationsToCount.filter(Boolean));

            if (total === 0) {
                if (Object.keys(this.plugin.fileTrees.localFiles.except).length > 0) {
                    show && this.plugin.show("You have file sync exceptions. Clear them in SmartSync Control Panel.", 5000);
                } else {
                    show && this.plugin.show("No files to sync");
                }
                this.plugin.setStatus(Status.NONE);
                return;
            }
            this.plugin.statusBar2.setText(" 0/" + this.plugin.loadingTotal);

            show && this.plugin.show("Synchronising...");

            const operations: Promise<void>[] = [];

            // Handle Remote operations
            if (controller.remote) {
                if (controller.remote.added === 1) {
                    operations.push(this.plugin.operations.downloadFiles(this.plugin.fileTrees.remoteFiles.added));
                } else if (controller.remote.added === -1) {
                    operations.push(this.plugin.operations.deleteFilesRemote(this.plugin.fileTrees.remoteFiles.added));
                }

                if (controller.remote.deleted === 1) {
                    operations.push(this.plugin.operations.deleteFilesLocal(this.plugin.fileTrees.remoteFiles.deleted));
                } else if (controller.remote.deleted === -1) {
                    operations.push(this.plugin.operations.uploadFiles(this.plugin.fileTrees.remoteFiles.deleted));
                }

                if (controller.remote.modified === 1) {
                    operations.push(this.plugin.operations.downloadFiles(this.plugin.fileTrees.remoteFiles.modified));
                } else if (controller.remote.modified === -1) {
                    operations.push(this.plugin.operations.uploadFiles(this.plugin.fileTrees.remoteFiles.modified));
                }

                if (controller.remote.except === 1) {
                    operations.push(this.plugin.operations.downloadFiles(this.plugin.fileTrees.remoteFiles.except));
                } else if (controller.remote.except === -1) {
                    operations.push(this.plugin.operations.uploadFiles(this.plugin.fileTrees.remoteFiles.except));
                }
            }

            // Handle Local operations
            if (controller.local) {
                if (controller.local.added === 1) {
                    operations.push(this.plugin.operations.uploadFiles(this.plugin.fileTrees.localFiles.added));
                } else if (controller.local.added === -1) {
                    operations.push(this.plugin.operations.deleteFilesLocal(this.plugin.fileTrees.localFiles.added));
                }

                if (controller.local.deleted === 1) {
                    operations.push(this.plugin.operations.deleteFilesRemote(this.plugin.fileTrees.localFiles.deleted));
                } else if (controller.local.deleted === -1) {
                    operations.push(this.plugin.operations.downloadFiles(this.plugin.fileTrees.localFiles.deleted));
                }

                if (controller.local.modified === 1) {
                    operations.push(this.plugin.operations.uploadFiles(this.plugin.fileTrees.localFiles.modified));
                } else if (controller.local.modified === -1) {
                    operations.push(this.plugin.operations.downloadFiles(this.plugin.fileTrees.localFiles.modified));
                }

                if (controller.local.except === 1) {
                    operations.push(this.plugin.operations.uploadFiles(this.plugin.fileTrees.localFiles.except));
                } else if (controller.local.except === -1) {
                    operations.push(this.plugin.operations.downloadFiles(this.plugin.fileTrees.localFiles.except));
                }
            }

            // Execute all operations concurrently
            await Promise.all(operations);
            this.plugin.setStatus(Status.NONE);

            show && this.plugin.show("Sync completed - checking again");
            await this.plugin.saveState();

            await this.check(true);

            this.plugin.tempExcludedFiles = {};

            show && this.plugin.show("Done");
            this.plugin.setStatus(Status.NONE);
        } catch (error) {
            console.error("SYNC", error);
            show && this.plugin.show("SYNC Error: " + error);
            this.plugin.setError(true);
            this.plugin.setStatus(Status.ERROR);
        } finally {
            this.plugin.finished();
        }
    }

    async duplicateLocal() {
        this.plugin.show("Duplicating local Vault ...");
        await this.sync({
            local: {
                added: 1,
                deleted: 1,
                modified: 1,
                except: 1,
            },
            remote: {
                added: -1,
                deleted: -1,
                modified: -1,
            },
        });
    }

    async duplicateRemote() {
        this.plugin.show("Duplicating Remote Vault ...");
        await this.plugin.operations.sync({
            local: {
                added: -1,
                deleted: -1,
                modified: -1,
            },
            remote: {
                added: 1,
                deleted: 1,
                modified: 1,
                except: 1,
            },
        });
    }

    async push() {
        this.sync({
            local: {
                added: 1,
                deleted: 1,
                modified: 1,
                except: 1,
            },
            remote: {},
        });
    }

    async pull() {
        this.sync({
            local: {},
            remote: {
                added: 1,
                deleted: 1,
                modified: 1,
                except: 1,
            },
        });
    }

    async fullSync() {
        this.sync({
            local: {
                added: 1,
                deleted: 1,
                modified: 1,
            },
            remote: {
                added: 1,
                deleted: 1,
                modified: 1,
            },
        });
    }

    async fullSyncSilent() {
        this.sync(
            {
                local: {
                    added: 1,
                    deleted: 1,
                    modified: 1,
                },
                remote: {
                    added: 1,
                    deleted: 1,
                    modified: 1,
                },
            },
            false
        );
    }

    dangerCheck() {
        const max = 15;
        let counter = 0;
        delete this.plugin.fileTrees.localFiles.deleted[".obsidian/"];

        Object.keys(this.plugin.fileTrees.localFiles.deleted).forEach((v) => {
            if (v.startsWith(".obsidian")) {
                counter++;
            }
        });
        if (counter > max) {
            this.plugin.errorWrite();
            this.plugin.show(`WARNING! DANGEROUS AMOUNT OF SYSTEM FILES HAVE PENDING DELETION (${counter})`, 5000);
            this.plugin.setStatus(Status.ERROR);
            return false;
        }

        return true;
    }
}
