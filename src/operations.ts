import Cloudr from "./main";
import { WebDAVClient, WEBDAV_HEADERS } from "./webdav";
import { join, dirname, calcDuration, logNotice } from "./util";
import { normalizePath } from "obsidian";
import { Controller, FileList, Status, STATUS_ITEMS } from "./const";

export class Operations {
    constructor(public plugin: Cloudr) {
        this.plugin = plugin;
    }

    /**
     * Configure and create WebDAV client
     */
    configWebdav(url: string, username: string, password: string): WebDAVClient {
        if (!(url && username && password)) {
            throw new Error("Missing WebDAV configuration parameters");
        }

        return new WebDAVClient(url, {
            username,
            password,
            headers: WEBDAV_HEADERS,
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

            const remotePath = join(this.plugin.baseWebdav, filePath);

            // Verify remote file exists
            const remoteStats = await this.plugin.webdavClient.exists(remotePath);
            if (!remoteStats) {
                console.error(`Remote file not found: ${remotePath}`);
                return false;
            }

            // Ensure local directory exists
            await this.ensureLocalDirectory(dirname(filePath));

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
                return await this.plugin.webdavClient.get(remotePath);
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
     * Upload files to WebDAV server
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
     * Upload a single file to WebDAV
     */
    private async uploadFile(localFilePath: string): Promise<void> {
        try {
            if (localFilePath.endsWith("/")) {
                await this.ensureRemoteDirectory(localFilePath);
                return;
            }

            const fileContent = await this.plugin.app.vault.adapter.readBinary(normalizePath(localFilePath));
            const remoteFilePath = join(this.plugin.baseWebdav, localFilePath);

            await this.plugin.webdavClient.put(remoteFilePath, fileContent);
            this.plugin.processed();
            this.plugin.log(`Uploaded: ${localFilePath} to ${remoteFilePath}`);
        } catch (error) {
            console.error(`Error uploading ${localFilePath}:`, error);
        }
    }

    /**
     * Delete files from WebDAV server
     */
    async deleteFilesWebdav(fileTree: FileList): Promise<void> {
        if (!fileTree || Object.keys(fileTree).length === 0) {
            this.plugin.log("No files to delete on WebDAV");
            return;
        }

        const failedPaths: string[] = [];

        const deleteFile = async (path: string): Promise<void> => {
            const cleanPath = path.endsWith("/") ? path.replace(/\/$/, "") : path;
            const fullPath = join(this.plugin.baseWebdav, cleanPath);

            try {
                const response = await this.plugin.webdavClient.delete(fullPath);
                // console.log(response, typeof response)
                //
                if (response !== 204 && response !== 404) {
                    console.log(fullPath, " Errorstatus: ", response);
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
                if (await this.plugin.webdavClient.exists(path)) {
                    const response = await this.plugin.webdavClient.delete(path);
                    if (response) {
                        this.plugin.processed();
                        console.log(`Retry successful: ${path}`);
                    }
                } else {
                    console.log(`File already deleted or doesn't exist: ${path}`);
                    this.plugin.processed();
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

    private async ensureRemoteDirectory(path: string): Promise<void> {
        try {
            console.log(`Creating remote directory: ${path}`);
            const response = await this.plugin.webdavClient.createDirectory(join(this.plugin.baseWebdav, path.replace(/\/$/, "")));
            if (!response) {
                throw new Error(`Failed to create remote directory ${path}`);
            }
            this.plugin.processed();
        } catch (error) {
            console.error(`Error creating remote directory ${path}:`, error);
        }
    }

    private async deleteLocalFile(file: string): Promise<void> {
        try {
            if (this.plugin.mobile) {
                await this.plugin.app.vault.adapter.trashLocal(file);
            } else {
                await this.plugin.app.vault.adapter.trashSystem(file);
            }
            // console.log(`Deleted locally: ${file}`);
            this.plugin.processed();
        } catch (error) {
            console.error(`Error deleting local file ${file}:`, error);
        }
    }

    async test(show = true, force = false) {
        // if (!force && (this.status !== Status.NONE && this.status !== Status.OFFLINE )) {
        //     show && this.show(`Testing not possible, currently ${this.status}`);
        //     return;
        // }

        // show && this.setStatus(Status.TEST);
        // show && this.show(`${Status.TEST} Testing ...`);

        // if (this.plugin.status === Status.ERROR){
        //     this.plugin.show("Clear your ERROR first! ")
        //     return
        // }

        try {
            const existBool = await this.plugin.webdavClient.exists(this.plugin.settings.webdavPath);
            this.plugin.log("EXISTS: ", existBool);

            if (existBool) {
                show && this.plugin.show("Connection successful");
                show && this.plugin.setStatus(Status.NONE);

                if (this.plugin.prevData.error) {
                    this.plugin.show("Clear your ERROR state manually!");
                    this.plugin.setStatus(Status.ERROR);
                }
                return true;
            }
            show && this.plugin.show("Connection failed");
            this.plugin.setStatus(Status.OFFLINE);

            // this.plugin.setError(!existBool);  // THIS WAS THE ISSUE

            return false;
        } catch (error) {
            show && this.plugin.show(`WebDAV connection test failed. Error: ${error}`);
            console.error("Failed miserably", error);
            this.plugin.setStatus(Status.ERROR);
            this.plugin.setError(true);
            return false;
        }
    }

    /**
     * This creates a list of files with predefined actions to take.
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
            webdavScanTime: 0,
            localScanTime: 0,
            compareTime: 0,
            totalTime: 0,
            fileCounts: {
                webdav: 0,
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
            response = await this.test(false, true);
            stats.testTime = Date.now() - testStart;

            if (!response) {
                // throw new Error("Testing failed, can't continue Check action!");
                show &&
                    logNotice(
                        `Testing failed, can't continue Check action!\nStatus: ${STATUS_ITEMS[this.plugin.status].label} ${this.plugin.status}`
                    );
                return false;
            }

            this.plugin.checkTime = Date.now();

            // Generate file hash trees with timing
            const webdavStart = Date.now();
            const webdavPromise = this.plugin.checksum.generateWebdavHashTree(
                this.plugin.webdavClient,
                this.plugin.baseWebdav,
                this.plugin.settings.exclusions
            );

            const localStart = Date.now();
            const localPromise = this.plugin.checksum.generateLocalHashTree(exclude);
            stats.localScanTime = Date.now() - localStart;

            const [webdavFiles, localFiles] = await Promise.all([webdavPromise, localPromise]);
            stats.webdavScanTime = Date.now() - webdavStart;
            stats.fileCounts.webdav = Object.keys(webdavFiles).length;
            stats.fileCounts.local = Object.keys(localFiles).length;

            // Update hash statistics from checksum
            if (this.plugin.hashStats && this.plugin.hashStats.local) {
                stats.hashStats = this.plugin.hashStats.local;
            }

            // Compare file trees
            const compareStart = Date.now();
            this.plugin.allFiles.local = localFiles;
            this.plugin.allFiles.webdav = webdavFiles;
            this.plugin.fileTrees = await this.plugin.compare.compareFileTrees(webdavFiles, localFiles);
            stats.compareTime = Date.now() - compareStart;

            const ok = this.dangerCheck();

            this.plugin.fullFileTrees = structuredClone(this.plugin.fileTrees);
            // if (this.plugin.modal) {
            //     this.plugin.modal.fileTreeDiv.setText(JSON.stringify(this.plugin.fileTrees, null, 2));
            // }

            // Calculate total time
            stats.totalTime = Date.now() - stats.startTime;

            // Log performance statistics
            console.log(`=== CHECK PERFORMANCE STATISTICS ===`);
            console.log(`Total time: ${stats.totalTime}ms`);
            console.log(`Connection test: ${stats.testTime}ms`);
            console.log(`WebDAV scan: ${stats.webdavScanTime}ms (${stats.fileCounts.webdav} files)`);
            console.log(`Local scan: ${stats.localScanTime}ms (${stats.fileCounts.local} files)`);
            console.log(`Comparison: ${stats.compareTime}ms`);
            console.log(`Files per second (WebDAV): ${Math.round((stats.fileCounts.webdav / stats.webdavScanTime) * 1000)}`);
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

            // show && (fileTreesEmpty(this.plugin.fileTrees) ? null : this.plugin.show("Finished checking files"));
            show && ok && this.plugin.show(`Finished checking files after ${calcDuration(this.plugin.checkTime)} s`);
            if (show && ok) {
                if (this.plugin.calcTotal(this.plugin.fileTrees.localFiles.except) > 0) {
                    this.plugin.show(
                        "Found file sync exceptions! Open Webdav Control Panel and either PUSH/PULL or resolve each case separately!",
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
     * Main Sync function for this plugin. This manages all the file exchanging
     * @param controller
     * @param show
     * @returns
     */
    async sync(controller: Controller, show = true) {
        if (this.plugin.prevData.error) {
            show && this.plugin.show("Error detected - please clear in control panel or force action by retriggering action");
            return;
        }

        try {
            if (!(await this.test(false))) {
                show && this.plugin.show("Connection Problem detected!");
                return;
            }

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

            if (controller.webdav) {
                if (controller.webdav.added) operationsToCount.push(this.plugin.fileTrees.webdavFiles.added);
                if (controller.webdav.modified) operationsToCount.push(this.plugin.fileTrees.webdavFiles.modified);
                if (controller.webdav.deleted) operationsToCount.push(this.plugin.fileTrees.webdavFiles.deleted);
                if (controller.webdav.except) operationsToCount.push(this.plugin.fileTrees.webdavFiles.except);
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
                    show && this.plugin.show("You have file sync exceptions. Clear them in Webdav Control Panel.", 5000);
                } else {
                    show && this.plugin.show("No files to sync");
                }
                this.plugin.setStatus(Status.NONE);
                return;
            }
            this.plugin.statusBar2.setText(" 0/" + this.plugin.loadingTotal);

            show && this.plugin.show("Synchronizing...");

            const operations: Promise<void>[] = [];

            // Handle WebDAV operations
            if (controller.webdav) {
                if (controller.webdav.added === 1) {
                    operations.push(this.plugin.operations.downloadFiles(this.plugin.fileTrees.webdavFiles.added));
                } else if (controller.webdav.added === -1) {
                    operations.push(this.plugin.operations.deleteFilesWebdav(this.plugin.fileTrees.webdavFiles.added));
                }

                if (controller.webdav.deleted === 1) {
                    operations.push(this.plugin.operations.deleteFilesLocal(this.plugin.fileTrees.webdavFiles.deleted));
                } else if (controller.webdav.deleted === -1) {
                    operations.push(this.plugin.operations.uploadFiles(this.plugin.fileTrees.webdavFiles.deleted));
                }

                if (controller.webdav.modified === 1) {
                    operations.push(this.plugin.operations.downloadFiles(this.plugin.fileTrees.webdavFiles.modified));
                } else if (controller.webdav.modified === -1) {
                    operations.push(this.plugin.operations.uploadFiles(this.plugin.fileTrees.webdavFiles.modified));
                }

                if (controller.webdav.except === 1) {
                    operations.push(this.plugin.operations.downloadFiles(this.plugin.fileTrees.webdavFiles.except));
                } else if (controller.webdav.except === -1) {
                    operations.push(this.plugin.operations.uploadFiles(this.plugin.fileTrees.webdavFiles.except));
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
                    operations.push(this.plugin.operations.deleteFilesWebdav(this.plugin.fileTrees.localFiles.deleted));
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

            // this.plugin.prevData.except = this.plugin.compare.checkExistKey(this.plugin.prevData.except, this.plugin.fileTrees.localFiles.except)
            this.plugin.tempExcludedFiles = {};

            show && this.plugin.show("Done");
            this.plugin.setStatus(Status.NONE);
        } catch (error) {
            console.error("SYNC", error);
            show && this.plugin.show("SYNC Error: " + error);
            this.plugin.setError(true);
            this.plugin.setStatus(Status.ERROR);
        } finally {
            // @ts-ignore
            // if (this.plugin.status !== Status.ERROR) {
            //     this.plugin.setStatus(Status.NONE); //Status.OK); war eigentlich so
            // }
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
            webdav: {
                added: -1,
                deleted: -1,
                modified: -1,
                // except: -1,
            },
        });
    }
    async duplicateWebdav() {
        this.plugin.show("Duplicating Webdav Vault ...");
        await this.plugin.operations.sync({
            local: {
                added: -1,
                deleted: -1,
                modified: -1,
                // except: -1,
            },
            webdav: {
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
            webdav: {},
        });
    }

    async pull() {
        this.sync({
            local: {},
            webdav: {
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
            webdav: {
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
                webdav: {
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
