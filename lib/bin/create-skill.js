#!/usr/bin/env node
/**
 * Create Agent Skill
 * 
 * Interactive wizard or CLI to create a new skill folder following the
 * Agent Skills specification: https://agentskills.io/specification
 */

const path = require('path');
const readline = require('readline');
const { createSkill, validateSkillName, validateSkillDescription } = require('../dist/skills');

function parseArgs(argv) {
    const out = { skillName: undefined, description: undefined, skillsDir: 'skills', interactive: true };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--skills-dir' && argv[i + 1]) {
            out.skillsDir = argv[i + 1];
            i++;
        } else if (arg === '--description' && argv[i + 1]) {
            out.description = argv[i + 1];
            out.interactive = false;
            i++;
        } else if (arg === '--non-interactive' || arg === '-n') {
            out.interactive = false;
        } else if (!arg.startsWith('--') && !out.skillName) {
            out.skillName = arg;
        }
    }
    return out;
}

function askQuestion(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

async function runInteractive(args) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('\n🛠️  Create New Agent Skill\n');
    console.log('Agent Skills give Copilot domain-specific capabilities.');
    console.log('See: https://agentskills.io/specification\n');

    const repoRoot = process.cwd();

    // Get skill name
    let name = args.skillName;
    while (!name) {
        name = await askQuestion(rl, 'Skill name (lowercase letters, numbers, hyphens): ');
        const nameError = validateSkillName(name);
        if (nameError) {
            console.error(`❌ ${nameError}`);
            name = null;
        }
    }

    // Get description
    let description = args.description;
    while (!description) {
        description = await askQuestion(rl, 'Description (10-1024 chars): ');
        const descError = validateSkillDescription(description);
        if (descError) {
            console.error(`❌ ${descError}`);
            description = null;
        }
    }

    rl.close();

    const result = createSkill(repoRoot, name, description, args.skillsDir);
    
    if (result.success) {
        console.log(`\n✅ Skill created successfully at: ${args.skillsDir}/${name}/`);
        console.log('\nNext steps:');
        console.log(`  1. Edit ${args.skillsDir}/${name}/SKILL.md to add detailed instructions`);
        console.log('  2. Add any bundled assets if needed');
        console.log('  3. Run "npm run skill:validate" to verify');
        console.log('  4. Add the skill to a collection.yml file');
    } else {
        console.error(`\n❌ Failed to create skill: ${result.error}`);
        process.exit(1);
    }
}

function runNonInteractive(args) {
    if (!args.skillName) {
        console.error('Usage: create-skill <skill-name> [--description <desc>] [--skills-dir <dir>]');
        console.error('');
        console.error('Options:');
        console.error('  --description <desc>  Skill description (required in non-interactive mode)');
        console.error('  --skills-dir <dir>    Skills directory (default: skills)');
        console.error('  --non-interactive     Run without prompts');
        process.exit(1);
    }

    if (!args.description) {
        console.error('❌ Description is required in non-interactive mode. Use --description <desc>');
        process.exit(1);
    }

    const repoRoot = process.cwd();
    const result = createSkill(repoRoot, args.skillName, args.description, args.skillsDir);

    if (result.success) {
        console.log(`✅ Created skill: ${args.skillName}`);
        console.log(`   Location: ${result.path}`);
        console.log('');
        console.log('Next steps:');
        console.log(`  1. Edit ${result.path}/SKILL.md`);
        console.log('  2. Add any bundled assets if needed');
        console.log('  3. Run "npm run skill:validate" to verify');
    } else {
        console.error(`❌ Failed to create skill: ${result.error}`);
        process.exit(1);
    }
}

const args = parseArgs(process.argv.slice(2));

if (args.interactive && process.stdin.isTTY) {
    runInteractive(args).catch(error => {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    });
} else {
    runNonInteractive(args);
}
