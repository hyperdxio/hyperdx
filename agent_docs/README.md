# Agent Documentation Directory

This directory contains detailed documentation for AI coding agents working on the HyperDX codebase. These files use **progressive disclosure** - they're referenced from `CLAUDE.md` but only read when needed.

## Purpose

Instead of stuffing all instructions into `CLAUDE.md` (which goes into every conversation), we keep detailed, task-specific information here. This ensures:

1. **Better focus**: Only relevant context gets loaded per task
2. **Improved performance**: Smaller context window = better instruction following
3. **Easier maintenance**: Update specific docs without bloating the main file

## Files

- **`architecture.md`** - System architecture, data models, service relationships, security patterns
- **`tech_stack.md`** - Technology choices, UI component patterns, library usage
- **`development.md`** - Development workflows, testing strategy, common tasks, debugging
- **`code_style.md`** - Code patterns and best practices (read only when actively coding)

## Usage Pattern

When starting a task:
1. Agent reads `CLAUDE.md` first (always included)
2. Agent determines which (if any) docs from this directory are relevant
3. Agent reads only the needed documentation
4. Agent proceeds with focused, relevant context

## Maintenance

- Keep files focused on their specific domain
- Use file/line references instead of code snippets when possible
- Update when patterns or architecture change
- Keep documentation current with the codebase

