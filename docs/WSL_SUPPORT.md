# WSL Support

The Prompt Registry extension now fully supports Windows Subsystem for Linux (WSL) environments.

## Background

When VS Code is connected to a WSL remote window:
- The extension runs in the **WSL (Linux) context**
- GitHub Copilot runs in the **Windows UI context**
- Prompts must be synced to the **Windows filesystem** for Copilot to access them

## How It Works

The extension automatically detects WSL remote connections using `vscode.env.remoteName` and:

1. **Detects the Windows username** via `cmd.exe /c echo %USERNAME%`
2. **Maps to Windows filesystem** via WSL mount points (`/mnt/c/`, `/mnt/d/`, etc.)
3. **Syncs prompts to Windows directory**: `/mnt/c/Users/{username}/AppData/Roaming/Code/User/prompts`

## Supported Scenarios

### ✅ Scenario A: Windows Mount Storage
When VS Code uses Windows-mounted storage:
```
globalStoragePath: /mnt/c/Users/username/AppData/Roaming/Code/User/globalStorage/...
→ Prompts synced to: /mnt/c/Users/username/AppData/Roaming/Code/User/prompts
```

### ✅ Scenario B: WSL Remote Storage
When VS Code uses WSL remote storage:
```
globalStoragePath: /home/username/.vscode-server/data/User/globalStorage/...
→ Prompts synced to: /mnt/c/Users/{windows-username}/AppData/Roaming/Code/User/prompts
```

## Edge Cases Handled

### Different Usernames
If your WSL username differs from Windows username:
- Extension executes `cmd.exe /c echo %USERNAME%` to get actual Windows username
- Fallback: Uses WSL username if command fails

### Multiple Drive Letters
If Windows is installed on D: or other drive:
- Extension checks `/mnt/c/`, `/mnt/d/`, `/mnt/e/`, `/mnt/f/` in priority order
- Uses first accessible drive with `Users/{username}/AppData/Roaming`

### VS Code Flavors
Automatically detects and supports:
- VS Code Stable (`Code`)
- VS Code Insiders (`Code - Insiders`)
- Windsurf (`Windsurf`)
- Cursor (`Cursor`)

### VS Code Profiles
Profile-based installations are fully supported:
```
→ Prompts synced to: /mnt/c/Users/username/AppData/Roaming/Code/User/profiles/{profile-id}/prompts
```

## Other Remote Types

- **SSH Remote** (`remoteName === 'ssh-remote'`): Uses existing logic (not WSL-specific)
- **Local** (`remoteName === undefined`): Uses platform-native paths (Windows/macOS/Linux)

## Troubleshooting

### Prompts not appearing in Copilot chat

**Symptoms**: Downloaded collections don't show in Copilot when working in WSL project

**Solutions**:
1. Check VS Code Output panel → "Prompt Registry" for WSL detection logs
2. Verify Windows username detection: Look for `WSL: Windows username from cmd.exe:`
3. Ensure Windows AppData directory is accessible from WSL: `ls /mnt/c/Users/{username}/AppData/Roaming/Code/User/prompts`
4. Check permissions on Windows prompts directory
5. Restart VS Code after installing collections

### Permission Errors

If you see `EACCES: permission denied` errors:
- Ensure Windows user has write access to `C:\Users\{username}\AppData\Roaming\Code\User\prompts`
- Check if antivirus is blocking WSL file access
- Verify WSL mount is accessible: `ls /mnt/c/Users`

### Wrong Drive Letter

If extension uses wrong drive (e.g., C: instead of D:):
- Extension checks drives in order: C → D → E → F
- Manually create directory if needed: `mkdir -p /mnt/d/Users/{username}/AppData/Roaming/Code/User/prompts`
- Check logs for drive detection: `WSL: Found Windows drive:`

## Technical Details

### Detection Method
```typescript
if (vscode.env.remoteName === 'wsl') {
    // Use WSL-specific logic
}
```

### Username Detection
```bash
# Primary method
cmd.exe /c echo %USERNAME%

# Fallback methods
process.env.LOGNAME
process.env.USER
os.userInfo().username
```

### Drive Detection
Checks in priority order:
1. `/mnt/c/Users/{username}/AppData/Roaming` (most common)
2. `/mnt/d/Users/{username}/AppData/Roaming`
3. `/mnt/e/Users/{username}/AppData/Roaming`
4. `/mnt/f/Users/{username}/AppData/Roaming`

## Related Issues

- [Issue #22: WSL Support](https://github.com/AmadeusITGroup/prompt-registry/issues/22)

## Testing

Comprehensive unit tests cover:
- WSL with `/mnt/c/` mount paths
- WSL with `/mnt/d/` (alternate drive)
- WSL with Code Insiders flavor
- WSL with profile-based paths
- Local context (non-WSL)
- SSH remote context

See `test/services/CopilotSyncService.test.ts` → "WSL Support" suite.
