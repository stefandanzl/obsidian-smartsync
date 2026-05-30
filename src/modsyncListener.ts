import { TFile, TAbstractFile, normalizePath } from "obsidian";
import SmartSyncPlugin from "./main";
import { Status } from "./const";

/**
 * Simple per-file modification sync with classic debounce
 * Handles create, modify, delete, rename, and raw events
 * Uses hash comparison to prevent unnecessary syncs
 */

export type FileChangeType = "create" | "modify" | "delete" | "rename" | "raw";

export class ModSyncListener {
	// Classic debounce timers - one per file
	private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

	// Retry timers for offline situations
	private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private retryAttempts: Map<string, number> = new Map();

	config = {
		enabled: false,
		debounceDelay: 2000, // 2 seconds
		dryRun: true, // Safe default for testing
		eventTypes: {
			create: true,
			modify: true,
			delete: true,
			rename: true,
			raw: true,
		},
	};

	private eventHandlers: {
		create: ((file: TAbstractFile) => void) | null;
		modify: ((file: TAbstractFile) => void) | null;
		delete: ((file: TAbstractFile) => void) | null;
		rename: ((file: TAbstractFile, oldPath: string) => void) | null;
		raw: ((path: string) => void) | null;
	} = {
		create: null,
		modify: null,
		delete: null,
		rename: null,
		raw: null,
	};

	constructor(private plugin: SmartSyncPlugin) {
		this.setupEventHandlers();
	}

	/**
	 * Initialize all event handlers for comprehensive file tracking
	 */
	private setupEventHandlers(): void {
		// File creation handler
		this.eventHandlers.create = (file: TAbstractFile) => {
			if (this.config?.eventTypes?.create && file instanceof TFile) {
				const normalizedPath = normalizePath(file.path);
				this.plugin.log(`[CREATE] ${normalizedPath}`);
				this.debounceFileChange(normalizedPath, "create");
			}
		};

		// File modification handler
		this.eventHandlers.modify = (file: TAbstractFile) => {
			if (this.config?.eventTypes?.modify && file instanceof TFile) {
				const normalizedPath = normalizePath(file.path);
				this.plugin.log(`[MODIFY] ${normalizedPath}`);
				this.debounceFileChange(normalizedPath, "modify");
			}
		};

		// File deletion handler
		this.eventHandlers.delete = (file: TAbstractFile) => {
			if (this.config?.eventTypes?.delete && file instanceof TFile) {
				const normalizedPath = normalizePath(file.path);
				this.plugin.log(`[DELETE] ${normalizedPath}`);
				this.debounceFileChange(normalizedPath, "delete");
			}
		};

		// File rename handler
		this.eventHandlers.rename = (file: TAbstractFile, oldPath: string) => {
			if (this.config?.eventTypes?.rename && file instanceof TFile) {
				const normalizedPath = normalizePath(file.path);
				const normalizedOldPath = normalizePath(oldPath);
				this.plugin.log(`[RENAME] ${normalizedOldPath} -> ${normalizedPath}`);
				// Handle as delete of old path + create of new path
				this.debounceFileChange(normalizedOldPath, "delete");
				this.debounceFileChange(normalizedPath, "create");
			}
		};

		// Raw event handler for ALL file changes including .obsidian/
		this.eventHandlers.raw = (path: string) => {
			if (this.config?.eventTypes?.raw) {
				const normalizedPath = normalizePath(path);
				const configDir = this.plugin.app.vault.configDir;

				// Filter for .obsidian/ files only - other files are handled by regular events
				if (!normalizedPath.startsWith(configDir + "/")) {
					return; // Not a .obsidian file, will be handled by regular events
				}

				// Check if file is excluded
				const isExcluded = this.plugin.checksum.isExcluded(path);
				if (isExcluded) {
					// this.plugin.log(`[RAW]: File ${path} is excluded, skipping`);
					return;
				}

				this.plugin.log(`[RAW] ${normalizedPath}`);
				this.debounceFileChange(normalizedPath, "raw");
			}
		};
	}

	/**
	 * Register all event listeners with Obsidian vault
	 */
	registerEventListeners(): void {
		const vault = this.plugin.app.vault;

		if (this.eventHandlers.create) {
			vault.on("create", this.eventHandlers.create);
		}
		if (this.eventHandlers.modify) {
			vault.on("modify", this.eventHandlers.modify);
		}
		if (this.eventHandlers.delete) {
			vault.on("delete", this.eventHandlers.delete);
		}
		if (this.eventHandlers.rename) {
			vault.on("rename", this.eventHandlers.rename);
		}
		if (this.eventHandlers.raw) {
			vault.on("raw" as any, this.eventHandlers.raw as any);
		}

		this.plugin.log("ModSync: All event listeners registered");
	}

	/**
	 * Unregister all event listeners from Obsidian vault
	 */
	unregisterEventListeners(): void {
		const vault = this.plugin.app.vault;

		if (this.eventHandlers.create) {
			vault.off("create", this.eventHandlers.create);
		}
		if (this.eventHandlers.modify) {
			vault.off("modify", this.eventHandlers.modify);
		}
		if (this.eventHandlers.delete) {
			vault.off("delete", this.eventHandlers.delete);
		}
		if (this.eventHandlers.rename) {
			vault.off("rename", this.eventHandlers.rename);
		}
		if (this.eventHandlers.raw) {
			vault.off("raw" as any, this.eventHandlers.raw as any);
		}

		this.plugin.log("ModSync: All event listeners unregistered");
	}

	/**
	 * Classic debounce: reset timer on each trigger, execute when changes stop
	 */
	private debounceFileChange(path: string, type: FileChangeType, delay = this.config.debounceDelay): void {
		// Reset existing timer
		const existingTimer = this.debounceTimers.get(path);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		// Set new timer
		const timer = setTimeout(async () => {
			this.debounceTimers.delete(path);
			await this.processFileChange(path, type);
		}, delay);

		this.debounceTimers.set(path, timer);
	}

	/**
	 * Process file change after debounce completes
	 */
	private async processFileChange(path: string, type: FileChangeType): Promise<void> {
		// Skip internal files
		if (path === this.plugin.prevPath) {
			// this.plugin.log("ModSync: Skipping internal prevdata file");
			return;
		}

		// Check if file is excluded
		const isExcluded = this.plugin.checksum.isExcluded(path);
		if (isExcluded) {
			this.plugin.log(`[${type}]: File ${path} is excluded, skipping`);
			return;
		}

		// Check if sync is in progress
		if (this.plugin.isSyncing) {
			this.plugin.log(`[${type}]: Sync in progress, skipping ${path}`);
			return;
		}

		// // DRY RUN - don't perform any operations
		// if (this.config.dryRun) {
		// 	this.plugin.log(`[DRY RUN] ${type}: ${path}`);
		// 	return; // TRUE dry run - no operations at all
		// }

		try {
			// Get file stats (single call for type check + metadata)
			const stat = await this.plugin.app.vault.adapter.stat(path).catch(() => null);

			// Handle explicit delete events
			if (type === "delete") {
				if (!stat) {
					await this.handleDeletion(path, type);
					return;
				}
				throw new Error("stat is available but should not");
			}

			// Handle raw deletions (determine from file existence)
			if (type === "raw" && !stat) {
				// Event type delete has to be enabled for "raw" events triggering deletion
				if (this.plugin.settings.modSyncConfig.eventTypes.delete) {
					await this.handleDeletion(path, "raw");
				}
				return;
			}

			// For other events, file might be in transient state
			if (!stat) {
				this.plugin.log(`[${type}] File ${path} not available (transient state), skipping`);
				return;
			}

			// Skip folders
			if (stat.type === "folder") {
				this.plugin.log(`[${type}]: Skipping folder ${path}`);
				return;
			}

			// Process file with hash comparison
			await this.handleFileWithHash(path, type, stat);
		} catch (error) {
			console.error(`[${type}]: Error processing ${path}:`, error);
		}
	}

	/**
	 * Handle file with hash comparison logic
	 */
	private async handleFileWithHash(
		path: string,
		type: FileChangeType,
		stat: { type: string; size: number; mtime: number }
	): Promise<void> {
		const prevEntry = this.plugin.prevData.files[path];
		const mtime = Math.floor(stat.mtime / 1000);

		// Calculate hash
		const content = await this.plugin.app.vault.adapter.readBinary(path);
		const { sha256 } = await import("./util");
		const hash = await sha256(content);

		// Hash comparison logic based on event type
		let shouldSync = false;

		switch (type) {
			case "modify":
			case "raw":
				// Sync only if hash differs from prevData
				if (prevEntry && prevEntry.hash !== hash) {
					shouldSync = true;
				} else if (!prevEntry) {
					// New file, treat as create
					shouldSync = true;
				}
				break;

			case "create":
				// Sync only if file doesn't exist in prevData
				if (!prevEntry) {
					shouldSync = true;
				}
				break;

			case "delete":
				// This shouldn't reach here since deletion is handled separately
				break;
		}

		if (!shouldSync) {
			this.plugin.log(`[${type}]: Skipping ${path} - no actual change detected`);
			return;
		}

		// Perform sync
		await this.syncFile(path, hash, stat.size, mtime, type);
	}

	/**
	 * Handle file deletion
	 */
	private async handleDeletion(path: string, type: FileChangeType): Promise<void> {
		const prevEntry = this.plugin.prevData.files[path];

		// Only sync if file existed in prevData
		if (!prevEntry) {
			this.plugin.log(`[${type}]: Skipping deletion ${path} - was not tracked`);
			return;
		}

		// Check offline status before deletion
		if (this.plugin.status === Status.OFFLINE) {
			const online = await this.plugin.operations.test(false, false);
			if (online) {
				this.plugin.setStatus(Status.NONE);
				this.retryAttempts.clear();
			} else {
				this.scheduleRetry(path);
				return;
			}
		}

		if (this.config.dryRun) {
			this.plugin.log(`[DRY RUN] [${type}]: Would delete: ${path}`);
			return;
		}

		const response = await this.plugin.smartSyncClient.deleteFile(path);
		if (response === 200) {
			delete this.plugin.prevData.files[path];
			await this.plugin.savePrevData();
			this.plugin.log(`[${type}]: Deleted ${path}`);
		} else {
			this.scheduleRetry(path);
		}
	}

	/**
	 * Sync file to server
	 */
	private async syncFile(
		path: string,
		hash: string,
		size: number,
		mtime: number,
		type: FileChangeType
	): Promise<void> {
		// Check offline status before sync
		if (this.plugin.status === Status.OFFLINE) {
			const online = await this.plugin.operations.test(false, false);
			if (online) {
				this.plugin.setStatus(Status.NONE);
				this.retryAttempts.clear();
			} else {
				this.scheduleRetry(path);
				return;
			}
		}

		if (this.config.dryRun) {
			this.plugin.log(
				`[DRY RUN] [${type}]: Would upload: ${path} (${size} bytes, hash: ${hash.substring(0, 8)}...)`
			);
			return;
		}

		try {
			this.plugin.log(`[${type}]: Uploading ${path}`);
			const content = await this.plugin.app.vault.adapter.readBinary(path);
			const response = await this.plugin.smartSyncClient.uploadFile(path, content);

			if (response) {
				// Update prevData only after successful sync
				this.plugin.prevData.files[path] = { hash, size, mtime };
				await this.plugin.savePrevData();
				this.plugin.log(`[${type}]: Successfully synced ${path}`);
			} else {
				// Sync failed - schedule retry
				this.plugin.setStatus(Status.OFFLINE);
				this.scheduleRetry(path);
			}
		} catch (error) {
			console.error(`[${type}]: Error syncing ${path}:`, error);
			this.plugin.show("ModSync Error");
			this.plugin.setStatus(Status.ERROR);
		}
	}

	/**
	 * Schedule retry with exponential backoff
	 */
	private scheduleRetry(path: string): void {
		const attempt = (this.retryAttempts.get(path) || 0) + 1;
		this.retryAttempts.set(path, attempt);

		// Exponential backoff: 10s * 1.5^attempt, capped at 60s
		const delay = Math.min(10000 * Math.pow(1.5, attempt), 60000);
		this.plugin.log(`ModSync: Scheduling retry for ${path} in ${delay / 1000}s (attempt ${attempt})`);

		// Clear existing retry timer
		const existingTimer = this.retryTimers.get(path);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		// Set new retry timer
		const timer = setTimeout(async () => {
			this.retryTimers.delete(path);
			// Use "raw" for retries - it will determine the correct action based on file existence
			await this.processFileChange(path, "raw");
		}, delay);

		this.retryTimers.set(path, timer);
	}

	/**
	 * Force immediate processing (cancel all debounce timers)
	 */
	async forceProcessQueue(): Promise<void> {
		this.plugin.log("ModSync: Force processing all queued changes");

		// Clear all debounce timers and process immediately
		const timers = Array.from(this.debounceTimers.entries());
		for (const [path, timer] of timers) {
			clearTimeout(timer);
			this.debounceTimers.delete(path);
			// Note: We'd need to track the original type, but for now we'll skip this
			// since the timer callback will still fire with the correct type
		}
	}

	/**
	 * Get current status
	 */
	getStatus(): {
		queuedFiles: number;
		retryingFiles: number;
	} {
		return {
			queuedFiles: this.debounceTimers.size,
			retryingFiles: this.retryTimers.size,
		};
	}

	/**
	 * Clear all timers
	 */
	clearAll(): void {
		// Clear debounce timers
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();

		// Clear retry timers
		for (const timer of this.retryTimers.values()) {
			clearTimeout(timer);
		}
		this.retryTimers.clear();
		this.retryAttempts.clear();

		this.plugin.log("ModSync: All timers cleared");
	}

	/**
	 * Update configuration
	 */
	updateConfig(newConfig: Partial<typeof this.config>): void {
		this.config = { ...this.config, ...newConfig };
		this.plugin.log("ModSync: Configuration updated", this.config);
	}
}
