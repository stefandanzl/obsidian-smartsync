import { FileTree } from "./const";
import { Notice, Vault } from "obsidian";

export const join = (...args: string[]) => {
    const separator = "/"; // Change this to '\\' for backslash on Windows
    return args.join(separator).replace(/\/\//g, "/");
};

/**
 * Returns true if obj is empty
 * @param obj
 * @returns
 */
export const emptyObj = (obj: unknown) => {
    if (typeof obj === "object" && obj !== null) {
        return Object.values(obj).length === 0;
    } else {
        return true;
    }
};

export const extname = (filePath: string) => {
    // Check if the last character is '/'
    if (filePath.charAt(filePath.length - 1) === "/") {
        return "";
    }

    // Split the file path by '/' and take the last item
    const fileName = filePath.split("/").pop();

    if (!fileName) {
        return "";
    }

    // Find the last dot in the file path
    const lastDotIndex = fileName.lastIndexOf(".");

    // If there is no dot or it's at the beginning of the file name, return an empty string
    if (lastDotIndex <= 0) {
        return "";
    }

    // Extract the extension by slicing the file path from the last dot index
    const extension = fileName.slice(lastDotIndex);

    return extension;
};

export const dirname = (filePath: string): string => {
    const separator = "/";
    const lastSeparatorIndex = filePath.lastIndexOf(separator);

    if (lastSeparatorIndex === -1) {
        return "";
    }

    return filePath.substring(0, lastSeparatorIndex);
};

export async function sha256(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
}

// export function fileTreesEmpty({ localFiles, remoteFiles }: { localFiles: FileTree; remoteFiles: FileTree }): boolean {
//     const hasNoRegularChanges = [
//         localFiles.added,
//         localFiles.deleted,
//         localFiles.modified,
//         remoteFiles.added,
//         remoteFiles.deleted,
//         remoteFiles.modified,
//     ].every((record) => Object.keys(record).length === 0);

//     if (!hasNoRegularChanges) {
//         return false;
//     }

//     const hasNoExceptions = [remoteFiles.except, localFiles.except].every((record) => Object.keys(record).length === 0);

//     if (hasNoExceptions) {
//         // show && this.show("Nothing to sync");
//         return true;
//     }

//     console.log("Please open control panel to solve your file exceptions");
//     return true;
// }

// Helper function to create nested folders
export async function createFolderIfNotExists(vault: Vault, folderPath: string): Promise<void> {
    const folders = folderPath.split("/").filter((folder) => folder.length);
    let currentPath = "";

    for (const folder of folders) {
        currentPath += folder;
        if (!(await vault.adapter.exists(currentPath))) {
            await vault.createFolder(currentPath);
        }
        currentPath += "/";
    }
}

export function calcDuration(time: number) {
    const now = Date.now();
    const duration = now - time;
    return duration / 1000;
}

// Already implemented by Obsidian API
export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function logNotice(message: string, ms?: number) {
    const duration = ms != undefined ? ms : 8000;
    new Notice(message, duration);
    console.log(message);
}
