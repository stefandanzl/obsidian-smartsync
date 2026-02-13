# Refactoring Guide

This document outlines identified syntactic cleanup opportunities and technical debt in the WebDAV Obsidian Plugin codebase.

## Table of Contents

- [Priority Issues](#priority-issues)
- [File-by-File Analysis](#file-by-file-analysis)
- [General Patterns](#general-patterns)

---

## Priority Issues

### High Priority (Type Safety & Bugs)

| File | Issue | Impact |
|------|-------|--------|
| `main.ts:110` | Standalone `this.prevData;` statement | No-op, dead code |
| `util.ts:88` | `this.show()` in utility function context | Runtime error potential |
| `checksum.ts:48-52` | Unreachable code after `return true` | Logic bug |
| `modal.ts:224,247` | `(this as any)` casts | Type safety loss |
| `dailynote.ts:248` | Missing `sleep` import | Runtime error |

### Medium Priority (Code Quality)

| File | Issue | Impact |
|------|-------|--------|
| `compare.ts` | `for...in` loops without type guards | Type safety |
| `compare.ts:122` | `hasOwnProperty` pattern | Outdated pattern |
| `const.ts:17-33` | Unused `Status2`, `Action` enums | Dead exports |
| Multiple files | Commented code blocks | Code clarity |

---

## File-by-File Analysis

### src/main.ts

```typescript
// Line 26: Overly complex type
message: string | Array<string[]> | string[] | unknown[];

// SUGGESTION: Simplify to what's actually used
message: string | string[];
```

```typescript
// Lines 34-35: Unsafe any type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
settingPrivate: any;

// SUGGESTION: Use proper Obsidian type
settingPrivate: SettingTab | null;
```

```typescript
// Line 110: Dead code
this.prevData;  // Does nothing

// SUGGESTION: Remove
```

```typescript
// Lines 37, 84, 92: Duplicate statusBar declarations
statusBar: HTMLElement;  // Line 37
// ... later ...
statusBar = plugin.addStatusBarItem();  // Line 84
statusBar = plugin.addStatusBarItem();  // Line 92 - overwrites!

// SUGGESTION: Rename or consolidate
statusBar: HTMLElement;        // Main status bar
statusBarProgress: HTMLElement; // For progress text
```

```typescript
// Line 344: Missing import
await sleep(2000);

// ADD TO IMPORTS:
import { sleep } from "./util";
```

**Commented code to remove:**
- Lines 96, 120-121, 178-183, 244, 273-276, 318, 399, 403

---

### src/operations.ts

```typescript
// Line 118: Unnecessary eslint-disable
// eslint-disable-next-line @typescript-eslint/no-unused-vars
for (const [localFilePath, _] of Object.entries(fileChecksums)) {

// SUGGESTION: Remove the eslint-disable - underscore is the standard convention
for (const [localFilePath, _] of Object.entries(fileChecksums)) {
```

```typescript
// Lines 249-273, 423-446: Repetitive console.log patterns
console.log("[TEST] Starting connection test...");
console.log("[SYNC] Starting sync...");

// SUGGESTION: Create a helper function in util.ts:
export function logWithPrefix(category: string, ...args: unknown[]) {
    console.log(`[${category}]`, ...args);
}

// USAGE:
logWithPrefix("TEST", "Starting connection test...");
logWithPrefix("SYNC", "Starting sync...");
```

```typescript
// Line 446: Unclear error message
console.log("SYNC CHECK FAIL CORRECT");

// SUGGESTION: Make message clearer
console.log("Sync check failed - cannot proceed");
```

```typescript
// Lines 567, 583: Redundant method reference
await this.sync({ /* ... */ });

// CURRENT (in duplicateLocal, duplicateRemote):
await this.plugin.operations.sync({ /* ... */ });

// SUGGESTION: Use this.sync() directly
await this.sync({ /* ... */ });
```

---

### src/const.ts

```typescript
// Lines 17-33: Unused enums
export enum Status2 { /* ... */ }
export enum Action { /* ... */ }

// SUGGESTION: Remove if grep shows no usage
```

```typescript
// Line 165: Partial typing on DEFAULT_SETTINGS
export const DEFAULT_SETTINGS: Partial<SmartSyncSettings> = { /* ... */ };

// SUGGESTION: This is fine for defaults, but consider:
type PartialSettings = Omit<SmartSyncSettings, 'modifySyncInterval' | 'modifySync'>;
export const DEFAULT_SETTINGS: PartialSettings = { /* ... */ };
```

---

### src/util.ts

```typescript
// Line 67: Parameter name mismatch
export function fileTreesEmpty({ localFiles, webdavFiles }: { localFiles: FileTree; webdavFiles: FileTree })

// SUGGESTION: Rename for consistency with rest of codebase
export function fileTreesEmpty({ localFiles, remoteFiles }: { localFiles: FileTree; remoteFiles: FileTree })
```

```typescript
// Line 88: Function using `this` in non-method context
export function fileTreesEmpty(...) {
    // ...
    this.show("Please open control panel to solve your file exceptions");
    // ^^^ This will cause runtime error
}

// SUGGESTION: Either:
// 1. Make it a class method, or
// 2. Accept plugin as parameter and call plugin.show()
```

```typescript
// Line 112: Conflicting comment
// Already implemented by Obsidian API
export function sleep(ms: number) { /* ... */ }

// SUGGESTION: Either remove function and update all call sites,
// or remove the misleading comment
```

---

### src/compare.ts

```typescript
// Lines 14, 25, 37, 61, 73, 92: for...in loops
for (const file1 in remoteFiles.modified) {
    if (localFiles.modified[file1]) {
        // ...
    }
}

// SUGGESTION: Use Object.keys() for better type safety
for (const file1 of Object.keys(remoteFiles.modified)) {
    if (file1 in localFiles.modified) {
        // ...
    }
}
```

```typescript
// Line 122: Outdated hasOwnProperty pattern
if (Object.prototype.hasOwnProperty.call(referenceObject, key)) {

// SUGGESTION: Use modern ES2022 equivalent
if (Object.hasOwn(referenceObject, key)) {
```

```typescript
// Lines 80-90: Large commented block
// SUGGESTION: Remove dead code
```

---

### src/checksum.ts

```typescript
// Lines 48-52: Logic issue - unreachable code
if (
    folders.some((folder) => {
        filePath.endsWith(folder + "/");
        return true;  // Always returns true!
    })
)
    if (extensions.length > 0) {
        // This block is unreachable due to logic above
    }

// SUGGESTION: Fix the control flow
if (folders.some((folder) => filePath.endsWith(folder + "/"))) {
    // Handle folder case
}

if (extensions.length > 0) {
    // Handle extensions
}
```

```typescript
// Line 146: ts-ignore without proper explanation
//@ts-ignore little trick
const fileCache = this.plugin.app.metadataCache.fileCache;

// SUGGESTION: Use proper type assertion
const fileCache = (this.plugin.app.metadataCache as MetadataCache & { fileCache?: Record<string, { hash: string }> }).fileCache;

// OR define type extension interface
interface MetadataCacheWithFileCache extends MetadataCache {
    fileCache?: Record<string, { hash: string }>;
}
```

---

### src/modal.ts

```typescript
// Lines 25, 224, 247: Unsafe any casts
const { titleEl, modalEl, contentEl, containerEl } = this;
(this as any).originalSetStatus = originalSetStatus;
if ((this as any).originalSetStatus) {

// SUGGESTION: Add proper class properties
export class FileTreeModal extends Modal {
    private originalSetStatus?: typeof SmartSyncPlugin.prototype.setStatus;

    // Then use:
    this.originalSetStatus = originalSetStatus;
    if (this.originalSetStatus) {
        this.plugin.setStatus = this.originalSetStatus;
    }
}
```

```typescript
// Line 250: Standalone statement
this.plugin.modal;  // Does nothing

// SUGGESTION: Remove
```

```typescript
// Line 587: ts-ignore
//@ts-ignore
{ location, type }

// SUGGESTION: Fix the type properly - the Controller type already allows optional properties
```

---

### src/dailynote.ts

```typescript
// Lines 7, 11: Unused property
private ignoreConnection: boolean;
// ...
this.ignoreConnection = false;  // Set statically, never meaningfully changed

// SUGGESTION: Remove if not functionally used, or implement properly
```

```typescript
// Line 248: Missing import
await sleep(1000 * waitTime);

// ADD TO IMPORTS:
import { sleep } from "./util";
```

```typescript
// Line 141: Unnecessary parameter
new Promise<never>((_resolve, reject) => {

// SUGGESTION: Use arrow function without parameter
new Promise<never>((_, reject) => {
// OR just:
new Promise<void>((_, reject) => {
```

```typescript
// Lines 27, 43: Commented code
// SUGGESTION: Remove dead code
```

---

### src/settings.ts

```typescript
// Lines 76-77: Inconsistent spacing
// SUGGESTION: Standardize blank line usage (2 lines between sections)
```

---

## General Patterns

### 1. Logging Consistency

Create a centralized logging utility:

```typescript
// src/util.ts
export enum LogCategory {
    TEST = "TEST",
    SYNC = "SYNC",
    CHECK = "CHECK",
    ERROR = "ERROR",
}

export function logWithPrefix(category: LogCategory | string, ...args: unknown[]) {
    console.log(`[${category}]`, ...args);
}
```

### 2. Type Safety Improvements

Replace `any` with proper types:

```typescript
// Instead of:
settingPrivate: any;

// Use:
import { SettingTab } from "obsidian";
settingPrivate: SettingTab | null;
```

### 3. Modern JavaScript Features

```typescript
// Old pattern:
Object.prototype.hasOwnProperty.call(obj, key)

// Modern ES2022:
Object.hasOwn(obj, key)
```

```typescript
// Old pattern:
for (const key in obj) { /* ... */ }

// Modern with type safety:
for (const key of Object.keys(obj)) { /* ... */ }
```

### 4. Dead Code Removal

Before removing any code, verify usage:
```bash
# Search for usage across the codebase
grep -r "Status2" src/
grep -r "Action" src/
```

---

## Checklist for PR

Use this checklist when implementing the refactoring:

- [ ] Fix missing imports (`sleep` in main.ts, dailynote.ts)
- [ ] Remove standalone no-op statements
- [ ] Replace `for...in` with `Object.keys()`
- [ ] Replace `hasOwnProperty` with `Object.hasOwn()`
- [ ] Remove unused enums (`Status2`, `Action`)
- [ ] Fix `fileTreesEmpty` function in util.ts
- [ ] Remove `(this as any)` casts - add proper types
- [ ] Clean up commented code blocks
- [ ] Fix checksum.ts logic bug (lines 48-52)
- [ ] Standardize console logging with helper function
- [ ] Remove unused `ignoreConnection` property
- [ ] Fix duplicate statusBar declarations
- [ ] Add proper types instead of `@ts-ignore`

---

## Notes

- Always run tests after each refactoring change
- Consider making smaller PRs for easier review
- Some `@ts-ignore` comments may be necessary for Obsidian's untyped APIs
- Verify that enum removals don't affect public API or user configs
