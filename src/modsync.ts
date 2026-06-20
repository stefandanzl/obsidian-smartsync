import { TFile, TAbstractFile, normalizePath } from "obsidian";
import SmartSyncPlugin from "./main";
import { FileEntry, Status } from "./const";
import { sha256 } from "./util";

/**
 * Simple per-file modification sync with classic debounce
 * Handles create, modify, delete, rename, and raw events
 * Uses hash comparison to prevent unnecessary syncs
 */

export type FileChangeType = "create" | "modify" | "delete" | "rename" | "raw";
export type FileQueueType = "create" | "modify" | "delete";

export class ModSyncListener {
	// Classic debounce timers - one per file
	private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

	// Retry timers for offline situations (legacy - will be phased out)
	private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

	// Queue system for managing sync operations
	activeConcurrent: number = 0;
	private queue: Array<{
		path: string;
		type: FileQueueType;
		fileEntry?: FileEntry;
	}> = [];
	private maxConcurrent: number = 5;
	private maxAttempts: number = 3;
	private isProcessing: boolean = false;
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

	// Tracks whether vault listeners are currently attached (idempotent register/unregister)
	private listenersRegistered = false;

	constructor(private plugin: SmartSyncPlugin) {
		this.setupEventHandlers();
	}

	/**
	 * Enqueue a file for processing
	 * Stores hash to avoid recalculation
	 */
	async enqueue(path: string, type: FileQueueType, fileEntry?: FileEntry): Promise<void> {
		// Check for duplicates and update if exists
		const existing = this.queue.find((item) => item.path === path);
		if (existing) {
			// Update with fresh data instead of skipping
			if (fileEntry) {
				existing.fileEntry = fileEntry;
			}
			existing.type = type;
			this.retryAttempts.set(path, 0); // Reset attempts on fresh modification
			this.plugin.log(`ModSync: Updated queued ${path} with fresh hash`);
			return;
		}

		// Add new item with hash
		this.queue.push({
			path,
			type,
			fileEntry,
		});

		this.plugin.log(`ModSync: Enqueued ${path} (queue size: ${this.queue.length})`);
		await this.processQueue();
	}

	/**
	 * Process items from the queue
	 * Uses isProcessing flag to prevent concurrent queue processing
	 */
	public async processQueue(): Promise<void> {
		if (this.isProcessing) return;
		if (!this.canProcessQueue()) return;

		this.isProcessing = true;

		try {
			// Process up to maxConcurrent items
			while (this.queue.length > 0 && this.activeConcurrent < this.maxConcurrent && this.canProcessQueue()) {
				const item = this.queue.shift();
				if (!item) break;

				// Don't await - fire off concurrently
				this.processItem(item).catch((err) => this.plugin.log(`ModSync: Item processing error: ${err}`));
			}
		} finally {
			this.isProcessing = false;
		}
	}

	/**
	 * Check if we can process queue
	 */
	private canProcessQueue(): boolean {
		return [Status.NONE, Status.AUTO].includes(this.plugin.status);
	}

	/**
	 * Process individual item from queue
	 */
	private async processItem(item: { path: string; type: FileQueueType; fileEntry?: FileEntry }): Promise<void> {
		// Check retry limit using Map
		const attempts = this.retryAttempts.get(item.path) || 0;
		if (attempts >= this.maxAttempts) {
			this.plugin.log(`ModSync: Giving up on ${item.path} after ${attempts} attempts`);
			this.plugin.show(`Failed to sync ${item.path} after ${attempts} attempts`);
			return;
		}

		try {
			this.increase();
			if (item.type === "create" || item.type === "modify") {
				await this.syncFile(item.path, item.fileEntry!, item.type);
			} else if (item.type === "delete") {
				await this.handleDeletion(item.path, item.type);
			}
		} finally {
			this.decrease();
			// Try to process more items
			await this.processQueue();
		}
	}

	/**
	 * Increase active operation counter and set AUTO status
	 */
	private increase(): void {
		this.activeConcurrent++;
		if (this.activeConcurrent === 1) {
			this.plugin.log("Should be AUTO");
			this.plugin.setStatus(Status.AUTO);
		}
	}

	/**
	 * Decrease active operation counter and reset status when all complete
	 */
	private decrease(): void {
		this.activeConcurrent = Math.max(0, this.activeConcurrent - 1);

		if (this.activeConcurrent === 0 && this.plugin.status === Status.AUTO) {
			this.plugin.setStatus(Status.NONE);
		}
	}

	/**
	 * Clear all queued items
	 */
	public clearQueue(): void {
		const cleared = this.queue.length;
		this.queue = [];
		this.plugin.log(`ModSync: Cleared ${cleared} queued items`);
	}

	/**
	 * Emergency reset - clear queue and reset counters
	 */
	public zero(): void {
		this.activeConcurrent = 0;
		this.queue = [];
		this.isProcessing = false;
		if (this.plugin.status === Status.AUTO) {
			this.plugin.setStatus(Status.NONE);
		}
		this.plugin.log("ModSync: Emergency reset - queue cleared");
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
				const isExcluded = this.plugin.checksum.isExcluded(normalizedPath);
				if (isExcluded) {
					return;
				}
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
				const isExcluded = this.plugin.checksum.isExcluded(normalizedPath);
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
		// Idempotent: never stack duplicate handlers
		if (this.listenersRegistered) {
			return;
		}
		this.listenersRegistered = true;

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
		// Idempotent: nothing to do if not currently registered
		if (!this.listenersRegistered) {
			return;
		}
		this.listenersRegistered = false;

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
					// await this.handleDeletion(path, type);
					await this.enqueue(path, "delete");
					return;
				}
				throw new Error("stat is available but should not");
			}

			// Handle raw deletions (determine from file existence)
			if (type === "raw" && !stat) {
				// Event type delete has to be enabled for "raw" events triggering deletion
				if (this.plugin.settings.modSyncConfig.eventTypes.delete) {
					// await this.handleDeletion(path, "raw");
					await this.enqueue(path, "delete");
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
				// this.plugin.log(`[${type}]: Skipping folder ${path}`);
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
		const hash = await sha256(content);

		// Hash comparison logic based on event type
		let typeCast: FileQueueType | undefined;

		switch (type) {
			case "modify":
			case "raw":
				// Sync only if hash differs from prevData
				if (prevEntry && prevEntry.hash !== hash) {
					typeCast = "modify";
				} else if (!prevEntry) {
					// New file, treat as create
					typeCast = "create";
				}
				break;

			case "create":
				// Sync only if file doesn't exist in prevData
				if (!prevEntry) {
					typeCast = "create";
				}
				break;

			case "delete":
				// This shouldn't reach here since deletion is handled separately
				break;
		}

		if (!typeCast) {
			this.plugin.log(`[${type}]: Skipping ${path} - no actual change detected`);
			return;
		}

		// Enqueue for sync (hash already calculated and validated)
		await this.enqueue(path, typeCast, { hash, size: stat.size, mtime });
	}

	/**
	 * Handle file deletion
	 */
	private async handleDeletion(path: string, type: FileQueueType): Promise<void> {
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
				this.scheduleRetry(path, type);
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
			this.scheduleRetry(path, type);
		}
	}

	/**
	 * Sync file to server
	 */
	private async syncFile(path: string, fileEntry: FileEntry, type: FileQueueType): Promise<void> {
		// Check offline status before sync
		if (this.plugin.status === Status.OFFLINE) {
			const online = await this.plugin.operations.test(false, false);
			if (online) {
				this.plugin.setStatus(Status.NONE);
			} else {
				this.scheduleRetry(path, type, fileEntry);
				return;
			}
		}

		if (this.config.dryRun) {
			this.plugin.log(
				`[DRY RUN] [${type}]: Would upload: ${path} (${fileEntry.size} bytes, hash: ${fileEntry.hash.substring(0, 8)}...)`
			);
			return;
		}

		try {
			this.plugin.log(`[${type}]: Uploading ${path}`);
			const content = await this.plugin.app.vault.adapter.readBinary(path);
			const response = await this.plugin.smartSyncClient.uploadFile(path, content);

			if (response) {
				// Update prevData only after successful sync
				this.plugin.prevData.files[path] = fileEntry;
				await this.plugin.savePrevData();
				this.plugin.log(`[${type}]: Successfully synced ${path}`);
			} else {
				// Sync failed - re-queue with incremented attempts
				this.plugin.setStatus(Status.OFFLINE);
				this.scheduleRetry(path, type, fileEntry);
			}
		} catch (error) {
			// Error - re-queue with incremented attempts
			console.error(`[${type}]: Error syncing ${path}:`, error);
			this.plugin.show("ModSync Error");
			this.plugin.setStatus(Status.ERROR);
			this.scheduleRetry(path, type, fileEntry);
		}
	}

	/**
	 * Schedule retry with exponential backoff
	 */
	private async scheduleRetry(path: string, type: FileQueueType, fileEntry?: FileEntry) {
		// Re-queue with incremented attempts
		const attempts = (this.retryAttempts.get(path) || 0) + 1;
		this.retryAttempts.set(path, attempts);
		await this.enqueue(path, type, fileEntry);
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
