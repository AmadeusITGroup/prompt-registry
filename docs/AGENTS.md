# Documentation Guide for AI Assistants

This file helps AI assistants understand and maintain the Prompt Registry documentation.

## Documentation Structure

Documentation is organized by audience:

```
docs/
├── README.md              # Navigation hub - links to all sections
├── AGENTS.md              # This file - AI guidance
├── user-guide/            # End-user documentation
├── author-guide/          # Collection creator documentation
├── contributor-guide/     # Code contributor documentation
├── reference/             # Technical specifications
└── assets/                # Images and diagrams
```

## Finding Documentation

| Audience | Directory | Topics |
|----------|-----------|--------|
| Users | `user-guide/` | Installation, marketplace, sources, profiles, troubleshooting |
| Authors | `author-guide/` | Creating collections, schemas, validation, publishing |
| Contributors | `contributor-guide/` | Dev setup, architecture, testing, coding standards |
| Developers | `reference/` | Commands, settings, APIs, schemas |

## Updating Documentation

### When to Update

Update documentation when:
- Adding new features or commands
- Changing existing behavior
- Fixing bugs that affect user-facing functionality
- Modifying configuration options

### Guidelines

1. **Keep it concise** — Avoid verbose explanations. One clear sentence beats three vague ones.
2. **Match the audience** — User docs should avoid implementation details. Contributor docs can be technical.
3. **Update the right file** — Place content where users expect to find it based on their role.
4. **Maintain links** — When moving or renaming files, update all references.
5. **Use Mermaid diagrams** — Prefer Mermaid diagrams over ASCII diagrams for visual representations, except for file structure/tree displays where ASCII is more appropriate.

### File Placement

| Content Type | Location |
|--------------|----------|
| New VS Code command | `reference/commands.md` |
| New extension setting | `reference/settings.md` |
| User-facing feature | `user-guide/` (appropriate file) |
| Repository-level installation | `user-guide/repository-installation.md` |
| Collection authoring | `author-guide/` (appropriate file) |
| Development process | `contributor-guide/` (appropriate file) |
| API or schema changes | `reference/` (appropriate file) |
| Installation/scope architecture | `contributor-guide/architecture/installation-flow.md` |

## Key Files

- **`docs/README.md`** — Navigation hub. Update when adding new documentation files.
- **`README.md` (root)** — Landing page. Keep under 150 lines. Link to docs/ for details.
- **`CONTRIBUTING.md`** — Points to contributor-guide/. Update links if files move.

## Style Notes

- Use relative links within docs/ (e.g., `../user-guide/getting-started.md`)
- Include "See Also" sections to connect related topics
- Add screenshot placeholders with descriptive alt text when UI changes
- Keep each file focused on one topic
