# Obsidian SmartSync Plugin

A powerful bidirectional synchronization plugin for Obsidian that keeps your vault in sync across multiple devices using a self-hosted backend.

> **Note:** This plugin requires [SmartSyncServer](https://github.com/stefandanzl/smartsyncserver) - a custom backend that can be easily deployed with Docker.

## Features

### Core Synchronization
- **Bidirectional Sync** – Keep your vault in sync both ways, with intelligent conflict detection
- **Live Sync (Mod Sync)** – Automatically sync files as soon as you edit them
- **Auto Sync** – Configure interval-based automatic synchronization
- **Push/Pull** – Force one-directional sync when needed

### Intelligent File Management
- **Hash-Based Comparison** – Efficient change detection using SHA-256 checksums
- **Visual Diff Modal** – See file differences before resolving conflicts
- **Selective Sync** – Choose specific files to sync instead of everything
- **Exception Handling** – Manually resolve sync conflicts with per-file control
- **File Exclusions** – Use `.gitignore` style patterns to exclude files

### User Experience
- **Control Panel Modal** – Visual interface for managing sync operations
- **Status Indicators** – Real-time sync status in the status bar
- **Debug Mode** – Enable verbose logging for troubleshooting
- **Mobile Optimized** – Skip `.obsidian` sync on mobile for faster performance

### Daily Notes Integration
- **Remote Daily Notes** – Create daily notes that sync across devices
- **Custom Format** – Configure folder structure and naming templates
- **Timestamp Insertion** – Optionally add timestamps when opening daily notes

## What Makes SmartSync Different

| Feature | SmartSync | Typical Git Sync | Cloud Storage |
|---------|-----------|------------------|---------------|
| **Real-time sync** | ✅ Yes (Mod Sync) | ❌ No | ⚠️ Depends on provider |
| **Conflict resolution** | ✅ Visual diff modal | ❌ Manual merge | ⚠️ Last write wins |
| **Selective sync** | ✅ Per-file selection | ❌ All or nothing | ⚠️ Limited |
| **Self-hosted** | ✅ Your server | ✅ Any git host | ❌ Third-party required |
| **No file locking** | ✅ Smart hashing | ⚠️ Merge conflicts | ⚠️ Lock files |
| **Battery efficient** | ✅ Hash-based | ⚠️ Constant polling | ⚠️ Constant polling |

## Installation

### 1. Deploy SmartSyncServer

The backend can be easily deployed using Docker:

```bash
docker pull ghcr.io/stefandanzl/smartsyncserver:latest
docker run -d -p 443:443 -v /path/to/data:/app/data ghcr.io/stefandanzl/smartsyncserver:latest
```

See [SmartSyncServer GitHub](https://github.com/stefandanzl/smartsyncserver) for more deployment options and configuration.

### 2. Install the Plugin

1. Download the latest release from the [Releases](../../releases) page
2. Extract to your Obsidian vault's plugins folder: `.obsidian/plugins/obsidian-smartsync/`
3. Enable the plugin in Obsidian settings
4. Configure your server URL and port in the plugin settings

## Usage

1. **Configure Connection** – Enter your SmartSyncServer URL and port
2. **Check for Changes** – Click "🔄 Reload" to scan for file differences
3. **Review Changes** – See added, modified, and deleted files grouped by Local/Remote
4. **Select Files** – Check/uncheck individual files to control what gets synced
5. **Sync** – Click "🔄 Sync" to synchronize selected files

### Sync Modes

- **Full Sync** – Syncs all changes (added, modified, deleted) in both directions
- **Push** – Upload all local changes to remote
- **Pull** – Download all remote changes to local
- **Replicate Local→Remote** – Replace remote with local state
- **Replicate Remote→Local** – Replace local with remote state

## Settings

| Setting | Description |
|---------|-------------|
| **Server URL** | Your SmartSyncServer address |
| **Server Port** | Port number (default: 443) |
| **Auth Token** | Optional bearer token for authentication |
| **Ignore Patterns** | `.gitignore` style exclusion patterns |
| **Mod Sync** | Enable sync on file modification |
| **Auto Interval Sync** | Enable periodic automatic sync |
| **Debug Mode** | Enable verbose console logging |

## Development

Built with TypeScript and Obsidian API. The plugin uses a custom client-server protocol over HTTPS for secure file synchronization.

## License

MIT
