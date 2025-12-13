import * as vscode from 'vscode';
import { NotificationManager } from '../services/NotificationManager';
import { Logger } from '../utils/logger';

/**
 * Specialized notification handler for extension self-updates and installation
 * Uses generic NotificationManager for display
 */
export class ExtensionNotifications {
    private static instance: ExtensionNotifications;
    private notificationManager: NotificationManager;
    private logger: Logger;
    
    private constructor() {
        this.notificationManager = NotificationManager.getInstance();
        this.logger = Logger.getInstance();
    }
    
    public static getInstance(): ExtensionNotifications {
        if (!ExtensionNotifications.instance) {
            ExtensionNotifications.instance = new ExtensionNotifications();
        }
        return ExtensionNotifications.instance;
    }
    
    /**
     * Show extension update notification
     */
    async showUpdateNotification(
        currentVersion: string,
        newVersion: string,
        scope?: string
    ): Promise<'update' | 'dismiss' | undefined> {
        const scopeText = scope ? ` (${scope})` : '';
        const message = `Prompt Registry update available${scopeText}: ${currentVersion} → ${newVersion}`;
        
        const action = await this.notificationManager.showInfo(message, 'Update Now', 'Dismiss');
        
        switch (action) {
            case 'Update Now':
                return 'update';
            case 'Dismiss':
                return 'dismiss';
            default:
                return undefined;
        }
    }
    
    /**
     * Show installation success notification
     */
    async showInstallationSuccess(
        version: string,
        scope: string,
        path: string
    ): Promise<'show' | 'dismiss' | undefined> {
        const message = `Prompt Registry v${version} installed successfully in ${scope} scope!`;
        
        const action = await this.notificationManager.showInfo(message, 'Show in Explorer', 'Dismiss');
        
        switch (action) {
            case 'Show in Explorer':
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path));
                return 'show';
            case 'Dismiss':
                return 'dismiss';
            default:
                return undefined;
        }
    }
    
    /**
     * Show update success notification
     */
    async showUpdateSuccess(
        version: string,
        scope: string
    ): Promise<'details' | 'dismiss' | undefined> {
        const message = `Prompt Registry updated to v${version} in ${scope} scope!`;
        
        const action = await this.notificationManager.showInfo(message, 'Show Details', 'Dismiss');
        
        switch (action) {
            case 'Show Details':
                vscode.commands.executeCommand('promptregistry.showVersion');
                return 'details';
            case 'Dismiss':
                return 'dismiss';
            default:
                return undefined;
        }
    }
    
    /**
     * Show uninstall confirmation
     */
    async showUninstallConfirmation(
        scope: string
    ): Promise<'confirm' | 'cancel' | undefined> {
        const message = `Are you sure you want to uninstall Prompt Registry from ${scope} scope? This action cannot be undone.`;
        
        const action = await this.notificationManager.showWarning(message, 'Uninstall', 'Cancel');
        
        switch (action) {
            case 'Uninstall':
                return 'confirm';
            case 'Cancel':
                return 'cancel';
            default:
                return undefined;
        }
    }
    
    /**
     * Show installation error notification
     */
    async showInstallationError(
        error: string
    ): Promise<'retry' | 'logs' | 'dismiss' | undefined> {
        const message = `Failed to install Prompt Registry: ${error}`;
        
        const action = await this.notificationManager.showError(message, 'Retry', 'Show Logs', 'Dismiss');
        
        switch (action) {
            case 'Retry':
                vscode.commands.executeCommand('promptregistry.enhancedInstall');
                return 'retry';
            case 'Show Logs':
                this.logger.show();
                return 'logs';
            case 'Dismiss':
                return 'dismiss';
            default:
                return undefined;
        }
    }
    
    /**
     * Show update error notification
     */
    async showUpdateError(
        error: string
    ): Promise<'retry' | 'logs' | 'dismiss' | undefined> {
        const message = `Failed to update Prompt Registry: ${error}`;
        
        const action = await this.notificationManager.showError(message, 'Retry', 'Show Logs', 'Dismiss');
        
        switch (action) {
            case 'Retry':
                vscode.commands.executeCommand('promptregistry.update');
                return 'retry';
            case 'Show Logs':
                this.logger.show();
                return 'logs';
            case 'Dismiss':
                return 'dismiss';
            default:
                return undefined;
        }
    }
    
    /**
     * Show connectivity error notification
     */
    async showConnectivityError(): Promise<'retry' | 'dismiss' | undefined> {
        const message = 'Unable to connect to GitHub. Please check your internet connection.';
        
        const action = await this.notificationManager.showError(message, 'Retry', 'Dismiss');
        
        switch (action) {
            case 'Retry':
                return 'retry';
            case 'Dismiss':
                return 'dismiss';
            default:
                return undefined;
        }
    }
    
    /**
     * Show first install welcome notification
     */
    async showWelcomeNotification(): Promise<'install' | 'learn' | 'dismiss' | undefined> {
        // Currently disabled - returning undefined
        return undefined;
    }

    /**
     * Show generic information notification
     * Provided for backward compatibility with existing extension code
     * New code should use NotificationManager directly for better separation of concerns
     */
    async showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
        return await this.notificationManager.showInfo(message, ...actions);
    }
    
    /**
     * Show generic warning notification
     * Provided for backward compatibility with existing extension code
     * New code should use NotificationManager directly for better separation of concerns
     */
    async showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
        return await this.notificationManager.showWarning(message, ...actions);
    }
    
    /**
     * Show generic error notification
     * Provided for backward compatibility with existing extension code
     * New code should use NotificationManager directly for better separation of concerns
     */
    async showError(message: string, ...actions: string[]): Promise<string | undefined> {
        return await this.notificationManager.showError(message, ...actions);
    }
    

}
