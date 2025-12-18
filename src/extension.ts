import * as vscode from 'vscode';
import { RegistryManager } from './services/RegistryManager';
import { RegistryTreeProvider } from './ui/RegistryTreeProvider';
import { MarketplaceViewProvider } from './ui/MarketplaceViewProvider';
import { ProfileCommands } from './commands/ProfileCommands';
import { SourceCommands } from './commands/SourceCommands';
import { BundleCommands } from './commands/BundleCommands';
import { HubCommands } from './commands/HubCommands';
import { HubProfileCommands } from './commands/HubProfileCommands';
import { HubIntegrationCommands } from './commands/HubIntegrationCommands';
import { HubManager } from './services/HubManager';
import { getEnabledDefaultHubs } from './config/defaultHubs';
import { HubStorage } from './storage/HubStorage';
import { SchemaValidator } from './services/SchemaValidator';
import { SettingsCommands } from './commands/SettingsCommands';
import { ScaffoldCommand, ScaffoldType } from './commands/ScaffoldCommand';
import { AddResourceCommand } from './commands/AddResourceCommand';
import { ValidateCollectionsCommand } from './commands/ValidateCollectionsCommand';
import { ValidateApmCommand } from './commands/ValidateApmCommand';
import { CreateCollectionCommand } from './commands/CreateCollectionCommand';
import { GitHubAuthCommand } from './commands/GitHubAuthCommand';
import { StatusBar } from './ui/statusBar';
import { ExtensionNotifications } from './notifications/ExtensionNotifications';
import { Logger } from './utils/logger';
import { McpConfigLocator } from './utils/mcpConfigLocator';
import { CopilotIntegration } from './integrations/CopilotIntegration';
import { UpdateScheduler } from './services/UpdateScheduler';
import { UpdateChecker } from './services/UpdateChecker';
import { NotificationManager } from './services/NotificationManager';
import { AutoUpdateService } from './services/AutoUpdateService';
import { BundleUpdateNotifications } from './notifications/BundleUpdateNotifications';

import {
    getValidUpdateCheckFrequency,
    getValidNotificationPreference
} from './utils/configTypeGuards';

import { ApmRuntimeManager } from './services/ApmRuntimeManager';
import { OlafRuntimeManager } from './services/OlafRuntimeManager';

// Module-level variable to store the extension instance for deactivation
let extensionInstance: PromptRegistryExtension | undefined;

// Legacy imports (to be migrated)
import { selectVersionCommand } from './commands/selectVersionCommand';
import { UpdateCommand } from './commands/updateCommand';
import { StatusCommand } from './commands/statusCommand';
import { ValidateAccessCommand } from './commands/validateAccessCommand';
import { InstallationManager } from './services/installationManager';
import { RegistrySource } from './types/registry';

/**
 * Main extension class that handles activation, deactivation, and command registration
 */
export class PromptRegistryExtension {
    private readonly logger: Logger;
    private readonly statusBar: StatusBar;
    private readonly notifications: ExtensionNotifications;
    private readonly registryManager: RegistryManager;
    private treeProvider: RegistryTreeProvider | undefined;
    private marketplaceProvider: MarketplaceViewProvider | undefined;
    private profileCommands: ProfileCommands | undefined;
    private sourceCommands: SourceCommands | undefined;
    private bundleCommands: BundleCommands | undefined;
    private settingsCommands: SettingsCommands | undefined;
    private hubCommands: HubCommands | undefined;
    private hubIntegrationCommands: HubIntegrationCommands | undefined;
    private hubProfileCommands: HubProfileCommands | undefined;
    private hubManager: HubManager | undefined;
    private validateCollectionsCommand: ValidateCollectionsCommand | undefined;
    private validateApmCommand: ValidateApmCommand | undefined;
    private createCollectionCommand: CreateCollectionCommand | undefined;
    private copilotIntegration: CopilotIntegration | undefined;
    
    // Update notification services
    private updateScheduler: UpdateScheduler | undefined;
    private updateChecker: UpdateChecker | undefined;
    private notificationManager: NotificationManager | undefined;
    private autoUpdateService: AutoUpdateService | undefined;

    // Legacy (to be removed)
    private readonly installationManager: InstallationManager;
    private disposables: vscode.Disposable[] = [];

    constructor(private readonly context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
        this.statusBar = StatusBar.getInstance();
        this.notifications = ExtensionNotifications.getInstance();
        this.registryManager = RegistryManager.getInstance(context);
        
        // Legacy (to be removed)
        this.installationManager = InstallationManager.getInstance();
    }

    /**
     * Activate the extension
     */
    /**
     * Extract bundleId from various argument types (string, TreeItem, InstalledBundle)
     */
    private extractBundleId(arg?: any): string | undefined {
        if (typeof arg === 'string') {
            return arg;
        } else if (arg?.data?.bundleId) {
            // TreeView RegistryTreeItem with InstalledBundle data
            return arg.data.bundleId;
        } else if (arg?.bundleId) {
            // Direct InstalledBundle or Bundle object
            return arg.bundleId;
        }
        return undefined;
    }

    public async activate(): Promise<void> {
        try {
            this.logger.info('Activating Prompt Registry extension...');

            // Initialize McpConfigLocator for profile support
            McpConfigLocator.initialize(this.context);

            // Initialize Runtime Managers with context
            ApmRuntimeManager.getInstance().initialize(this.context);
            OlafRuntimeManager.getInstance().initialize(this.context);

            // Initialize Registry Manager
            await this.registryManager.initialize();

            // Register commands
            this.registerCommands();

            // Initialize UI components
            await this.initializeUI();
            
            // Register TreeView
            await this.registerTreeView();

            // Register Marketplace View
            await this.registerMarketplaceView();

            // Initialize Copilot Integration
            await this.initializeCopilot();

            // Initialize update notification system
            await this.initializeUpdateSystem();

            // Check for automatic updates if enabled
            await this.checkForAutomaticUpdates();

            // Check if this is first run and show welcome message
            await this.checkFirstRun();

            // Always sync active hub on activation to keep it up-to-date
            await this.syncActiveHub();

            // Ensure only one profile is active (cleanup any multi-active state)
            await this.ensureSingleActiveProfile();

            this.logger.info('Prompt Registry extension activated successfully');

        } catch (error) {
            this.logger.error('Failed to activate Prompt Registry extension', error as Error);
            await this.notifications.showError(
                `Failed to activate Prompt Registry extension: ${(error as Error).message}`,
                'Show Logs'
            ).then((action) => {
                if (action === 'Show Logs') {
                    this.logger.show();
                }
            });
        }
    }

    /**
     * Deactivate the extension
     */
    public deactivate(): void {
        try {
            this.logger.info('Deactivating Prompt Registry extension...');

            // Dispose of all resources
            this.disposables.forEach(disposable => disposable.dispose());
            this.disposables = [];

            // Dispose update scheduler
            this.updateScheduler?.dispose();

            // Dispose Copilot integration
            this.copilotIntegration?.dispose();

            // Dispose collection commands
            this.validateCollectionsCommand?.dispose();
            this.validateApmCommand?.dispose();
            this.createCollectionCommand?.dispose();

            // Dispose UI components
            this.statusBar.dispose();
            this.logger.dispose();

            this.logger.info('Prompt Registry extension deactivated successfully');

        } catch (error) {
            console.error('Error during Prompt Registry extension deactivation:', error);
        }
    }

    /**
     * Register all extension commands
     */
    private registerCommands(): void {
        // Initialize Command Handlers
        this.profileCommands = new ProfileCommands(this.registryManager);
        this.sourceCommands = new SourceCommands(this.registryManager);
        this.settingsCommands = new SettingsCommands(this.registryManager);
        this.bundleCommands = new BundleCommands(this.registryManager);
        
        // Initialize hub infrastructure
        const hubStoragePath = this.context.globalStorageUri.fsPath;
        const hubStorage = new HubStorage(hubStoragePath);
        const hubValidator = new SchemaValidator(this.context.extensionPath);
        // Pass BundleInstaller from RegistryManager to enable bundle installation during profile activation
        const bundleInstaller = (this.registryManager as any).installer;
        this.hubManager = new HubManager(hubStorage, hubValidator, this.context.extensionPath, bundleInstaller, this.registryManager);
		
		// Connect HubManager to RegistryManager for profile integration
		this.registryManager.setHubManager(this.hubManager);
        
        this.hubCommands = new HubCommands(this.hubManager, this.registryManager, this.context);
        this.hubIntegrationCommands = new HubIntegrationCommands(this.hubManager, this.context);
        this.hubProfileCommands = new HubProfileCommands(this.context);
        // Note: scaffoldCommand is registered inline in command handler
        const addResourceCommand = new AddResourceCommand();
        const githubAuthCommand = new GitHubAuthCommand(this.registryManager);
        this.validateCollectionsCommand = new ValidateCollectionsCommand(this.context);
        this.validateApmCommand = new ValidateApmCommand(this.context);
        this.createCollectionCommand = new CreateCollectionCommand();

        // Legacy commands
        const updateCommand = new UpdateCommand();
        const statusCommand = new StatusCommand();
        const validateAccessCommand = new ValidateAccessCommand();

        // Register command handlers
        const commands = [
            // Profile Management Commands
            vscode.commands.registerCommand('promptRegistry.createProfile', () => this.profileCommands!.createProfile()),
            vscode.commands.registerCommand('promptRegistry.editProfile', (profileId?) => this.profileCommands!.editProfile(profileId)),
            vscode.commands.registerCommand('promptRegistry.activateProfile', (profileId?) => this.profileCommands!.activateProfile(profileId)),
            vscode.commands.registerCommand('promptRegistry.deactivateProfile', (profileId?) => this.profileCommands!.deactivateProfile(profileId)),
            vscode.commands.registerCommand('promptRegistry.deleteProfile', (profileId?) => this.profileCommands!.deleteProfile(profileId)),
            vscode.commands.registerCommand('promptRegistry.exportProfile', (profileId?) => this.profileCommands!.exportProfile(profileId)),
            vscode.commands.registerCommand('promptRegistry.importProfile', () => this.profileCommands!.importProfile()),
            vscode.commands.registerCommand('promptRegistry.listProfiles', () => this.profileCommands!.listProfiles()),
            
            // Settings Management Commands
            vscode.commands.registerCommand('promptRegistry.exportSettings', () => this.settingsCommands!.exportSettings()),
            vscode.commands.registerCommand('promptRegistry.importSettings', () => this.settingsCommands!.importSettings()),

            // Source Management Commands
            vscode.commands.registerCommand('promptRegistry.addSource', () => this.sourceCommands!.addSource()),
            vscode.commands.registerCommand('promptRegistry.editSource', (sourceId?) => this.sourceCommands!.editSource(sourceId)),
            vscode.commands.registerCommand('promptRegistry.removeSource', (sourceId?) => this.sourceCommands!.removeSource(sourceId)),
            vscode.commands.registerCommand('promptRegistry.syncSource', (sourceId?) => this.sourceCommands!.syncSource(sourceId)),
            vscode.commands.registerCommand('promptRegistry.syncAllSources', () => this.sourceCommands!.syncAllSources()),
            vscode.commands.registerCommand('promptRegistry.toggleSource', (sourceId?) => this.sourceCommands!.toggleSource(sourceId)),
            vscode.commands.registerCommand('promptRegistry.listSources', () => this.sourceCommands!.listSources()),
            
            // Bundle Management Commands
            vscode.commands.registerCommand('promptRegistry.searchBundles', () => this.bundleCommands!.searchAndInstall()),
            vscode.commands.registerCommand('promptRegistry.installBundle', (bundleId?) => this.bundleCommands!.installBundle(bundleId)),
            vscode.commands.registerCommand('promptRegistry.uninstallBundle', (arg?) => this.bundleCommands!.uninstallBundle(this.extractBundleId(arg))),
            vscode.commands.registerCommand('promptRegistry.updateBundle', (arg?) => this.bundleCommands!.updateBundle(this.extractBundleId(arg))),
            vscode.commands.registerCommand('promptRegistry.checkBundleUpdates', (arg?) => {
                const bundleId = this.extractBundleId(arg);
                if (bundleId) {
                    // Check single bundle update - show dialog instead of directly updating
                    this.bundleCommands!.checkSingleBundleUpdate(bundleId);
                } else {
                    // Check all bundles
                    this.bundleCommands!.checkAllUpdates();
                }
            }),
            vscode.commands.registerCommand('promptRegistry.manualCheckForUpdates', async () => {
                await this.handleManualUpdateCheck();
            }),
            vscode.commands.registerCommand('promptRegistry.updateAllBundles', () => this.bundleCommands!.updateAllBundles()),
            vscode.commands.registerCommand('promptRegistry.enableAutoUpdate', (arg?) => this.bundleCommands!.enableAutoUpdate(this.extractBundleId(arg))),
            vscode.commands.registerCommand('promptRegistry.disableAutoUpdate', (arg?) => this.bundleCommands!.disableAutoUpdate(this.extractBundleId(arg))),
            vscode.commands.registerCommand('promptRegistry.viewBundle', async (arg?) => {
                const bundleId = this.extractBundleId(arg);
                
                if (bundleId && this.marketplaceProvider) {
                    // Open in webview details panel (same as marketplace)
                    await this.marketplaceProvider.openBundleDetails(bundleId);
                } else {
                    // Fallback to QuickPick view
                    await this.bundleCommands!.viewBundle(bundleId);
                }
            }),
            vscode.commands.registerCommand('promptRegistry.browseByCategory', () => this.bundleCommands!.browseByCategory()),
            vscode.commands.registerCommand('promptRegistry.showPopular', () => this.bundleCommands!.showPopular()),
            vscode.commands.registerCommand('promptRegistry.listInstalled', () => this.bundleCommands!.listInstalled()),
            
            // Scaffold Command - Create project structure
            vscode.commands.registerCommand('promptRegistry.scaffoldProject', async () => {
                const scaffoldTypeChoice = await vscode.window.showQuickPick(
                    [
                        {
                            label: 'Awesome Copilot Project',
                            description: 'Standard prompt library structure',
                            value: ScaffoldType.AwesomeCopilot
                        },
                        {
                            label: 'APM Package',
                            description: 'Distributable prompt package (apm.yml)',
                            value: ScaffoldType.Apm
                        }
                    ],
                    {
                        placeHolder: 'Select project type',
                        title: 'Scaffold Project',
                        ignoreFocusOut: true
                    }
                );

                if (!scaffoldTypeChoice) {
                    return;
                }

                const targetPath = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    title: `Select Target Directory for ${scaffoldTypeChoice.label}`
                });

                if (targetPath && targetPath[0]) {
                    const projectName = await vscode.window.showInputBox({
                        prompt: 'Enter project name (optional)',
                        placeHolder: 'example',
                        value: 'example',
                        ignoreFocusOut: true
                    });

                    const runnerChoice = await vscode.window.showQuickPick(
                        [
                            {
                                label: 'GitHub-hosted (ubuntu-latest)',
                                description: 'Free GitHub-hosted runner',
                                value: 'ubuntu-latest'
                            },
                            {
                                label: 'Self-hosted',
                                description: 'Use self-hosted runner',
                                value: 'self-hosted'
                            },
                            {
                                label: 'Custom',
                                description: 'Specify custom runner label',
                                value: 'custom'
                            }
                        ],
                        {
                            placeHolder: 'Select GitHub Actions runner type',
                            title: 'GitHub Actions Runner',
                            ignoreFocusOut: true
                        }
                    );

                    let githubRunner = 'ubuntu-latest';
                    if (runnerChoice?.value === 'self-hosted') {
                        githubRunner = 'self-hosted';
                    } else if (runnerChoice?.value === 'custom') {
                        const customRunner = await vscode.window.showInputBox({
                            prompt: 'Enter custom runner label',
                            placeHolder: 'my-runner or [self-hosted, linux, x64]',
                            validateInput: (value) => {
                                if (!value || value.trim().length === 0) {
                                    return 'Runner label cannot be empty';
                                }
                                return undefined;
                            },
                            ignoreFocusOut: true
                        });
                        githubRunner = customRunner || 'ubuntu-latest';
                    }

                    // Collect additional info for APM projects
                    let description: string | undefined;
                    let author: string | undefined;
                    let tags: string[] | undefined;

                    if (scaffoldTypeChoice.value === ScaffoldType.Apm) {
                        description = await vscode.window.showInputBox({
                            prompt: 'Enter package description',
                            placeHolder: 'A short description of your package',
                            ignoreFocusOut: true
                        });

                        author = await vscode.window.showInputBox({
                            prompt: 'Enter author name',
                            placeHolder: 'Your Name <email@example.com>',
                            value: process.env.USER || 'user',
                            ignoreFocusOut: true
                        });

                        const tagsInput = await vscode.window.showInputBox({
                            prompt: 'Enter tags (comma separated)',
                            placeHolder: 'ai, prompts, coding',
                            value: 'apm, prompts',
                            ignoreFocusOut: true
                        });

                        if (tagsInput) {
                            tags = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0);
                        }
                    }

                    try {
                        await vscode.window.withProgress(
                            {
                                location: vscode.ProgressLocation.Notification,
                                title: `Scaffolding ${scaffoldTypeChoice.label}...`,
                                cancellable: false
                            },
                            async () => {
                                const cmd = new ScaffoldCommand(undefined, scaffoldTypeChoice.value);
                                await cmd.execute(targetPath[0], {
                                    projectName,
                                    githubRunner,
                                    description,
                                    author,
                                    tags
                                });
                            }
                        );

                        const action = await vscode.window.showInformationMessage(
                            `${scaffoldTypeChoice.label} scaffolded successfully!`,
                            'Open Folder',
                            'View README'
                        );

                        if (action === 'Open Folder') {
                            await vscode.commands.executeCommand('vscode.openFolder', targetPath[0]);
                        } else if (action === 'View README') {
                            const readmePath = vscode.Uri.joinPath(targetPath[0], 'README.md');
                            await vscode.commands.executeCommand('vscode.open', readmePath);
                        }
                    } catch (error) {
                        vscode.window.showErrorMessage(`Scaffold failed: ${(error as Error).message}`);
                    }
                }
            }),
            
            
            // Add Resource Command - Add individual resources
            vscode.commands.registerCommand('promptRegistry.addResource', async () => {
                await addResourceCommand.execute();
            }),

            // Collection Management Commands
            vscode.commands.registerCommand('promptRegistry.validateCollections', async (options?) => {
                await this.validateCollectionsCommand!.execute(options);
            }),
            
            vscode.commands.registerCommand('promptRegistry.validateCollectionsWithRefs', async () => {
                await this.validateCollectionsCommand!.execute({ checkRefs: true });
            }),

            vscode.commands.registerCommand('promptRegistry.listCollections', async () => {
                await this.validateCollectionsCommand!.execute({ listOnly: true });
            }),

            vscode.commands.registerCommand('promptRegistry.validateApm', async () => {
                await this.validateApmCommand!.execute();
            }),

            vscode.commands.registerCommand('promptRegistry.createCollection', async () => {
                await this.createCollectionCommand!.execute();
            }),

            // Command Menu - Show all commands
            vscode.commands.registerCommand('promptRegistry.showCommandMenu', async () => {
                await this.showCommandMenu();
            }),

            // Settings Command
            vscode.commands.registerCommand('promptRegistry.openSettings', () => {
                vscode.commands.executeCommand('workbench.action.openSettings', 'promptregistry');
            }),

            // Reset First Run Command
            vscode.commands.registerCommand('promptRegistry.resetFirstRun', async () => {
                await this.context.globalState.update('promptregistry.firstRun', true);
                await this.context.globalState.update('promptregistry.hubInitialized', false);
                // Clear active hub to ensure hub selector is shown
                await this.hubManager?.setActiveHub(null);
                this.logger.info('First run state reset: firstRun=true, hubInitialized=false, activeHub=null');
                vscode.window.showInformationMessage('First run state has been reset. Reload the window to trigger first-run initialization.');
            }),

            
            // Legacy commands (to be migrated)
            vscode.commands.registerCommand('promptregistry.selectVersion', () => selectVersionCommand()),
            vscode.commands.registerCommand('promptregistry.update', () => updateCommand.execute()),
            vscode.commands.registerCommand('promptregistry.checkUpdates', () => statusCommand.checkUpdates()),
            vscode.commands.registerCommand('promptregistry.showVersion', () => statusCommand.showVersion()),
            vscode.commands.registerCommand('promptregistry.uninstall', () => statusCommand.uninstall()),
            vscode.commands.registerCommand('promptregistry.showHelp', () => statusCommand.showHelp()),
            vscode.commands.registerCommand('promptregistry.validateAccess', () => validateAccessCommand.execute()),
            vscode.commands.registerCommand('promptregistry.forceGitHubAuth', () => githubAuthCommand.execute()),

            // vscode.commands.registerCommand('promptregistry.uninstallAll', () => uninstallCommand.executeUninstallAll()),
            // vscode.commands.registerCommand('promptregistry.enhancedInstall', () => enhancedInstallCommand.execute()),
            // vscode.commands.registerCommand('promptregistry.enhancedUninstall', () => refactoredUninstallCommand.execute()),
        ];

        // Add to disposables
        this.disposables.push(...commands);

        // Add to context subscriptions
        this.context.subscriptions.push(...commands);

        this.logger.debug('Commands registered successfully');
    }

    /**
     * Register TreeView for Registry Explorer
     */
    private async registerTreeView(): Promise<void> {
        this.logger.info('Registering Registry Explorer TreeView...');
        
        // Create tree provider
        this.treeProvider = new RegistryTreeProvider(this.registryManager, this.hubManager!);
        
        // Register tree view
        const treeView = vscode.window.createTreeView('promptRegistryExplorer', {
            treeDataProvider: this.treeProvider,
            showCollapseAll: true,
        });
        
        this.disposables.push(treeView);
        
        // Register tree view commands
        const treeCommands = [
            vscode.commands.registerCommand('promptRegistry.refresh', () => {
                this.treeProvider?.refresh();
            }),
            vscode.commands.registerCommand('promptRegistry.toggleProfileView', () => {
                this.treeProvider?.toggleViewMode();
            }),
        ];
        
        this.disposables.push(...treeCommands);
        this.context.subscriptions.push(...treeCommands);
        
        this.logger.info('Registry Explorer TreeView registered successfully');
    }

    /**
     * Register Marketplace View for browsing and installing bundles
     */
    private async registerMarketplaceView(): Promise<void> {
        this.logger.info('Registering Marketplace View...');
        
        // Create marketplace provider
        this.marketplaceProvider = new MarketplaceViewProvider(this.context, this.registryManager);
        
        // Register webview view
        const marketplaceView = vscode.window.registerWebviewViewProvider(
            MarketplaceViewProvider.viewType,
            this.marketplaceProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        );
        
        this.disposables.push(marketplaceView);
        this.context.subscriptions.push(marketplaceView);
        
        this.logger.info('Marketplace View registered successfully');
    }

    /**
     * Initialize Copilot Integration
     */
    private async initializeCopilot(): Promise<void> {
        try {
            this.logger.info('Initializing Copilot integration...');
            
            this.copilotIntegration = new CopilotIntegration(this.context);
            await this.copilotIntegration.activate();
            
            this.logger.info('Copilot integration initialized successfully');
        } catch (error) {
            this.logger.warn('Failed to initialize Copilot integration', error as Error);
            // Don't fail extension activation if Copilot integration fails
            // It's an optional feature that requires GitHub Copilot
        }
    }

    /**
     * Initialize update notification system
     * Sets up UpdateScheduler, UpdateChecker, NotificationManager, and AutoUpdateService
     * Uses dependency injection to avoid circular dependencies
     */
    private async initializeUpdateSystem(): Promise<void> {
        try {
            this.logger.info('Initializing update notification system...');

            // Get RegistryStorage instance
            const registryStorage = this.registryManager.getStorage();

            // Initialize NotificationManager (singleton)
            this.notificationManager = NotificationManager.getInstance();

            // Initialize UpdateChecker (no circular dependency)
            this.updateChecker = new UpdateChecker(
                this.registryManager,
                registryStorage,
                this.context.globalState
            );

            // Initialize AutoUpdateService with dependency injection
            // Pass RegistryManager methods as functions to avoid circular reference
            const bundleNotifications = new BundleUpdateNotifications(
                async (bundleId: string) => {
                    return await this.registryManager.getBundleName(bundleId);
                }
            );

            // Create update service factory to inject dependencies
            this.autoUpdateService = new AutoUpdateService(
                // Bundle operations
                {
                    updateBundle: (bundleId: string, version?: string) => this.registryManager.updateBundle(bundleId, version),
                    listInstalledBundles: () => this.registryManager.listInstalledBundles(),
                    getBundleDetails: (bundleId: string) => this.registryManager.getBundleDetails(bundleId)
                },
                // Source operations
                {
                    listSources: () => this.registryManager.listSources(),
                    syncSource: (sourceId: string) => this.registryManager.syncSource(sourceId)
                },
                bundleNotifications,
                registryStorage
            );

            // Set AutoUpdateService in RegistryManager for command access
            this.registryManager.setAutoUpdateService(this.autoUpdateService);

            // Initialize UpdateScheduler with AutoUpdateService
            this.updateScheduler = new UpdateScheduler(
                this.context,
                this.updateChecker,
                async (bundleId: string) => {
                    return await this.registryManager.getBundleName(bundleId);
                },
                this.autoUpdateService
            );

            // Wire up update detection to tree provider
            if (this.treeProvider) {
                this.updateScheduler.onUpdatesDetected(updates => {
                    this.treeProvider?.onUpdatesDetected(updates);
                });
            }

            // Initialize scheduler (triggers startup check)
            await this.updateScheduler.initialize();

            // Register configuration change listeners
            this.registerUpdateConfigurationListeners();

            this.logger.info('Update notification system initialized successfully');
        } catch (error) {
            this.logger.warn('Failed to initialize update notification system', error as Error);
            // Don't fail extension activation if update system fails
        }
    }

    /**
     * Register configuration change listeners for update system
     * Applies configuration changes immediately without requiring restart
     */
    private registerUpdateConfigurationListeners(): void {
        // Listen for update check configuration changes
        const configListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('promptregistry.updateCheck')) {
                this.handleUpdateConfigurationChange();
            }
        });

        this.disposables.push(configListener);
        this.context.subscriptions.push(configListener);
    }

    /**
     * Handle update configuration changes
     * Applies new settings immediately to UpdateScheduler
     */
    private handleUpdateConfigurationChange(): void {
        if (!this.updateScheduler) {
            return;
        }

        const config = vscode.workspace.getConfiguration('promptregistry.updateCheck');
        const enabled = config.get<boolean>('enabled', true);
        const rawFrequency = config.get<string>('frequency', 'daily');

        // Validate and sanitize configuration values
        const frequency = getValidUpdateCheckFrequency(rawFrequency, 'daily');

        // Log warning if invalid value was provided
        if (rawFrequency !== frequency) {
            this.logger.warn(
                `Invalid update check frequency "${rawFrequency}" in configuration. Using default "${frequency}".`
            );
        }

        this.logger.info(`Update configuration changed: enabled=${enabled}, frequency=${frequency}`);

        // Apply changes immediately
        this.updateScheduler.updateEnabled(enabled);
        this.updateScheduler.updateSchedule(frequency);
    }

    /**
     * Handle manual update check command
     * Bypasses cache and displays results immediately
     */
    private async handleManualUpdateCheck(): Promise<void> {
        if (!this.updateScheduler || !this.updateChecker || !this.notificationManager) {
            this.logger.warn('Update system not initialized');
            await vscode.window.showWarningMessage('Update system is not initialized yet. Please try again in a moment.');
            return;
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Checking for bundle updates...',
                    cancellable: false
                },
                async () => {
                    // Trigger manual check (bypasses cache)
                    await this.updateScheduler!.checkNow();

                    // Get the results
                    const updates = await this.updateChecker!.getCachedResults();

                    if (!updates || updates.length === 0) {
                        await vscode.window.showInformationMessage('All bundles are up to date!');
                        return;
                    }

                    // Show notification with results
                    const config = vscode.workspace.getConfiguration('promptregistry.updateCheck');
                    const rawNotificationPreference = config.get<string>('notificationPreference', 'all');

                    // Validate and sanitize notification preference
                    const notificationPreference = getValidNotificationPreference(rawNotificationPreference, 'all');

                    // Log warning if invalid value was provided
                    if (rawNotificationPreference !== notificationPreference) {
                        this.logger.warn(
                            `Invalid notification preference "${rawNotificationPreference}" in configuration. Using default "${notificationPreference}".`
                        );
                    }

                    // Use BundleUpdateNotifications for bundle update notifications
                    const bundleNotifications = new BundleUpdateNotifications(
                        async (bundleId: string) => {
                            return await this.registryManager.getBundleName(bundleId);
                        }
                    );
                    await bundleNotifications.showUpdateNotification({
                        updates,
                        notificationPreference
                    });
                }
            );
        } catch (error) {
            this.logger.error('Manual update check failed', error as Error);
            await vscode.window.showErrorMessage(
                `Failed to check for updates: ${(error as Error).message}`,
                'Show Logs'
            ).then(action => {
                if (action === 'Show Logs') {
                    this.logger.show();
                }
            });
        }
    }

    /**
     * Initialize UI components
     */
    private async initializeUI(): Promise<void> {
        try {
            // Initialize status bar
            await this.statusBar.initialize();

            // Add status bar to disposables
            this.disposables.push(this.statusBar);

            this.logger.debug('UI components initialized successfully');

        } catch (error) {
            this.logger.error('Failed to initialize UI components', error as Error);
        }
    }

    /**
     * Check if current workspace is an awesome-copilot repository
     */
    private async isAwesomeCopilotRepository(): Promise<boolean> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return false;
        }

        const workspaceRoot = workspaceFolders[0].uri;

        // Check for key directories that indicate an awesome-copilot structure
        const requiredDirs = ['collections', 'prompts', 'instructions', 'agents'];
        const existingDirs = [];

        for (const dir of requiredDirs) {
            const dirUri = vscode.Uri.joinPath(workspaceRoot, dir);
            try {
                const stat = await vscode.workspace.fs.stat(dirUri);
                if (stat.type === vscode.FileType.Directory) {
                    existingDirs.push(dir);
                }
            } catch (error) {
                // Directory doesn't exist
            }
        }

        // Consider it an awesome-copilot repo if at least collections and one other directory exists
        return existingDirs.includes('collections') && existingDirs.length >= 2;
    }

    /**
     * Check if current workspace is an APM repository
     */
    private async isApmRepository(): Promise<boolean> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return false;
        }

        const workspaceRoot = workspaceFolders[0].uri;
        const apmYmlUri = vscode.Uri.joinPath(workspaceRoot, 'apm.yml');

        try {
            await vscode.workspace.fs.stat(apmYmlUri);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Show command menu with all available extension commands
     */
    private async showCommandMenu(): Promise<void> {
        interface CommandItem extends vscode.QuickPickItem {
            command?: string;
        }

        const isAwesomeCopilotRepo = await this.isAwesomeCopilotRepository();
        const isApmRepo = await this.isApmRepository();

        const commands: CommandItem[] = [
            // Profile Management
            {
                label: '$(person) Profile Management',
                kind: vscode.QuickPickItemKind.Separator
            },
            {
                label: '$(add) Create Profile',
                description: 'Create a new prompt profile',
                command: 'promptRegistry.createProfile'
            },
            {
                label: '$(edit) Edit Profile',
                description: 'Edit an existing profile',
                command: 'promptRegistry.editProfile'
            },
            {
                label: '$(check) Activate Profile',
                description: 'Switch to a different profile',
                command: 'promptRegistry.activateProfile'
            },
            {
                label: '$(list-flat) List Profiles',
                description: 'View all available profiles',
                command: 'promptRegistry.listProfiles'
            },
            
            // Source Management
            {
                label: '$(source-control) Source Management',
                kind: vscode.QuickPickItemKind.Separator
            },
            {
                label: '$(add) Add Source',
                description: 'Add a new prompt source',
                command: 'promptRegistry.addSource'
            },
            {
                label: '$(sync) Sync All Sources',
                description: 'Synchronize all prompt sources',
                command: 'promptRegistry.syncAllSources'
            },
            {
                label: '$(list-flat) List Sources',
                description: 'View all configured sources',
                command: 'promptRegistry.listSources'
            },
            
            // Bundle Management
            {
                label: '$(package) Bundle Management',
                kind: vscode.QuickPickItemKind.Separator
            },
            {
                label: '$(search) Search Bundles',
                description: 'Search and install prompt bundles',
                command: 'promptRegistry.searchBundles'
            },
            {
                label: '$(star) Show Popular Bundles',
                description: 'Browse popular prompt bundles',
                command: 'promptRegistry.showPopular'
            },
            {
                label: '$(list-selection) List Installed Bundles',
                description: 'View all installed bundles',
                command: 'promptRegistry.listInstalled'
            },
            {
                label: '$(refresh) Check for Updates',
                description: 'Check for bundle updates',
                command: 'promptRegistry.checkBundleUpdates'
            }
        ];

        // Add Collection Management section only for awesome-copilot repositories
        if (isAwesomeCopilotRepo) {
            commands.push(
                {
                    label: '$(folder) Collection Management',
                    kind: vscode.QuickPickItemKind.Separator
                },
                {
                    label: '$(new-file) Create New Collection',
                    description: 'Interactive collection creator',
                    command: 'promptRegistry.createCollection'
                },
                {
                    label: '$(check-all) Validate Collections',
                    description: 'Validate collection YAML files',
                    command: 'promptRegistry.validateCollections'
                },
                {
                    label: '$(list-flat) List All Collections',
                    description: 'Show collection metadata',
                    command: 'promptRegistry.listCollections'
                }
            );
        }

        // Add APM Package Management section only for APM repositories
        if (isApmRepo) {
            commands.push(
                {
                    label: '$(package) Package Management',
                    kind: vscode.QuickPickItemKind.Separator
                },
                {
                    label: '$(check-all) Validate APM Package',
                    description: 'Validate APM manifest and prompt files',
                    command: 'promptRegistry.validateApm'
                }
            );
        }

        // Project Scaffolding
        commands.push(
            {
                label: '$(file-directory) Project Scaffolding',
                kind: vscode.QuickPickItemKind.Separator
            },
            {
                label: '$(folder-library) Scaffold Project',
                description: 'Create new prompt project (Awesome-Copilot or APM)',
                command: 'promptRegistry.scaffoldProject'
            }
        );

        // Settings & Info
        commands.push(
            {
                label: '$(settings-gear) Settings & Information',
                kind: vscode.QuickPickItemKind.Separator
            },
            {
                label: '$(gear) Open Settings',
                description: 'Configure Prompt Registry',
                command: 'promptRegistry.openSettings'
            },
            {
                label: '$(info) Show Version',
                description: 'Display version information',
                command: 'promptregistry.showVersion'
            },
            {
                label: '$(question) Show Help',
                description: 'Get help with Prompt Registry',
                command: 'promptregistry.showHelp'
            }
        );

        const selected = await vscode.window.showQuickPick(commands, {
            placeHolder: 'Select a Prompt Registry command',
            matchOnDescription: true,
            matchOnDetail: true,
            ignoreFocusOut: true
        });

        if (selected && selected.command) {
            await vscode.commands.executeCommand(selected.command);
        }
    }

    /**
     * Ensure only one profile is active during startup
     * Fixes cases where multiple profiles may be marked as active from previous sessions
     */
    private async ensureSingleActiveProfile(): Promise<void> {
        try {
            const allProfiles = await this.registryManager!.listProfiles();
            const activeProfiles = allProfiles.filter(p => p.active);
            
            if (activeProfiles.length <= 1) {
                // Already have 0 or 1 active profile - good state
                return;
            }
            
            this.logger.info(`Found ${activeProfiles.length} active profiles, ensuring only one is active`);
            
            // Deactivate all but the first active profile
            for (let i = 1; i < activeProfiles.length; i++) {
                const profile = activeProfiles[i];
                this.logger.info(`Deactivating extra active profile: ${profile.name}`);
                try {
                    await this.registryManager!.deactivateProfile(profile.id);
                } catch (error) {
                    this.logger.error(`Failed to deactivate profile ${profile.id}`, error as Error);
                }
            }
            
            this.logger.info(`Profile cleanup complete, only ${activeProfiles[0].name} remains active`);
        } catch (error) {
            this.logger.error('Failed to ensure single active profile', error as Error);
        }
    }

    /**
     * Check for automatic updates on extension activation
     */
    private async checkForAutomaticUpdates(): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('promptregistry');
            const autoCheckUpdates = config.get<boolean>('autoCheckUpdates', true);

            if (!autoCheckUpdates) {
                this.logger.debug('Automatic update checking is disabled');
                return;
            }

            this.logger.debug('Checking for automatic updates...');

            // Automatic update checking removed - users can access all commands via status bar menu
            this.logger.debug('Automatic update checking disabled - use command menu instead');

        } catch (error) {
            this.logger.warn('Failed to perform automatic update check', error as Error);
        }
    }    /**
     * Initialize default sources on first run
     */
    private async initializeDefaultSources(): Promise<void> {
        try {
            // Check if any sources already exist
            const existingSources = await this.registryManager!.listSources();
            if (existingSources.length > 0) {
                this.logger.info('Sources already exist, skipping default source initialization');
                return;
            }

            // Add default Awesome Copilot source
            const defaultSource: RegistrySource = {
                id: 'awesome-copilot-official',
                name: 'Awesome Copilot (Official)',
                type: 'awesome-copilot',
                url: 'https://github.com/github/awesome-copilot',
                enabled: true,
                priority: 1,
                private: false,
                metadata: {
                    description: 'Official Awesome Copilot collections from GitHub',
                    homepage: 'https://github.com/github/awesome-copilot',
                }
            };

            // Add config for awesome-copilot source type
            (defaultSource as any).config = {
                branch: 'main',
                collectionsPath: 'collections'
            };

            await this.registryManager!.addSource(defaultSource);
            this.logger.info('Default Awesome Copilot source added successfully');

        } catch (error) {
            this.logger.warn('Failed to initialize default sources', error as Error);
        }
    }

    /**

    /**
     * Check if this is the first run and show welcome message
     */
    private async checkFirstRun(): Promise<void> {
        try {
            const isFirstRun = this.context.globalState.get<boolean>('promptregistry.firstRun', true);

            if (isFirstRun) {                // Mark as not first run
                await this.context.globalState.update('promptregistry.firstRun', false);

                // Initialize default sources (Awesome Copilot)
                await this.initializeDefaultSources();

                // Initialize hub (first-run hub selector or migration)
                await this.initializeHub();


                // Check if Prompt Registry is already installed
                const installedScopes = await this.installationManager.getInstalledScopes();
                if (installedScopes.length === 0) {
                    // Show welcome notification after a short delay
                    setTimeout(async () => {
                        await this.notifications.showWelcomeNotification();
                    }, 2000);
                }

                this.logger.info('First run detected, welcome message shown');
            }

        } catch (error) {
            this.logger.warn('Failed to check first run status', error as Error);
        }
    }

    /**
     * Sync active hub configuration on every activation
     * Ensures users always have the latest hub configuration
     */
    private async syncActiveHub(): Promise<void> {
        try {
            const hubManager = this.hubManager;
            const sourceCommands = this.sourceCommands;
            
            if (!hubManager || !sourceCommands) {
                this.logger.warn('HubManager or SourceCommands not initialized, skipping hub sync');
                return;
            }

            // Check if there's an active hub
            const activeHub = await hubManager.getActiveHub();
            if (!activeHub) {
                this.logger.info('No active hub configured, skipping auto-sync');
                return;
            }

            // Get active hub ID
            const activeProfiles = await hubManager.listActiveHubProfiles();
            if (activeProfiles.length === 0 || !activeProfiles[0].hubId) {
                this.logger.warn('Active hub has no profiles or hub ID, skipping auto-sync');
                return;
            }

            const activeHubId = activeProfiles[0].hubId;
            this.logger.info(`Auto-syncing active hub: ${activeHubId}`);

            // Sync hub configuration
            await hubManager.syncHub(activeHubId);
            
            // Sync all sources from the active hub
            await sourceCommands.syncAllSources();
            
            // Refresh tree view
            await vscode.commands.executeCommand('promptRegistry.refresh');
            
            this.logger.info('Active hub synchronized successfully on activation');

        } catch (error) {
            this.logger.warn('Failed to auto-sync active hub on activation', error as Error);
            // Don't fail extension activation if sync fails
        }
    }


    /**
     * Initialize hub configuration on first run or migrate existing installations
     */
    private async initializeHub(): Promise<void> {
        try {
            const hubManager = this.hubManager!;
            const isHubInitialized = this.context.globalState.get<boolean>('promptregistry.hubInitialized', false);

            if (isHubInitialized) {
                this.logger.info('Hub already initialized, skipping hub setup');
                return;
            }

            // Check existing hubs
            const hubs = await hubManager.listHubs();
            const activeHubResult = await hubManager.getActiveHub();

            if (hubs.length === 0 && !activeHubResult) {
                // Scenario 1: First-time installation, no hubs
                this.logger.info('First-time hub setup: showing hub selector');
                await this.showFirstRunHubSelector();
            } else if (hubs.length > 0 && !activeHubResult) {
                // Scenario 2: Migration - hubs exist but no active hub set
                this.logger.info(`Migration detected: ${hubs.length} hubs found, migrating to active hub model`);
                await this.migrateToActiveHub(hubs);
            } else {
                // Scenario 3: Already initialized (active hub exists)
                this.logger.info('Hub already configured with active hub');
            }

            // Mark as initialized
            await this.context.globalState.update('promptregistry.hubInitialized', true);
            this.logger.info('Hub initialization complete');

        } catch (error) {
            this.logger.error('Failed to initialize hub', error as Error);
            // Don't block extension activation on hub init failure
        }
    }

    /**
     * Show first-run hub selector with preset options
     */
    private async showFirstRunHubSelector(): Promise<void> {
        const hubManager = this.hubManager!;
        
        // Get enabled default hubs and verify their availability
        const defaultHubs = getEnabledDefaultHubs();
        // Verify each hub in parallel but preserve order
        this.logger.info('Verifying default hubs...');
        const verificationResults = await Promise.all(defaultHubs.map(async (hub) => {
            const isAvailable = await hubManager.verifyHubAvailability(hub.reference);
            this.logger.debug(`Hub verification result for ${hub.name}: ${isAvailable ? 'available' : 'unavailable'}`);
            if (isAvailable) {
                this.logger.info(`✓ Hub verified: ${hub.name} (${hub.reference.type}:${hub.reference.location})`);
            } else {
                this.logger.warn(`✗ Hub unavailable: ${hub.name} (${hub.reference.type}:${hub.reference.location})`);
            }
            return { ...hub, verified: isAvailable };
        }));
        
        // verificationResults maintains the same order as defaultHubs
        const verifiedHubs = verificationResults;

        // Build quick-pick items from verified hubs
        const items = verifiedHubs
            .filter(hub => hub.verified) // Only show verified hubs
            .map(hub => ({
                label: `$(${hub.icon}) ${hub.name}${hub.recommended ? ' ⭐' : ''}`,
                description: hub.recommended ? hub.description + ' (recommended)' : hub.description,
                detail: `${hub.reference.type}/${hub.reference.location}`,
                hubConfig: hub
            }));

        // Add custom URL and skip options
        items.push(
            {
                label: '$(link-external) Custom Hub URL',
                description: 'Import from custom URL',
                detail: 'Enter a custom hub URL',
                hubConfig: null as any
            },
            {
                label: '$(x) Skip for now',
                description: 'Configure hub later',
                detail: 'You can configure a hub anytime from the toolbar',
                hubConfig: null as any
            }
        );

        // Show warning if no verified hubs
        if (verifiedHubs.filter(h => h.verified).length === 0) {
            this.logger.warn('No default hubs are currently accessible');
            vscode.window.showWarningMessage(
                'Default hubs are currently unavailable. You can import a custom hub or skip for now.',
                'Continue'
            );
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a hub to get started',
            title: 'Welcome to Prompt Registry - Choose Your Hub',
            ignoreFocusOut: true
        });

        if (!selected) {
            this.logger.info('User cancelled first-run hub selector');
            return;
        }

        if (selected.hubConfig && selected.hubConfig.reference) {
            // Import and activate the selected hub
            this.logger.info(`Importing first-run hub: ${selected.hubConfig.name}`);
            try {
                const hubId = await hubManager.importHub(selected.hubConfig.reference);
                await hubManager.setActiveHub(hubId);
                this.logger.info(`First-run hub ${hubId} imported and activated, syncing sources...`);
                
                // Sync all sources from the newly imported hub
                try {
                    await this.sourceCommands!.syncAllSources();
                    this.logger.info('Sources synchronized successfully');
                } catch (syncError) {
                    this.logger.warn('Failed to sync sources after hub import', syncError as Error);
                }
                
                // Try to activate a default profile if hub has profiles
                try {
                    const hubProfiles = await hubManager.listActiveHubProfiles();
                    if (hubProfiles.length > 0) {
                        // Activate the first profile as default
                        const defaultProfile = hubProfiles[0];
                        this.logger.info(`Auto-activating default profile: ${defaultProfile.name}`);
                        await this.registryManager!.activateProfile(defaultProfile.id);
                        this.logger.info(`Default profile ${defaultProfile.id} activated successfully`);
                    } else {
                        this.logger.info('No profiles found in hub for auto-activation');
                    }
                } catch (profileError) {
                    this.logger.warn('Failed to auto-activate default profile', profileError as Error);
                }
                
                await vscode.commands.executeCommand('promptRegistry.refresh');
                vscode.window.showInformationMessage(`Successfully activated ${selected.hubConfig.name}`);
            } catch (error) {
                this.logger.error(`Failed to import hub: ${selected.hubConfig.name}`, error as Error);
                vscode.window.showErrorMessage(
                    `Failed to import ${selected.hubConfig.name}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        } else if (selected.label.includes('Custom Hub URL')) {
            // Redirect to import hub command
            this.logger.info('User chose custom hub URL, redirecting to import command');
            await vscode.commands.executeCommand('promptregistry.importHub');
        } else {
            // Skip for now
            this.logger.info('User chose to skip hub configuration');
        }
    }

    /**
     * Migrate existing multi-hub installation to active hub model
     */
    private async migrateToActiveHub(hubs: any[]): Promise<void> {
        const hubManager = this.hubManager!;

        if (hubs.length === 1) {
            // Auto-activate the only hub
            const hubId = hubs[0].id;
            this.logger.info(`Auto-activating single hub: ${hubId}`);
            await hubManager.setActiveHub(hubId);
            await vscode.commands.executeCommand('promptRegistry.refresh');
            return;
        }

        // Multiple hubs - show selection dialog
        const items = hubs.map(hub => ({
            label: hub.metadata?.name || hub.id,
            description: hub.metadata?.description || '',
            detail: `${hub.metadata?.url || 'Unknown URL'} (${hub.metadata?.ref || 'Unknown ref'})`,
            hubId: hub.id
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Multiple hubs found. Select which hub to activate:',
            title: 'Hub Migration - Select Active Hub',
            ignoreFocusOut: true
        });

        const hubId = selected ? selected.hubId : hubs[0].id;
        this.logger.info(`Migrating to active hub: ${hubId}`);
        await hubManager.setActiveHub(hubId);
        await vscode.commands.executeCommand('promptRegistry.refresh');
    }

}

// Extension activation function called by VS Code
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    extensionInstance = new PromptRegistryExtension(context);
    await extensionInstance.activate();
}

// Extension deactivation function called by VS Code
export function deactivate(): void {
    if (extensionInstance) {
        extensionInstance.deactivate();
        extensionInstance = undefined;
    }
}
