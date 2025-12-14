/**
 * Profile Management Commands
 * Handles profile creation, editing, activation, import/export, and deletion
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { RegistryManager } from '../services/RegistryManager';
import { Profile, ProfileBundle } from '../types/registry';
import { Logger } from '../utils/logger';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

/**
 * Profile Icons with search keywords
 */
const PROFILE_ICONS = [
    // Software & Development
    { icon: '🚀', label: 'Rocket', tags: 'launch, deploy, speed, fast, startup' },
    { icon: '📦', label: 'Package', tags: 'bundle, build, delivery, box, container' },
    { icon: '💻', label: 'Computer', tags: 'code, dev, programming, tech, laptop, work' },
    { icon: '🖥️', label: 'Desktop', tags: 'screen, monitor, pc, work' },
    { icon: '⌨️', label: 'Keyboard', tags: 'type, input, code, writing' },
    { icon: '�', label: 'Floppy', tags: 'save, storage, legacy, disk' },
    { icon: '💿', label: 'Disc', tags: 'cd, dvd, storage, data, media' },
    { icon: '�', label: 'Plug', tags: 'api, connect, integration, power' },
    { icon: '📡', label: 'Satellite', tags: 'communication, signal, remote, broadcast' },
    { icon: '☁️', label: 'Cloud', tags: 'server, host, remote, sky, aws, azure' },
    { icon: '🌐', label: 'Web', tags: 'internet, browser, globe, world, http' },
    { icon: '🐛', label: 'Bug', tags: 'debug, issue, fix, error, qa, test' },
    { icon: '🦠', label: 'Microbe', tags: 'virus, bug, issue, small' },
    { icon: '🔧', label: 'Wrench', tags: 'tools, fix, settings, config' },
    { icon: '🔨', label: 'Hammer', tags: 'build, construct, fix' },
    { icon: '🛠️', label: 'Tools', tags: 'utility, settings, fix, repair, maintenance' },
    { icon: '⚙️', label: 'Gear', tags: 'settings, config, options, engine' },
    { icon: '⛓️', label: 'Chains', tags: 'link, connect, blockchain, security' },
    { icon: '🧬', label: 'DNA', tags: 'core, structure, biology, life' },
    { icon: '⚛️', label: 'Atom', tags: 'react, physics, science, core' },
    { icon: '�', label: 'Snake', tags: 'python, script, reptile' },
    { icon: '☕', label: 'Coffee', tags: 'java, break, drink, hot' },
    { icon: '�', label: 'Elephant', tags: 'php, large, database, postgres' },
    { icon: '🐳', label: 'Whale', tags: 'docker, container, sea, ocean' },
    { icon: '🐙', label: 'Octopus', tags: 'github, git, complex, sea' },
    { icon: '🐧', label: 'Penguin', tags: 'linux, open source, cold' },
    { icon: '🤖', label: 'Robot', tags: 'bot, ai, automation, smart, android' },
    { icon: '🧠', label: 'Brain', tags: 'intelligence, smart, logic, think, ai, ml' },
    { icon: '�️', label: 'Joystick', tags: 'game, play, control, fun' },
    { icon: '📱', label: 'Mobile', tags: 'phone, app, device, responsive' },

    // Security & Access
    { icon: '🔒', label: 'Lock', tags: 'security, protect, auth, safe, private' },
    { icon: '🔓', label: 'Unlock', tags: 'open, access, public, insecure' },
    { icon: '🔑', label: 'Key', tags: 'lock, access, secret, auth, password' },
    { icon: '🛡️', label: 'Shield', tags: 'security, protect, guard, safe, firewall' },
    { icon: '�️', label: 'Eye', tags: 'vision, monitor, watch, see, view' },
    { icon: '🚧', label: 'Barrier', tags: 'block, construction, wip, stop' },

    // Business, Product & Analytics
    { icon: '📊', label: 'Chart', tags: 'data, analytics, stats, graph, report, bi' },
    { icon: '📈', label: 'Chart Up', tags: 'growth, profit, success, trend, increase' },
    { icon: '📉', label: 'Chart Down', tags: 'loss, decrease, trend, drop' },
    { icon: '📋', label: 'Clipboard', tags: 'plan, checklist, task, todo, audit' },
    { icon: '📅', label: 'Calendar', tags: 'date, plan, schedule, event, time' },
    { icon: '📝', label: 'Memo', tags: 'note, write, draft, text, docs' },
    { icon: '�', label: 'Folder', tags: 'file, organize, group, directory' },
    { icon: '📇', label: 'Card Index', tags: 'contacts, data, organize' },
    { icon: '📌', label: 'Pushpin', tags: 'pin, sticky, note, location' },
    { icon: '🎨', label: 'Palette', tags: 'design, art, creative, ui, ux, color' },
    { icon: '�', label: 'Bulb', tags: 'idea, solution, light, think, innovation' },
    { icon: '📢', label: 'Megaphone', tags: 'announce, shout, news, marketing, promo' },
    { icon: '💰', label: 'Money', tags: 'finance, cash, dollar, price, cost, budget' },
    { icon: '💳', label: 'Credit Card', tags: 'payment, buy, finance' },
    { icon: '🧾', label: 'Receipt', tags: 'bill, proof, transaction' },
    { icon: '🛒', label: 'Cart', tags: 'shop, store, buy, ecommerce, retail' },
    { icon: '🛍️', label: 'Bags', tags: 'shopping, retail, buy' },
    { icon: '🎁', label: 'Gift', tags: 'present, reward, bonus, package' },
    { icon: '🤝', label: 'Handshake', tags: 'deal, partner, agree, meeting' },
    { icon: '👥', label: 'Team', tags: 'people, group, users, collab' },
    { icon: '�', label: 'User', tags: 'person, profile, account, customer' },
    { icon: '🏢', label: 'Office', tags: 'building, work, company, enterprise' },
    { icon: '🏗️', label: 'Building', tags: 'architecture, construct, wip, structure' },
    
    // Travel (Amadeus Core)
    { icon: '✈️', label: 'Airplane', tags: 'flight, fly, travel, trip, airport' },
    { icon: '🛫', label: 'Departure', tags: 'takeoff, leave, start, flight' },
    { icon: '🛬', label: 'Arrival', tags: 'landing, arrive, end, flight' },
    { icon: '🎫', label: 'Ticket', tags: 'pass, entry, booking, reservation' },
    { icon: '🛂', label: 'Passport', tags: 'control, border, id, travel' },
    { icon: '🧳', label: 'Luggage', tags: 'baggage, suitcase, trip, pack' },
    { icon: '🏨', label: 'Hotel', tags: 'sleep, accommodation, stay, booking' },
    { icon: '🛌', label: 'Bed', tags: 'sleep, rest, hotel, room' },
    { icon: '🗺️', label: 'Map', tags: 'location, guide, navigation, world' },
    { icon: '🧭', label: 'Compass', tags: 'direction, guide, explore, nav' },
    { icon: '🏖️', label: 'Beach', tags: 'vacation, holiday, sun, sea, leisure' },
    { icon: '⛰️', label: 'Mountain', tags: 'nature, hike, view, landscape' },
    { icon: '🏙️', label: 'City', tags: 'urban, town, buildings, skyline' },
    { icon: '🏝️', label: 'Island', tags: 'vacation, sea, land, tropical' },
    { icon: '�', label: 'Globe', tags: 'world, earth, international, travel' },

    // Transport (Rail, Car, Cruise)
    { icon: '🚗', label: 'Car', tags: 'rental, drive, vehicle, auto, road' },
    { icon: '�', label: 'Taxi', tags: 'cab, ride, transport, car' },
    { icon: '🚌', label: 'Bus', tags: 'transport, public, ride' },
    { icon: '🏎️', label: 'Race Car', tags: 'speed, fast, sport' },
    { icon: '🚓', label: 'Police', tags: 'security, guard, law' },
    { icon: '🚑', label: 'Ambulance', tags: 'health, medical, emergency' },
    { icon: '🚚', label: 'Truck', tags: 'delivery, cargo, transport, logistics' },
    { icon: '�', label: 'Locomotive', tags: 'train, steam, old, rail' },
    { icon: '🚆', label: 'Train', tags: 'rail, transport, commute, station' },
    { icon: '🚄', label: 'Fast Train', tags: 'speed, rail, modern, travel' },
    { icon: '🚋', label: 'Tram', tags: 'city, rail, transport' },
    { icon: '🚇', label: 'Metro', tags: 'subway, underground, tube, rail' },
    { icon: '🚢', label: 'Ship', tags: 'cruise, boat, sea, ocean, travel' },
    { icon: '�️', label: 'Cruise Ship', tags: 'passenger, holiday, sea, boat' },
    { icon: '🚤', label: 'Speedboat', tags: 'fast, sea, fun' },
    { icon: '⚓', label: 'Anchor', tags: 'sea, ship, port, marine' },
    { icon: '⛽', label: 'Fuel', tags: 'gas, station, energy, car' },
    { icon: '🚦', label: 'Traffic Light', tags: 'signal, road, stop, go' },
    { icon: '�', label: 'Stop', tags: 'sign, halt, warning' },

    // Science & QA
    { icon: '🔬', label: 'Microscope', tags: 'science, research, test, analysis, lab' },
    { icon: '🧪', label: 'Test Tube', tags: 'experiment, chemistry, lab, test' },
    { icon: '🌡️', label: 'Thermometer', tags: 'temperature, measure, heat, cold' },
    { icon: '🎯', label: 'Target', tags: 'goal, objective, focus, aim, accuracy' },
    { icon: '✅', label: 'Check', tags: 'done, success, pass, qa, verify' },
    { icon: '❎', label: 'Cross', tags: 'fail, error, wrong, delete' },
    { icon: '⚠️', label: 'Warning', tags: 'alert, caution, danger, issue' },
    { icon: '❓', label: 'Question', tags: 'help, ask, unknown, query' },

    // Misc
    { icon: '⚡', label: 'Zap', tags: 'power, energy, instant, fast, electric' },
    { icon: '🌟', label: 'Star', tags: 'favorite, special, featured, top, rating' },
    { icon: '🔥', label: 'Fire', tags: 'hot, trending, urgent, burn' },
    { icon: '🎓', label: 'Cap', tags: 'education, school, student, learn, degree' },
    { icon: '🎪', label: 'Circus', tags: 'fun, event, play, show' },
    { icon: '🎭', label: 'Masks', tags: 'role, persona, acting, theater' },
    { icon: '�', label: 'Gem', tags: 'ruby, crystal, value, rich' },
    { icon: '🕰️', label: 'Clock', tags: 'time, wait, schedule, deadline' },
    { icon: '⏱️', label: 'Stopwatch', tags: 'timer, race, speed, measure' },
    { icon: '🏆', label: 'Trophy', tags: 'winner, award, success, top' },
    { icon: '🥇', label: 'Medal', tags: 'first, winner, gold' },
    { icon: '🎵', label: 'Music', tags: 'note, sound, audio, play' },
    { icon: '🍔', label: 'Burger', tags: 'food, lunch, eat' },
    { icon: '🍕', label: 'Pizza', tags: 'food, lunch, eat' },
];

/**
 * Profile Commands Handler
 */
export class ProfileCommands {
    private logger: Logger;

    constructor(private registryManager: RegistryManager) {
        this.logger = Logger.getInstance();
    }

    /**
     * Create a new profile
     */
    async createProfile(): Promise<void> {
        try {
            // Step 1: Get profile name
            const name = await vscode.window.showInputBox({
                prompt: 'Enter profile name',
                placeHolder: 'e.g., Full-Stack Developer',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Profile name is required';
                    }
                    if (value.length > 50) {
                        return 'Profile name must be less than 50 characters';
                    }
                    return undefined;
                },
                ignoreFocusOut: true
            });

            if (!name) {
                return; // User cancelled
            }

            // Step 2: Get profile description
            const description = await vscode.window.showInputBox({
                prompt: 'Enter profile description (optional)',
                placeHolder: 'e.g., Prompts for full-stack web development',
                ignoreFocusOut: true
            }) || '';

            // Step 3: Select icon
            const icon = await this.selectIcon('Profile Icon') || '📦';

            // Step 4: Select bundles
            const bundles = await this.selectBundles();

            if (!bundles || bundles.length === 0) {
                const proceed = await vscode.window.showWarningMessage(
                    'No bundles selected. Create empty profile?',
                    'Yes', 'No'
                );
                
                if (proceed !== 'Yes') {
                    return;
                }
            }

            // Create profile with unique ID
            let profileId = this.generateProfileId(name);
            
            // Check if ID conflicts with existing profiles (hub or local)
            const existingProfiles = await this.registryManager.listProfiles();
            let counter = 1;
            let originalId = profileId;
            while (existingProfiles.some(p => p.id === profileId)) {
                profileId = `${originalId}-${counter}`;
                counter++;
            }
            
            if (profileId !== originalId) {
                this.logger.info(`Profile ID '${originalId}' already exists, using '${profileId}' instead`);
            }

            // Create profile
            const profile: Omit<Profile, 'createdAt' | 'updatedAt'> = {
                id: profileId,
                name: name.trim(),
                description: description.trim(),
                icon,
                bundles: bundles || [],
                active: false,
            };

            await this.registryManager.createProfile(profile);

            vscode.window.showInformationMessage(
                `Profile "${name}" created successfully!`,
                'Activate Now', 'View Profiles'
            ).then(action => {
                if (action === 'Activate Now') {
                    this.activateProfile(profile.id);
                }
            });

        } catch (error) {
            this.logger.error('Failed to create profile', error as Error);
            vscode.window.showErrorMessage(`Failed to create profile: ${(error as Error).message}`);
        }
    }

    /**
     * Edit an existing profile
     */
    async editProfile(profileId?: string | any): Promise<void> {
        try {
            // Extract profile ID from tree item if object is passed
            let targetProfileId: string | undefined;
            if (typeof profileId === 'string') {
                targetProfileId = profileId;
            } else if (profileId && typeof profileId === 'object' && profileId.data) {
                if (profileId.data.id) {
                    targetProfileId = profileId.data.id;
                }
            }
            
            // If no profileId, let user select
            if (!targetProfileId) {
                const profiles = await this.registryManager.listProfiles();
                
                if (profiles.length === 0) {
                    vscode.window.showInformationMessage('No profiles found. Create one first.');
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    profiles.map(p => ({
                        label: `${p.icon} ${p.name}`,
                        description: p.description,
                        detail: `${p.bundles.length} bundles${p.active ? ' (Active)' : ''}`,
                        profile: p
                    })),
                    {
                        placeHolder: 'Select profile to edit',
                        title: 'Edit Profile',
                        ignoreFocusOut: true
                    }
                );

                if (!selected) {
                    return;
                }

                targetProfileId = selected.profile.id;
            }

            const profiles = await this.registryManager.listProfiles();
            const profile = profiles.find(p => p.id === targetProfileId);

            if (!profile) {
                vscode.window.showErrorMessage('Profile not found');
                return;
            }

            // Show edit options
            const action = await vscode.window.showQuickPick(
                [
                    { label: '$(edit) Rename', value: 'rename' },
                    { label: '$(note) Edit Description', value: 'description' },
                    { label: '$(symbol-color) Change Icon', value: 'icon' },
                    { label: '$(package) Manage Bundles', value: 'bundles' },
                ],
                {
                    placeHolder: `Edit "${profile.name}"`,
                    title: 'Profile Edit Options',
                    ignoreFocusOut: true
                }
            );

            if (!action) {
                return;
            }

            switch (action.value) {
                case 'rename':
                    await this.renameProfile(targetProfileId);
                    break;
                case 'description':
                    await this.updateDescription(targetProfileId);
                    break;
                case 'icon':
                    await this.changeIcon(targetProfileId);
                    break;
                case 'bundles':
                    await this.manageBundles(targetProfileId);
                    break;
            }

        } catch (error) {
            this.logger.error('Failed to edit profile', error as Error);
            vscode.window.showErrorMessage(`Failed to edit profile: ${(error as Error).message}`);
        }
    }

    /**
     * Activate a profile
     */

    async activateProfile(profileId?: string | any): Promise<void> {
        try {
            let targetProfileId: string;

            // Handle tree item click (object with data property)
            if (profileId && typeof profileId === 'object' && 'data' in profileId) {
                targetProfileId = profileId.data.id;
                this.logger.info(`Activating profile from tree item: ${targetProfileId}`);
            } 
            // Handle direct profile ID
            else if (typeof profileId === 'string') {
                targetProfileId = profileId;
                this.logger.info(`Activating profile by ID: ${targetProfileId}`);
            } 
            // No profile specified - show picker
            else {
                const profiles = await this.registryManager.listProfiles();
                
                if (profiles.length === 0) {
                    vscode.window.showInformationMessage('No profiles available. Create one first.');
                    return;
                }

                const items = profiles.map(profile => ({
                    label: profile.name,
                    description: profile.description,
                    profile
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a profile to activate',
                    title: 'Activate Profile',
                    ignoreFocusOut: true
                });

                if (!selected) {
                    return;
                }

                targetProfileId = selected.profile.id;
            }

            // Activate the profile
            await this.registryManager.activateProfile(targetProfileId);

            vscode.window.showInformationMessage(`Profile activated successfully`);
            this.logger.info(`Profile activated: ${targetProfileId}`);

        } catch (error) {
            this.logger.error('Failed to activate profile', error as Error);
            vscode.window.showErrorMessage(`Failed to activate profile: ${(error as Error).message}`);
        }
    }

    
    /**
     * Deactivate a profile
     */
    async deactivateProfile(profileIdOrItem?: string | any): Promise<void> {
        try {
            let targetProfileId: string;

            // Handle tree item click (object with data property)
            if (profileIdOrItem && typeof profileIdOrItem === 'object' && 'data' in profileIdOrItem) {
                targetProfileId = profileIdOrItem.data.id;
                this.logger.info(`Deactivating profile from tree item: ${targetProfileId}`);
            } 
            // Handle direct profile ID
            else if (typeof profileIdOrItem === 'string') {
                targetProfileId = profileIdOrItem;
                this.logger.info(`Deactivating profile by ID: ${targetProfileId}`);
            } 
            // No profile specified - show picker
            else {
                const profiles = await this.registryManager.listProfiles();
                const activeProfiles = profiles.filter(p => p.active);
                
                if (activeProfiles.length === 0) {
                    vscode.window.showInformationMessage('No active profiles to deactivate');
                    return;
                }

                const items = activeProfiles.map(profile => ({
                    label: profile.name,
                    description: profile.description,
                    profile
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a profile to deactivate',
                    title: 'Deactivate Profile',
                    ignoreFocusOut: true
                });

                if (!selected) {
                    return;
                }

                targetProfileId = selected.profile.id;
            }

            // Deactivate the profile
            await this.registryManager.deactivateProfile(targetProfileId);

            vscode.window.showInformationMessage(`Profile deactivated successfully`);
            this.logger.info(`Profile deactivated: ${targetProfileId}`);

        } catch (error) {
            this.logger.error('Failed to deactivate profile', error as Error);
            vscode.window.showErrorMessage(`Failed to deactivate profile: ${(error as Error).message}`);
        }
    }

    /**
     * Delete a profile
     * For local profiles: deletes the profile
     * For hub profiles (in favorites view): deactivates and removes from favorites
     */
    async deleteProfile(profileId?: string | any): Promise<void> {
        try {
            let targetProfileId: string | undefined;
            let hubId: string | undefined;
            let profileData: any;
            
            // Extract profile ID and hubId from tree item if object is passed
            if (profileId && typeof profileId === 'object' && 'data' in profileId && profileId.data) {
                profileData = profileId.data;
                targetProfileId = profileData.id;
                hubId = profileData.hubId;
                this.logger.info(`Deleting profile from tree item: ${targetProfileId}, hubId: ${hubId}`);
            } else if (typeof profileId === 'string') {
                targetProfileId = profileId;
            }
            
            // If no profileId, let user select
            if (!targetProfileId) {
                const profiles = await this.registryManager.listProfiles();
                
                if (profiles.length === 0) {
                    vscode.window.showInformationMessage('No profiles found.');
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    profiles.map(p => ({
                        label: `${p.icon} ${p.name}`,
                        description: p.description,
                        detail: `${p.bundles.length} bundles${p.active ? ' (Active)' : ''}`,
                        profile: p
                    })),
                    {
                        placeHolder: 'Select profile to delete',
                        title: 'Delete Profile',
                        ignoreFocusOut: true
                    }
                );

                if (!selected) {
                    return;
                }

                targetProfileId = selected.profile.id;
            }

            const profiles = await this.registryManager.listProfiles();
            const profile = profiles.find(p => p.id === targetProfileId);

            if (!profile) {
                vscode.window.showErrorMessage('Profile not found');
                return;
            }

            // Confirm deletion for local profiles
            // Note: If profile exists in registryManager.listProfiles(), it's a local profile and can be deleted.
            // The isHubProfile check was removed because local copies of hub profiles should be deletable.
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to delete profile "${profile.name}"?`,
                { modal: true },
                'Delete', 'Cancel'
            );

            if (confirmation !== 'Delete') {
                return;
            }

            await this.registryManager.deleteProfile(targetProfileId!);

            vscode.window.showInformationMessage(
                `Profile "${profile.name}" deleted successfully`
            );

        } catch (error) {
            this.logger.error('Failed to delete profile', error as Error);
            vscode.window.showErrorMessage(`Failed to delete profile: ${(error as Error).message}`);
        }
    }

    /**
     * Export a profile
     */
    async exportProfile(profileId?: string): Promise<void> {
        try {
            // If no profileId, let user select
            if (!profileId) {
                const profiles = await this.registryManager.listProfiles();
                
                if (profiles.length === 0) {
                    vscode.window.showInformationMessage('No profiles found.');
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    profiles.map(p => ({
                        label: `${p.icon} ${p.name}`,
                        description: p.description,
                        profile: p
                    })),
                    {
                        placeHolder: 'Select profile to export',
                        title: 'Export Profile',
                        ignoreFocusOut: true
                    }
                );

                if (!selected) {
                    return;
                }

                profileId = selected.profile.id;
            }

            const profileJson = await this.registryManager.exportProfile(profileId);
            const profile = JSON.parse(profileJson) as Profile;

            // Ask where to save
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`${profile.name.toLowerCase().replace(/\s+/g, '-')}.json`),
                filters: {
                    'JSON Files': ['json'],
                    'All Files': ['*']
                },
                title: `Export Profile: ${profile.name}`
            });

            if (!uri) {
                return;
            }

            await writeFile(uri.fsPath, profileJson, 'utf-8');

            vscode.window.showInformationMessage(
                `Profile "${profile.name}" exported successfully!`,
                'Open File'
            ).then(action => {
                if (action === 'Open File') {
                    vscode.commands.executeCommand('vscode.open', uri);
                }
            });

        } catch (error) {
            this.logger.error('Failed to export profile', error as Error);
            vscode.window.showErrorMessage(`Failed to export profile: ${(error as Error).message}`);
        }
    }

    /**
     * Import a profile
     */
    async importProfile(): Promise<void> {
        try {
            // Ask for file
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: {
                    'JSON Files': ['json'],
                    'All Files': ['*']
                },
                title: 'Import Profile'
            });

            if (!uris || uris.length === 0) {
                return;
            }

            const content = await readFile(uris[0].fsPath, 'utf-8');
            const profile = await this.registryManager.importProfile(content);

            vscode.window.showInformationMessage(
                `Profile "${profile.name}" imported successfully!`,
                'Activate Now', 'View Profiles'
            ).then(action => {
                if (action === 'Activate Now') {
                    this.activateProfile(profile.id);
                }
            });

        } catch (error) {
            this.logger.error('Failed to import profile', error as Error);
            vscode.window.showErrorMessage(`Failed to import profile: ${(error as Error).message}`);
        }
    }

    /**
     * List all profiles
     */
    async listProfiles(): Promise<void> {
        try {
            const profiles = await this.registryManager.listProfiles();

            if (profiles.length === 0) {
                vscode.window.showInformationMessage(
                    'No profiles found. Create one to get started!',
                    'Create Profile'
                ).then(action => {
                    if (action === 'Create Profile') {
                        this.createProfile();
                    }
                });
                return;
            }

            const selected = await vscode.window.showQuickPick(
                profiles.map(p => ({
                    label: `${p.icon} ${p.name}${p.active ? ' ⭐' : ''}`,
                    description: p.description,
                    detail: `${p.bundles.length} bundles • ${p.active ? 'Active' : 'Inactive'}`,
                    profile: p
                })),
                {
                    placeHolder: 'Select a profile to view details',
                    title: 'My Profiles'
                }
            );

            if (selected) {
                // Show profile actions
                const action = await vscode.window.showQuickPick([
                    { label: '$(check) Activate', value: 'activate', enabled: !selected.profile.active },
                    { label: '$(edit) Edit', value: 'edit', enabled: true },
                    { label: '$(export) Export', value: 'export', enabled: true },
                    { label: '$(trash) Delete', value: 'delete', enabled: true },
                ].filter(a => a.enabled), {
                    placeHolder: `Actions for "${selected.profile.name}"`,
                    title: 'Profile Actions'
                });

                if (action) {
                    switch (action.value) {
                        case 'activate':
                            await this.activateProfile(selected.profile.id);
                            break;
                        case 'edit':
                            await this.editProfile(selected.profile.id);
                            break;
                        case 'export':
                            await this.exportProfile(selected.profile.id);
                            break;
                        case 'delete':
                            await this.deleteProfile(selected.profile.id);
                            break;
                    }
                }
            }

        } catch (error) {
            this.logger.error('Failed to list profiles', error as Error);
            vscode.window.showErrorMessage(`Failed to list profiles: ${(error as Error).message}`);
        }
    }

    // ===== Helper Methods =====

    /**
     * Select bundles for profile
     */
    private async selectBundles(): Promise<ProfileBundle[]> {
        try {
            // Search all available bundles
            const allBundles = await this.registryManager.searchBundles({});

            if (allBundles.length === 0) {
                vscode.window.showWarningMessage('No bundles available. Add a source first.');
                return [];
            }

            const selected = await vscode.window.showQuickPick(
                allBundles.map(b => ({
                    label: b.name,
                    description: `v${b.version} • ${b.author}`,
                    detail: b.description,
                    picked: false,
                    bundle: b
                })),
                {
                    placeHolder: 'Select bundles to add to profile',
                    canPickMany: true,
                    title: 'Bundle Selection',
                    ignoreFocusOut: true
                }
            );

            if (!selected || selected.length === 0) {
                return [];
            }

            // Ask if bundles are required or optional
            const profileBundles: ProfileBundle[] = [];

            for (const item of selected) {
                const required = await vscode.window.showQuickPick(
                    [
                        { label: '✓ Required', value: true, description: 'Bundle must be installed' },
                        { label: '○ Optional', value: false, description: 'Bundle can be installed later' }
                    ],
                    {
                        placeHolder: `Is "${item.bundle.name}" required?`,
                        title: 'Bundle Requirement',
                        ignoreFocusOut: true
                    }
                );

                if (required !== undefined) {
                    profileBundles.push({
                        id: item.bundle.id,
                        version: 'latest',
                        required: required.value
                    });
                }
            }

            return profileBundles;

        } catch (error) {
            this.logger.error('Failed to select bundles', error as Error);
            return [];
        }
    }

    /**
     * Select an icon from the expanded list
     */
    private async selectIcon(title: string): Promise<string | undefined> {
        const items = PROFILE_ICONS.map(i => ({
            label: `${i.icon} ${i.label}`,
            description: i.tags,
            detail: 'Search by keywords',
            iconChar: i.icon
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an icon (type to search by keywords)',
            title: title,
            matchOnDescription: true,
            ignoreFocusOut: true
        });

        return selected ? selected.iconChar : undefined;
    }

    /**
     * Generate profile ID from name
     */
    private generateProfileId(name: string): string {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }

    /**
     * Rename profile
     */
    private async renameProfile(profileId: string): Promise<void> {
        const profiles = await this.registryManager.listProfiles();
        const profile = profiles.find(p => p.id === profileId);

        if (!profile) {
            return;
        }

        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new profile name',
            value: profile.name,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Profile name is required';
                }
                return undefined;
            },
            ignoreFocusOut: true
        });

        if (newName && newName !== profile.name) {
            await this.registryManager.updateProfile(profileId, { name: newName });
            vscode.window.showInformationMessage(`Profile renamed to "${newName}"`);
        }
    }

    /**
     * Update profile description
     */
    private async updateDescription(profileId: string): Promise<void> {
        const profiles = await this.registryManager.listProfiles();
        const profile = profiles.find(p => p.id === profileId);

        if (!profile) {
            return;
        }

        const newDescription = await vscode.window.showInputBox({
            prompt: 'Enter new description',
            value: profile.description,
            ignoreFocusOut: true
        });

        if (newDescription !== undefined && newDescription !== profile.description) {
            await this.registryManager.updateProfile(profileId, { description: newDescription });
            vscode.window.showInformationMessage('Profile description updated');
        }
    }

    /**
     * Change profile icon
     */
    private async changeIcon(profileId: string): Promise<void> {
        const selectedIcon = await this.selectIcon('Change Profile Icon');

        if (selectedIcon) {
            await this.registryManager.updateProfile(profileId, { icon: selectedIcon });
            vscode.window.showInformationMessage('Profile icon updated');
        }
    }

    /**
     * Manage profile bundles
     */
    private async manageBundles(profileId: string): Promise<void> {
        const action = await vscode.window.showQuickPick([
            { label: '$(add) Add Bundles', value: 'add' },
            { label: '$(remove) Remove Bundles', value: 'remove' },
        ], {
            placeHolder: 'Bundle Management',
            title: 'Manage Profile Bundles',
            ignoreFocusOut: true
        });

        if (!action) {
            return;
        }

        if (action.value === 'add') {
            const newBundles = await this.selectBundles();
            if (newBundles.length > 0) {
                const profiles = await this.registryManager.listProfiles();
                const profile = profiles.find(p => p.id === profileId);
                if (profile) {
                    const updatedBundles = [...profile.bundles, ...newBundles];
                    await this.registryManager.updateProfile(profileId, { bundles: updatedBundles });
                    vscode.window.showInformationMessage(`Added ${newBundles.length} bundle(s)`);
                }
            }
        } else {
            // Remove bundles
            const profiles = await this.registryManager.listProfiles();
            const profile = profiles.find(p => p.id === profileId);

            if (profile && profile.bundles.length > 0) {
                const bundleDetails = await Promise.all(
                    profile.bundles.map(async pb => {
                        try {
                            const bundle = await this.registryManager.getBundleDetails(pb.id);
                            return { bundle, profileBundle: pb };
                        } catch {
                            return { bundle: null, profileBundle: pb };
                        }
                    })
                );

                const toRemove = await vscode.window.showQuickPick(
                    bundleDetails.map(bd => ({
                        label: bd.bundle?.name || bd.profileBundle.id,
                        description: `v${bd.profileBundle.version}`,
                        detail: bd.profileBundle.required ? 'Required' : 'Optional',
                        profileBundle: bd.profileBundle
                    })),
                    {
                        placeHolder: 'Select bundles to remove',
                        canPickMany: true,
                        title: 'Remove Bundles',
                        ignoreFocusOut: true
                    }
                );

                if (toRemove && toRemove.length > 0) {
                    const idsToRemove = new Set(toRemove.map(r => r.profileBundle.id));
                    const updatedBundles = profile.bundles.filter(b => !idsToRemove.has(b.id));
                    await this.registryManager.updateProfile(profileId, { bundles: updatedBundles });
                    vscode.window.showInformationMessage(`Removed ${toRemove.length} bundle(s)`);
                }
            }
        }
    }
}


