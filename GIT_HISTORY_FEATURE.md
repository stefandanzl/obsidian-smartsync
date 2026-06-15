# Git History Feature Specification

## Overview

Create a comprehensive git history explorer for SmartSync that allows users to browse file history, explore commits, restore deleted files, and view vault-wide changes chronologically. This feature transforms SmartSync from a simple sync tool into a complete version control interface for Obsidian vaults.

---

## Architecture

### Components

1. **FileHistoryModal** - Universal history browser (4 view types)
2. **Server Git Extensions** - New git history functions in `git.go`
3. **HTTP Endpoints** - New API routes in `handlers.go`
4. **Client Integration** - Context menu entry points

### Access Points

- **FileTreeModal** → Right-click file → "Show History"
- **Context menu** on any vault file → "Show History"  
- **Future**: Keyboard shortcut for quick access

---

## FileHistoryModal Design

### Structure

```
FileHistoryModal (universal history browser)
├── Tab Navigation
│   ├── [Commits] - Current file history
│   ├── [Explorer] - Directory browser at commit
│   ├── [Trash] - Deleted files chronologically  
│   └── [All Changes] - Vault-wide change timeline
├── View-specific Toggles
└── Content Area (paginated)
```

### View Types

#### 1. Commit View
**Purpose**: Show commit history for specific file (current or deleted)

**Features**:
- Paginated commit list (20 per page)
- Each commit shows:
  - Commit hash
  - Date/time
  - Author (SmartSyncServer)
  - Commit message
  - Files changed in this commit
- Toggle: `Diff View | Full Content`
- Click commit → show file content at that point
- Restore button for each commit

**Interaction Flow**:
```
Click file → Load Commit View → Paginated commits → Click commit → Show content
```

#### 2. Explorer View  
**Purpose**: Browse full directory structure at any commit point

**Features**:
- Shows complete file tree as it existed at commit
- Click directories to traverse
- Click files → load their commit history
- Commit selector at top (choose any point in time)
- Shows file sizes and modification dates

**Interaction Flow**:
```
Select commit → Browse directories → Click file → Load its history
```

#### 3. Trash View
**Purpose**: Chronological list of all deleted files across vault history

**Features**:
- Lists all files that were ever deleted
- Shows deletion date/time
- Shows which commit deleted the file
- Chronological order (newest first)
- Click deleted file → load its full history
- Restore button for each deletion

**Interaction Flow**:
```
Browse Trash → Click deleted file → See its history → Choose commit → Restore
```

#### 4. All Changes View
**Purpose**: Vault-wide chronological change timeline

**Features**:
- Every file change across entire repository
- Toggle: `Show Duplicates | Unique Files Only`
  - **Show Duplicates**: Same file appears multiple times as it changes
  - **Unique Files**: Each file listed once (most recent change only)
- Shows commit, date, files affected
- Click any file → load its history
- Click any commit → see all files changed in that commit

**Interaction Flow**:
```
Browse timeline → Click change → See affected files → Click file → Load history
```

---

## Server Implementation

### New Git Functions (`git.go`)

```go
// Get commit history for specific file (paginated)
func (m *Manager) GetFileHistory(path string, page, limit int) (*FileHistoryResult, error)

// Get directory listing at specific commit
func (m *Manager) GetTreeAtCommit(commitHash, path string) (*TreeResult, error)

// Get file content at specific commit
func (m *Manager) GetFileAtCommit(commitHash, path string) ([]byte, error)

// Get all deleted files chronologically (paginated)
func (m *Manager) GetDeletedFiles(page, limit int) (*DeletedFilesResult, error)

// Get all changes across repository (paginated)
func (m *Manager) GetAllChanges(page, limit int, showDuplicates bool) (*AllChangesResult, error)

// Get diff between two commits for specific file
func (m *Manager) GetFileDiff(commitHash, path string) (*DiffResult, error)

// Restore file to specific commit state
func (m *Manager) RestoreFile(commitHash, path string) error
```

### Response Types

```go
type FileHistoryResult struct {
    Path      string        `json:"path"`
    Commits   []CommitInfo  `json:"commits"`
    Total     int           `json:"total"`
    Page      int           `json:"page"`
    HasMore   bool          `json:"has_more"`
}

type CommitInfo struct {
    Hash      string    `json:"hash"`
    Message   string    `json:"message"`
    Author    string    `json:"author"`
    Date      time.Time `json:"date"`
    Files     []string  `json:"files,omitempty"`
}

type TreeResult struct {
    Commit    string           `json:"commit"`
    Path      string           `json:"path"`
    Entries   []TreeEntry      `json:"entries"`
}

type TreeEntry struct {
    Name     string    `json:"name"`
    Path     string    `json:"path"`
    IsFile   bool      `json:"is_file"`
    Size     int64     `json:"size"`
    Modified time.Time `json:"modified"`
}

type DeletedFilesResult struct {
    Files    []DeletedFileInfo `json:"files"`
    Total    int               `json:"total"`
    Page     int               `json:"page"`
    HasMore  bool              `json:"has_more"`
}

type DeletedFileInfo struct {
    Path         string    `json:"path"`
    DeletedHash  string    `json:"deleted_hash"`
    DeletedDate  time.Time `json:"deleted_date"`
    LastCommit   string    `json:"last_commit"`
    LastDate     time.Time `json:"last_date"`
}

type AllChangesResult struct {
    Changes   []ChangeInfo `json:"changes"`
    Total     int           `json:"total"`
    Page      int           `json:"page"`
    HasMore   bool          `json:"has_more"`
}

type ChangeInfo struct {
    Commit     string    `json:"commit"`
    Date       time.Time `json:"date"`
    Message    string    `json:"message"`
    Files      []string  `json:"files"`
    Action     string    `json:"action"` // "added", "modified", "deleted"
}

type DiffResult struct {
    Path      string       `json:"path"`
    OldCommit string       `json:"old_commit"`
    NewCommit string       `json:"new_commit"`
    Diffs     []FileDiff   `json:"diffs"`
}

type FileDiff struct {
    Path     string `json:"path"`
    Added    string `json:"added,omitempty"`
    Removed  string `json:"removed,omitempty"`
    IsBinary bool   `json:"is_binary"`
}
```

### New HTTP Endpoints (`handlers.go`)

```
# File History (paginated)
GET /file/{path}/history?page=1&limit=20
→ Returns: FileHistoryResult

# Directory at commit
GET /git/tree?commit=abc123&path=/folder
→ Returns: TreeResult

# File content at commit  
GET /git/file?commit=abc123&path=file.md
→ Returns: file content (raw or JSON with metadata)

# Deleted files (paginated)
GET /git/deleted?page=1&limit=20
→ Returns: DeletedFilesResult

# All changes (paginated)
GET /git/changes?page=1&limit=20&duplicates=true
→ Returns: AllChangesResult

# Diff for file at commit
GET /git/diff?commit=abc123&path=file.md
→ Returns: DiffResult

# Restore file to commit state
POST /git/restore
Body: {"commit": "abc123", "path": "file.md"}
→ Returns: {"success": true, "restored": "file.md"}
```

---

## Binary Data Handling

### Detection Strategy

```typescript
// Detect content type
function getContentType(path: string, content: ArrayBuffer): 'text' | 'binary' {
    const ext = path.split('.').pop()?.toLowerCase();
    
    // Text files
    const textExts = ['md', 'txt', 'json', 'yaml', 'yml', 'js', 'ts', 'css', 'html'];
    if (textExts.includes(ext)) return 'text';
    
    // Known binary types
    const binaryExts = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'mp3', 'mp4'];
    if (binaryExts.includes(ext)) return 'binary';
    
    // Binary detection by content
    const decoder = new TextDecoder();
    const text = decoder.decode(content.slice(0, 1024));
    return text.match(/[\x00-\x08\x0E-\x1F]/) ? 'binary' : 'text';
}
```

### Display Strategies

**Text Files**:
- Show full content with syntax highlighting
- Diff view shows side-by-side or unified diff
- Copy to clipboard button
- Download button

**Binary Files**:
- Show metadata (size, type, last modified)
- Images: Preview thumbnail + download
- PDFs/Other: Download button + file info
- Cannot show diff, only "file changed" indicator

---

## Client Implementation

### FileHistoryModal Structure

```typescript
class FileHistoryModal extends Modal {
    private currentView: 'commits' | 'explorer' | 'trash' | 'all-changes';
    private currentFile: string;
    private currentCommit: string;
    private pagination: { page: number; hasMore: boolean };
    
    // View modes
    private showDuplicates: boolean = true;
    private diffMode: boolean = true;
    
    // Content caching
    private commitCache: Map<string, CommitInfo[]>;
    private fileContentCache: Map<string, ArrayBuffer>;
    
    constructor(app: App, plugin: SmartSyncPlugin, filePath?: string);
    
    // View switching
    private switchToCommitsView(filePath: string);
    private switchToExplorerView(commitHash: string);
    private switchToTrashView();
    private switchToAllChangesView();
    
    // Content loading
    private async loadFileHistory(path: string, page: number);
    private async loadTreeAtCommit(commit: string, path: string);
    private async loadDeletedFiles(page: number);
    private async loadAllChanges(page: number, showDuplicates: boolean);
    
    // File operations
    private async loadFileAtCommit(commit: string, path: string);
    private async restoreFile(commit: string, path: string);
    
    // UI rendering
    private renderCommitsView();
    private renderExplorerView();
    private renderTrashView();
    private renderAllChangesView();
    private renderFileContent(content: ArrayBuffer, path: string);
    private renderDiff(diff: DiffResult);
}
```

### Context Menu Integration

```typescript
// Register in main.ts
this.registerEvent(
    this.app.workspace.on("file-menu", (menu: Menu, file: TFile) => {
        menu.addItem((item) => {
            item
                .setTitle("Show History")
                .setIcon("history")
                .onClick(() => {
                    new FileHistoryModal(this.app, this, file.path).open();
                });
        });
    })
);
```

### Lazy Loading Strategy

1. **Initial Load**: Only fetch commit metadata (lightweight)
2. **On Click**: Fetch actual file content/diff (cached after first load)
3. **Pagination**: Load commits in pages of 20
4. **Memory Management**: Clear cache when modal closes, keep recent 50 items

---

## Implementation Phases

### Phase 1: Core Git Functions (Server)
- Implement git history functions in `git.go`
- Add HTTP endpoints in `handlers.go`
- Test with curl/Postman

### Phase 2: Basic FileHistoryModal (Client)
- Create FileHistoryModal with Commit View
- Implement pagination
- Add file content display
- Test with text files

### Phase 3: Additional Views
- Implement Explorer View
- Implement Trash View  
- Implement All Changes View
- Add view switching

### Phase 4: Advanced Features
- Diff viewing (diffMode toggle)
- Binary file handling
- Restore functionality
- Error handling and edge cases

### Phase 5: Polish
- Performance optimization
- UI improvements
- Keyboard shortcuts
- Mobile responsiveness

---

## Technical Considerations

### Performance

- **Pagination**: Essential for large repositories (1000+ commits)
- **Lazy Loading**: Only fetch content when user clicks
- **Caching**: Cache frequently accessed commits/contents
- **Debouncing**: Debounce rapid page changes

### Edge Cases

- **File renamed**: Track renames in git history
- **Large files**: Show progress indicator for content loading
- **Merge conflicts**: Handle conflicted commits gracefully
- **Empty repositories**: Show appropriate empty states
- **Network errors**: Graceful fallback and retry logic
- **Binary corruption**: Validate file contents

### Security

- **Path traversal**: Validate all file paths
- **Commit injection**: Validate commit hashes
- **Access control**: Ensure only vault files are accessible
- **Size limits**: Prevent loading huge files

---

## Testing Strategy

### Server Tests

- Test pagination with various repository sizes
- Test binary file detection and handling
- Test deleted file retrieval across renames
- Test diff generation with various file types
- Test restore functionality

### Client Tests  

- Test view switching and state management
- Test pagination navigation
- Test content caching behavior
- Test error handling (network failures)
- Test binary file display
- Test restore confirmation dialogs

### Integration Tests

- Test full workflow: open modal → browse → restore
- Test with actual vault (various file types)
- Test with large repository (performance)
- Test with deleted files recovery
- Test cross-platform compatibility

---

## Future Enhancements

### Potential Additions

- **Branch switching**: Support multiple branches
- **Commit search**: Full-text search in commit messages
- **File annotations**: Blame view showing who changed each line
- **Time comparison**: Compare file state between any two time points
- **Export history**: Export file history as JSON/PDF
- **Conflict resolution**: Advanced merge tools for conflicts
- **Collaborative features**: Show commits by different authors
- **Graph visualization**: Visual commit graph with branches

---

## Success Criteria

### Must Have (MVP)

- ✅ View file history with pagination
- ✅ Show file content at specific commits
- ✅ Browse deleted files
- ✅ Restore files from history
- ✅ Handle both text and binary files
- ✅ Basic error handling

### Should Have (Complete)

- ✅ All four view types implemented
- ✅ Diff view functionality
- ✅ Explorer navigation
- ✅ All changes timeline
- ✅ Performance optimization
- ✅ Mobile responsive

### Could Have (Enhanced)

- Advanced search/filter
- Keyboard shortcuts
- Visual commit graph
- Branch management
- Export capabilities

---

## Notes

- **go-git package**: Already integrated, use existing functionality
- **Performance**: Pagination and lazy loading are critical for large repos
- **User Experience**: Keep views simple and intuitive, avoid overwhelming information
- **Testing**: Thorough testing needed for edge cases (renames, conflicts, large files)
- **Backwards Compatibility**: Ensure existing sync functionality remains unaffected