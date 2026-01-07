# Command Reference

This document lists all VS Code commands provided by the Prompt Registry extension.

## Bundle Management

| Command | Title | Description |
|---------|-------|-------------|
| `promptRegistry.viewBundle` | View Bundle Details | View detailed information about a bundle |
| `promptRegistry.updateBundle` | Update Bundle | Update a specific bundle to the latest version |
| `promptRegistry.uninstallBundle` | Uninstall Bundle | Remove an installed bundle |
| `promptRegistry.checkBundleUpdates` | Check for Bundle Updates | Check if updates are available for a bundle |
| `promptRegistry.updateAllBundles` | Update All Bundles | Update all installed bundles to their latest versions |
| `promptRegistry.manualCheckForUpdates` | Check for Updates (Manual) | Manually trigger an update check |
| `promptRegistry.enableAutoUpdate` | Enable Auto-Update | Enable automatic updates for a bundle |
| `promptRegistry.disableAutoUpdate` | Disable Auto-Update | Disable automatic updates for a bundle |

## Version Management

| Command | Title | Description |
|---------|-------|-------------|
| `promptregistry.selectVersion` | Select Version to Install | Choose a specific version of a bundle to install |
| `promptregistry.checkUpdates` | Check for Updates | Check for available updates |
| `promptregistry.update` | Update to Latest Version | Update to the latest version |
| `promptregistry.showVersion` | Show Version Information | Display version information |

## Source Management

| Command | Title | Description |
|---------|-------|-------------|
| `promptRegistry.addSource` | Add Source | Add a new bundle source |
| `promptRegistry.editSource` | Edit Source | Modify an existing source configuration |
| `promptRegistry.removeSource` | Remove Source | Delete a source from the registry |
| `promptRegistry.syncSource` | Sync Source | Synchronize bundles from a specific source |
| `promptRegistry.syncAllSources` | Sync All Sources | Synchronize bundles from all configured sources |
| `promptRegistry.toggleSource` | Toggle Source Enabled/Disabled | Enable or disable a source |

## Profile Management

| Command | Title | Description |
|---------|-------|-------------|
| `promptRegistry.createProfile` | Create New Profile | Create a new bundle profile |
| `promptRegistry.editProfile` | Edit Profile | Modify an existing profile |
| `promptRegistry.activateProfile` | Activate Profile | Activate a profile to install its bundles |
| `promptRegistry.deactivateProfile` | Deactivate Profile | Deactivate a profile |
| `promptRegistry.deleteProfile` | Delete Profile | Remove a profile |
| `promptRegistry.exportProfile` | Export Profile | Export a profile to a file |
| `promptRegistry.importProfile` | Import Profile | Import a profile from a file |
| `promptRegistry.listProfiles` | List All Profiles | Display all available profiles |
| `promptRegistry.toggleProfileView` | Toggle Favorites View | Switch between profile views |
| `promptRegistry.toggleProfileFavorite` | Toggle Favorite | Mark or unmark a profile as favorite |

## Hub Management

| Command | Title | Description |
|---------|-------|-------------|
| `promptregistry.importHub` | Import Hub | Import a hub configuration |
| `promptregistry.listHubs` | List Hubs | Display all configured hubs |
| `promptregistry.syncHub` | Sync Hub | Synchronize with a hub |
| `promptregistry.deleteHub` | Delete Hub | Remove a hub configuration |
| `promptregistry.switchHub` | Switch Hub | Switch to a different hub |
| `promptregistry.exportHubConfig` | Export Hub Configuration | Export hub configuration to a file |
| `promptregistry.openHubRepository` | Open Hub Repository | Open the hub's repository in a browser |

## Hub Profile Management

| Command | Title | Description |
|---------|-------|-------------|
| `promptregistry.listHubProfiles` | List Hub Profiles | Display profiles from a hub |
| `promptregistry.browseHubProfiles` | Browse Hub Profiles | Browse available hub profiles |
| `promptregistry.viewHubProfile` | View Hub Profile | View details of a hub profile |
| `promptregistry.activateHubProfile` | Activate Hub Profile | Activate a hub profile |
| `promptregistry.deactivateHubProfile` | Deactivate Hub Profile | Deactivate a hub profile |
| `promptregistry.showActiveProfiles` | Show Active Hub Profiles | Display currently active hub profiles |
| `promptregistry.checkForUpdates` | Check Hub Profile for Updates | Check for updates to a hub profile |
| `promptregistry.viewProfileChanges` | View Hub Profile Changes | View changes in a hub profile |
| `promptregistry.syncProfileNow` | Sync Hub Profile Now | Immediately sync a hub profile |
| `promptregistry.reviewAndSyncProfile` | Review and Sync Hub Profile | Review changes before syncing |
| `promptregistry.viewSyncHistory` | View Hub Profile Sync History | View synchronization history |
| `promptregistry.rollbackProfile` | Rollback Hub Profile | Revert to a previous profile state |
| `promptregistry.clearSyncHistory` | Clear Hub Profile Sync History | Clear the sync history |

## Collection & Validation

| Command | Title | Description |
|---------|-------|-------------|
| `promptRegistry.createCollection` | Create New Collection | Create a new prompt collection |
| `promptRegistry.validateCollections` | Validate Collections | Validate collection YAML files |
| `promptRegistry.validateCollectionsWithRefs` | Validate Collections (Check File References) | Validate collections including file references |
| `promptRegistry.validateApm` | Validate APM Package | Validate an APM package |
| `promptRegistry.listCollections` | List All Collections | Display all collections |

## Scaffolding & Resources

| Command | Title | Description |
|---------|-------|-------------|
| `promptRegistry.scaffoldProject` | Scaffold Project | Create a new project from a template |
| `promptRegistry.addResource` | Add Resource | Add a prompt, instruction, agent, or skill |

## Settings & Configuration

| Command | Title | Description |
|---------|-------|-------------|
| `promptRegistry.exportSettings` | Export Settings | Export extension settings to a file |
| `promptRegistry.importSettings` | Import Settings | Import extension settings from a file |
| `promptRegistry.openSettings` | Open Settings | Open extension settings |

## Authentication & Access

| Command | Title | Description |
|---------|-------|-------------|
| `promptregistry.validateAccess` | Validate Repository Access | Validate access to a repository |
| `promptregistry.forceGitHubAuth` | Force GitHub Authentication | Force re-authentication with GitHub |

## Utilities

| Command | Title | Description |
|---------|-------|-------------|
| `promptregistry.showHelp` | Show Help Documentation | Display help documentation |
| `promptregistry.openItemRepository` | Open Repository | Open an item's repository in a browser |
| `promptRegistry.resetFirstRun` | Reset First Run | Reset first-run state to re-trigger hub selection dialog |

## See Also

- [Settings Reference](./settings.md) — Extension configuration options
- [Getting Started](../user-guide/getting-started.md) — Installation and first steps
