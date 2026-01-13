/**
 * Scope Service Factory
 * 
 * Factory for creating appropriate scope services based on InstallationScope.
 * Returns UserScopeService for user/workspace scopes and RepositoryScopeService for repository scope.
 * 
 * Requirements: 1.1, 1.8, 2.5
 */

import * as vscode from 'vscode';
import { InstallationScope } from '../types/registry';
import { IScopeService } from './IScopeService';
import { UserScopeService } from './UserScopeService';
import { RepositoryScopeService } from './RepositoryScopeService';
import { RegistryStorage } from '../storage/RegistryStorage';

/**
 * Factory for creating scope-specific services.
 * 
 * This factory abstracts the creation of scope services, allowing the rest of the
 * codebase to work with the IScopeService interface without knowing the concrete
 * implementation details.
 */
export class ScopeServiceFactory {
    /**
     * Create a scope service for the given installation scope.
     * 
     * @param scope - The installation scope (user, workspace, or repository)
     * @param context - VS Code extension context (required for user/workspace scopes)
     * @param workspaceRoot - The workspace root path (required for repository scope)
     * @param storage - Registry storage instance (required for repository scope)
     * @returns An IScopeService implementation appropriate for the scope
     * @throws Error if scope is unknown or required parameters are missing
     */
    static create(
        scope: InstallationScope,
        context: vscode.ExtensionContext,
        workspaceRoot?: string,
        storage?: RegistryStorage
    ): IScopeService {
        switch (scope) {
            case 'user':
            case 'workspace':
                // Both user and workspace scopes use UserScopeService
                // The service handles the distinction internally based on VS Code's profile system
                return new UserScopeService(context);

            case 'repository':
                // Repository scope requires workspaceRoot and storage
                if (!workspaceRoot) {
                    throw new Error('workspaceRoot is required for repository scope');
                }
                if (!storage) {
                    throw new Error('storage is required for repository scope');
                }
                return new RepositoryScopeService(workspaceRoot, storage);

            default:
                throw new Error(`Unknown installation scope: ${scope}`);
        }
    }
}
