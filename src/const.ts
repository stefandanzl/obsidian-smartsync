export const PLUGIN_ID = "smartsync";

export enum Status {
	NONE = "✔️",
	TEST = "🧪",
	CHECK = "🔎",
	SYNC = "⏳",
	AUTO = "🔄",
	SAVE = "💾",
	OFFLINE = "📴",
	ERROR = "❌",
	PULL = "🔻",
	PUSH = "🔺",
	PAUSE = "⏸️",
}

export interface StatusItem {
	emoji: string;
	class: string;
	lucide: string;
	label: string;
	color: string;
}

export const STATUS_ITEMS: Record<Status, StatusItem> = {
	[Status.NONE]: {
		emoji: "✔️",
		class: "status-none",
		lucide: "circle-check-big",
		label: "Ready",
		color: "var(--interactive-accent)",
	},
	[Status.CHECK]: {
		emoji: "🔎",
		class: "status-check",
		lucide: "search",
		label: "Checking files ...",
		color: "var(--interactive-accent)",
	},
	[Status.TEST]: {
		emoji: "🧪",
		class: "status-test",
		lucide: "test-tube-diagonal",
		label: "Testing server connection ...",
		color: "#00c3ff",
	},
	[Status.SAVE]: {
		emoji: "💾",
		class: "status-save",
		lucide: "save",
		label: "Saving current file state to disk ...",
		color: "",
	},
	[Status.SYNC]: {
		emoji: "⏳",
		class: "status-sync",
		lucide: "refresh-ccw",
		label: "Synchronising files ...",
		color: "var(--interactive-accent)",
	},
	[Status.AUTO]: {
		emoji: "🔄",
		class: "status-auto",
		lucide: "refresh-ccw-dot",
		label: "Performing automated Sync ...",
		color: "var(--interactive-accent)",
	},
	[Status.OFFLINE]: {
		emoji: "📴",
		class: "status-offline",
		lucide: "wifi-off",
		label: "Offline! Can't connect to server!",
		color: "#dd4747",
	},
	[Status.ERROR]: {
		emoji: "❌",
		class: "status-error",
		lucide: "refresh-cw-off",
		label: "Error! Please check Console in DevTools!",
		color: "#e94e4e",
	},
	[Status.PULL]: {
		emoji: "🔻",
		class: "status-pull",
		lucide: "arrow-down-to-line",
		label: "Downloading files ...",
		color: "#FFA500",
	},
	[Status.PUSH]: {
		emoji: "🔺",
		class: "status-push",
		lucide: "arrow-up-from-line",
		label: "Uploading files ...",
		color: "#FFA500",
	},
	[Status.PAUSE]: {
		emoji: "⏸️",
		class: "status-pause",
		lucide: "pause",
		label: "User enabled Pause - Disable in Control Panel",
		color: "",
	},
};

export type Path = string;
export type Hash = string;
export type Location = "remote" | "local";
export type DiffType = "added" | "deleted" | "modified" | "except";
export type SyncAction = 1 | -1 | undefined;

export type ExplicitAction = "push" | "pull" | undefined;

export type FileEntry = {
	hash: string;
	size: number;
	mtime: number; // seconds since epoch
};

export type FileList = Record<Path, FileEntry>;

export type FileTree = {
	added: FileList;
	deleted: FileList;
	modified: FileList;
	except: FileList;
};

export type FileTrees = {
	remote: FileTree;
	local: FileTree;
};

export type PreviousObject = {
	error: boolean;
	files: FileList;
	except: FileList;
	timestamps: {
		prevdataUpdate: number; // When prevdata.json was last saved locally
		lastFullSync: number; // When last full sync completed
		lastFileSync: number; // When last single file sync completed
	};
};

export type PostSync = "check" | "prevSuccess" | "saveAndCheck" | "none";

// This is used to build custom functionality with the sync function like inverse actions
export type Controller = {
	remote?: {
		added?: SyncAction;
		deleted?: SyncAction;
		modified?: SyncAction;
		except?: SyncAction;
	};
	local?: {
		added?: SyncAction;
		deleted?: SyncAction;
		modified?: SyncAction;
		except?: SyncAction;
	};
};

export const DEFAULT_SETTINGS: Partial<SmartSyncSettings> = {
	url: "http://127.0.0.1",
	port: 443,
	authToken: "",

	ignorePatterns: ["*.exe", "prevdata.json", ".obsidian/workspace.json", ".git*"],
	exclusionsOverride: false,

	modSync: false,
	autoSync: false,
	autoSyncInterval: 30,
	enableRibbons: true,
	skipHiddenMobile: false,
	skipHiddenDesktop: false,

	modSyncConfig: {
		enabled: false,
		debounceDelay: 2000,
		//maxRetries: 5,
		//conflictDetection: true,
		dryRun: true,
		eventTypes: {
			create: true,
			modify: true,
			delete: true,
			rename: true,
			raw: true,
		},
	},

	dailyNotesFolder: "Daily Notes",
	dailyNotesFormat: "YYYY/YYYY-MM/YYYY-MM-DD ddd",
	dailyNotesTemplate: "",
	dailyNotesTimestamp: true,

	startSync: {
		enable: false,
		delay: 30,
		doSync: false,
		syncDelay: 10,
	},

	debugMode: false,
};

export interface ModSyncEventTypes {
	create: boolean;
	modify: boolean;
	delete: boolean;
	rename: boolean;
	raw: boolean;
}

export interface ModSyncConfig {
	enabled: boolean;
	debounceDelay: number;
	dryRun: boolean;
	eventTypes: ModSyncEventTypes;
}

export interface StartSyncConfig {
	enable: boolean;
	delay: number;
	doSync: boolean;
	syncDelay: number;
}

export interface SmartSyncSettings {
	url: string;
	port: number;
	authToken: string;
	ignorePatterns: string[];
	exclusionsOverride: boolean;

	modSync: boolean;
	autoSync: boolean;
	autoSyncInterval: number;
	modifySyncInterval: number;
	modifySync: boolean;
	enableRibbons: boolean;
	skipHiddenDesktop: boolean;
	skipHiddenMobile: boolean;

	modSyncConfig: ModSyncConfig;

	dailyNotesFolder: string;
	dailyNotesFormat: string;
	dailyNotesTemplate: string;
	dailyNotesTimestamp: boolean;

	startSync: StartSyncConfig;

	debugMode: boolean;
}
