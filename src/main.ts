import { Notice, Plugin, setIcon, TFile } from "obsidian";
import { SmartSyncClient } from "./smartSync";
import {} from "./settings";
import { FileTreeModal } from "./modal";
import { Checksum } from "./checksum";
import { Compare } from "./compare";
import { Operations } from "./operations";
import { launcher } from "./setup";
import { ModSyncListener } from "./modsync";
import {
	FileList,
	PreviousObject,
	Status,
	SmartSyncSettings,
	DEFAULT_SETTINGS,
	STATUS_ITEMS,
	FileTrees,
	Hash,
	Location,
	DiffType,
	ExplicitAction,
} from "./const";
import { DailyNoteManager } from "./dailynote";
import { DailyOfflineModal } from "./dailyModal";

export default class SmartSync extends Plugin {
	message: string | Array<string[]> | string[] | unknown[];
	declare settings: SmartSyncSettings;
	compare: Compare;
	checksum: Checksum;
	operations: Operations;
	dailyNote: DailyNoteManager;
	modSyncListener: ModSyncListener;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any Not exposed in Obsidian API
	settingPrivate: any;

	statusBar: HTMLElement;
	statusBar1: HTMLElement;
	statusBar2: HTMLElement;
	iconSpan: HTMLSpanElement;
	modal: FileTreeModal;
	dailyOfflineModal: DailyOfflineModal | null = null;
	baseRemotePath: string = "";
	showModal: boolean;
	smartSyncClient: SmartSyncClient;
	fileTrees: FileTrees;
	allFiles: {
		local: FileList;
		remote: FileList;
	};
	prevPath: string;
	prevData: PreviousObject;
	intervalId: number;
	status: Status;
	lastFileEdited: string;
	lastModSync: number;
	sessionSynced: boolean;
	reconnectInterval: number | null = null;
	reconnectAttempts: number = 0;

	scheduledSync = {
		checkTimeoutId: null as number | null,
		syncTimeoutId: null as number | null,
	};

	notice: Notice;
	pause: boolean;
	isSyncing: boolean;
	fileSelection: Record<
		string,
		{
			location: Location | undefined;
			diffType: DiffType;
			selected: boolean;
			inverse?: boolean;
		}
	>;

	mobile: boolean;
	local: FileList;
	remote: FileList;
	hashStats: {
		totalFiles: number;
		sources: {
			prevData: number;
			calculated: number;
			cache: number;
		};
		excluded: number;
	};
	hashFlags: {
		prevData: boolean;
		cache: boolean;
	};

	loadingTotal: number;
	loadingProcessed: number;
	checkTime: number;
	lastScrollPosition: number;
	tempExcludedFiles: Record<
		string,
		{
			location: Location;
			diffType: DiffType;
			hash: Hash;
		}
	>;

	onload() {
		launcher(this);

		// Wait for layout to be ready before registering event listeners
		// This prevents catching startup file loading events
		this.app.workspace.onLayoutReady(() => {
			console.warn("🚀 [SmartSync] Layout ready - Registering ModSync listeners NOW");
			setTimeout(() => {
				// Initialize and register ModSync listeners AFTER layout is ready
				if (this.settings.modSync) {
					this.setModSync();
				}

				if (this.settings.autoSync) {
					this.setAutoSync();
				}
			}, 500);
		});
	}

	log(...text: string[] | unknown[]) {
		this.message = text;
		if (this.settings.debugMode) {
			console.log(...text);
		}
	}

	async setClient() {
		try {
			this.smartSyncClient = this.operations.configSmartSync(
				this.settings.url,
				this.settings.port,
				this.settings.authToken
			);
		} catch (error) {
			console.error("SmartSync Client creation error.", error);
			this.show("Error creating SmartSync Client!");
		}
	}

	async setAutoSync() {
		window.clearInterval(this.intervalId);

		if (this.settings.autoSync) {
			this.intervalId = window.setInterval(async () => {
				this.log("AUTOSYNC INTERVAL TRIGGERED");
				// if (Date.now() - this.checkTime > 30*1000){
				if (this.status === Status.OFFLINE) {
					const response = await this.operations.test(false);
					if (!response) {
						return;
					} else {
						this.setStatus(Status.NONE);
					}
				}

				if (this.status !== Status.NONE) {
					console.log("Cant Autosync because ", this.status);
					return;
				}

				if (!(await this.operations.check(false))) {
					return;
				}

				await this.operations.sync(false);
				// }
			}, this.settings.autoSyncInterval * 1000);
		}
	}

	/**
	 * Initialize the comprehensive modification sync listener
	 * This replaces the old simple debounce system with advanced batch processing
	 */
	setModSync() {
		if (!this.modSyncListener) {
			this.modSyncListener = new ModSyncListener(this);
		}
		// Apply configuration from settings
		this.modSyncListener.updateConfig({
			...this.settings.modSyncConfig,
		});

		if (this.settings.modSync) {
			this.modSyncListener.registerEventListeners();
			const modeText = this.settings.modSyncConfig.dryRun ? " (DRY RUN MODE)" : "";
			this.log(`Ultimate ModSync activated with comprehensive event tracking${modeText}`);
		} else {
			if (this.modSyncListener) {
				this.modSyncListener.unregisterEventListeners();
				this.log("ModSync deactivated");
			}
		}
	}

	async setError() {
		this.prevData.error = true;

		console.error("Error detected and saved to prevData");
		this.show("Error detected and saved to prevData!");
		this.setStatus(Status.ERROR);
		// Stop modsync from reacting to vault changes while in error state
		this.modSyncListener?.unregisterEventListeners();
		await this.savePrevData();
	}

	async clearError() {
		this.prevData.error = false;
		this.setStatus(Status.NONE);
		new Notice("Error states cleared");
		if (this.settings.modSync) {
			this.modSyncListener?.registerEventListeners();
		}
		await this.savePrevData();
	}

	// default true in order for except to be updated
	async saveState(checkLocal = false) {
		this.log("save state");
		const action = "save";
		if (this.prevData.error) {
			this.show(`Error detected - please clear in control panel or force action by retriggering ${action}`);
			console.log("SAVE ERROR OCCURREDDD");
			return;
		}
		if (this.status === Status.NONE && !this.prevData.error) {
			this.setStatus(Status.SAVE);

			try {
				// if (checkLocal || emptyObj(this.allFiles.local)) {
				// const oldPrevData = this.prevData.files;
				// }

				const { files, end } = await this.checksum.generateLocalHashTree(false);

				console.log("fileSelection: ", this.fileSelection);

				// Preserve old hashes for files where selected is false
				for (const path of Object.keys(this.fileSelection)) {
					if (this.fileSelection[path].selected === false) {
						if (path in this.prevData.files) {
							files[path] = this.prevData.files[path];
						} else {
							delete files[path];
						}
					}
				}

				const newExcept = this.compare.checkExistKey(this.fileTrees.local.except, files);

				this.prevData = {
					error: this.prevData.error,
					files,
					except: newExcept,
					timestamps: {
						prevdataUpdate: Date.now(),
						lastFullSync: this.prevData.timestamps?.lastFullSync || 0,
						lastFileSync: this.prevData.timestamps?.lastFileSync || 0,
					},
				};

				await this.app.vault.adapter.write(this.prevPath, JSON.stringify(this.prevData, null, 2));
				console.log("saving successful!");
				this.show("Saved current vault state!");
				this.setStatus(Status.NONE);
			} catch (error) {
				console.log("Error occurred while saving State. ", error);
				this.setError();
				return error;
			}
		} else {
			this.show(`Saving not possible because of ${this.status} \nplease clear Error in Control Panel`);
			console.log("Action currently active: ", this.status, "\nCan't save right now!");
		}
	}

	async savePrevData() {
		try {
			await this.app.vault.adapter.write(this.prevPath, JSON.stringify(this.prevData, null, 2));
			this.log("saving prevData successful!");
			// this.prevDataSaveTimeoutId = null;
		} catch (error) {
			console.error("prevData   ", error);
		}
	}

	abortScheduledSync() {
		let aborted = false;

		if (this.scheduledSync.checkTimeoutId !== null) {
			clearTimeout(this.scheduledSync.checkTimeoutId);
			this.scheduledSync.checkTimeoutId = null;
			aborted = true;
		}

		if (this.scheduledSync.syncTimeoutId !== null) {
			clearTimeout(this.scheduledSync.syncTimeoutId);
			this.scheduledSync.syncTimeoutId = null;
			aborted = true;
		}

		if (aborted) {
			this.show("❌ Startup sync aborted");
		}
	}

	async initRemote() {
		//
		await this.operations.deleteFilesRemote(this.remote);
		await this.operations.uploadFiles(this.local);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	calcTotal(...rest: Record<string, any>[]) {
		this.log("REST: ", rest);
		this.loadingProcessed = 0;
		let total = 0;
		for (const i of rest) {
			total += Object.keys(i).length;
		}
		this.loadingTotal = total;
		// this.statusBar2.setText(" 0/" + this.loadingTotal);
		return total;
	}

	async finished() {
		await sleep(2000);
		this.statusBar2.setText("");
	}

	async processed() {
		this.loadingProcessed++;
		this.log(this.loadingProcessed.toString() + "/" + this.loadingTotal);
		this.statusBar2.setText(this.loadingProcessed.toString() + "/" + this.loadingTotal);
	}

	togglePause() {
		this.pause = !this.pause;

		console.log(this.status);
		if (this.pause) {
			this.setStatus(Status.PAUSE);
		} else {
			this.setStatus(Status.NONE);
		}
	}

	async displayModal() {
		this.modal = new FileTreeModal(this.app, this);
		this.modal.open();
	}

	/**
	 *
	 * @param message - What is on your Toast?
	 * @param duration - Time in milliseconds
	 */
	show(message: string, duration?: number) {
		// if (this.notice) {
		//     this.notice.hide();
		// }

		const fragment = document.createDocumentFragment();
		const divElement = document.createElement("div");
		divElement.textContent = message;
		// divElement.setAttribute("style", "white-space: pre-wrap;");
		divElement.style.whiteSpace = "pre-wrap";

		fragment.appendChild(divElement);
		this.notice = new Notice(fragment, duration);
		// new Notice(message, duration);
	}

	async setStatus(status: Status, show = true, text?: string) {
		const oldStatus = this.status;
		this.status = status;

		// this.app.vault.fileMap
		if (text) {
			this.statusBar.setText(text);
			return;
		}

		// show && this.statusBar.setText(status);
		if (show) {
			// Update status method
			// updateSyncStatus(status: 'error' | 'syncing' | 'success')
			// this.iconSpan.removeClass("mod-error", "mod-syncing", "mod-success", );
			// this.iconSpan.addClass(`mod-${STATUS_ITEMS[status].class}`);
			this.iconSpan.setCssProps({ color: STATUS_ITEMS[status].color });
			this.statusBar.setAttribute("aria-label", STATUS_ITEMS[status].label);
			setIcon(this.iconSpan, STATUS_ITEMS[status].lucide);
		}

		// Process queue when transitioning to NONE
		if (status === Status.NONE && oldStatus !== Status.NONE) {
			if (this.modSyncListener) {
				setTimeout(() => this.modSyncListener.processQueue(), 100);
			}
		}

		// Schedule reconnect when transitioning to OFFLINE or ERROR
		if ([Status.OFFLINE, Status.ERROR].includes(status) && ![Status.OFFLINE, Status.ERROR].includes(oldStatus)) {
			this.scheduleReconnect();
		}

		// Clear reconnect when transitioning away from OFFLINE or ERROR
		if (![Status.OFFLINE, Status.ERROR].includes(status) && [Status.OFFLINE, Status.ERROR].includes(oldStatus)) {
			this.clearReconnect();
		}

		if (this.modal) {
			this.modal.updateStatusIndicator();
		}
	}

	/**
	 * Schedule periodic connection testing when offline with exponential backoff
	 */
	private scheduleReconnect(): void {
		if (this.reconnectInterval) return; // Already running

		this.reconnectAttempts = 0;
		this.startReconnectAttempt();
	}

	/**
	 * Start a single reconnect attempt with exponential backoff
	 */
	private startReconnectAttempt(): void {
		// Calculate delay with exponential backoff: 10s * 1.5^attempt, capped at 60s
		const delay = Math.min(10000 * Math.pow(1.5, this.reconnectAttempts), 30000);
		this.log(`Reconnect attempt ${this.reconnectAttempts + 1} in ${delay / 1000}s`);

		this.reconnectInterval = window.setTimeout(async () => {
			// Check if we're still offline/error
			if (this.status !== Status.OFFLINE && this.status !== Status.ERROR) {
				this.clearReconnect();
				return;
			}

			this.log("Testing connection...");
			const online = await this.operations.test(false);

			if (online) {
				this.log("Connection restored!");
				this.clearReconnect();
				this.setStatus(Status.NONE); // This triggers queue processing
			} else {
				// Increment attempts and schedule next retry
				this.reconnectAttempts++;
				this.startReconnectAttempt();
			}
		}, delay);
	}

	/**
	 * Clear the reconnect scheduler
	 */
	private clearReconnect(): void {
		if (this.reconnectInterval) {
			window.clearTimeout(this.reconnectInterval);
			this.reconnectInterval = null;
			this.reconnectAttempts = 0;
			this.log("Stopped reconnect scheduler");
		}
	}

	onunload() {
		window.clearInterval(this.intervalId);
		this.clearReconnect();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
