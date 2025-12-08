/**
 * Shared test utilities for auto-update functionality
 * Reduces duplication across auto-update related tests
 */

import * as sinon from 'sinon';
import { RegistryStorage } from '../../src/storage/RegistryStorage';
import { AutoUpdateService } from '../../src/services/AutoUpdateService';
import { BundleUpdateNotifications } from '../../src/notifications/BundleUpdateNotifications';
import { Logger } from '../../src/utils/logger';
import { createMockInstalledBundle, createMockUpdateCheckResult } from './bundleTestHelpers';

/**
 * Auto-update test utilities
 */
export class AutoUpdateTestHelpers {
    /**
     * Setup storage mock for auto-update preferences
     * Consolidates simple and complex storage setup patterns
     * 
     * @param mockStorage - Stubbed RegistryStorage instance
     * @param bundleId - Bundle identifier
     * @param getReturns - Single boolean or array of booleans for multiple calls
     * @param setResolves - Whether setUpdatePreference should resolve (default: true)
     */
    static setupStorageMock(
        mockStorage: sinon.SinonStubbedInstance<RegistryStorage>,
        bundleId: string,
        getReturns: boolean | boolean[],
        setResolves: boolean = true
    ): void {
        const getStub = mockStorage.getUpdatePreference.withArgs(bundleId);
        
        if (Array.isArray(getReturns)) {
            // Multiple calls setup
            getReturns.forEach((value, index) => {
                if (index === 0) {
                    getStub.onFirstCall().resolves(value);
                } else if (index === 1) {
                    getStub.onSecondCall().resolves(value);
                } else {
                    getStub.onCall(index).resolves(value);
                }
            });
        } else {
            // Single call setup
            getStub.resolves(getReturns);
        }
        
        if (setResolves) {
            mockStorage.setUpdatePreference
                .withArgs(bundleId, sinon.match.any)
                .resolves();
        }
    }

    /**
     * Setup storage mock to reject with error
     */
    static setupStorageError(
        mockStorage: sinon.SinonStubbedInstance<RegistryStorage>,
        bundleId: string,
        enabled: boolean,
        errorMessage: string
    ): void {
        mockStorage.setUpdatePreference
            .withArgs(bundleId, enabled)
            .rejects(new Error(errorMessage));
    }

    /**
     * Reset all auto-update related mocks
     * Follows the same pattern as resetBundleCommandsMocks for consistency
     */
    static resetAutoUpdateMocks(
        mockStorage: sinon.SinonStubbedInstance<RegistryStorage>,
        loggerStub?: sinon.SinonStubbedInstance<Logger>,
        ...otherMocks: any[]
    ): void {
        // Reset storage mocks
        mockStorage.getUpdatePreference.reset();
        mockStorage.setUpdatePreference.reset();
        
        // Reset logger history (consistent with bundleTestHelpers pattern)
        if (loggerStub) {
            loggerStub.debug.resetHistory();
            loggerStub.info.resetHistory();
            loggerStub.warn.resetHistory();
            loggerStub.error.resetHistory();
        }
        
        // Reset any additional mocks passed in
        otherMocks.forEach(mock => {
            if (mock && typeof mock.reset === 'function') {
                mock.reset();
            } else if (mock && typeof mock.resetHistory === 'function') {
                mock.resetHistory();
            }
        });
    }

    /**
     * Create a mock AutoUpdateService with properly stubbed dependencies
     * Follows integration test patterns with real instances and targeted stubs
     */
    static createMockAutoUpdateService(
        sandbox: sinon.SinonSandbox,
        mockStorage?: sinon.SinonStubbedInstance<RegistryStorage>
    ): {
        service: AutoUpdateService;
        mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
        mockNotifications: sinon.SinonStubbedInstance<BundleUpdateNotifications>;
        mockBundleOps: sinon.SinonStubbedInstance<any>;
        mockSourceOps: sinon.SinonStubbedInstance<any>;
    } {
        const storage = mockStorage || sandbox.createStubInstance(RegistryStorage);
        const mockNotifications = sandbox.createStubInstance(BundleUpdateNotifications);
        
        // Create proper stub instances instead of empty objects
        const mockBundleOps = {
            updateBundle: sandbox.stub(),
            listInstalledBundles: sandbox.stub(),
            getBundleDetails: sandbox.stub()
        };
        
        const mockSourceOps = {
            listSources: sandbox.stub(),
            syncSource: sandbox.stub()
        };
        
        const service = new AutoUpdateService(
            mockBundleOps as any,
            mockSourceOps as any,
            mockNotifications as any,
            storage as any
        );

        return {
            service,
            mockStorage: storage,
            mockNotifications,
            mockBundleOps,
            mockSourceOps
        };
    }

    /**
     * Convenience methods for common assertion patterns
     * These wrap standard assertions to reduce boilerplate in tests
     * Use standard assertions (assert.strictEqual) for more complex scenarios
     */
    
    /**
     * Assert that setUpdatePreference was called with correct parameters
     * Wrapper around standard assertions for common pattern
     */
    static assertPreferenceStored(
        mockStorage: sinon.SinonStubbedInstance<RegistryStorage>,
        bundleId: string,
        expectedValue: boolean,
        callIndex: number = 0
    ): void {
        const assert = require('assert');
        assert.strictEqual(mockStorage.setUpdatePreference.callCount, callIndex + 1, 
            `Expected setUpdatePreference to be called ${callIndex + 1} times`);
        assert.strictEqual(mockStorage.setUpdatePreference.getCall(callIndex).args[0], bundleId,
            `Expected bundleId '${bundleId}' at call ${callIndex}`);
        assert.strictEqual(mockStorage.setUpdatePreference.getCall(callIndex).args[1], expectedValue,
            `Expected enabled '${expectedValue}' at call ${callIndex}`);
    }

    /**
     * Assert that getUpdatePreference was called with correct parameters
     * Wrapper around standard assertions for common pattern
     */
    static assertPreferenceRetrieved(
        mockStorage: sinon.SinonStubbedInstance<RegistryStorage>,
        bundleId: string,
        callIndex: number = 0
    ): void {
        const assert = require('assert');
        assert.ok(mockStorage.getUpdatePreference.callCount > callIndex,
            `Expected getUpdatePreference to be called at least ${callIndex + 1} times`);
        assert.strictEqual(mockStorage.getUpdatePreference.getCall(callIndex).args[0], bundleId,
            `Expected bundleId '${bundleId}' at call ${callIndex}`);
    }

    /**
     * Create test data using existing bundleTestHelpers utilities
     * Promotes reuse of established factory functions
     */
    
    /**
     * Create a mock installed bundle for auto-update tests
     * Delegates to existing bundleTestHelpers factory
     */
    static createTestInstalledBundle(
        bundleId: string,
        version: string,
        overrides?: any
    ) {
        return createMockInstalledBundle(bundleId, version, overrides);
    }

    /**
     * Create a mock update check result for auto-update tests
     * Delegates to existing bundleTestHelpers factory
     */
    static createTestUpdateResult(
        bundleId: string,
        currentVersion: string,
        latestVersion: string,
        overrides?: any
    ) {
        return createMockUpdateCheckResult(bundleId, currentVersion, latestVersion, overrides);
    }
}