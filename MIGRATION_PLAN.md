# SmartSync Migration Plan

## Overview

Migrate the Obsidian plugin from WebDAV protocol to SmartSyncServer REST API.

**Current State:** WebDAV-based sync plugin (`id: webdav`, class: `Cloudr`)
**Target State:** SmartSync plugin using SmartSyncServer API

---

## API Reference (SmartSyncServer)

Server is self hosted configurable URL:port (default: `127.0.0.1:443`)
(likely to be behind nginx reverse proxy and a custom domain)

| Endpoint         | Method | Description                                |
| ---------------- | ------ | ------------------------------------------ |
| `/status`        | GET    | Check if server is online, get file count  |
| `/file/{path}`   | PUT    | Upload a file                              |
| `/file/{path}`   | GET    | Download a file                            |
| `/file/{path}`   | DELETE | Delete a file                              |
| `/folder/{path}` | PUT    | Create a folder                            |
| `/folder/{path}` | DELETE | Delete a folder                            |
| `/rename`        | POST   | Rename file/folder (JSON body)             |
| `/checksums`     | GET    | Get all file checksums                     |
| `/checksums`     | PUT    | Trigger rescan                             |
| `/snapshot`      | POST   | Create git snapshot                        |
| `/git/pull`      | POST   | Pull from remote git                       |
| _Auth_           | Header | `Authorization: Bearer {token}` (optional) |

---

## Implementation Tasks

### 1. Branding Changes

- [ ] **manifest.json**
    - Change `id: "webdav"` → `id: "smartsync"`
    - Change `name: "Webdav"` → `name: "SmartSync"`
    - Update description
    - Bump version to `2.0.0`

- [ ] **Class and variable names**
    - `Cloudr` → `SmartSync`
    - `WebDAVClient` → `SmartSyncClient`
    - `webdavClient` → `smartSyncClient`
    - `baseWebdav` → `baseRemotePath`
    - `webdavFiles` → `remoteFiles`

- [ ] **File names** (optional, can defer)
    - `webdav.ts` → `smartSync.ts`

### 2. Settings Changes

Current settings (settings.ts):

- Webdav URL
- Webdav Username
- Webdav Password
- Webdav Base Directory

**New settings:**

- SmartSync Server URL (default: `127.0.0.1`)
- SmartSync Server Port (default: `443`)
- Auth Token (optional, Bearer token)
- Base Directory (keep existing)

**Remove:**

- Username/Password (no longer used)

### 3. Create SmartSyncClient

New file: `src/smartSync.ts` (or replace `src/webdav.ts`)

**Methods to implement:**

| Current WebDAV Method       | New SmartSync Method        | Notes                    |
| --------------------------- | --------------------------- | ------------------------ |
| `get(path)`                 | `getFile(path)`             | GET /file/{path}         |
| `put(path, content)`        | `uploadFile(path, content)` | PUT /file/{path}         |
| `delete(path)`              | `deleteFile(path)`          | DELETE /file/{path}      |
| `createDirectory(path)`     | `createFolder(path)`        | PUT /folder/{path}       |
| `deleteDirectory(path)`     | `deleteFolder(path)`        | DELETE /folder/{path}    |
| `getDirectory(path, depth)` | _replaced by_               | Use `/checksums` instead |
| `propfind(path, depth)`     | _replaced by_               | Use `/checksums` instead |
| `exists(path)`              | `getStatus()`               | GET /status              |
| `move(from, to)`            | _deferred_                  | POST /rename (future)    |

### 4. Checksum Module Rewrite

File: `src/checksum.ts`

**Current flow:** WebDAV PROPFIND → parse XML → extract checksums

**New flow:** `GET /checksums` → parse JSON → extract checksums

Key changes:

- Remove `refineObject()` (XML parsing)
- Remove `generateWebdavHashTree()` WebDAV logic
- Add `generateRemoteHashTree()` using `/checksums` endpoint
- `generateLocalHashTree()` remains mostly unchanged

Expected response from `/checksums`:

```json
{
    "checksums": {
        "notes/hello.md": "abc123...",
        "notes/other.md": "def456..."
    },
    "file_count": 2
}
```

### 5. Operations Module Update

File: `src/operations.ts`

**Methods to update:**

- `configWebdav()` → `configSmartSync()`
- `downloadFiles()` - adapt to SmartSyncClient
- `uploadFiles()` - adapt to SmartSyncClient
- `deleteFilesWebdav()` → `deleteFilesRemote()`
- `downloadWithRetry()` - update for new client
- `uploadFile()` - update for new client
- `ensureRemoteDirectory()` - update for new client
- `test()` - use `/status` endpoint

### 6. Main Plugin Class

File: `src/main.ts`

**Rename:**

- Class `Cloudr` → `SmartSync`
- `webdavClient: WebDAVClient` → `smartSyncClient: SmartSyncClient`
- `baseWebdav: string` → `baseRemotePath: string`
- `webdavFiles: FileList` → `remoteFiles: FileList`

**Update:**

- `setClient()` → initialize SmartSyncClient with URL + port
- `setBaseWebdav()` → `setBaseRemotePath()`

### 7. Constants & Types

File: `src/const.ts`

**Update/Remove:**

- Remove `WebDAVDirectoryItem` (no longer needed)
- Add SmartSync response types if needed
- Update any remaining "webdav" strings

### 8. Settings UI

File: `src/settings.ts`

**Replace inputs:**

- "Webdav URL" → "SmartSync Server URL"
- Remove "Webdav Username"
- Remove "Webdav Password"
- Add "SmartSync Server Port" (default: 443)
- Add "Auth Token"

**Keep:**

- Base Directory
- Override remote Vault Name
- Excluded Directories
- Excluded file extensions
- Excluded filename markers
- Mod Sync
- Auto Interval Sync
- Enable Ribbons
- Skip .obsidian sync options
- Daily Notes settings

### 9. Setup & Initialization

File: `src/setup.ts`

- Update import from `./settings` (CloudrSettingsTab → SmartSyncSettingsTab)
- Update any remaining "webdav" references

---

## Deferred (Future Features)

- Git integration (`/snapshot`, `/git/pull` endpoints)
- Rename/move operations (`POST /rename`)

---

## Testing Checklist

- [ ] Connection test works with new settings
- [ ] Checksum retrieval from `/checksums`
- [ ] File upload (PUT /file)
- [ ] File download (GET /file)
- [ ] File deletion (DELETE /file)
- [ ] Folder creation (PUT /folder)
- [ ] Folder deletion (DELETE /folder)
- [ ] Full sync cycle works
- [ ] Live sync works
- [ ] Auto sync works
- [ ] Exclusions still work
- [ ] Settings persist correctly

---

## Breaking Changes for Users

1. **Settings reset required** - users will need to reconfigure server URL/port
2. **No more username/password** - auth token (if needed) instead
3. **Requires SmartSyncServer running** - won't work with WebDAV servers anymore

---

## Migration Strategy

1. Branch off from `webdav-legacy` (already done)
2. Implement all changes on `main` branch
3. Test thoroughly
4. Release as v2.0.0 (major version bump due to breaking changes)

After finished implementation:
Add some mocking of Obsidian functions features to allow testing of components outside of Obsidian.
