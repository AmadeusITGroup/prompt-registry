# Prompt Registry - Quick Start Tutorial

**A practical, step-by-step guide for first-time users.**

This tutorial walks you through installing, configuring, and using the Prompt Registry extension. For feature details and reference documentation, see [README.md](../README.md).

---

## Prerequisites

- VS Code 1.99.3 or higher
- GitHub Copilot installed (for using prompts)
- Optional: GitHub authentication for private repositories

## Installation

See [Installation section in README.md](../README.md#installation) for detailed instructions.

**Quick install**: Open VS Code → Extensions (`Ctrl+Shift+X`) → Search "Prompt Registry" → Install

---

## Your First 5 Minutes

### Step 1: Open the Marketplace (30 seconds)

1. Look for the **Prompt Registry** icon in the Activity Bar (left sidebar)
2. Click it - the marketplace opens automatically
3. You'll see tiles showing available prompt bundles

**What you're seeing**: Pre-configured sources are already loaded. No setup needed!

---

### Step 2: Browse and Search (1 minute)

Try these marketplace features:

**Search**:
- Type keywords in the search box (e.g., "testing", "documentation")
- Search works across bundle names, descriptions, and tags

**Filter by Tags**:
- Click the **Tags** dropdown
- Select tags like `testing`, `qa`, `automation`
- Multiple tags use OR logic (shows bundles with ANY selected tag)

**Filter by Source**:
- Use the **Source** dropdown to show bundles from specific repositories

**Show Installed**:
- Check the **Installed** checkbox to see only what you've installed

---

### Step 3: Install Your First Bundle (2 minutes)

1. **Find a bundle**: Try searching for "testing" or browse by tags
2. **Review details**: Click on a bundle tile to see:
   - Full description
   - Content breakdown (prompts, instructions, chat modes)
   - List of included files
   - Tags and metadata
3. **Install**: Click the **Install** button
4. **Wait**: Installation takes 5-10 seconds
5. **Verify**: The bundle card now shows "✓ Installed" badge

**Where are the files?**
- **macOS**: `~/Library/Application Support/Code/User/prompts/`
- **Linux**: `~/.config/Code/User/prompts/`
- **Windows**: `%APPDATA%\Code\User\prompts\`

GitHub Copilot automatically discovers prompts in these directories.

---

### Step 4: Use Your Prompts in Copilot (30 seconds)

1. Open any file in VS Code
2. Start typing or use Copilot Chat
3. Your installed prompts are now available!

**Testing it**: Type `/<bundle-id>-<prompt-id>` in Copilot Chat and look for your new prompts.

4. Your custom agents are now available to use in Copilot Chat as well.

**Testing it**: Check the dropdown *Agent* in Copilot Chat and look for your new agent.

---

### Step 5: Add Your Own Source (1 minute)

Want to use your team's private repository?

1. Open *Registry Explorer* view
2. Click the *Add Source* button
3. Choose source type:
   - **awesome-copilot**: GitHub collections (recommended for teams)
   - **github**: GitHub releases
   - **local**: Local directory (for offline work)
4. Enter details:
   - **Name**: "My Team Prompts"
   - **URL**: Your repository URL
5. Done! The new source appears in the Source dropdown

**Next section covers authentication for private repositories.**

---

## Common Tasks

Now that you've installed your first bundle, here are everyday operations.

### Uninstall a Bundle

1. Open marketplace
2. Use **Installed** checkbox to show only installed bundles
3. Click on the bundle you want to remove
4. Click **Uninstall**
5. Confirm the action

The bundle is removed from Copilot's prompts directory immediately.

---

### Check for Updates

```
Command Palette → Prompt Registry: Check for Updates
```

Shows which installed bundles have newer versions available.

---

### View Extension Logs

**When to use**: Debugging installation issues or authentication problems.

1. Open Output panel: `View → Output` (or `Ctrl+Shift+U`)
2. Select **Prompt Registry** from the dropdown
3. View detailed logs showing:
   - Authentication attempts
   - Bundle downloads
   - Installation steps
   - Error messages

---

### Validate Repository Access

**When to use**: Testing if authentication is working for private repositories.

```
Command Palette → Prompt Registry: Validate Repository Access
```

This command:
- Tests connection to your configured sources
- Shows authentication status
- Identifies permission issues

---

## Working with Private Repositories

**Scenario**: Your team has a private GitHub repository with prompt collections.

### Understanding the Authentication Chain

The extension automatically tries three authentication methods in order:

#### 1. VS Code GitHub Authentication (Easiest)

**What it is**: If you're already signed into GitHub in VS Code, no additional setup is needed.

**How to check**:
1. Look at VS Code's bottom-left corner for your GitHub avatar
2. If not signed in: Click the account icon → Sign in with GitHub

**Why use it**: Zero configuration, most convenient.

---

#### 2. GitHub CLI (Fallback)

**What it is**: Uses your GitHub CLI authentication if VS Code auth isn't available.

**How to set up**:
1. Install GitHub CLI: https://cli.github.com/
2. Run: `gh auth login`
3. Follow the prompts to authenticate

**Why use it**: Works across multiple tools, good for developers who already use `gh`.

---

#### 3. Explicit Token (Manual)

**What it is**: Provide a personal access token directly to the source.

**How to set up**:
1. Generate token: https://github.com/settings/tokens
2. Select scopes: `repo` (for private repositories)
3. Copy the token
4. When adding source, paste the token in the "Token" field

**Why use it**: Maximum control, works in CI/CD, doesn't require VS Code or gh CLI.

---

### Verify Authentication is Working

**Check the logs**: Open Output panel (`View → Output → Prompt Registry`)

**Success looks like**:
```
[GitHubAdapter] Attempting authentication...
[GitHubAdapter] ✓ Using VSCode GitHub authentication
[GitHubAdapter] Token preview: gho_abc12...
[GitHubAdapter] Request to https://api.github.com/... with auth (method: vscode)
```

**Failure looks like**:
```
[GitHubAdapter] ✗ No authentication available
[GitHubAdapter] HTTP 404: Not Found - Repository not found or not accessible
```

If you see the failure message, try the next authentication method in the chain.

---

## Troubleshooting

### Problem: Bundle Installation Fails

**Symptoms**: Installation hangs, shows error, or never completes

**Step-by-step debugging**:

1. **Check internet connection**
   - Can you access GitHub in your browser?
   - Are you behind a proxy or firewall?

2. **View detailed logs**
   - Open: `View → Output → Prompt Registry`
   - Look for error messages with `[ERROR]` or `✗`
   - Common errors:
     - `ECONNREFUSED` → Network blocked
     - `404 Not Found` → Repository doesn't exist or authentication issue
     - `Permission denied` → File system permissions

3. **For private repositories**
   - Verify authentication (see [Working with Private Repositories](#working-with-private-repositories))
   - Run: `Prompt Registry: Validate Repository Access`
   - Check logs show `✓ Using [auth method] authentication`

4. **Try again**
   - Click **Uninstall** if the bundle shows as partially installed
   - Click **Refresh** in marketplace
   - Try installing again

---

### Problem: "Failed to fetch bundles" Error

**Symptoms**: Marketplace shows no bundles or displays an error message

**Step-by-step debugging**:

1. **Refresh the marketplace**
   - Click the **Refresh** button
   - Wait 5-10 seconds

2. **Check source configuration**
   - Is the URL correct?
   - Does the repository exist?
   - Is it public or private?

3. **Test repository access**
   - Run: `Prompt Registry: Validate Repository Access`
   - Check Output panel for results

4. **For GitHub sources**
   - Verify the repository exists: paste URL in browser
   - Check authentication for private repos

---

### Problem: Authentication Not Working (404/401 Errors)

**Symptoms**: Private repository access fails with 404 or 401 HTTP errors

**Step-by-step debugging**:

1. **Check authentication logs**
   - Open: `View → Output → Prompt Registry`
   - Look for:
     ```
     [GitHubAdapter] ✗ No authentication available
     [GitHubAdapter] HTTP 404: Not Found
     ```

2. **Try each authentication method**:

   **Method 1: VS Code GitHub Authentication**
   - Check bottom-left corner of VS Code for GitHub avatar
   - If not logged in: Click account icon → Sign in with GitHub
   - Verify: `Accounts → GitHub → Signed in as [username]`

   **Method 2: GitHub CLI**
   - Run in terminal: `gh auth status`
   - If not logged in: `gh auth login`

   **Method 3: Explicit Token**
   - Generate token: https://github.com/settings/tokens
   - Ensure `repo` scope is selected
   - Add token when editing the source

3. **Verify token has correct permissions**
   - Token needs `repo` scope for private repositories
   - Check token hasn't expired

---

### Problem: Prompts Not Appearing in Copilot

**Symptoms**: Bundles show as installed but don't appear in GitHub Copilot

**Step-by-step debugging**:

1. **Verify installation directory**
   - **macOS**: `ls ~/Library/Application\ Support/Code/User/prompts/`
   - **Linux**: `ls ~/.config/Code/User/prompts/`
   - **Windows**: `dir %APPDATA%\Code\User\prompts\`
   
   You should see directories for each installed bundle.

2. **Check file contents**
   - Open the bundle directory
   - Verify files exist: `.prompt.md`, `.instructions.md`, or `.chatmode.md`
   - Files should not be empty

3. **Restart VS Code**
   - Close all VS Code windows
   - Reopen VS Code
   - GitHub Copilot rescans the prompts directory on startup

4. **Verify Copilot is enabled**
   - Check Copilot status in status bar
   - Try: `@workspace` in Copilot Chat to see if prompts appear

5. **Check VS Code flavor**
   - Using VS Code Insiders? Directory might be `Code - Insiders`
   - Using Windsurf? Directory might be `Windsurf`
   - Verify with: `Prompt Registry: Show Installation Directory` (if command exists)

---

## Advanced Topics

### Creating Your Own Prompt Collections

**Scenario**: You want to create a custom prompt library for your team.

#### Scaffold a New Project

```
Command Palette → Prompt Registry: Scaffold Awesome-Copilot Project
```

**What it creates**:
```
my-prompts/
├── collections/
│   └── example.collection.yml    # Example collection
├── prompts/
│   └── example.prompt.md         # Example prompt file
├── .github/
│   └── workflows/
│       └── validate-collections.yml  # CI validation
├── scripts/
│   └── validate-collections.js    # Validation script
└── README.md                      # Documentation
```

**Next steps**:
1. Edit `collections/example.collection.yml` with your collection details
2. Add your prompt files to `prompts/`
3. Reference your prompts in the collection file
4. Validate before publishing (see next section)

---

### Validating Your Collections

**Before publishing**, validate your collection files:

```
Command Palette → Prompt Registry: Validate Collections
```

**What it checks**:
- ✅ Required fields (id, name, description)
- ✅ Valid item references
- ✅ File existence
- ✅ YAML syntax
- ✅ ID format (kebab-case)
- ✅ Description length

**Validation output**:
```
✓ Valid: my-collection.collection.yml
  - 5 prompts
  - 2 instructions
  - All files exist

✗ Invalid: broken-collection.collection.yml
  - Missing required field: description
  - File not found: prompts/missing.prompt.md
```

**CI Integration**: The scaffolded project includes GitHub Actions workflow that automatically validates collections on every push.

---

## What's Next?

You've completed the quick start! Here are some ideas for what to do next:

### Explore the Marketplace
- **Try different tags**: Filter by `testing`, `documentation`, `code-review`, etc.
- **Use the Installed filter**: Review what you've installed
- **Check for updates**: Keep your bundles current

### Customize Your Setup
- **Add your team's repository**: Share prompts across your organization
- **Create profiles**: Organize bundles by project or context
- **Build your own collection**: Use the scaffolding tool to start

### Learn More
- 📖 **[README.md](../README.md)** - Full feature reference and documentation
- 🏗️ **[ARCHITECTURE.md](ARCHITECTURE.md)** - System design and technical details
- 🔧 **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** - Contributing and development

### Get Help
- 🐛 [Report Issues](https://github.com/AmadeusITGroup/prompt-registry/issues)
- 💬 [Discussions](https://github.com/AmadeusITGroup/prompt-registry/discussions)
- 📧 Check Output panel for debugging

---

**Happy prompting! 🎉**
