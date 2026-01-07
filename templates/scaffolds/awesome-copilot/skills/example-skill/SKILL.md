---
name: example-skill
description: 'An example skill demonstrating the Agent Skills structure with bundled resources for specialized tasks.'
---

# Example Skill

This skill demonstrates the structure and capabilities of Agent Skills in the awesome-copilot format.

## When to Use This Skill

Use this skill when you need to:
- Understand the Agent Skills format and structure
- Create a template for your own skills
- Test skill installation and validation

## Prerequisites

- GitHub Copilot or compatible AI assistant
- VS Code or compatible editor

## Core Capabilities

### 1. Skill Instructions
The main `SKILL.md` file contains markdown instructions with YAML frontmatter that defines the skill's identity and metadata.

### 2. Bundled Assets
Skills can include helper scripts, templates, data files, and other resources that agents can utilize when performing specialized tasks.

## Usage Examples

### Example 1: Basic Usage
```
Ask the agent to use this skill for guidance on creating new skills.
```

### Example 2: Referencing Bundled Assets
```
The skill can reference helper files included in this folder.
```

## Guidelines

1. **Clear naming** - Use lowercase names with hyphens (e.g., `my-skill`)
2. **Descriptive content** - Provide detailed instructions in the markdown body
3. **Appropriate assets** - Include only necessary supporting files
4. **Size limits** - Keep bundled assets under 5MB per file

## Limitations

- Skills are designed for specialized tasks, not general-purpose use
- Asset files should be reasonable in size
- Complex dependencies may need separate installation
