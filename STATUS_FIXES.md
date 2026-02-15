# Status Management System Fixes

## Problem Overview

### Current Issues
1. **Race Condition**: Rapid clicks on "Check" button can bypass the status check because there's a window between checking status and setting it
2. **Status Stuck**: If an error occurs, status gets stuck at ERROR, blocking further operations until manually reset
3. **No Proper Locking**: Status alone isn't sufficient for preventing concurrent operations

### Current Flow (operations.ts:289-295)
```typescript
async check(show = true, exclude = true) {
    // RACE WINDOW: Multiple calls can pass this check before status is set
    if (this.plugin.status !== Status.NONE && this.plugin.status !== Status.OFFLINE) {
        show && this.plugin.show(`Checking not possible, currently ${this.plugin.status}`);
        return;
    }
    // Status set happens AFTER the check - race condition!
    this.plugin.setStatus(Status.CHECK);
```

---

## Required Changes

### 1. Add Operation Lock Flags (REQUIRED)

**File**: `src/const.ts`

Add to `SmartSyncSettings` interface (or create a new interface):

```typescript
export interface OperationState {
    isChecking: boolean;
    isSyncing: boolean;
    isTesting: boolean;
}
```

Add to main plugin class properties:

```typescript
export class SmartSyncPlugin extends Plugin {
    // ... existing properties ...
    operationState: OperationState = {
        isChecking: false,
        isSyncing: false,
        isTesting: false,
    };
}
```

---

### 2. Fix Check Function Race Condition

**File**: `src/operations.ts` - `check()` function

**OPTION A** (Recommended): Use lock flag
```typescript
async check(show = true, exclude = true) {
    // Check lock FIRST
    if (this.plugin.operationState.isChecking) {
        show && this.plugin.show("Check already in progress");
        return false;
    }

    // Set lock immediately
    this.plugin.operationState.isChecking = true;

    // Existing status check (keep as backup)
    if (this.plugin.status !== Status.NONE && this.plugin.status !== Status.OFFLINE) {
        this.plugin.operationState.isChecking = false; // Release lock
        show && this.plugin.show(`Checking not possible, currently ${this.plugin.status}`);
        return;
    }

    try {
        this.plugin.setStatus(Status.CHECK);
        // ... rest of function ...

        // Success path - clear lock at end
        ok && this.plugin.setStatus(Status.NONE);
        this.plugin.operationState.isChecking = false;
        return true;
    } catch (error) {
        // Error path - clear lock
        this.plugin.operationState.isChecking = false;
        // ... existing error handling ...
        throw error;
    }
}
```

**OPTION B**: Add debounce to UI button (less reliable, easier)
```typescript
// In the button handler that calls check()
let debounceTimer: NodeJS.Timeout;
const debouncedCheck = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        this.plugin.operations.check();
    }, 500);
};
```

**[YOUR CHOICE: A or B]**

---

### 3. Fix Sync Function Race Condition

**File**: `src/operations.ts` - `sync()` function (line 418)

Same pattern as check function:

**OPTION A** (Recommended): Use lock flag
```typescript
async sync(controller: Controller, show = true) {
    if (this.plugin.operationState.isSyncing) {
        show && this.plugin.show("Sync already in progress");
        return false;
    }

    this.plugin.operationState.isSyncing = true;

    try {
        // ... existing sync code ...
    } finally {
        // Always clear lock, even on error
        this.plugin.operationState.isSyncing = false;
    }
}
```

**OPTION B**: Reuse status check only
```typescript
// No changes - rely on existing status check only
```

**[YOUR CHOICE: A or B]**

---

### 4. Fix Test Function Race Condition

**File**: `src/operations.ts` - `test()` function

**OPTION A** (Recommended): Use lock flag
```typescript
async test(show: boolean = true) {
    if (this.plugin.operationState.isTesting) {
        return false;
    }

    this.plugin.operationState.isTesting = true;

    try {
        // ... existing test code ...
        return result;
    } finally {
        this.plugin.operationState.isTesting = false;
    }
}
```

**OPTION B**: Test is fast, no lock needed
```typescript
// No changes - test is quick
```

**[YOUR CHOICE: A or B]**

---

### 5. Handle Status Reset After Error

**File**: `src/operations.ts` - multiple locations

Currently when error occurs, status is set to ERROR and stays there. User can't recover.

**OPTION A** (Recommended): Auto-reset after delay
```typescript
// In catch block of check()
catch (error) {
    console.error("CHECK ERROR: ", error);
    show && this.plugin.show(`CHECK ERROR: ${error}`);
    this.plugin.setError(true);
    response ? this.plugin.setStatus(Status.ERROR) : this.plugin.setStatus(Status.OFFLINE);

    // Auto-reset after 3 seconds
    setTimeout(() => {
        if (this.plugin.status === Status.ERROR) {
            this.plugin.setStatus(Status.NONE);
            this.plugin.setError(false);
        }
    }, 3000);

    throw error;
}
```

**OPTION B**: Add "Reset Status" button in UI
```typescript
// In settings.ts or control panel
new Setting(containerEl)
    .setName("Reset Error Status")
    .setDesc("Click if you're stuck in ERROR state")
    .addButton(button => button
        .onClick(() => {
            this.plugin.setStatus(Status.NONE);
            this.plugin.setError(false);
            this.plugin.show("Status reset");
        })
        .setButtonText("Reset")
    );
```

**OPTION C**: Both auto-reset AND manual button
```typescript
// Implement both OPTION A and OPTION B
```

**[YOUR CHOICE: A, B, or C]**

---

### 6. Filter Files Before dangerCheck

**File**: `src/operations.ts` - `dangerCheck()` function (line 652)

The dangerCheck counts `.obsidian` files in deleted list, but our filter should have removed them already.

**VERIFY**: Ensure filtering is working correctly by logging before dangerCheck:

```typescript
const ok = this.dangerCheck();

// ADD LOGGING BEFORE:
this.plugin.log("Deleted files before dangerCheck:", Object.keys(this.plugin.fileTrees.localFiles.deleted));
this.plugin.log("Remote deleted:", Object.keys(this.plugin.fileTrees.remoteFiles.deleted));
```

If `.obsidian` files still appear, the filter isn't working - investigate `compare.ts` filterExclusions.

---

## Implementation Order

1. **[FIRST]** Add `OperationState` interface and property (Change #1)
2. **[SECOND]** Fix check function (Change #2) - this is the main issue
3. **[THIRD]** Fix sync function (Change #3)
4. **[FOURTH]** Fix test function (Change #4)
5. **[FIFTH]** Add status reset mechanism (Change #5)
6. **[VERIFY]** Add logging for dangerCheck debugging (Change #6)

---

## Your Choices

Please fill in your choices:

- **Change #2 (check function)**: [ A or B ]
- **Change #3 (sync function)**: [ A or B ]
- **Change #4 (test function)**: [ A or B ]
- **Change #5 (error reset)**: [ A, B, or C ]

---

## Testing Checklist

After implementing:

- [ ] Rapid-click "Check" button multiple times - should only run once
- [ ] While check is running, try sync - should be blocked
- [ ] Trigger an error (disconnect server) - verify recovery works
- [ ] Verify no `.obsidian` files appear in deleted list
- [ ] Status always returns to NONE after operations complete
