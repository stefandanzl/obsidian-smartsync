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
export type Location = "remoteFiles" | "localFiles";
export type Type = "added" | "deleted" | "modified" | "except";

export type ExplicitAction = "push" | "pull";

export type FileList = Record<Path, Hash>;

export type FileTree = {
    added: FileList;
    deleted: FileList;
    modified: FileList;
    except: FileList;
};

export type FileTrees = {
    remoteFiles: FileTree;
    localFiles: FileTree;
};

export type PreviousObject = {
    date: number;
    error: boolean;
    files: FileList;
    except: FileList;
};

// This is used to build custom functionality with the sync function like inverse actions
export type Controller = {
    remote: {
        added?: 1 | -1;
        deleted?: 1 | -1;
        modified?: 1 | -1;
        except?: 1 | -1;
    };
    local: {
        added?: 1 | -1;
        deleted?: 1 | -1;
        modified?: 1 | -1;
        except?: 1 | -1;
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

    dailyNotesFolder: "Daily Notes",
    dailyNotesFormat: "YYYY/YYYY-MM/YYYY-MM-DD ddd",
    dailyNotesTemplate: "",
    dailyNotesTimestamp: true,

    debugMode: false,
};

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

    dailyNotesFolder: string;
    dailyNotesFormat: string;
    dailyNotesTemplate: string;
    dailyNotesTimestamp: boolean;

    debugMode: boolean;
}
