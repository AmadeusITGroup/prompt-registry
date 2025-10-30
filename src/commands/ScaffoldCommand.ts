/**
 * ScaffoldCommand - Create awesome-copilot compliant project structure
 * 
 * Creates a complete directory structure with examples and documentation
 * for building awesome-copilot style prompt collections.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Logger } from '../utils/logger';

/**
 * Scaffold options for customization
 */
export interface ScaffoldOptions {
    /** Custom project name for the collection */
    projectName?: string;
    /** Skip creating example files */
    skipExamples?: boolean;
    /** Force overwrite existing files */
    force?: boolean;
}

/**
 * ScaffoldCommand
 * 
 * Creates a complete awesome-copilot compliant project structure:
 * - prompts/ - Task-specific prompts
 * - instructions/ - Coding standards and best practices
 * - chatmodes/ - AI personas
 * - collections/ - Curated collections
 * - README.md - Comprehensive documentation
 * 
 * Includes example files to help users understand the structure.
 */
export class ScaffoldCommand {
    private logger: Logger;

    constructor() {
        this.logger = Logger.getInstance();
    }

    /**
     * Execute the scaffold command
     * 
     * @param targetPath - Target directory path
     * @param options - Scaffold options
     */
    async execute(targetPath: string, options?: ScaffoldOptions): Promise<void> {
        try {
            this.logger.info(`Scaffolding awesome-copilot structure at: ${targetPath}`);

            // Create directory structure
            await this.createDirectoryStructure(targetPath);

            // Create GitHub CI workflow
            await this.createGitHubWorkflow(targetPath);

            // Create validation script
            await this.createValidationScript(targetPath);

            // Create package.json
            await this.createPackageJson(targetPath, options);

            // Create example files
            if (!options?.skipExamples) {
                await this.createExampleFiles(targetPath, options);
            }

            // Create README
            await this.createReadme(targetPath);

            this.logger.info('Scaffold completed successfully');
        } catch (error) {
            this.logger.error('Scaffold failed', error as Error);
            throw error;
        }
    }

    /**
     * Create directory structure
     */
    private async createDirectoryStructure(targetPath: string): Promise<void> {
        const directories = [
            'prompts',
            'instructions',
            'chatmodes',
            'collections',
            '.github/workflows',
            'scripts'
        ];

        // Create base directory
        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
        }

        // Create subdirectories
        for (const dir of directories) {
            const dirPath = path.join(targetPath, dir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                this.logger.debug(`Created directory: ${dirPath}`);
            }
        }
    }

    /**
     * Create example files
     */
    private async createExampleFiles(targetPath: string, options?: ScaffoldOptions): Promise<void> {
        const projectName = options?.projectName || 'example';

        // Create example prompt
        await this.createExamplePrompt(targetPath);

        // Create example instruction
        await this.createExampleInstruction(targetPath);

        // Create example chatmode
        await this.createExampleChatmode(targetPath);

        // Create example collection
        await this.createExampleCollection(targetPath, projectName);
    }

    /**
     * Create example prompt file
     */
    private async createExamplePrompt(targetPath: string): Promise<void> {
        const promptPath = path.join(targetPath, 'prompts', 'example.prompt.md');
        const content = `# Example Prompt

Create a comprehensive README file for this project.

## Context

You are helping to document a software project. The README should be:
- Clear and concise
- Include getting started instructions
- Explain the purpose and benefits
- Provide examples and usage

## Instructions

1. Analyze the project structure
2. Identify key features
3. Write clear, engaging documentation
4. Include code examples where appropriate
5. Add badges and links

## Output Format

The README should include:
- Project title and description
- Installation instructions
- Usage examples
- Contributing guidelines
- License information

## Example

For a web application, include:
\`\`\`markdown
# My Awesome Project

A brief description of what this project does.

## Installation

\`\`\`bash
npm install my-awesome-project
\`\`\`

## Usage

\`\`\`javascript
const app = require('my-awesome-project');
app.start();
\`\`\`
\`\`\`

## Tags

#documentation #readme #project-setup
`;

        fs.writeFileSync(promptPath, content, 'utf8');
        this.logger.debug(`Created example prompt: ${promptPath}`);
    }

    /**
     * Create example instruction file
     */
    private async createExampleInstruction(targetPath: string): Promise<void> {
        const instructionPath = path.join(targetPath, 'instructions', 'example.instructions.md');
        const content = `# Example Instructions

Best practices and coding guidelines for this project.

## Purpose

These instructions help maintain code quality and consistency across the project.

## Coding Standards

### General Principles

- **Clarity**: Write code that is easy to read and understand
- **Consistency**: Follow established patterns and conventions
- **Simplicity**: Keep solutions simple and maintainable
- **Documentation**: Comment complex logic and public APIs

### TypeScript/JavaScript

\`\`\`typescript
// Good: Clear function with JSDoc
/**
 * Calculate the total price including tax
 * @param price - Base price
 * @param taxRate - Tax rate as decimal (e.g., 0.1 for 10%)
 * @returns Total price with tax
 */
function calculateTotal(price: number, taxRate: number): number {
    return price * (1 + taxRate);
}

// Bad: Unclear and undocumented
function calc(p: number, t: number) {
    return p * (1 + t);
}
\`\`\`

### Error Handling

- Always handle errors gracefully
- Provide meaningful error messages
- Log errors for debugging
- Don't swallow exceptions silently

### Testing

- Write unit tests for all business logic
- Test edge cases and error conditions
- Use descriptive test names
- Maintain test coverage above 80%

## File Organization

- Group related code together
- Use clear, descriptive file names
- Keep files focused and single-purpose
- Avoid files longer than 300 lines

## Git Commit Messages

Follow conventional commits format:
\`\`\`
feat: add user authentication
fix: resolve memory leak in cache
docs: update API documentation
test: add tests for payment processing
\`\`\`

## Code Review Guidelines

- Review for logic correctness first
- Check for potential bugs and edge cases
- Ensure tests are comprehensive
- Verify documentation is updated
- Be constructive and respectful

## Resources

- [Clean Code](https://www.amazon.com/Clean-Code-Handbook-Software-Craftsmanship/dp/0132350882)
- [Effective TypeScript](https://effectivetypescript.com/)
- [Test Driven Development](https://martinfowler.com/bliki/TestDrivenDevelopment.html)
`;

        fs.writeFileSync(instructionPath, content, 'utf8');
        this.logger.debug(`Created example instruction: ${instructionPath}`);
    }

    /**
     * Create example chatmode file
     */
    private async createExampleChatmode(targetPath: string): Promise<void> {
        const chatmodePath = path.join(targetPath, 'chatmodes', 'example.chatmode.md');
        const content = `# Example Chat Mode - Senior Software Architect

You are a Senior Software Architect with 15+ years of experience in building scalable, maintainable systems.

## Persona

- **Name**: Alex, Senior Software Architect
- **Expertise**: System design, architecture patterns, scalability, performance optimization
- **Communication Style**: Clear, thoughtful, pragmatic
- **Approach**: Balance best practices with practical constraints

## Capabilities

You excel at:
- Designing system architectures from scratch
- Evaluating trade-offs between different approaches
- Identifying potential bottlenecks and scalability issues
- Recommending appropriate design patterns
- Creating technical documentation
- Mentoring developers on architectural decisions

## Guidelines

### When Reviewing Code

- Focus on architectural concerns (coupling, cohesion, separation of concerns)
- Identify potential scalability issues
- Suggest improvements to maintainability
- Point out deviations from SOLID principles
- Recommend appropriate design patterns

### When Designing Systems

- Start with requirements and constraints
- Consider both functional and non-functional requirements
- Evaluate multiple approaches with trade-offs
- Think about evolution and future changes
- Document key decisions and rationale

### Communication

- Explain complex concepts clearly
- Use diagrams when helpful (Mermaid, architecture diagrams)
- Provide concrete examples
- Reference industry best practices
- Balance theory with practical experience

## Example Interactions

**User**: "How should I structure a microservices application?"

**You**: "Let's design this systematically. First, let's understand:

1. **Service Boundaries**: Identify business domains using Domain-Driven Design
2. **Communication Patterns**: 
   - Synchronous (REST/gRPC) for request-response
   - Asynchronous (message queues) for events
3. **Data Management**: Each service owns its data (database per service pattern)
4. **Cross-Cutting Concerns**: API Gateway, service discovery, distributed tracing

Key Trade-offs:
- **Pros**: Independent deployment, scalability, technology diversity
- **Cons**: Distributed system complexity, eventual consistency, operational overhead

Let me sketch an architecture diagram..."

## Limitations

- I focus on architecture-level concerns, not syntax details
- I may ask clarifying questions to understand context
- I provide guidance based on industry practices, but recognize context-specific needs

## Tone

Professional, thoughtful, and educational. I aim to help you understand not just *what* to do, but *why* certain architectural decisions make sense.
`;

        fs.writeFileSync(chatmodePath, content, 'utf8');
        this.logger.debug(`Created example chatmode: ${chatmodePath}`);
    }

    /**
     * Create example collection file
     */
    private async createExampleCollection(targetPath: string, projectName: string): Promise<void> {
        const collectionPath = path.join(targetPath, 'collections', 'example.collection.yml');
        
        const collection = {
            id: projectName.toLowerCase().replace(/\s+/g, '-'),
            name: `${projectName} Collection`,
            description: 'Example collection demonstrating prompts, instructions, and chat modes for development workflows.',
            tags: ['example', 'getting-started', 'development', 'best-practices'],
            items: [
                {
                    path: 'prompts/example.prompt.md',
                    kind: 'prompt'
                },
                {
                    path: 'instructions/example.instructions.md',
                    kind: 'instruction'
                },
                {
                    path: 'chatmodes/example.chatmode.md',
                    kind: 'chat-mode'
                }
            ],
            display: {
                ordering: 'manual',
                show_badge: true
            }
        };

        const yamlContent = yaml.dump(collection, {
            indent: 2,
            lineWidth: 120,
            noRefs: true
        });

        fs.writeFileSync(collectionPath, yamlContent, 'utf8');
        this.logger.debug(`Created example collection: ${collectionPath}`);
    }

    /**
     * Create comprehensive README
     */
    private async createReadme(targetPath: string): Promise<void> {
        const readmePath = path.join(targetPath, 'README.md');
        const content = `# Awesome Copilot Collection

Welcome to your awesome-copilot prompt collection! This repository contains prompts, instructions, chat modes, and collections to enhance your GitHub Copilot experience.

## 📖 Repository Structure

\`\`\`
├── prompts/              # Task-specific prompts (.prompt.md)
│   └── example.prompt.md
├── instructions/         # Coding standards and best practices (.instructions.md)
│   └── example.instructions.md
├── chatmodes/           # AI personas and specialized modes (.chatmode.md)
│   └── example.chatmode.md
├── collections/         # Curated collections (.collection.yml)
│   └── example.collection.yml
└── README.md           # This file
\`\`\`

## 🚀 Getting Started

### Using the Examples

This repository comes with example files to help you get started:

1. **Example Prompt** (\`prompts/example.prompt.md\`) - Shows how to create effective prompts
2. **Example Instructions** (\`instructions/example.instructions.md\`) - Demonstrates coding guidelines
3. **Example Chat Mode** (\`chatmodes/example.chatmode.md\`) - Illustrates AI persona definition
4. **Example Collection** (\`collections/example.collection.yml\`) - Groups related items together

### Publishing to GitHub

To share your collection and test it with the Prompt Registry extension:

1. **Initialize Git** (if not already done):
   \`\`\`bash
   git init
   git add .
   git commit -m "Initial commit: Awesome Copilot collection"
   \`\`\`

2. **Create GitHub Repository**:
   - Go to [GitHub](https://github.com/new)
   - Create a new repository (e.g., \`my-awesome-prompts\`)
   - **Do not** initialize with README (you already have one)

3. **Push to GitHub**:
   \`\`\`bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git branch -M main
   git push -u origin main
   \`\`\`

4. **Test with Prompt Registry**:
   - Open VS Code
   - Install the "Prompt Registry" extension
   - Click the status bar → "Add Source"
   - Enter your repository URL: \`https://github.com/YOUR_USERNAME/YOUR_REPO\`
   - Browse and validate your collections

### Installation

#### Via Prompt Registry Extension

1. Open VS Code
2. Install the "Prompt Registry" extension
3. Add this repository as a source
4. Browse and install collections

#### Manual Installation

1. Clone this repository
2. Copy files to your GitHub Copilot directory:
   - **macOS**: \`~/Library/Application Support/Code/User/prompts/\`
   - **Linux**: \`~/.config/Code/User/prompts/\`
   - **Windows**: \`%APPDATA%\\Code\\User\\prompts\\\`

## 🤝 How to Contribute

### Creating a New Prompt

Prompts are task-specific instructions for Copilot.

1. Create a new file in \`prompts/\` with the naming convention: \`[name].prompt.md\`
2. Structure your prompt:

\`\`\`markdown
# Prompt Title

Brief description of what this prompt does.

## Context

Provide context about when to use this prompt.

## Instructions

1. Step-by-step instructions
2. Clear expectations
3. Output format

## Example

Show an example of the expected output.

## Tags

#tag1 #tag2 #tag3
\`\`\`

3. Test your prompt in Copilot Chat using \`/\` command

### Creating Instructions

Instructions apply automatically based on file patterns.

1. Create a new file in \`instructions/\` with the naming convention: \`[name].instructions.md\`
2. Include:
   - Purpose and scope
   - Coding standards
   - Best practices
   - Examples (good vs bad code)
   - Applicable file patterns

\`\`\`markdown
# Instruction Title

## Purpose

Explain what these instructions cover.

## Guidelines

### Section 1

- Rule 1
- Rule 2

### Section 2

- Rule 3
- Rule 4

## Examples

\\\`\\\`\\\`typescript
// Good example
const goodCode = true;

// Bad example
const bad = false;
\\\`\\\`\\\`

## Applies To

- \`**/*.ts\`
- \`**/*.tsx\`
\`\`\`

### Creating Chat Modes

Chat modes define AI personas for specialized assistance.

1. Create a new file in \`chatmodes/\` with the naming convention: \`[name].chatmode.md\`
2. Define the persona:

\`\`\`markdown
# Chat Mode - [Persona Name]

You are a [role] with [expertise].

## Persona

- **Name**: [Name and title]
- **Expertise**: [Areas of expertise]
- **Communication Style**: [How you communicate]

## Capabilities

You excel at:
- [Capability 1]
- [Capability 2]

## Guidelines

### When [Scenario]

- [Guideline 1]
- [Guideline 2]

## Example Interactions

**User**: "[Question]"

**You**: "[Response]"

## Tone

[Description of communication tone]
\`\`\`

### Creating Collections

Collections group related items for discovery and installation.

1. Create a new file in \`collections/\` with the naming convention: \`[id].collection.yml\`
2. Follow this structure:

\`\`\`yaml
id: my-collection-id
name: My Collection Name
description: A brief description of what this collection provides.
tags:
  - tag1
  - tag2
items:
  - path: prompts/my-prompt.prompt.md
    kind: prompt
  - path: instructions/my-instructions.instructions.md
    kind: instruction
  - path: chatmodes/my-chatmode.chatmode.md
    kind: chat-mode
display:
  ordering: manual  # or "alpha" for alphabetical
  show_badge: true
\`\`\`

3. **Validation Rules**:
   - \`id\`: Unique, lowercase, hyphens only
   - \`name\`: 1-100 characters
   - \`description\`: 1-500 characters
   - \`tags\`: Optional, max 10 tags, each 1-30 characters
   - \`items\`: 1-50 items, paths must exist
   - \`kind\`: Must be \`prompt\`, \`instruction\`, or \`chat-mode\`

## 🧪 Testing and Validation

### Automated CI Validation

This project includes GitHub Actions CI workflow for automatic validation:

**Workflow Location**: \`.github/workflows/validate-collections.yml\`

**What it does**:
- ✅ Runs automatically on every push to main/develop
- ✅ Runs on pull requests
- ✅ Validates all collection files
- ✅ Checks required fields, ID format, file references
- ✅ Reports errors and warnings
- ✅ Fails CI if validation errors found

**Local Validation**:
\`\`\`bash
# Install dependencies first
npm install

# Run validation
npm run validate

# Or run directly
node scripts/validate-collections.js
\`\`\`

**Validation Rules**:
- ✅ Required fields: \`id\`, \`name\`, \`description\`, \`items\`
- ✅ ID format: lowercase, numbers, hyphens only
- ✅ Valid kinds: \`prompt\`, \`instruction\`, \`chat-mode\`, \`agent\`
- ✅ All referenced files must exist
- ⚠️  Description max 500 characters (warning)
- ⚠️  Max 10 tags recommended (warning)

### Test Your Prompts

1. Open Copilot Chat in VS Code
2. Use \`/\` to access your prompts
3. Verify the output matches expectations

### Using Prompt Registry Extension

Once you've published your repository to GitHub, use the Prompt Registry extension for collection management:

1. **Validate Collections**:
   - Open VS Code Command Palette (\`Ctrl+Shift+P\`)
   - Run: "Validate Collections"
   - View results in the Output panel

2. **Create New Collections**:
   - Open VS Code Command Palette (\`Ctrl+Shift+P\`)
   - Run: "Create New Collection"
   - Follow the interactive prompts
   - Fill in ID, name, description, and tags

3. **List Collections**:
   - Open VS Code Command Palette (\`Ctrl+Shift+P\`)
   - Run: "List All Collections"
   - View all collection metadata

**Note**: Collection management commands are only available when working in an awesome-copilot repository structure.

### Quality Checklist

- [ ] File naming follows conventions
- [ ] All paths in collections exist
- [ ] YAML syntax is valid
- [ ] Content is clear and helpful
- [ ] Examples are provided
- [ ] Tags are relevant
- [ ] Local validation passes (\`npm run validate\`)
- [ ] CI validation passes (check GitHub Actions)

## 📚 Best Practices

### Prompts

1. **Be Specific**: Clear instructions produce better results
2. **Provide Context**: Help Copilot understand the task
3. **Include Examples**: Show expected output format
4. **Use Tags**: Aid in discovery and organization

### Instructions

1. **Focus on Principles**: Teach patterns, not just rules
2. **Show Examples**: Good vs bad code samples
3. **Keep Updated**: Reflect current best practices
4. **Be Pragmatic**: Balance ideals with reality

### Chat Modes

1. **Define Clear Personas**: Specific expertise and style
2. **Set Boundaries**: What the persona can and can't do
3. **Provide Examples**: Show typical interactions
4. **Be Consistent**: Maintain persona throughout

### Collections

1. **Cohesive Groups**: Items that work well together
2. **Clear Purpose**: Users should understand the benefit
3. **Appropriate Size**: 3-10 items typically work well
4. **Good Names**: Descriptive and discoverable

## 📖 Resources

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot)
- [Awesome Copilot Repository](https://github.com/github/awesome-copilot)
- [Prompt Engineering Guide](https://www.promptingguide.ai/)
- [Collection Template](https://github.com/github/awesome-copilot/blob/main/collections/TEMPLATE.md)

## 🔧 Tools

- **Prompt Registry Extension**: Visual management and installation
- **VS Code**: Primary development environment
- **YAML Validators**: Check collection syntax
- **Markdown Linters**: Ensure proper formatting

## 📄 License

This collection is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **GitHub Copilot team** for the amazing AI assistant
- **[github/awesome-copilot](https://github.com/github/awesome-copilot)** for the collection structure and best practices
- Community contributors for inspiration and examples
- Everyone who has shared prompts and best practices

### Attribution

This project structure is inspired by the [github/awesome-copilot](https://github.com/github/awesome-copilot) repository:
- Collection format and structure
- Best practices for organizing prompts and instructions
- [Collection template documentation](https://github.com/github/awesome-copilot/blob/main/collections/TEMPLATE.md)

## 💬 Support

If you have questions or need help:

1. Check the [examples](prompts/example.prompt.md)
2. Review the [awesome-copilot repository](https://github.com/github/awesome-copilot)
3. Open an issue for discussion

## 🎯 Next Steps

1. Review the example files
2. Create your first prompt or instruction
3. Add items to a collection
4. Test in GitHub Copilot
5. Share with your team!

---

Happy prompting! 🚀
`;

        fs.writeFileSync(readmePath, content, 'utf8');
        this.logger.debug(`Created README: ${readmePath}`);
    }

    /**
     * Create GitHub CI workflow for collection validation
     */
    private async createGitHubWorkflow(targetPath: string): Promise<void> {
        const workflowPath = path.join(targetPath, '.github', 'workflows', 'validate-collections.yml');
        
        const workflow = `name: Validate Collections

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]
  workflow_dispatch:

jobs:
  validate:
    name: Validate Collections
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Validate collections
        run: npm run validate
      
      - name: Upload validation results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: validation-results
          path: |
            collections/
          if-no-files-found: ignore
`;

        fs.writeFileSync(workflowPath, workflow, 'utf8');
        this.logger.debug(`Created GitHub workflow: ${workflowPath}`);
    }

    /**
     * Create validation script
     */
    private async createValidationScript(targetPath: string): Promise<void> {
        const scriptPath = path.join(targetPath, 'scripts', 'validate-collections.js');
        
        // Read template from templates directory
        const templatePath = path.join(__dirname, '../../templates/validate-collections.js');
        
        if (fs.existsSync(templatePath)) {
            const template = fs.readFileSync(templatePath, 'utf8');
            fs.writeFileSync(scriptPath, template, 'utf8');
            
            // Make script executable on Unix systems
            try {
                fs.chmodSync(scriptPath, 0o755);
            } catch (error) {
                // Ignore chmod errors on Windows
                this.logger.debug('Could not set executable permission (likely Windows)');
            }
        } else {
            // Fallback: embed script inline if template not found
            this.logger.warn('Template not found, using embedded script');
            const script = this.getEmbeddedValidationScript();
            fs.writeFileSync(scriptPath, script, 'utf8');
        }
        
        this.logger.debug(`Created validation script: ${scriptPath}`);
    }

    /**
     * Create package.json for the scaffolded project
     */
    private async createPackageJson(targetPath: string, options?: ScaffoldOptions): Promise<void> {
        const packageJsonPath = path.join(targetPath, 'package.json');
        const projectName = options?.projectName || path.basename(targetPath);
        
        const packageJson = {
            name: projectName.toLowerCase().replace(/\s+/g, '-'),
            version: '1.0.0',
            description: 'Awesome Copilot prompt collection',
            scripts: {
                validate: 'node scripts/validate-collections.js',
                'validate:verbose': 'node scripts/validate-collections.js --verbose'
            },
            keywords: [
                'copilot',
                'prompts',
                'ai',
                'github-copilot'
            ],
            author: '',
            license: 'MIT',
            dependencies: {
                'js-yaml': '^4.1.0'
            },
            devDependencies: {},
            engines: {
                node: '>=18.0.0'
            }
        };

        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
        this.logger.debug(`Created package.json: ${packageJsonPath}`);
    }

    /**
     * Get embedded validation script (fallback if template not found)
     */
    private getEmbeddedValidationScript(): string {
        // This is a minified version for embedding
        return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Validation logic embedded
console.log('Running collection validation...');
console.log('For full functionality, ensure templates/validate-collections.js exists');

const collectionsDir = path.join(process.cwd(), 'collections');
if (!fs.existsSync(collectionsDir)) {
    console.error('Collections directory not found');
    process.exit(1);
}

const files = fs.readdirSync(collectionsDir).filter(f => f.endsWith('.collection.yml'));
console.log(\`Found \${files.length} collection(s)\`);

let hasErrors = false;
files.forEach(file => {
    const content = fs.readFileSync(path.join(collectionsDir, file), 'utf8');
    try {
        const collection = yaml.load(content);
        if (!collection.id || !collection.name || !collection.items) {
            console.error(\`❌ \${file}: Missing required fields\`);
            hasErrors = true;
        } else {
            console.log(\`✓ \${file}: Valid\`);
        }
    } catch (error) {
        console.error(\`❌ \${file}: YAML parse error\`);
        hasErrors = true;
    }
});

process.exit(hasErrors ? 1 : 0);
`;
    }

    /**
     * Validate scaffolded structure
     * 
     * @param targetPath - Path to validate
     * @returns True if valid, false otherwise
     */
    async validate(targetPath: string): Promise<boolean> {
        try {
            // Check required directories exist
            const requiredDirs = ['prompts', 'instructions', 'chatmodes', 'collections'];
            for (const dir of requiredDirs) {
                const dirPath = path.join(targetPath, dir);
                if (!fs.existsSync(dirPath)) {
                    this.logger.warn(`Missing required directory: ${dir}`);
                    return false;
                }
            }

            // Check README exists
            const readmePath = path.join(targetPath, 'README.md');
            if (!fs.existsSync(readmePath)) {
                this.logger.warn('Missing README.md');
                return false;
            }

            // Validate collection files
            const collectionsDir = path.join(targetPath, 'collections');
            const collectionFiles = fs.readdirSync(collectionsDir)
                .filter(f => f.endsWith('.collection.yml'));

            for (const file of collectionFiles) {
                const filePath = path.join(collectionsDir, file);
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const collection = yaml.load(content) as any;

                    // Validate required fields
                    if (!collection.id || !collection.name || !collection.items) {
                        this.logger.warn(`Invalid collection file: ${file} - missing required fields`);
                        return false;
                    }

                    // Validate item paths exist
                    for (const item of collection.items) {
                        const itemPath = path.join(targetPath, item.path);
                        if (!fs.existsSync(itemPath)) {
                            this.logger.warn(`Collection references missing file: ${item.path}`);
                            return false;
                        }
                    }
                } catch (error) {
                    this.logger.warn(`Invalid YAML in collection file: ${file}`, error as Error);
                    return false;
                }
            }

            this.logger.info('Validation passed');
            return true;

        } catch (error) {
            this.logger.error('Validation failed', error as Error);
            return false;
        }
    }
}
