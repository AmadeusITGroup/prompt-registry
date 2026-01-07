#!/usr/bin/env node
/**
 * Create Agent Skill
 * 
 * Interactive wizard to create a new skill folder following the
 * Agent Skills specification: https://agentskills.io/specification
 * 
 * Attribution: Based on github/awesome-copilot creation patterns
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

function validateSkillName(name) {
    if (!name || typeof name !== 'string') {
        return 'Name is required';
    }
    if (!/^[a-z0-9-]+$/.test(name)) {
        return 'Name must contain only lowercase letters, numbers, and hyphens';
    }
    if (name.length > 64) {
        return 'Name must not exceed 64 characters';
    }
    return null;
}

function validateDescription(description) {
    if (!description || typeof description !== 'string') {
        return 'Description is required';
    }
    if (description.length < 10) {
        return 'Description must be at least 10 characters';
    }
    if (description.length > 1024) {
        return 'Description must not exceed 1024 characters';
    }
    return null;
}

function generateSkillContent(name, description) {
    return `---
name: ${name}
description: "${description}"
---

# ${name}

${description}

## Capabilities

Describe what this skill enables Copilot to do.

## Usage

Explain when and how Copilot should use this skill.

## Examples

Provide example interactions or use cases.
`;
}

async function createSkill() {
    console.log('\n🛠️  Create New Agent Skill\n');
    console.log('Agent Skills give Copilot domain-specific capabilities.');
    console.log('See: https://agentskills.io/specification\n');

    // Get skill name
    let name;
    while (true) {
        name = await askQuestion('Skill name (lowercase letters, numbers, hyphens): ');
        const nameError = validateSkillName(name);
        if (nameError) {
            console.error(`❌ ${nameError}`);
            continue;
        }
        
        const skillPath = path.join(SKILLS_DIR, name);
        if (fs.existsSync(skillPath)) {
            console.error(`❌ Skill "${name}" already exists`);
            continue;
        }
        break;
    }

    // Get description
    let description;
    while (true) {
        description = await askQuestion('Description (10-1024 chars): ');
        const descError = validateDescription(description);
        if (descError) {
            console.error(`❌ ${descError}`);
            continue;
        }
        break;
    }

    // Create skill folder and files
    const skillPath = path.join(SKILLS_DIR, name);
    
    try {
        // Ensure skills directory exists
        if (!fs.existsSync(SKILLS_DIR)) {
            fs.mkdirSync(SKILLS_DIR, { recursive: true });
        }

        // Create skill folder
        fs.mkdirSync(skillPath, { recursive: true });

        // Create SKILL.md
        const content = generateSkillContent(name, description);
        fs.writeFileSync(path.join(skillPath, 'SKILL.md'), content);

        console.log(`\n✅ Skill created successfully at: skills/${name}/`);
        console.log('\nNext steps:');
        console.log(`  1. Edit skills/${name}/SKILL.md to add detailed instructions`);
        console.log('  2. Add any bundled assets if needed');
        console.log('  3. Run "npm run skill:validate" to verify');
        console.log('  4. Add the skill to a collection.yml file');

    } catch (error) {
        console.error(`\n❌ Failed to create skill: ${error.message}`);
        process.exit(1);
    }

    rl.close();
}

// Run creation wizard
createSkill().catch(error => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});
