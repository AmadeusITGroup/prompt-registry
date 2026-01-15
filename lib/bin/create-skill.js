#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { skillName: undefined, skillsDir: 'skills' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skills-dir' && argv[i + 1]) {
      out.skillsDir = argv[i + 1];
      i++;
    } else if (!arg.startsWith('--') && !out.skillName) {
      out.skillName = arg;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (!args.skillName) {
  console.error('Usage: create-skill <skill-name> [--skills-dir <dir>]');
  console.error('');
  console.error('Creates a new skill directory structure with:');
  console.error('  - SKILL.md (main skill file)');
  console.error('  - assets/ (for images and diagrams)');
  console.error('  - references/ (for reference documents)');
  console.error('  - scripts/ (for helper scripts)');
  process.exit(1);
}

const repoRoot = process.cwd();
const skillDir = path.join(repoRoot, args.skillsDir, args.skillName);

if (fs.existsSync(skillDir)) {
  console.error(`❌ Skill directory already exists: ${skillDir}`);
  process.exit(1);
}

// Create directory structure
fs.mkdirSync(skillDir, { recursive: true });
fs.mkdirSync(path.join(skillDir, 'assets'));
fs.mkdirSync(path.join(skillDir, 'references'));
fs.mkdirSync(path.join(skillDir, 'scripts'));

// Create SKILL.md template
const skillMd = `# ${args.skillName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}

> Brief description of what this skill does.

## Overview

Describe the skill's purpose and when to use it.

## Prerequisites

- List any prerequisites
- Required tools or access

## Usage

Explain how to use this skill.

## Examples

Provide usage examples.

## References

- Link to relevant documentation
`;

fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd);

// Create placeholder files
fs.writeFileSync(path.join(skillDir, 'assets', '.gitkeep'), '');
fs.writeFileSync(path.join(skillDir, 'references', '.gitkeep'), '');
fs.writeFileSync(path.join(skillDir, 'scripts', '.gitkeep'), '');

console.log(`✅ Created skill: ${args.skillName}`);
console.log(`   Location: ${skillDir}`);
console.log('');
console.log('Next steps:');
console.log(`  1. Edit ${path.join(skillDir, 'SKILL.md')}`);
console.log('  2. Add assets, references, and scripts as needed');
console.log('  3. Add the skill to your collection.yml');
