import SmartSyncPlugin from "./main";
import { FileTree, FileList, FileTrees } from "./const";
import ignoreFactory from "ignore";

export class Compare {
	constructor(public plugin: SmartSyncPlugin) {
		this.plugin = plugin;
	}

	// Files that are in sync on both sides (present on local + remote with identical
	// hash) but missing from prevData.files — i.e. the gap between prevData and the
	// true synced state. Merged into prevData after check() so it stays complete
	// (and so future deletions/moves classify correctly). Reset every compareFileTrees run.
	prevDataGap: FileList = {};
	// Function to compare two file trees and find changes
	compareFileTreesExcept(remote: FileTree, local: FileTree) {
		// Identify added and modified files

		for (const file1 in remote.modified) {
			if (local.modified[file1]) {
				remote.except[file1] = remote.modified[file1];
				local.except[file1] = local.modified[file1];

				delete remote.modified[file1];
				delete local.modified[file1];
			}
		}

		// Identify where hashes didn't change and remove them from fileTree, as they didn't change
		for (const file1 in remote.added) {
			const localValue = local.added[file1];
			const remoteValue = remote.added[file1];

			if (!localValue) {
				this.plugin.log("compare.ts: no localValue defined for " + file1);
				continue;
			}

			// Both are FileEntry - compare hashes
			if (remoteValue.hash === localValue.hash) {
				this.prevDataGap[file1] = localValue;
				delete remote.added[file1];
				delete local.added[file1];
				console.log("shown as both 'added locally' and 'added remotely' but not in prevData: ", file1);
			} else {
				remote.except[file1] = remoteValue;
				local.except[file1] = localValue;

				delete remote.added[file1];
				delete local.added[file1];
			}
		}

		for (const file1 in local.except) {
			const localValue = local.except[file1];
			const remoteValue = remote.except[file1];

			if (!remoteValue) {
				this.plugin.log("compare.ts: no remoteValue defined for " + file1);
				continue;
			}
			// Both are FileEntry - compare hashes
			if (localValue.hash === remoteValue.hash) {
				this.prevDataGap[file1] = localValue;
				delete remote.except[file1];
				delete local.except[file1];
			}
		}

		return { remoteMatch: remote, localMatch: local };
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
		for (const [currentFile, currentValue] of Object.entries(currentFiles)) {
			const previousValue = previousFiles[currentFile];

			if (!previousValue) {
				fileTree.added[currentFile] = currentValue;
			} else if (previousValue.hash === currentValue.hash) {
				// Unchanged - hashes match
			} else {
				fileTree.modified[currentFile] = currentValue;
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

		// Identify deleted files
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
		const isIgnore =
			typeof ig === "function"
				? () => (ig as () => boolean)()
				: (path: string) => {
						try {
							return ig.ignores(path);
						} catch (error) {
							console.error("Ignore check error for path:", path, error);
							return false; // Don't exclude on error
						}
					};

		for (const filePath in fileTree) {
			if (!isIgnore(filePath)) {
				filtered[filePath] = fileTree[filePath];
			}
		}

		return filtered;
	};

	compareFileTrees = async (remote: FileList, local: FileList): Promise<FileTrees> => {
		// Reset the prevData gap (in-sync files missing from prevData) for this run
		this.prevDataGap = {};

		// Initialize default file trees structure
		const fileTreeMatch: FileTrees = {
			remote: { added: {}, deleted: {}, modified: {}, except: {} },
			local: { added: {}, deleted: {}, modified: {}, except: {} },
		};

		// Case 1: No previous file tree or no remote files
		if (
			!this.plugin.prevData.files ||
			Object.keys(this.plugin.prevData.files).length === 0 ||
			Object.keys(remote).length === 0
		) {
			if (Object.keys(remote).length === 0) {
				// Only local files exist
				fileTreeMatch.local.added = this.filterExclusions(local);
				return fileTreeMatch;
			}

			// Both remote and local files exist, but no previous state
			const initialTrees = {
				remote: { added: this.filterExclusions(remote), deleted: {}, modified: {}, except: {} },
				local: { added: this.filterExclusions(local), deleted: {}, modified: {}, except: {} },
			};

			const { remoteMatch, localMatch } = this.compareFileTreesExcept(initialTrees.remote, initialTrees.local);
			return { remote: remoteMatch, local: localMatch };
		}
		/**
		 * Regular workflow ...
		 */

		// Case 2: Compare with previous state
		try {
			const filteredPrevTree = this.filterExclusions(this.plugin.prevData.files);
			const filteredExcepts = this.filterExclusions(this.plugin.prevData.except);
			const filteredRemote = this.filterExclusions(remote);
			const filteredLocal = this.filterExclusions(local);

			const [remoteBranch, localBranch] = await Promise.all([
				this.comparePreviousFileTree(filteredPrevTree, filteredExcepts, filteredRemote),
				this.comparePreviousFileTree(filteredPrevTree, filteredExcepts, filteredLocal),
			]);

			remoteBranch.except = { ...this.plugin.prevData.except, ...remoteBranch.except };
			localBranch.except = { ...this.plugin.prevData.except, ...localBranch.except };

			const { remoteMatch, localMatch } = this.compareFileTreesExcept(remoteBranch, localBranch);

			// Post-process deleted files
			remoteMatch.deleted = this.checkExistKey(remoteMatch.deleted, local);
			localMatch.deleted = this.checkExistKey(localMatch.deleted, remote);

			return { remote: remoteMatch, local: localMatch };
		} catch (error) {
			console.error("File comparison error:", error);
			throw error;
		}
	};
}
