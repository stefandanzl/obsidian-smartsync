# Obsidian SQLite Sync Server - Requirements

## Project Overview

A lightweight Go backend server that serves as a single source of truth for Obsidian vault synchronization. Replaces slow WebDAV PROPFIND operations (4-5s for 3000 files) with fast SQLite queries (<100ms).

### Core Philosophy

- **SQLite is the source of truth** - all data in one `.db` file
- **Git is transport** - in-memory operations for GitHub push/pull
- **Single binary** - no runtime dependencies, easy deployment
- **Fast sync** - <100ms for vault comparison vs 4-5s WebDAV

---

## 1. Core Functionality

### 1.1 Database Schema

#### Files Table

```sql
CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,           -- Relative path from vault root
    content BLOB NOT NULL,               -- File content (binary)
    sha256 TEXT NOT NULL,                -- SHA256 hash of content
    size INTEGER NOT NULL,               -- Content size in bytes
    mtime INTEGER NOT NULL,              -- Modified time (Unix timestamp)
    created_at INTEGER NOT NULL,         -- Creation time
    updated_at INTEGER NOT NULL          -- Last update time
);

CREATE INDEX idx_files_path ON files(path);
CREATE INDEX idx_files_sha256 ON files(sha256);
CREATE INDEX idx_files_mtime ON files(mtime);
```

#### Directories Table

```sql
CREATE TABLE directories (
    path TEXT PRIMARY KEY,               -- Directory path with trailing slash
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

#### Settings Table

```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

### 1.2 HTTP API

#### File Operations

| Method   | Endpoint                       | Description                | Response                               |
| -------- | ------------------------------ | -------------------------- | -------------------------------------- |
| `GET`    | `/api/files`                   | List all files with hashes | `{ files: { "path": "sha256", ... } }` |
| `GET`    | `/api/files?since=<timestamp>` | Incremental file list      | `{ files: {...}, deleted: [...] }`     |
| `GET`    | `/api/file/*`                  | Get single file content    | File content (binary)                  |
| `PUT`    | `/api/file/*`                  | Create/update file         | `{ success: true, sha256: "..." }`     |
| `DELETE` | `/api/file/*`                  | Delete file                | `{ success: true }`                    |
| `GET`    | `/api/directories`             | List all directories       | `{ directories: [..., ...] }`          |

#### Export & Git Operations

| Method | Endpoint               | Description                    | Response                                         |
| ------ | ---------------------- | ------------------------------ | ------------------------------------------------ |
| `POST` | `/api/export`          | Trigger export + git push      | `{ status: "pushed", commit: "..." }`            |
| `POST` | `/api/export?dry=true` | Preview export without pushing | `{ files: [...], size: ... }`                    |
| `GET`  | `/api/git/status`      | Git status info                | `{ branch: "...", commits: ..., remote: "..." }` |
| `GET`  | `/api/git/log`         | Git commit history             | `[{ hash, message, time, author }, ...]`         |

#### Health & Info

| Method | Endpoint      | Description         | Response                                        |
| ------ | ------------- | ------------------- | ----------------------------------------------- |
| `GET`  | `/api/health` | Health check        | `{ status: "ok", version: "..." }`              |
| `GET`  | `/api/stats`  | Database statistics | `{ files: ..., totalSize: ..., lastSync: ... }` |

### 1.3 Git Integration

**Library**: `github.com/go-git/go-git/v5`

#### Push Flow

1. Create in-memory Git repository
2. Read all files from SQLite `files` table
3. Create Git commit with current state
4. Push to remote GitHub repository
5. Discard in-memory repository

#### Pull Flow (future - optional)

1. Clone remote repository to memory
2. Compare with SQLite state
3. Update SQLite with changes
4. Return diff to caller

---

## 2. Configuration

### 2.1 Config File (TOML)

```toml
[server]
host = "127.0.0.1"
port = 8080

[database]
path = "./vault.db"              # Path to SQLite database

[git]
enabled = true
remote_url = "https://github.com/user/repo.git"
branch = "main"
author_name = "Obsidian Sync"
author_email = "sync@example.com"
commit_message = "Auto-sync from Obsidian"

[export]
mode = "manual"                  # "manual" | "cron" | "auto"
# For cron mode:
cron_schedule = "0 */2 * * *"   # Every 2 hours
# For auto mode:
auto_push_after_write = false    # Push after every file write
auto_push_delay_seconds = 30     # Batch writes within 30s

[auth]
api_key = ""                     # Optional: API key for plugin auth
```

### 2.2 Environment Variables

| Variable            | Description            | Required | Default      |
| ------------------- | ---------------------- | -------- | ------------ |
| `VAULT_DB_PATH`     | SQLite database path   | No       | `./vault.db` |
| `VAULT_SERVER_HOST` | Server host            | No       | `127.0.0.1`  |
| `VAULT_SERVER_PORT` | Server port            | No       | `8080`       |
| `VAULT_GIT_REMOTE`  | Git remote URL         | No       | from config  |
| `VAULT_API_KEY`     | API authentication key | No       | empty        |

---

## 3. Obsidian Plugin Integration

### 3.1 Plugin Changes Required

The existing plugin needs to be modified to use the new API instead of WebDAV:

#### Current (WebDAV):

```typescript
const webdavFiles = await webdavClient.getDirectory(rootFolder, "infinity"); // 4-5s
```

#### New (SQLite Sync Server):

```typescript
const response = await fetch("http://localhost:8080/api/files");
const data = await response.json(); // <100ms
```

### 3.2 Plugin API Client

```typescript
class SQLiteSyncClient {
    baseUrl: string;

    async getAllFiles(): Promise<FileList>;
    async getIncrementalFiles(since: number): Promise<IncrementalFileList>;
    async getFile(path: string): Promise<ArrayBuffer>;
    async putFile(path: string, content: ArrayBuffer): Promise<boolean>;
    async deleteFile(path: string): Promise<boolean>;
    async triggerExport(): Promise<ExportResult>;
}
```

### 3.3 Backward Compatibility

- Keep WebDAV mode as fallback option
- Allow users to migrate from WebDAV to SQLite Sync
- Export WebDAV state to SQLite during migration

---

## 4. Performance Requirements

### 4.1 Target Metrics

| Operation            | Target                  | Current (WebDAV) |
| -------------------- | ----------------------- | ---------------- |
| Get all files (3000) | <100ms                  | ~5000ms          |
| Get single file      | <50ms                   | ~100ms           |
| Put file             | <100ms                  | ~200ms           |
| Delete file          | <50ms                   | ~100ms           |
| Export + Git push    | <5s (cold) / <2s (warm) | N/A              |
| Database size        | ~1.2x of raw files      | N/A              |

### 4.2 Concurrency

- Support up to 10 concurrent requests from plugin
- SQLite WAL mode for read concurrency
- Mutex for write operations

---

## 5. Deployment

### 5.1 Build

```bash
# Build for current platform
go build -o vault-sync-server

# Cross-platform builds
GOOS=windows GOARCH=amd64 go build -o vault-sync-server.exe
GOOS=linux GOARCH=amd64 go build -o vault-sync-server
GOOS=darwin GOARCH=amd64 go build -o vault-sync-server-mac
```

### 5.2 Distribution

- Single binary executable
- Optional: installer for Windows (.exe)
- Optional: systemd service for Linux
- Optional: launchd service for macOS

### 5.3 Running

```bash
# With config file
./vault-sync-server -config config.toml

# With environment variables
VAULT_DB_PATH=./vault.db ./vault-sync-server
```

---

## 6. Error Handling

### 6.1 HTTP Status Codes

| Code | Usage                                 |
| ---- | ------------------------------------- |
| 200  | Success                               |
| 201  | Created (PUT)                         |
| 400  | Bad request (invalid path, etc.)      |
| 404  | File not found                        |
| 409  | Conflict (concurrent write)           |
| 500  | Internal server error                 |
| 503  | Service unavailable (Git push failed) |

### 6.2 Database Errors

- Handle SQLite busy errors with retry
- Validate file paths before database operations
- Handle database corruption with rebuild option

### 6.3 Git Errors

- Git push failures should not block database operations
- Log Git errors for troubleshooting
- Retry mechanism for network failures

---

## 7. Security Considerations

### 7.1 API Authentication

- Optional API key in config
- API key via `X-API-Key` header
- Rate limiting for API endpoints

### 7.2 Input Validation

- Validate file paths (no directory traversal)
- Limit file size (configurable, default 100MB per file)
- Sanitize error messages (don't leak paths)

### 7.3 Git Security

- Use SSH or HTTPS with token for Git remote
- Store credentials in config (not in database)
- Support Git credential helpers

---

## 8. Future Enhancements

### 8.1 Phase 2 (Post-MVP)

#### Two-way Sync

- Pull from remote Git repository
- Merge remote changes with local SQLite state
- Conflict detection and resolution API

#### Binary Delta Storage

- Store only changed chunks for large binary files
- Reduce database size for frequently-modified binaries

#### Compression

- Compress file content in SQLite (zstd)
- Configurable compression level
- Trade-off: CPU vs storage

#### Multiple Vaults

- Support multiple vaults in single server
- Namespace-based isolation
- Per-vault Git remotes

#### Web UI

- Simple web interface for vault management
- File browser
- Git history viewer
- Manual conflict resolution

### 8.2 Phase 3 (Advanced)

#### Encryption

- Encrypt database at rest
- Per-file encryption keys
- Client-side encryption support

#### Collaboration Features

- Real-time sync notification (WebSocket)
- Conflict resolution helpers
- Merge visualization

#### Advanced Git Features

- Branch support (experimental vaults)
- Tagging vault states
- Cherry-pick specific file changes

#### Plugins/Extensions

- Plugin system for custom export formats
- Hooks before/after Git operations
- Custom storage backends

### 8.3 Phase 4 (Integration)

#### Obsidian Sync Integration

- Official Obsidian Sync compatibility
- Hybrid sync (local server + cloud)

#### Other Editors

- Support for Logseq, Joplin, etc.
- Generic Markdown vault sync

#### Cloud Storage Integration

- Direct S3 upload (alternative to Git)
- Dropbox API integration
- Google Drive integration

---

## 9. Migration from WebDAV

### 9.1 Migration Tool

Command-line utility to migrate from WebDAV:

```bash
vault-sync migrate \
  --webdav-url "https://dav.example.com" \
  --webdav-user "user" \
  --webdav-pass "pass" \
  --output-db "./vault.db"
```

### 9.2 Migration Steps

1. Scan WebDAV for all files
2. Download each file content
3. Calculate SHA256 hashes
4. Insert into SQLite database
5. Commit to Git (initial commit)
6. Verify integrity

---

## 10. Testing Strategy

### 10.1 Unit Tests

- Database operations (CRUD)
- HTTP handlers
- Git operations (mocked)
- Configuration parsing

### 10.2 Integration Tests

- Full API workflow
- Git push/pull with test repository
- Concurrent request handling
- Database recovery

### 10.3 Performance Tests

- Benchmark file list retrieval
- Benchmark Git push with 10K files
- Memory usage profiling
- Database query optimization

---

## 11. Documentation

### 11.1 User Documentation

- Installation guide
- Configuration reference
- Plugin setup instructions
- Troubleshooting guide

### 11.2 Developer Documentation

- API reference (OpenAPI/Swagger)
- Database schema documentation
- Contribution guidelines
- Architecture diagrams

---

## 12. Dependencies

```
github.com/go-git/go-git/v5
github.com/robfig/cron/v3
modernc.org/sqlite
github.com/BurntSushi/toml
github.com/stretchr/testify
```

---

## 13. License

MIT License - same as existing Obsidian plugin

---

## 14. Project Status

- [ ] Phase 1: Core functionality (MVP)
- [ ] Phase 2: Migration from WebDAV
- [ ] Phase 3: Plugin integration
- [ ] Phase 4: Testing & documentation
- [ ] Phase 5: Future enhancements
