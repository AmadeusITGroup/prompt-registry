#!/usr/bin/env node
/**
 * Validate Agent Skills
 * 
 * Validates all skill folders in the skills/ directory following the
 * Agent Skills specification: https://agentskills.io/specification
 */

const path = require('path');
const { validateAllSkills } = require('../dist/skills');

function parseArgs(argv) {
    const out = { skillsDir: 'skills', verbose: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--skills-dir' && argv[i + 1]) {
            out.skillsDir = argv[i + 1];
            i++;
        } else if (arg === '--verbose' || arg === '-v') {
            out.verbose = true;
        }
    }
    return out;
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = process.cwd();

console.log(`Validating skills in ${args.skillsDir}/...\n`);

const result = validateAllSkills(repoRoot, args.skillsDir);

if (result.totalSkills === 0) {
    console.log('No skill folders found - validation skipped');
    process.exit(0);
}

console.log(`Found ${result.totalSkills} skill folder(s)\n`);

for (const skill of result.skills) {
    if (skill.valid) {
        console.log(`✅ ${skill.folderName} is valid`);
    } else {
        console.error(`❌ Validation errors in ${skill.folderName}:`);
        skill.errors.forEach(error => console.error(`   - ${error}`));
    }
}

console.log('');

if (result.valid) {
    console.log(`🎉 All ${result.validSkills} skills are valid`);
    process.exit(0);
} else {
    console.error(`❌ Skill validation failed: ${result.invalidSkills} of ${result.totalSkills} skills have errors`);
    process.exit(1);
}
