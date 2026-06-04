import { SmartSyncClient, ChecksumsResponse } from "./smartSync";
import SmartSyncPlugin from "./main";
import { msToSeconds, sha256 } from "./util";
import { TAbstractFile, TFile, normalizePath } from "obsidian";
import { FileList, Hash } from "./const";
import ignoreFactory from "ignore";

interface FileProcessor {
	(file: string): Promise<void>;
}

interface ConcurrencyProcessor {
	<T>(items: T[], worker: (item: T) => Promise<void>, limit: number): Promise<void>;
}

interface HashStats {
	totalFiles: number;
	sources: {
		prevData: number;
		calculated: number;
		cache: number;
	};
	excluded: number;
}

export class Checksum {
	allLocalFiles: FileList = {};
	hashDurations: Record<string, number> = {};
	hashStats: HashStats;

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
			const addObsidian = this.plugin.mobile
				? this.plugin.settings.skipHiddenMobile
				: this.plugin.settings.skipHiddenDesktop;

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
			this.plugin.hashStats.totalFiles++;

			try {
				if (exclude && this.isExcluded(file)) {
					this.plugin.hashStats.excluded++;
					return;
				}

				// Get file stats
				const stat = await this.plugin.app.vault.adapter.stat(file);
				if (!stat || stat.type !== "file") return;

				const currentSize = stat.size;
				const currentMtime = Math.floor(stat.mtime / 1000);

				// Check prevData for optimization
				const prevEntry = this.plugin.prevData?.files[file];
				let hash: string;

				if (
					this.plugin.hashFlags.prevData &&
					prevEntry &&
					prevEntry.size === currentSize &&
					prevEntry.mtime === currentMtime
				) {
					// Size and mtime match - reuse previous hash
					hash = prevEntry.hash;
					this.plugin.hashStats.sources.prevData++;
				} else {
					const data = await this.plugin.app.vault.adapter.readBinary(file);
					hash = await sha256(data);
					this.plugin.hashStats.sources.calculated++;
				}

				// Store FileEntry with metadata
				this.allLocalFiles[file] = {
					hash,
					size: currentSize,
					mtime: currentMtime,
				};
			} catch (error) {
				console.error(`Error processing file ${file}:`, error);
			}
		};

		// Process files
		await processConcurrently(files, processFile, concurrency);

		// Recursively process subdirectories
		for (const folder of folders) {
			if (exclude && this.isExcluded(folder + "/")) {
				continue;
			}
			await this.getHiddenLocalFiles(normalizePath(folder), exclude, concurrency);
		}
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
		this.plugin.hashStats = {
			totalFiles: 0,
			sources: {
				prevData: 0,
				calculated: 0,
				cache: 0,
			},
			excluded: 0,
		};

		await Promise.all(
			localTFiles.map(async (element) => {
				try {
					if (element instanceof TFile) {
						const filePath = element.path;
						this.plugin.hashStats.totalFiles++;
						if (exclude && this.isExcluded(filePath)) {
							this.plugin.hashStats.excluded++;
							return;
						}

						// Get current file stats (convert ms to seconds)
						const currentSize = element.stat.size;
						const currentMtime = Math.floor(element.stat.mtime / 1000);

						// Check prevData for optimization
						const prevEntry = this.plugin.prevData?.files[filePath];
						let hash: string | undefined;

						if (
							this.plugin.hashFlags.prevData &&
							prevEntry &&
							prevEntry.size === currentSize &&
							prevEntry.mtime === currentMtime
						) {
							// Size and mtime match - reuse previous hash
							hash = prevEntry.hash;
							this.plugin.hashStats.sources.prevData++;
						} else {
							// Calculate new hash
							const filePath = element.path;
							const start = Date.now();

							// Try fileCache first (for .md files)
							// Only use metadatacache if mtime is older than 10s
							if (
								this.plugin.hashFlags.cache &&
								fileCache &&
								filePath.endsWith(".md") &&
								currentMtime + 15 <= msToSeconds(start)
							) {
								try {
									const cacheHash = fileCache[filePath].hash;
									if (cacheHash) {
										this.plugin.hashStats.sources.cache++;
										hash = cacheHash;
									}
								} catch (error) {
									console.error("fileCache error", element, error);
								}
							}

							// Calculate hash if not yet assigned
							if (!hash) {
								try {
									const content = await this.plugin.app.vault.readBinary(element);
									hash = await sha256(content);
									this.plugin.hashStats.sources.calculated++;
									this.hashDurations[filePath] = Date.now() - start;
								} catch (error) {
									console.error(`Hash calculation failed for ${filePath}:`, error);
									return; // Skip file rather than storing undefined
								}
							}
						}

						// Store FileEntry with metadata
						this.allLocalFiles[filePath] = {
							hash,
							size: currentSize,
							mtime: currentMtime,
						};
					}
				} catch (error) {
					console.error("localTFiles Errororr", element, error);
				}
			})
		);
		const configDir = this.plugin.app.vault.configDir;
		await this.getHiddenLocalFiles(configDir, exclude);

		// Store statistics in plugin for access from operations
		// if (!this.plugin.hashStats) {
		//     this.plugin.hashStats = {
		//         local: {
		//             totalFiles: 0,
		//             sources: {
		//                 prevData: 0,
		//                 calculated: 0,
		//                 cache: 0
		//             },
		//             excluded: 0
		//         },
		//     };
		// }
		// this.plugin.hashStats.local = hashStats;

		this.plugin.log(`LOCAL HASH STATISTICS: ${JSON.stringify(this.plugin.hashStats, null, 2)}`);
		this.plugin.log(this.hashDurations);

		if (exclude) {
			this.plugin.local = this.allLocalFiles;
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

			this.plugin.log(`Remote checksums received: ${response.files_total} files`);

			// Convert checksums object to FileList format
			// Server now sends FileEntry objects directly
			const remoteHashTree: FileList = {};

			for (const [filePath, fileEntry] of Object.entries(response.checksums)) {
				// Store FileEntry directly from server
				remoteHashTree[filePath] = fileEntry;
			}

			this.plugin.remote = remoteHashTree;

			return { files: remoteHashTree, end: Date.now() };
		} catch (error) {
			console.error("Error:", error);
			throw error;
		}
	};
}
