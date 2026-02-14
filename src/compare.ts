import SmartSyncPlugin from "./main";
import { FileTree, FileList, FileTrees } from "./const";
import ignoreFactory from "ignore";

export class Compare {
    constructor(public plugin: SmartSyncPlugin) {
        this.plugin = plugin;
    }
    // Function to compare two file trees and find changes
    compareFileTreesExcept(remoteFiles: FileTree, localFiles: FileTree) {
        // Identify added and modified files
        // for (const [file1, hash1] of Object.entries(remoteFiles)) {

        for (const file1 in remoteFiles.modified) {
            if (localFiles.modified[file1]) {
                remoteFiles.except[file1] = remoteFiles.modified[file1];
                localFiles.except[file1] = localFiles.modified[file1];

                delete remoteFiles.modified[file1];
                delete localFiles.modified[file1];
            }
        }

        // Identify where hashes didn't change and remove them from fileTree, as they didn't change
        for (const file1 in remoteFiles.added) {
            if (localFiles.added[file1] === remoteFiles.added[file1]) {
                delete remoteFiles.added[file1];
                delete localFiles.added[file1];
            } else if (localFiles.added[file1]) {
                remoteFiles.except[file1] = remoteFiles.added[file1];
                localFiles.except[file1] = localFiles.added[file1];

                delete remoteFiles.added[file1];
                delete localFiles.added[file1];
            }
        }
        for (const file1 in localFiles.except) {
            if (localFiles.except[file1] === remoteFiles.except[file1]) {
                delete remoteFiles.except[file1];
                delete localFiles.except[file1];
                // console.log("deleted Except:",file1);
            }
        }

        return { remoteMatch: remoteFiles, localMatch: localFiles };
    }

    // Function to compare two file trees and find changes
    async comparePreviousFileTree(previousFiles: FileList, previousExcept: FileList, currentFiles: FileList) {
        const fileTree: FileTree = {
            added: {},
            deleted: {},
            modified: {},
            except: this.checkExistKey(previousExcept, currentFiles),
        };

        // Identify added and modified files
        for (const [currentFile, currentHash] of Object.entries(currentFiles)) {
            const matchingHash = previousFiles[currentFile];

            if (previousFiles[currentFile] === currentFiles[currentFile]) {
                // nothing
            } else if (!matchingHash) {
                fileTree.added[currentFile] = currentHash;
            } else if (matchingHash !== currentHash) {
                fileTree.modified[currentFile] = currentHash;
            }
        }

        /**
         * Correct previous except files that could now be found in modified
         */
        Object.keys(previousExcept).forEach((path) => {
            if (path in fileTree.modified) {
                fileTree.except[path] = fileTree.modified[path];
                delete fileTree.modified[path];
            }
        });

        // // Identify deleted files
        // for (const [prevFile, prevHash] of Object.entries(previous)) {
        //   if (!current[prevFile]) {

        //     if (current[prevFile] === previous[prevFile]){
        //       // unchanged
        //     } else {
        //       deleted[prevFile] = prevHash;
        //     }
        //   }
        // }

        for (const [file] of Object.entries(previousFiles)) {
            if (!currentFiles.hasOwnProperty(file)) {
                // The key is not in the current object
                fileTree.deleted[file] = previousFiles[file];
            }
        }

        return fileTree;
    }

    /**
     *  Keeps only the items from sourceObject that also exist in referenceObject
     */
    checkExistKey = (sourceObject: FileList, referenceObject: FileList) => {
        return Object.fromEntries(
            // Convert back to object
            Object.entries(sourceObject) // Convert object to [key, value] pairs
                .filter(([key]) => key in referenceObject) // Keep only if key exists in reference
        );
    };

    /** This function splits sourceObject into two objects:
     * - removedItems: items that don't exist in referenceObject
     * - remainingItems: items that do exist in referenceObject
     */
    checkExistKeyBoth = (sourceObject: FileList, referenceObject: FileList) => {
        const removedItems: FileList = {};
        const remainingItems: FileList = {};

        for (const key in sourceObject) {
            if (Object.prototype.hasOwnProperty.call(referenceObject, key)) {
                remainingItems[key] = sourceObject[key]; // Key exists in both
            } else {
                removedItems[key] = sourceObject[key]; // Key only in source
            }
        }

        return [removedItems, remainingItems];
    };

    private createIgnoreMatcher() {
        const ig = ignoreFactory();

        if (this.plugin.settings.exclusionsOverride) {
            // When override is enabled, don't filter anything
            return () => false;
        }

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

        return ig;
    }

    filterExclusions = (fileTree: FileList) => {
        const ig = this.createIgnoreMatcher();
        let filtered: FileList = {};

        // When override is enabled, ig is a function that returns false (don't ignore)
        // Otherwise, ig is an Ignore instance with ignores() method
        const isIgnore = typeof ig === "function"
            ? () => (ig as () => boolean)()
            : (path: string) => ig.ignores(path);

        for (const filePath in fileTree) {
            if (!isIgnore(filePath)) {
                filtered[filePath] = fileTree[filePath];
            }
        }

        return filtered;
    };

    compareFileTrees = async (remoteFiles: FileList, localFiles: FileList): Promise<FileTrees> => {
        // Initialize default file trees structure
        const fileTreeMatch: FileTrees = {
            remoteFiles: { added: {}, deleted: {}, modified: {}, except: {} },
            localFiles: { added: {}, deleted: {}, modified: {}, except: {} },
        };

        // Case 1: No previous file tree or no webdav files
        if (!this.plugin.prevData.files || Object.keys(this.plugin.prevData.files).length === 0 || Object.keys(remoteFiles).length === 0) {
            if (Object.keys(remoteFiles).length === 0) {
                // Only local files exist
                fileTreeMatch.localFiles.added = localFiles;
                return fileTreeMatch;
            }

            // Both remote and local files exist, but no previous state
            const initialTrees = {
                remote: { added: remoteFiles, deleted: {}, modified: {}, except: {} },
                local: { added: localFiles, deleted: {}, modified: {}, except: {} },
            };

            const { remoteMatch, localMatch } = this.compareFileTreesExcept(initialTrees.remote, initialTrees.local);
            return { remoteFiles: remoteMatch, localFiles: localMatch };
        }
        /**
         * Regular workflow ...
         */

        // Case 2: Compare with previous state
        try {
            const filteredPrevTree = this.filterExclusions(this.plugin.prevData.files);
            const filteredExcepts = this.filterExclusions(this.plugin.prevData.except);

            const [remoteFilesBranch, localFilesBranch] = await Promise.all([
                this.comparePreviousFileTree(filteredPrevTree, filteredExcepts, remoteFiles),
                this.comparePreviousFileTree(filteredPrevTree, filteredExcepts, localFiles),
            ]);

            remoteFilesBranch.except = { ...this.plugin.prevData.except, ...remoteFilesBranch.except };
            localFilesBranch.except = { ...this.plugin.prevData.except, ...localFilesBranch.except };

            const { remoteMatch, localMatch } = this.compareFileTreesExcept(remoteFilesBranch, localFilesBranch);

            // Post-process deleted files
            remoteMatch.deleted = this.checkExistKey(remoteMatch.deleted, localFiles);
            localMatch.deleted = this.checkExistKey(localMatch.deleted, remoteFiles);

            return { remoteFiles: remoteMatch, localFiles: localMatch };
        } catch (error) {
            console.error("File comparison error:", error);
            throw error;
        }
    };
}
