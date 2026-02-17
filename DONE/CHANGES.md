## 3. Replace Custom Exclusion Logic with `ignore` Library

**Problem:** Current exclusion filtering is complex, buggy, and hard to maintain. Manual path splitting and checking doesn't properly handle:

- Rule ordering
- Negation patterns (`!pattern`)
- Directory vs file semantics
- Edge cases

**Solution:** Use [`ignore`](https://www.npmjs.com/package/ignore) library for proper `.gitignore` semantics.

### Current Structure (to be replaced):

**Settings ([const.ts:212-216](src/const.ts#L212-L216)):**

```typescript
export interface Exclusions {
    directories: string[];
    extensions: string[];
    markers: string[];
}
```

**Current filtering logic ([compare.ts:132-173](src/compare.ts#L132-L173)):**

- Manual path splitting by `/`
- Individual checks for directories, extensions, markers
- StructuredClone to avoid array mutation
- Complex folder traversal logic

### New Structure:

**Settings:**

```typescript
export interface SmartSyncSettings {
    // Replace entire `exclusions: Exclusions` object with:
    ignorePatterns: string[];

    // All other fields remain the same
}
```

**Default patterns ([const.ts:165-189](src/const.ts#L165-L189)):**

```typescript
export const DEFAULT_SETTINGS: Partial<SmartSyncSettings> = {
    // Old:
    exclusions: {
        directories: [],
        extensions: [".exe"],
        markers: ["prevdata.json", ".obsidian/workspace.json"],
    },

    // New:
    ignorePatterns: ["*.exe", "prevdata.json", ".obsidian/workspace.json", ".git*"],

    // Keep exclusionsOverride for now
    exclusionsOverride: false,
    // ... rest of settings
};
```

### Implementation:

**In `compare.ts`:**

```typescript
import ignore from "ignore";

// Replace entire `filterExclusions` function with:
private createIgnoreMatcher() {
    const ig = ignore();

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

    for (const filePath in fileTree) {
        if (!ig.ignores(filePath)) {
            filtered[filePath] = fileTree[filePath];
        }
    }

    return filtered;
};
```

**In `settings.ts`:**

- Remove 3 separate text areas (directories, extensions, markers)
- Replace with single text area for ignorePatterns
- Use textarea with one pattern per line

**UI Example:**

```
Ignore Patterns (.gitignore style):
┌─────────────────────────────────────┐
│ *.exe                             │
│ *.log                             │
│ prevdata.json                      │
│ .obsidian/workspace.json             │
│ node_modules/                       │
│ .git*                             │
└─────────────────────────────────────┘
```

## Implementation Checklist

- [ ] Update `SmartSyncSettings` interface in `const.ts`
- [ ] Update `DEFAULT_SETTINGS` in `const.ts`
- [ ] Replace `filterExclusions` function in `compare.ts`
- [ ] Update settings UI in `settings.ts` (remove 3 fields, add 1)
- [ ] Test with various ignore patterns

---

## Migration Example

**Before (old settings):**

```json
{
    "exclusions": {
        "directories": ["node_modules", ".git"],
        "extensions": [".exe", ".log"],
        "markers": ["prevdata.json"]
    }
}
```

**After (new settings):**

```json
{
    "ingorePatterns": ["node_modules", ".git", "*.exe", "prevdata.json"]
}
```
