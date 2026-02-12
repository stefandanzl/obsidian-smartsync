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

export enum Status2 {
    READY = "✔️",
    OFFLINE = "📴",
    ERROR = "❌",
    PAUSE = "⏸️",
}

export enum Action {
    NONE = "",
    TEST = "🧪",
    CHECK = "🔎",
    SYNC = "⏳",
    AUTO = "🔄",
    SAVE = "💾",
    PULL = "🔻",
    PUSH = "🔺",
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
        lucide: "flask",
        label: "Testing server connection ...",
        color: "#0000FF",
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
        color: "#FF0000",
    },
    [Status.ERROR]: {
        emoji: "❌",
        class: "status-error",
        lucide: "refresh-cw-off",
        label: "Error! Please check Console in DevTools!",
        color: "#FF0000",
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
    url: "127.0.0.1",
    port: 443,
    authToken: "",

    exclusions: {
        directories: [],
        extensions: [".exe"],
        markers: ["prevdata.json", ".obsidian/workspace.json"],
    },
    exclusionsOverride: false,

    liveSync: false,
    autoSync: false,
    autoSyncInterval: 30,
    enableRibbons: true,
    skipHiddenMobile: false,
    skipHiddenDesktop: false,

    dailyNotesFolder: "Daily Notes",
    dailyNotesFormat: "YYYY/YYYY-MM/YYYY-MM-DD ddd",
    dailyNotesTemplate: "",
    dailyNotesTimestamp: true,
};

export interface SmartSyncSettings {
    url: string;
    port: number;
    authToken: string;
    exclusions: Exclusions;
    exclusionsOverride: boolean;

    liveSync: boolean;
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
}

export interface Exclusions {
    directories: string[];
    extensions: string[];
    markers: string[];
}
