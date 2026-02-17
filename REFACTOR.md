# Refactoring Guide

This document outlines identified syntactic cleanup opportunities and technical debt in the SmartSync Obsidian Plugin codebase.

## Table of Contents

- [Priority Issues](#priority-issues)
- [File-by-File Analysis](#file-by-file-analysis)
- [General Patterns](#general-patterns)

---

## Priority Issues

### High Priority (Type Safety & Bugs)

| File               | Issue                  | Impact           |
| ------------------ | ---------------------- | ---------------- |
| `modal.ts:224,247` | `(this as any)` casts  | Type safety loss |
| `dailynote.ts:248` | Missing `sleep` import | Runtime error    |

### Medium Priority (Code Quality)

| File             | Issue                                | Impact           |
| ---------------- | ------------------------------------ | ---------------- |
| `compare.ts`     | `for...in` loops without type guards | Type safety      |
| `compare.ts:122` | `hasOwnProperty` pattern             | Outdated pattern |
| Multiple files   | Commented code blocks                | Code clarity     |

---

## File-by-File Analysis

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
await this.sync({
    /* ... */
});

// CURRENT (in duplicateLocal, duplicateRemote):
await this.plugin.operations.sync({
    /* ... */
});

// SUGGESTION: Use this.sync() directly
await this.sync({
    /* ... */
});
```

---

### src/const.ts

---

### src/util.ts

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
        return true; // Always returns true!
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
this.plugin.modal; // Does nothing

// SUGGESTION: Remove
```

```typescript
// Line 587: ts-ignore
//@ts-ignore
{
    (location, type);
}

// SUGGESTION: Fix the type properly - the Controller type already allows optional properties
```

---

---

## General Patterns

### 3. Modern JavaScript Features

```typescript
// Old pattern:
Object.prototype.hasOwnProperty.call(obj, key);

// Modern ES2022:
Object.hasOwn(obj, key);
```

```typescript
// Old pattern:
for (const key in obj) {
    /* ... */
}

// Modern with type safety:
for (const key of Object.keys(obj)) {
    /* ... */
}
```

---

## Checklist

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

---

## Notes

- Always try to build with command "task default" after each refactoring change
- Some `@ts-ignore` comments may be necessary for Obsidian's untyped APIs
- Verify that enum removals don't affect public API or user configs
