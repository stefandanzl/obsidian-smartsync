import SmartSyncPlugin from "./main";
import { SmartSyncClient } from "./smartSync";
import { join, dirname, calcDuration, logNotice, msToSeconds } from "./util";
import { normalizePath } from "obsidian";
import { FileEntry, FileList, PostSync, Status, STATUS_ITEMS } from "./const";

export class Operations {
	newPrevDataFiles: {
		modifiedAdded: FileList;
		deleted: FileList;
		failed: FileList;
	};
	constructor(public plugin: SmartSyncPlugin) {
		this.plugin = plugin;
		this.newPrevDataFiles = {
			modifiedAdded: {},
			deleted: {},
			failed: {},
		};
	}

	/**
	 * Configure and create SmartSync client
	 */
	configSmartSync(url: string, port: number, authToken?: string): SmartSyncClient {
		if (!url) {
			throw new Error("Missing SmartSync URL");
		}

		return new SmartSyncClient(
			{
				serverUrl: url,
				port: port || 443,
				authToken,
			},
			this.plugin
		);
	}

	async downloadFiles(filesMap: FileList): Promise<void> {
		if (!filesMap || Object.keys(filesMap).length === 0) {
			this.plugin.log("No files to download");
			return;
		}

		// First attempt for all files
		const results = await Promise.all(
			Object.entries(filesMap).map(async ([filePath, fileEntry]) => ({
				filePath,
				success: await this.downloadFile(filePath, fileEntry),
			}))
		);

		// Filter out failed downloads and retry them
		const failedDownloads = results.filter((r) => !r.success);
		if (failedDownloads.length > 0) {
			console.log(`Retrying ${failedDownloads.length} failed downloads...`);
			await Promise.all(failedDownloads.map(({ filePath }) => this.downloadFile(filePath, filesMap[filePath])));
		}
	}

	private async downloadFile(filePath: string, fileEntry: FileEntry): Promise<boolean> {
		try {
			// Verify remote file exists by checking if server is online
			const status = await this.plugin.smartSyncClient.getStatus();
			if (!status.online) {
				console.error(`Remote server is offline, cannot download ${filePath}`);
				return false;
			}

			// Download with retry
			const fileData = await this.downloadWithRetry(filePath);
			if (fileData.status !== 200) {
				throw new Error(`Failed to download ${filePath}: ${fileData.status}`);
			}
			await this.ensureLocalDirectory(dirname(filePath));
			await this.plugin.app.vault.adapter.writeBinary(filePath, fileData.data);
			this.plugin.processed();
			this.newPrevDataFiles.modifiedAdded[filePath] = fileEntry;
			return true;
		} catch (error) {
			this.plugin.log(`Error downloading ${filePath}:`, error);
			this.newPrevDataFiles.failed[filePath] = fileEntry;
			return false;
		}
	}

	// Helper methods
	private async downloadWithRetry(
		filePath: string,
		maxRetries = 2
	): Promise<{
		data: ArrayBuffer;
		status: number;
	}> {
		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				return await this.plugin.smartSyncClient.getFile(filePath);
			} catch (error) {
				if (attempt === maxRetries) throw error;
				console.log(`Retry ${attempt} for ${filePath}`);
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
		throw new Error(`Failed to download after ${maxRetries} attempts`);
	}

	private async ensureLocalDirectory(path: string): Promise<void> {
		const parts = normalizePath(path).split("/").filter(Boolean);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!(await this.plugin.app.vault.adapter.exists(current))) {
				await this.plugin.app.vault.createFolder(current);
			}
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

		// Now we use the FileEntry data instead of discarding it!
		for (const [localFilePath, fileEntry] of Object.entries(fileChecksums)) {
			await this.uploadFile(localFilePath, fileEntry);
		}

		this.plugin.log("Upload completed");
	}

	/**
	 * Upload a single file to SmartSyncServer
	 */
	private async uploadFile(filePath: string, fileEntry: FileEntry): Promise<void> {
		try {
			const fileContent = await this.plugin.app.vault.adapter.readBinary(normalizePath(filePath));

			if (await this.plugin.smartSyncClient.uploadFile(filePath, fileContent)) {
				this.plugin.processed();
				this.newPrevDataFiles.modifiedAdded[filePath] = fileEntry;
				this.plugin.log(`Uploaded: ${filePath}`);
			}
		} catch (error) {
			console.error(`Error uploading ${filePath}:`, error);
			this.newPrevDataFiles.failed[filePath] = fileEntry;
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

		// First attempt for all files
		for (const path of Object.keys(fileTree)) {
			const result = await this.deleteRemoteFile(path);
			if (result.failed) {
				failedPaths.push(result.fullPath);
			}
		}

		// Retry failed deletions
		if (failedPaths.length > 0) {
			console.log(`Retrying ${failedPaths.length} failed deletions...`);
			await Promise.all(failedPaths.map((path) => this.retryRemoteDelete(path)));
		}
	}

	/**
	 * Delete a single file from remote server
	 */
	private async deleteRemoteFile(path: string): Promise<{ failed: boolean; fullPath: string }> {
		const fullPath = join(this.plugin.baseRemotePath, path);

		try {
			const response = await this.plugin.smartSyncClient.deleteFile(fullPath);
			if (response !== 200 && response !== 204 && response !== 404) {
				console.log(fullPath, " Error status: ", response);
				return { failed: true, fullPath };
			}
			this.plugin.processed();
			// Use object notation instead of .push()
			this.newPrevDataFiles.deleted[path] = { hash: "", size: 0, mtime: 0 };
			return { failed: false, fullPath };
		} catch (error) {
			console.error(`Delete failed for ${path}:`, error);
			return { failed: true, fullPath };
		}
	}

	/**
	 * Retry a failed remote file deletion
	 */
	private async retryRemoteDelete(path: string): Promise<void> {
		try {
			const status = await this.plugin.smartSyncClient.getStatus();
			if (!status.online) {
				console.log(`Server offline for ${path}, skipping delete retry`);
				this.plugin.processed();
				// Use object notation instead of .push()
				this.newPrevDataFiles.deleted[path] = { hash: "", size: 0, mtime: 0 };
				return;
			}

			const response = await this.plugin.smartSyncClient.deleteFile(path);
			if (response === 200 || response === 204 || response === 404) {
				this.plugin.processed();
				// Use object notation instead of .push()
				this.newPrevDataFiles.deleted[path] = { hash: "", size: 0, mtime: 0 };
				this.plugin.log(`Retry successful: ${path}`);
			} else {
				console.log(`Delete still failed for ${path}, status: ${response}`);
			}
		} catch (error) {
			console.error(`Final delete attempt failed for ${path}:`, error);
			this.newPrevDataFiles.failed[path] = { hash: "", size: 0, mtime: 0 };
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

		for (const [filePath, fileEntry] of Object.entries(fileTree)) {
			await this.deleteLocalFile(filePath, fileEntry);
		}
	}

	private async deleteLocalFile(filePath: string, fileEntry: FileEntry): Promise<void> {
		try {
			if (this.plugin.mobile) {
				await this.plugin.app.vault.adapter.trashLocal(filePath);
			} else {
				await this.plugin.app.vault.adapter.trashSystem(filePath);
			}
			this.plugin.processed();
			// Store FileEntry instead of just path
			this.newPrevDataFiles.deleted[filePath] = fileEntry;
		} catch (error) {
			console.error(`Error deleting local file ${filePath}:`, error);
			this.newPrevDataFiles.failed[filePath] = fileEntry;
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
		} catch (error) {
			console.error(`Error creating remote directory ${path}:`, error);
		}
	}

	async test(show = true, verbose = false) {
		if (this.plugin.status === Status.TEST) {
			return;
		}
		try {
			show && this.plugin.setStatus(Status.TEST);
			verbose && this.plugin.show(`${Status.TEST} Testing ...`);

			const status = await this.plugin.smartSyncClient.establishConnection(show);

			// Check if online field exists and is true
			if (status) {
				verbose && this.plugin.show("Connection successful");
				// ALWAYS set status to NONE after successful test, regardless of show parameter
				show && this.plugin.setStatus(Status.NONE);

				if (this.plugin.prevData.error) {
					this.plugin.show("Clear your ERROR state manually!");
					this.plugin.setStatus(Status.ERROR);
				}
				return true;
			}
			console.log("[TEST] Connection failed");
			show && this.plugin.show("Connection failed: Server is offline");
			this.plugin.setStatus(Status.OFFLINE);

			return false;
		} catch (error) {
			console.error("[TEST] Connection test failed with error:", error);
			show && this.plugin.show(`SmartSync connection test failed. Error: ${error}`);
			console.error("Failed miserably", error);
			this.plugin.setStatus(Status.ERROR);
			this.plugin.setError();
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
				local: 0,
			},
			hashStats: {
				totalFiles: 0,
				sources: {
					prevData: 0,
					calculated: 0,
					cache: 0,
				},
				excluded: 0,
			},
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
			const remotePromise = this.plugin.checksum.generateRemoteHashTree(this.plugin.smartSyncClient);

			const localStart = Date.now();
			const localPromise = this.plugin.checksum.generateLocalHashTree(exclude);

			const [remote, local] = await Promise.all([remotePromise, localPromise]);

			stats.remoteScanTime = remote.end - remoteStart;
			stats.localScanTime = local.end - localStart;
			stats.fileCounts.remote = Object.keys(remote.files).length;
			stats.fileCounts.local = Object.keys(local.files).length;

			// Update hash statistics from checksum
			if (this.plugin.hashStats) {
				stats.hashStats = this.plugin.hashStats;
			}

			// Compare file trees
			const compareStart = Date.now();
			this.plugin.allFiles.local = local.files;
			this.plugin.allFiles.remote = remote.files;
			this.plugin.fileTrees = await this.plugin.compare.compareFileTrees(remote.files, local.files);
			stats.compareTime = Date.now() - compareStart;

			// Reconcile prevData with verified state: record files that are in sync on
			// both sides (keeps prevData complete) and drop entries deleted on both sides.
			// Pure bookkeeping — no file operations. Only writes prevData when something changed.
			this.reconcilePrevData(local.files, remote.files);

			const ok = this.dangerCheck();

			// Calculate total time
			stats.totalTime = Date.now() - stats.startTime;

			// Log performance statistics
			this.plugin.log(`=== CHECK PERFORMANCE STATISTICS ===`);
			this.plugin.log(`Total time: ${stats.totalTime}ms`);
			this.plugin.log(`Connection test: ${stats.testTime}ms`);
			this.plugin.log(`Remote scan: ${stats.remoteScanTime}ms (${stats.fileCounts.remote} files)`);
			this.plugin.log(`Local scan: ${stats.localScanTime}ms (${stats.fileCounts.local} files)`);
			this.plugin.log(`Comparison: ${stats.compareTime}ms`);
			this.plugin.log(
				`Files per second (Remote): ${Math.round((stats.fileCounts.remote / stats.remoteScanTime) * 1000)}`
			);
			this.plugin.log(
				`Files per second (Local): ${Math.round((stats.fileCounts.local / stats.localScanTime) * 1000)}`
			);

			// Log hash statistics
			if (stats.hashStats) {
				const hashPercentage =
					stats.hashStats.totalFiles > 0
						? Math.round(
								((stats.hashStats.sources.prevData + stats.hashStats.sources.cache) /
									stats.hashStats.totalFiles) *
									100
							)
						: 0;
				this.plugin.log(`\n=== HASH OPTIMIZATION STATISTICS ===`);
				this.plugin.log(`Total files processed: ${stats.hashStats.totalFiles}`);
				this.plugin.log(`Hashes from prevData: ${stats.hashStats.sources.prevData}`);
				this.plugin.log(`Hashes from cache: ${stats.hashStats.sources.cache} (${hashPercentage}% optimized)`);
				this.plugin.log(`Hashes calculated: ${stats.hashStats.sources.calculated}`);
				this.plugin.log(`Files excluded: ${stats.hashStats.excluded}`);
				this.plugin.log(`Optimization rate: ${hashPercentage}% - Higher is better!`);
				this.plugin.log(`===============================`);
			}

			show && ok && this.plugin.show(`Finished checking files after ${calcDuration(this.plugin.checkTime)} s`);
			if (show && ok) {
				if (this.plugin.calcTotal(this.plugin.fileTrees.local.except) > 0) {
					this.plugin.show(
						"Found file sync exceptions! Open SmartSync Control Panel and select correct versions manually!",
						5000
					);
				}
			}
			this.plugin.lastScrollPosition = 0;
			// this.plugin.tempExcludedFiles = {};
			this.plugin.modal?.renderFileTrees();
			ok && this.plugin.setStatus(Status.NONE);
			return true;
		} catch (error) {
			console.error("CHECK ERROR: ", error);
			show && this.plugin.show(`CHECK ERROR: ${error}`);
			this.plugin.setError();
			response ? this.plugin.setStatus(Status.ERROR) : this.plugin.setStatus(Status.OFFLINE);
			throw error;
		}
	}

	/**
	 * Reconcile prevData with the verified in-sync state without performing a sync.
	 * - Record files that are matched on both sides (same hash) but missing from prevData,
	 *   so prevData stays complete and future deletions/moves classify correctly.
	 * - Drop prevData entries that no longer exist on either side (confirmed both-sides deletion).
	 * Pending diffs (present on exactly one side) are left untouched.
	 * Writes prevData only when something actually changed.
	 */
	private reconcilePrevData(localFiles: FileList, remoteFiles: FileList) {
		let changed = false;

		for (const [path, entry] of Object.entries(this.plugin.compare.prevDataGap)) {
			const existing = this.plugin.prevData.files[path];
			// Add missing entries, or update existing ones whose hash is stale
			// (e.g. a file modified identically on both sides since last sync).
			if (!existing || existing.hash !== entry.hash) {
				this.plugin.prevData.files[path] = entry;
				changed = true;
			}
			// A resolved conflict (now in sync) no longer belongs in prevData.except
			if (path in this.plugin.prevData.except) {
				delete this.plugin.prevData.except[path];
				changed = true;
			}
		}

		for (const path of Object.keys(this.plugin.prevData.files)) {
			if (!(path in localFiles) && !(path in remoteFiles)) {
				delete this.plugin.prevData.files[path];
				changed = true;
			}
		}

		if (changed) {
			this.plugin.prevData.timestamps = {
				...this.plugin.prevData.timestamps,
				prevdataUpdate: msToSeconds(Date.now()),
			};
			this.plugin.savePrevData();
			this.plugin.log(`> prevDataGap: ${Object.keys(this.plugin.compare.prevDataGap).length} added to prevData`);
		}
	}

	async saveAndCheck() {
		// Test connection
		if (!(await this.plugin.operations.test(false))) return false;

		// Scan both in parallel
		const [remote, local] = await Promise.all([
			this.plugin.checksum.generateRemoteHashTree(this.plugin.smartSyncClient),
			this.plugin.checksum.generateLocalHashTree(true),
		]);

		// Compare
		// this.plugin.fileTrees = await this.plugin.compare.compareFileTrees(remote.files, local.files);

		// Save ONLY selected, non-excluded files to prevData

		this.plugin.allFiles.local = local.files;
		this.plugin.allFiles.remote = remote.files;
		this.plugin.fileTrees = await this.plugin.compare.compareFileTrees(remote.files, local.files);

		const saveableFiles: any = { ...local.files };

		for (const path of Object.keys(this.plugin.fileSelection)) {
			if (this.plugin.fileSelection[path].selected === false) {
				if (path in this.plugin.prevData.files) {
					saveableFiles[path] = this.plugin.prevData.files[path]; // Keep old state
				} else {
					delete saveableFiles[path]; // Remove if wasn't in prevData
				}
			}
		}

		const newExcept = this.plugin.compare.checkExistKey(this.plugin.fileTrees.local.except, saveableFiles);

		const now = msToSeconds(Date.now());

		this.plugin.prevData = {
			error: this.plugin.prevData.error,
			files: saveableFiles,
			except: newExcept,
			timestamps: {
				prevdataUpdate: now,
				lastFullSync: now,
				lastFileSync: now,
			},
		};

		this.plugin.lastScrollPosition = 0;
		this.plugin.modal?.renderFileTrees();

		this.plugin.app.vault.adapter.write(this.plugin.prevPath, JSON.stringify(this.plugin.prevData, null, 2));
		this.plugin.show("Saved state and checked for differences");
		return true;
	}

	async prevSuccess() {
		for (const [filePath, fileEntry] of Object.entries(this.newPrevDataFiles.modifiedAdded)) {
			try {
				if (!fileEntry) {
					console.error(`fileEntry is undefined for path: ${filePath}`);
					continue;
				}

				const stat = await this.plugin.app.vault.adapter.stat(filePath);
				if (!stat || !fileEntry.hash) {
					console.error("No current local file stat or pre-sync hash available");
					continue;
				}
				if (stat.size !== fileEntry.size) {
					console.error("Post Sync stat and pre-sync size are different for file ", filePath);
					continue;
				}
				this.plugin.prevData.files[filePath] = {
					hash: fileEntry.hash,
					size: stat.size,
					mtime: msToSeconds(stat.mtime),
				};
			} catch (error) {
				console.error(`Error processing file ${filePath} in prevSuccess:`, error);
				this.plugin.show(`Error processing file ${filePath} in prevSuccess:`, error);
			}
		}
		for (const filePath in this.newPrevDataFiles.deleted) {
			delete this.plugin.prevData.files[filePath];
		}

		const allSyncedFiles = {
			...this.newPrevDataFiles.modifiedAdded,
			...this.newPrevDataFiles.deleted,
		};

		for (const filePath of Object.keys(allSyncedFiles)) {
			if (this.plugin.fileTrees) {
				delete this.plugin.fileTrees.local.added[filePath];
				delete this.plugin.fileTrees.local.modified[filePath];
				delete this.plugin.fileTrees.local.deleted[filePath];
				delete this.plugin.fileTrees.local.except[filePath];
				delete this.plugin.fileTrees.remote.added[filePath];
				delete this.plugin.fileTrees.remote.modified[filePath];
				delete this.plugin.fileTrees.remote.deleted[filePath];
				delete this.plugin.fileTrees.remote.except[filePath];
			}
		}

		// Clean up fileSelection for successfully synced files
		for (const filePath of Object.keys(allSyncedFiles)) {
			if (this.plugin.fileSelection[filePath]) {
				delete this.plugin.fileSelection[filePath];
			}
		}

		if (Object.keys(this.newPrevDataFiles.failed).length > 0) {
			this.plugin.show(`Warning: ${Object.keys(this.newPrevDataFiles.failed).length} files failed to sync`, 5000);
			this.plugin.log(this.newPrevDataFiles.failed);
		}

		this.plugin.modal?.renderFileTrees();

		const now = msToSeconds(Date.now());

		this.plugin.prevData.timestamps = {
			...this.plugin.prevData.timestamps,
			prevdataUpdate: now,
			lastFileSync: now,
			lastFullSync: now,
		};
	}

	/*
	 * Perform all actual file actions the user has chosen
	 */
	private async executeSyncOperations(): Promise<void> {
		const fileTrees = this.plugin.fileTrees;

		const filesToDownload: FileList = {};
		const filesToUpload: FileList = {};
		const filesToDeleteRemote: FileList = {};
		const filesToDeleteLocal: FileList = {};

		for (const [filePath, selection] of Object.entries(this.plugin.fileSelection)) {
			if (!selection.selected) continue;

			if (!selection.location) continue;

			if (selection.location === "local") {
				if (selection.diffType === "added") {
					if (selection.inverse) {
						filesToDeleteLocal[filePath] = fileTrees.local.added[filePath];
					} else {
						filesToUpload[filePath] = fileTrees.local.added[filePath];
					}
				} else if (selection.diffType === "modified") {
					if (selection.inverse) {
						filesToDownload[filePath] = this.plugin.allFiles.remote[filePath];
					} else {
						filesToUpload[filePath] = fileTrees.local.modified[filePath];
					}
				} else if (selection.diffType === "deleted") {
					if (selection.inverse) {
						filesToDownload[filePath] = this.plugin.allFiles.remote[filePath];
					} else {
						filesToDeleteRemote[filePath] = fileTrees.local.deleted[filePath];
					}
				} else if (selection.diffType === "except") {
					if (selection.inverse) {
						this.plugin.log("Except file should not have inverse set to true: " + filePath);
					}
					filesToUpload[filePath] = this.plugin.allFiles.local[filePath];
				}
			} else if (selection.location === "remote") {
				if (selection.diffType === "added") {
					if (selection.inverse) {
						filesToDeleteRemote[filePath] = fileTrees.remote.added[filePath];
					} else {
						filesToDownload[filePath] = fileTrees.remote.added[filePath];
					}
				} else if (selection.diffType === "modified") {
					if (selection.inverse) {
						filesToUpload[filePath] = this.plugin.allFiles.local[filePath];
					} else {
						filesToDownload[filePath] = fileTrees.remote.modified[filePath];
					}
				} else if (selection.diffType === "deleted") {
					if (selection.inverse) {
						filesToUpload[filePath] = this.plugin.allFiles.local[filePath];
					} else {
						filesToDeleteLocal[filePath] = fileTrees.remote.deleted[filePath];
					}
				} else if (selection.diffType === "except") {
					if (selection.inverse) {
						this.plugin.log("Except file should not have inverse set to true: " + filePath);
					}
					filesToDownload[filePath] = this.plugin.allFiles.remote[filePath];
				}
			}
		}
		this.plugin.calcTotal(filesToDownload, filesToUpload, filesToDeleteRemote, filesToDeleteLocal);

		await Promise.all([
			this.downloadFiles(filesToDownload),
			this.uploadFiles(filesToUpload),
			this.deleteFilesRemote(filesToDeleteRemote),
			this.deleteFilesLocal(filesToDeleteLocal),
		]);
	}

	/**
	 * Main Sync function for this plugin. This manages all file exchanging
	 * @param controller
	 * @param show
	 * @returns
	 */
	async sync(show = true, postSync: PostSync = "prevSuccess") {
		console.log("[SYNC] Starting sync, show:", show);
		if (this.plugin.prevData.error) {
			console.log("[SYNC] Blocked by error state");
			show &&
				this.plugin.show(
					"Error detected - please clear in control panel or force action by retriggering action"
				);
			return;
		}

		try {
			this.plugin.isSyncing = true;
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

			this.newPrevDataFiles = {
				modifiedAdded: {},
				deleted: {},
				failed: {},
			};

			if (!this.plugin.fileTrees) {
				show && this.plugin.show("Checking files before operation...");
				const response = await this.check(show);
				console.log("SYNC CHECK FAIL CORRECT");
				if (!response) {
					return;
				}
			}

			this.plugin.setStatus(Status.SYNC);

			if (Object.keys(this.plugin.fileSelection).length === 0) {
				if (Object.keys(this.plugin.fileTrees.local.except).length > 0) {
					show &&
						this.plugin.show("You have file sync exceptions. Clear them in SmartSync Control Panel.", 5000);
				} else {
					show && this.plugin.show("No files to sync");
				}
				this.plugin.setStatus(Status.NONE);
				return;
			}
			this.plugin.statusBar2.setText(" 0/" + this.plugin.loadingTotal);

			show && this.plugin.show("Synchronising...");

			// Execute sync operations based on file selection
			await this.executeSyncOperations();

			this.plugin.setStatus(Status.NONE);

			if (postSync === "check") {
				show && this.plugin.show("Sync completed - checking again");
				await this.plugin.saveState();
				await this.check(true);
			} else if (postSync === "prevSuccess") {
				await this.prevSuccess();

				await this.plugin.savePrevData();
			} else if (postSync === "saveAndCheck") {
				await this.saveAndCheck();
			}
			this.plugin.sessionSynced = true;
			// this.plugin.tempExcludedFiles = {};

			show && this.plugin.show("Done");
			this.plugin.setStatus(Status.NONE);
		} catch (error) {
			console.error("SYNC", error);
			show && this.plugin.show(`SYNC Error: ${error}`);
			this.plugin.setError();
			this.plugin.setStatus(Status.ERROR);
		} finally {
			this.plugin.isSyncing = false;
			this.plugin.finished();
		}
	}

	dangerCheck() {
		const max = 15;
		let counter = 0;

		Object.keys(this.plugin.fileTrees.local.deleted).forEach((v) => {
			if (v.startsWith(".obsidian")) {
				counter++;
			}
		});
		if (counter > max) {
			this.plugin.setError();
			this.plugin.show(`WARNING! DANGEROUS AMOUNT OF SYSTEM FILES HAVE PENDING DELETION (${counter})`, 5000);
			this.plugin.setStatus(Status.ERROR);
			return false;
		}

		return true;
	}
}
