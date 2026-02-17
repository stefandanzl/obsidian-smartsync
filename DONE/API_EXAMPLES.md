# SmartSyncServer API Examples

## Quick Test

```bash
# Check server is running
curl http://127.0.0.1:8080/status

# Expected response:
# {"online":true,"file_count":2}
```

---

## 1. Upload a file (PUT /file/{path})

```bash
curl -X PUT http://127.0.0.1:8080/file/notes/hello.md \
  -H "Content-Type: text/plain" \
  -d "# Hello World"

# Expected response:
# {"success":true}
```

---

## 2. Download a file (GET /file/{path})

```bash
curl http://127.0.0.1:8080/file/notes/hello.md -o downloaded.md

# Expected: File content saved to downloaded.md
```

---

## 3. Delete a file (DELETE /file/{path})

```bash
curl -X DELETE http://127.0.0.1:8080/file/notes/hello.md

# Expected response:
# {"deleted":true}
```

---

## 4. Create a folder (PUT /folder/{path})

```bash
curl -X PUT http://127.0.0.1:8080/folder/notes/new-project

# Expected response:
# {"created":true}
```

---

## 5. Delete a folder (DELETE /folder/{path})

```bash
curl -X DELETE http://127.0.0.1:8080/folder/notes/new-project

# Expected response:
# {"deleted":true}
```

---

## 6. Rename a file or folder (POST /rename)

```bash
curl -X POST http://127.0.0.1:8080/rename \
  -H "Content-Type: application/json" \
  -d '{"type":"file","from":"notes/hello.md","to":"notes/renamed.md"}'

# Expected response:
# {"renamed":true}
```

---

## 7. Get all checksums (GET /checksums)

```bash
curl http://127.0.0.1:8080/checksums

# Expected response:
# {"checksums":{"notes/hello.md":"abc123..."},"file_count":1}
```

---

## 8. Trigger rescan (PUT /checksums)

```bash
curl -X PUT http://127.0.0.1:8080/checksums

# Expected response:
# {"scanned":true,"file_count":1,"checksums":{"notes/hello.md":"abc123..."}}
```

---

## Checksums after operations

```bash
# After any file operation, check checksums.json
curl http://127.0.0.1:8080/status

# file_count should increase/decrease accordingly
```

---

## 9. Create git snapshot (POST /snapshot)

```bash
curl -X POST http://127.0.0.1:8080/snapshot

# Expected response (success):
# {"success":true,"has_changes":true,"files_changed":["notes/hello.md"],"commit_hash":"abc123...","pushed":true,"message":"Changes committed and pushed"}

# Expected response (no changes):
# {"success":true,"has_changes":false,"message":"No changes to commit"}

# Expected response (git not configured):
# {"success":true,"message":"Git not configured"}
```

---

## 10. Pull from remote (POST /git/pull)

```bash
curl -X POST http://127.0.0.1:8080/git/pull

# Expected response (pulled successfully):
# {"success":true,"updated":true,"message":"Pull successful"}

# Expected response (already up to date):
# {"success":true,"up_to_date":true,"message":"Already up to date"}

# Expected response (conflicts detected):
# {"success":false,"updated":true,"conflicted":true,"message":"Pulled but conflicts detected - please resolve manually"}

# Expected response (error):
# {"success":false,"message":"Pull failed","error":"..."}
```

---

## With Authentication (if enabled in config)

```bash
# Add Authorization header
curl -H "Authorization: Bearer your-secret-token-here" \
  http://127.0.0.1:8080/status
```
