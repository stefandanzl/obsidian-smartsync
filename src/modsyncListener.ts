import { TFile, TAbstractFile, normalizePath } from "obsidian";
import SmartSyncPlugin from "./main";
import { Status, ModSyncConfig } from "./const";

/**
 * Comprehensive file change tracking for ultimate modification sync
 * Handles create, modify, delete, rename operations with intelligent batching
 * PLUS "raw" event listener for .obsidian/ folder changes
 */

export type FileChangeType = "create" | "modify" | "delete" | "rename";

export interface FileChange {
	path: string;
	type: FileChangeType;
	timestamp: number;
	oldPath?: string; // For renames
	hash?: string;
	size?: number;
	mtime?: number;
	syncAttempts: number;
	lastError?: string;
	priority: "high" | "normal" | "low";
	excluded?: boolean;
}

export interface ChangeBatch {
	changes: FileChange[];
	startTime: number;
	endTime: number;
	batchId: string;
}

export class ModSyncListener {
	private changeQueue: Map<string, FileChange> = new Map();
	private processingBatch: boolean = false;
	private batchTimer: ReturnType<typeof setTimeout> | null = null;
	private changeCount: number = 0;
	private changeCountWindow: number[] = []; // Timestamps for rate calculation
	private priorityMode: boolean = false;

	config: ModSyncConfig = {
		enabled: false,
		batchWindow: 5000, // 5 seconds
		debounceDelay: 2000, // 2 seconds
		maxBatchSize: 50,
		maxRetries: 5,
		enablePriorityMode: true,
		conflictDetection: true,
		dryRun: true, // Safe default for testing
		eventTypes: {
			create: true,
			modify: true,
			delete: true,
			rename: true,
			raw: true
		}
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
			if (this.config?.eventTypes?.create) {
				const normalizedPath = normalizePath(file.path);
				this.plugin.log(`[CREATE] ${normalizedPath}`);
				this.handleFileChange(file, "create");
			}
		};

		// File modification handler
		this.eventHandlers.modify = (file: TAbstractFile) => {
			if (this.config?.eventTypes?.modify) {
				const normalizedPath = normalizePath(file.path);
				this.plugin.log(`[MODIFY] ${normalizedPath}`);
				this.handleFileChange(file, "modify");
			}
		};

		// File deletion handler
		this.eventHandlers.delete = (file: TAbstractFile) => {
			if (this.config?.eventTypes?.delete) {
				const normalizedPath = normalizePath(file.path);
				this.plugin.log(`[DELETE] ${normalizedPath}`);
				this.handleFileChange(file, "delete");
			}
		};

		// File rename handler (rename is delete + create)
		this.eventHandlers.rename = (file: TAbstractFile, oldPath: string) => {
			if (this.config?.eventTypes?.rename) {
				const normalizedPath = normalizePath(file.path);
				const normalizedOldPath = normalizePath(oldPath);
				this.plugin.log(`[RENAME] ${normalizedOldPath} -> ${normalizedPath}`);
				// First handle as delete of old path
				this.handleFileChange(file, "delete", oldPath);
				// Then as create of new path
				this.handleFileChange(file, "create");
			}
		};

		// Raw event handler for ALL file changes including .obsidian/
		this.eventHandlers.raw = (path: string) => {
			if (this.config?.eventTypes?.raw) {
				this.handleRawFileChange(path);
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

		// Register raw event listener for ALL changes including .obsidian/
		if (this.eventHandlers.raw) {
			vault.on("raw" as any, this.eventHandlers.raw as any);
		}

		this.plugin.log("ModSync: All event listeners registered (including raw for .obsidian/)");
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

		// Unregister raw event listener
		if (this.eventHandlers.raw) {
			vault.off("raw" as any, this.eventHandlers.raw as any);
		}

		this.plugin.log("ModSync: All event listeners unregistered (including raw)");
	}

	/**
	 * Handle raw file change events (including .obsidian/ files)
	 * The raw event catches ALL file changes, including hidden config files
	 */
	private handleRawFileChange(path: string): void {
		// Normalize path immediately at entry
		const normalizedPath = normalizePath(path);
		const configDir = this.plugin.app.vault.configDir;

        
		// Filter for .obsidian/ files only
		if (!normalizedPath.startsWith(configDir + "/")) {
            return; // Not a .obsidian file, will be handled by regular events
		}
        
        this.plugin.log(`[RAW] ${normalizedPath}`);
        
		// Skip internal files
		if (normalizedPath === this.plugin.prevPath) {
			return;
		}

		// Check if file is excluded
		const isExcluded = this.plugin.checksum.isExcluded(normalizedPath);
		if (isExcluded) {
			return;
		}

		// Check if sync is in progress
		if (this.plugin.isSyncing) {
			this.queueRawChange(normalizedPath);
			return;
		}

		// Determine the type of change based on file existence
		this.processRawChange(normalizedPath);
	}

	/**
	 * Queue a raw file change for later processing
	 */
	private queueRawChange(path: string): void {
		const normalizedPath = normalizePath(path);
		const change: FileChange = {
			path: normalizedPath,
			type: "modify", // Default to modify, will be determined during processing
			timestamp: Date.now(),
			priority: "normal",
			syncAttempts: 0,
		};

		this.changeQueue.set(normalizedPath, change);
		this.plugin.log(`ModSync (raw): Queued ${normalizedPath} for later processing`);
	}

	/**
	 * Process a raw file change by determining the type and handling it
	 */
	private async processRawChange(path: string): Promise<void> {
		const normalizedPath = normalizePath(path);
		try {
			// Check if file exists (determine if it's create/modify or delete)
			const fileExists = await this.plugin.app.vault.adapter.exists(normalizedPath);

			if (!fileExists) {
				// File was deleted
				await this.handleRawDeletion(normalizedPath);
			} else {
				// File was created or modified
				await this.handleRawModification(normalizedPath);
			}
		} catch (error) {
			console.error(`ModSync (raw): Error processing ${normalizedPath}:`, error);
		}
	}

	/**
	 * Handle raw file deletion
	 */
	private async handleRawDeletion(path: string): Promise<void> {
		const normalizedPath = normalizePath(path);
		const change: FileChange = {
			path: normalizedPath,
			type: "delete",
			timestamp: Date.now(),
			priority: "high", // Deletions are high priority
			syncAttempts: 0,
		};

		this.changeQueue.set(normalizedPath, change);
		this.updateChangeRate();
		this.scheduleBatchProcessing();
	}

	/**
	 * Handle raw file modification or creation
	 */
	private async handleRawModification(path: string): Promise<void> {
		const normalizedPath = normalizePath(path);
		// Determine priority based on file type
		const priority = this.determineRawPriority(normalizedPath);

		const change: FileChange = {
			path: normalizedPath,
			type: "modify", // Could be create or modify, will be determined during sync
			timestamp: Date.now(),
			priority,
			syncAttempts: 0,
		};

		// Try to get file stats
		try {
			const stat = await this.plugin.app.vault.adapter.stat(normalizedPath);
			if (stat) {
				change.size = stat.size;
				change.mtime = Math.floor(stat.mtime / 1000);
			}
		} catch (error) {
			this.plugin.log(`ModSync (raw): Could not get stats for ${path}`);
		}

		this.changeQueue.set(path, change);
		this.updateChangeRate();
		this.scheduleBatchProcessing();
	}

	/**
	 * Determine priority for raw file changes
	 */
	private determineRawPriority(path: string): "high" | "normal" | "low" {
		// High priority for workspace files (user actively working)
		if (path.includes("workspace.json") || path.includes("workspace-mobile.json")) {
			return "high";
		}

		// Low priority for cache and temporary files
		if (path.includes("cache/") || path.includes(".tmp") || path.includes("temp")) {
			return "low";
		}

		// Normal priority for other .obsidian files
		return "normal";
	}

	/**
	 * Process any file change event
	 */
	private handleFileChange(file: TAbstractFile, type: FileChangeType, oldPath?: string): void {
		if (!(file instanceof TFile)) return;

		const filePath = oldPath || normalizePath(file.path);

		// Skip internal files
		if (filePath === this.plugin.prevPath) {
			this.plugin.log("ModSync: Skipping internal prevdata file");
			return;
		}

		// Check if file is excluded
		const isExcluded = this.plugin.checksum.isExcluded(filePath);
		if (isExcluded) {
			this.plugin.log(`ModSync: File ${filePath} is excluded, skipping`);
			return;
		}

		// Check if sync is in progress
		if (this.plugin.isSyncing) {
			this.plugin.log(`ModSync: Sync in progress, queuing ${filePath}`);
			this.queueChange(file, type, oldPath);
			return;
		}

		// Determine priority based on file type and recent activity
		const priority = this.determinePriority(file, type);

		// Create or update file change record
		const change: FileChange = {
			path: filePath,
			type,
			timestamp: Date.now(),
			oldPath,
			priority,
			syncAttempts: 0,
			excluded: isExcluded,
		};

		// Add file metadata if available
		if (type !== "delete") {
			change.size = file.stat.size;
			change.mtime = Math.floor(file.stat.mtime / 1000);
		}

		this.changeQueue.set(filePath, change);
		this.updateChangeRate();

		this.plugin.log(`ModSync: Registered ${type} for ${filePath} (priority: ${priority})`);

		// Schedule batch processing
		this.scheduleBatchProcessing();
	}

	/**
	 * Queue a change for later processing when sync completes
	 */
	private queueChange(file: TAbstractFile, type: FileChangeType, oldPath?: string): void {
		// Store in a temporary queue for processing after sync
		const filePath = oldPath || normalizePath(file.path);
		const change: FileChange = {
			path: filePath,
			type,
			timestamp: Date.now(),
			oldPath,
			priority: "normal",
			syncAttempts: 0,
		};

		this.changeQueue.set(filePath, change);
	}

	/**
	 * Determine priority level for a file change
	 */
	private determinePriority(file: TFile, type: FileChangeType): "high" | "normal" | "low" {
		// High priority for active notes and recent files
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile && activeFile.path === file.path) {
			return "high";
		}

		// High priority for recently edited files
		if (this.plugin.lastFileEdited === file.path) {
			return "high";
		}

		// High priority for deletes to prevent data loss
		if (type === "delete") {
			return "high";
		}

		// Low priority for system files
		if (file.path.startsWith(".obsidian/") || file.path.includes(".stash")) {
			return "low";
		}

		return "normal";
	}

	/**
	 * Update the rate of changes and adjust priority mode
	 */
	private updateChangeRate(): void {
		const now = Date.now();
		this.changeCount++;

		// Add current timestamp to window
		this.changeCountWindow.push(now);

		// Remove timestamps older than 1 minute
		this.changeCountWindow = this.changeCountWindow.filter((timestamp) => now - timestamp < 60000);

		// Check if we should enable priority mode
		const changesPerMinute = this.changeCountWindow.length;
		this.priorityMode = changesPerMinute >= 10 && this.config.enablePriorityMode;

		if (this.priorityMode) {
			this.plugin.log(`ModSync: Priority mode enabled (${changesPerMinute} changes/min)`);
		}
	}

	/**
	 * Schedule batch processing with configurable delay
	 */
	private scheduleBatchProcessing(): void {
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
		}

		const delay = this.priorityMode
			? this.config.batchWindow / 2 // Faster batching in priority mode
			: this.config.batchWindow;

		this.batchTimer = setTimeout(() => {
			this.processBatch();
		}, delay);
	}

	/**
	 * Process the current batch of changes
	 */
	private async processBatch(): Promise<void> {
		if (this.processingBatch || this.changeQueue.size === 0) {
			return;
		}

		this.processingBatch = true;
		const batchId = `batch-${Date.now()}`;
		const changes = Array.from(this.changeQueue.values());

		this.plugin.log(`ModSync: Processing batch ${batchId} with ${changes.length} changes`);

		// Sort by priority and timestamp
		const sortedChanges = this.sortChangesByPriority(changes);

		// Process in sub-batches to avoid overwhelming the system
		const subBatches = this.createSubBatches(sortedChanges);

		for (const subBatch of subBatches) {
			await this.processSubBatch(subBatch);

			// Clear processed changes from queue
			subBatch.changes.forEach((change) => {
				if (
					change.syncAttempts === 0 ||
					(change.lastError && change.syncAttempts >= this.config.maxRetries)
				) {
					this.changeQueue.delete(change.path);
				}
			});
		}

		this.processingBatch = false;

		// Check if there are remaining changes to process
		if (this.changeQueue.size > 0) {
			this.plugin.log(`ModSync: ${this.changeQueue.size} changes remaining, scheduling next batch`);
			this.scheduleBatchProcessing();
		}
	}

	/**
	 * Sort changes by priority and timestamp
	 */
	private sortChangesByPriority(changes: FileChange[]): FileChange[] {
		const priorityOrder = { high: 0, normal: 1, low: 2 };

		return changes.sort((a, b) => {
			// First sort by priority
			const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
			if (priorityDiff !== 0) {
				return priorityDiff;
			}

			// Then by timestamp (older changes first)
			return a.timestamp - b.timestamp;
		});
	}

	/**
	 * Create sub-batches for controlled processing
	 */
	private createSubBatches(changes: FileChange[]): ChangeBatch[] {
		const subBatches: ChangeBatch[] = [];
		const maxBatchSize = this.priorityMode
			? this.config.maxBatchSize * 1.5 // Allow larger batches in priority mode
			: this.config.maxBatchSize;

		for (let i = 0; i < changes.length; i += maxBatchSize) {
			const batchChanges = changes.slice(i, i + maxBatchSize);
			subBatches.push({
				changes: batchChanges,
				startTime: Date.now(),
				endTime: 0,
				batchId: `subbatch-${i}-${Date.now()}`,
			});
		}

		return subBatches;
	}

	/**
	 * Process a single sub-batch of changes
	 */
	private async processSubBatch(batch: ChangeBatch): Promise<void> {
		this.plugin.log(`ModSync: Processing sub-batch ${batch.batchId} with ${batch.changes.length} changes`);

		// DRY RUN PROTECTION - Log what would happen without actually syncing
		if (this.config.dryRun) {
			this.plugin.log(`[DRY RUN] Would process ${batch.changes.length} changes:`);
			batch.changes.forEach((change) => {
				this.plugin.log(`[DRY RUN] ${change.type}: ${change.path} (${change.size || 0} bytes)`);
			});
			// Mark all changes as successful in dry run mode
			batch.changes.forEach((change) => {
				this.changeQueue.delete(change.path);
			});
			return;
		}

		// Check online status before processing
		if (this.plugin.status === Status.OFFLINE) {
			const online = await this.plugin.operations.test(false, false);
			if (!online) {
				this.plugin.log("ModSync: Still offline, scheduling retry");
				this.scheduleBatchRetry(batch);
				return;
			}
		}

		// Process each change in the batch
		const results = await Promise.allSettled(batch.changes.map((change) => this.processSingleChange(change)));

		// Handle results
		results.forEach((result, index) => {
			const change = batch.changes[index];
			if (result.status === "rejected") {
				change.syncAttempts++;
				change.lastError = result.reason?.message || "Unknown error";
				this.plugin.log(`ModSync: Failed to sync ${change.path}: ${change.lastError}`);
			} else {
				this.plugin.log(`ModSync: Successfully synced ${change.path}`);
			}
		});

		batch.endTime = Date.now();
	}

	/**
	 * Process a single file change
	 */
	private async processSingleChange(change: FileChange): Promise<void> {
		const configDir = this.plugin.app.vault.configDir;
		const isObsidianFile = change.path.startsWith(configDir + "/");

		if (isObsidianFile) {
			// Handle .obsidian file changes using raw adapter methods
			return this.processObsidianFileChange(change);
		}

		// Handle regular vault file changes
		const file = this.plugin.app.vault.getAbstractFileByPath(change.path);

		if (!file || !(file instanceof TFile)) {
			if (change.type === "delete") {
				// File was deleted, handle deletion
				return this.handleDeletion(change);
			} else {
				throw new Error(`File not found: ${change.path}`);
			}
		}

		// Check for conflicts before syncing
		const hasConflict = await this.checkForConflict(change, file);
		if (hasConflict) {
			this.plugin.log(`ModSync: Conflict detected for ${change.path}, requiring resolution`);
			await this.handleConflict(change, file);
			return;
		}

		// Perform the sync operation based on change type
		switch (change.type) {
			case "create":
			case "modify":
				return this.uploadFile(file, change);
			case "delete":
				return this.handleDeletion(change);
			case "rename":
				// Rename is handled as delete + create
				return this.handleRename(file, change);
		}
	}

	/**
	 * Process .obsidian file changes using adapter methods
	 */
	private async processObsidianFileChange(change: FileChange): Promise<void> {
		this.plugin.log(`ModSync: Processing .obsidian file ${change.path}`);

		// Check for conflicts before syncing
		const hasConflict = await this.checkForObsidianConflict(change);
		if (hasConflict) {
			this.plugin.log(`ModSync: Conflict detected for .obsidian file ${change.path}`);
			// For .obsidian files, we might want to prioritize local changes
			this.plugin.show(`Conflict in ${change.path} - using local version`);
		}

		// Handle deletion
		if (change.type === "delete") {
			return this.handleObsidianDeletion(change);
		}

		// Handle create/modify
		return this.handleObsidianUpload(change);
	}

	/**
	 * Check for conflicts in .obsidian files
	 */
	private async checkForObsidianConflict(change: FileChange): Promise<boolean> {
		try {
			// Get current file content and hash
			const exists = await this.plugin.app.vault.adapter.exists(change.path);
			if (!exists) return false;

			const content = await this.plugin.app.vault.adapter.readBinary(change.path);
			const { sha256 } = await import("./util");
			const currentHash = await sha256(content);

			// Check prevData
			const prevEntry = this.plugin.prevData.files[change.path];
			if (prevEntry && prevEntry.hash !== currentHash) {
				return true; // Local file changed since last sync
			}

			// Check remote for conflicts
			const remoteChecksums = await this.plugin.smartSyncClient.getChecksums();
			const remoteEntry = remoteChecksums.checksums[change.path];

			if (remoteEntry && remoteEntry.hash !== currentHash) {
				return true; // Remote file has different hash
			}
		} catch (error) {
			this.plugin.log(`ModSync: Could not check .obsidian file conflict: ${error}`);
		}

		return false;
	}

	/**
	 * Handle .obsidian file deletion
	 */
	private async handleObsidianDeletion(change: FileChange): Promise<void> {
		if (this.config.dryRun) {
			this.logDryRun("DELETE (.obsidian)", `Would delete .obsidian file: ${change.path}`);
			return;
		}

		const response = await this.plugin.smartSyncClient.deleteFile(change.path);

		if (response !== 200) {
			throw new Error(`Delete failed for ${change.path}`);
		}

		// Remove from prevData
		delete this.plugin.prevData.files[change.path];
		await this.plugin.savePrevData();
	}

	/**
	 * Handle .obsidian file upload
	 */
	private async handleObsidianUpload(change: FileChange): Promise<void> {
		if (this.config.dryRun) {
			this.logDryRun("UPLOAD (.obsidian)", `Would upload .obsidian file: ${change.path}`);
			// Simulate hash calculation for dry run
			const content = await this.plugin.app.vault.adapter.readBinary(change.path);
			const { sha256 } = await import("./util");
			const hash = await sha256(content);
			this.logDryRun("UPLOAD (.obsidian)", `File hash: ${hash.substring(0, 8)}... (${content.byteLength} bytes)`);
			return;
		}

		const content = await this.plugin.app.vault.adapter.readBinary(change.path);
		const response = await this.plugin.smartSyncClient.uploadFile(change.path, content);

		if (!response) {
			throw new Error(`Upload failed for ${change.path}`);
		}

		// Calculate hash and update prevData
		const { sha256 } = await import("./util");
		const hash = await sha256(content);

		this.plugin.prevData.files[change.path] = {
			hash,
			size: change.size || content.byteLength,
			mtime: change.mtime || Math.floor(Date.now() / 1000),
		};

		await this.plugin.savePrevData();
	}

	/**
	 * Check for conflicts before syncing
	 */
	private async checkForConflict(change: FileChange, file: TFile): Promise<boolean> {
		// Get current file hash
		const currentHash = await this.calculateFileHash(file);

		// Check if prevData has a different hash
		const prevEntry = this.plugin.prevData.files[change.path];
		if (prevEntry && prevEntry.hash !== currentHash) {
			// Local file changed since last sync
			return true;
		}

		// Check with remote server for conflicts
		try {
			const remoteChecksums = await this.plugin.smartSyncClient.getChecksums();
			const remoteEntry = remoteChecksums.checksums[change.path];

			if (remoteEntry && remoteEntry.hash !== currentHash) {
				// Remote file has different hash, potential conflict
				return true;
			}
		} catch (error) {
			this.plugin.log(`ModSync: Could not check remote for conflicts: ${error}`);
		}

		return false;
	}

	/**
	 * Handle conflict resolution
	 */
	private async handleConflict(change: FileChange, file: TFile): Promise<void> {
		this.plugin.show(`Conflict detected for ${change.path}. Manual resolution required.`);

		// Store conflict info for UI to handle
		this.plugin.fileExplicitActions.set(change.path, "pull"); // Default to pulling remote version

		// Notify user through modal if available
		if (this.plugin.modal) {
			this.plugin.displayModal();
		}
	}

	/**
	 * Log dry run action
	 */
	private logDryRun(action: string, details: string): void {
		const timestamp = new Date().toISOString();
		console.log(`[DRY RUN ${timestamp}] ${action}: ${details}`);
		this.plugin.log(`[DRY RUN] ${action}: ${details}`);
	}

	/**
	 * Upload file to remote server
	 */
	private async uploadFile(file: TFile, change: FileChange): Promise<void> {
		const filePath = normalizePath(file.path);

		if (this.config.dryRun) {
			this.logDryRun("UPLOAD", `Would upload file: ${filePath} (${file.stat.size} bytes)`);
			// Simulate hash calculation for dry run
			const hash = await this.calculateFileHash(file);
			this.logDryRun("UPLOAD", `File hash: ${hash.substring(0, 8)}...`);
			return;
		}

		const fileContent = await this.plugin.app.vault.adapter.readBinary(filePath);
		const response = await this.plugin.smartSyncClient.uploadFile(filePath, fileContent);

		if (!response) {
			throw new Error(`Upload failed for ${filePath}`);
		}

		// Update prevData with new hash
		const hash = await this.calculateFileHash(file);
		this.plugin.prevData.files[filePath] = {
			hash,
			size: file.stat.size,
			mtime: Math.floor(file.stat.mtime / 1000),
		};

		await this.plugin.savePrevData();
	}

	/**
	 * Handle file deletion
	 */
	private async handleDeletion(change: FileChange): Promise<void> {
		if (this.config.dryRun) {
			this.logDryRun("DELETE", `Would delete remote file: ${change.path}`);
			return;
		}

		const response = await this.plugin.smartSyncClient.deleteFile(change.path);

		if (response !== 200) {
			throw new Error(`Delete failed for ${change.path}`);
		}

		// Remove from prevData
		delete this.plugin.prevData.files[change.path];
		await this.plugin.savePrevData();
	}

	/**
	 * Handle file rename
	 */
	private async handleRename(file: TFile, change: FileChange): Promise<void> {
		if (this.config.dryRun) {
			this.logDryRun("RENAME", `Would rename from ${change.oldPath} to ${file.path}`);
			return;
		}

		// First delete the old path
		if (change.oldPath) {
			await this.handleDeletion({ ...change, path: change.oldPath });
		}

		// Then upload the new path
		await this.uploadFile(file, change);
	}

	/**
	 * Calculate file hash with optimization
	 */
	private async calculateFileHash(file: TFile): Promise<string> {
		const filePath = file.path;

		// Check if we can use cached hash from prevData
		const prevEntry = this.plugin.prevData.files[filePath];
		const currentSize = file.stat.size;
		const currentMtime = Math.floor(file.stat.mtime / 1000);

		if (prevEntry && prevEntry.size === currentSize && prevEntry.mtime === currentMtime) {
			return prevEntry.hash;
		}

		// Calculate new hash
		const { sha256 } = await import("./util");
		const content = await this.plugin.app.vault.readBinary(file);
		return await sha256(content);
	}

	/**
	 * Schedule retry for failed batch
	 */
	private scheduleBatchRetry(batch: ChangeBatch): void {
		const retryCount = batch.changes[0]?.syncAttempts || 0;
		// Simplified retry delay: 10s * 1.5^retryCount, capped at 60s
		const delay = Math.min(10000 * Math.pow(1.5, retryCount), 60000);

		this.plugin.log(`ModSync: Scheduling retry in ${delay / 1000}s (attempt ${retryCount + 1})`);

		setTimeout(() => {
			this.processSubBatch(batch);
		}, delay);
	}

	/**
	 * Force immediate processing of all queued changes
	 */
	async forceProcessQueue(): Promise<void> {
		this.plugin.log("ModSync: Force processing all queued changes");

		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}

		await this.processBatch();
	}

	/**
	 * Get current queue status
	 */
	getQueueStatus(): {
		queueSize: number;
		processingBatch: boolean;
		priorityMode: boolean;
		changesPerMinute: number;
	} {
		return {
			queueSize: this.changeQueue.size,
			processingBatch: this.processingBatch,
			priorityMode: this.priorityMode,
			changesPerMinute: this.changeCountWindow.length,
		};
	}

	/**
	 * Clear the change queue
	 */
	clearQueue(): void {
		this.changeQueue.clear();
		this.changeCount = 0;
		this.changeCountWindow = [];
		this.priorityMode = false;

		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}

		this.plugin.log("ModSync: Queue cleared");
	}

	/**
	 * Update configuration
	 */
	updateConfig(newConfig: Partial<ModSyncConfig>): void {
		this.config = { ...this.config, ...newConfig };
		this.plugin.log("ModSync: Configuration updated", this.config);
	}
}
