---
name: prbot
description: PR review bot. Use "/prbot review" to critically review the current PR and generate REVIEW.md with feedback. Use "/prbot" or "/prbot resolve" to fix issues in REVIEW.md and delete it when complete. Use "/prbot summarize" to summarize PR changes and related tests.
---

# PR Review Bot

Critical PR reviewer that identifies bugs, design issues, and areas of concern.

## Mode: Review (`/prbot review`)

Critically analyze the current PR and generate a REVIEW.md file with actionable feedback.

### Steps

1. **Get the diff**:
   ```bash
   git diff $(git merge-base HEAD main)..HEAD
   ```

2. **Get list of changed files**:
   ```bash
   git diff --name-only $(git merge-base HEAD main)..HEAD
   ```

3. **Read each changed file** to understand full context, not just the diff.

4. **Critically analyze for**:
   - **Bugs**: Logic errors, off-by-one, null/undefined handling, race conditions
   - **Security**: Injection, auth issues, data exposure
   - **Design**: Coupling, unclear responsibilities, missing abstractions, code duplication
   - **Edge cases**: Error handling, boundary conditions, empty states
   - **Performance**: N+1 queries, unnecessary iterations, memory leaks
   - **Maintainability**: Hard-coded values, unclear naming, missing validation

5. **Write REVIEW.md** in the repository root with this format:

```markdown
# PR Review: <branch-name>

## Summary
<1-2 sentence overall assessment>

## Critical Issues
Issues that must be fixed before merge.

### [C1] <Title>
- **File**: `path/to/file.py:42-50`
- **Severity**: Critical
- **Issue**: <What's wrong>
- **Why it matters**: <Impact/risk>
- **Suggestion**: <How to fix>
- [ ] Resolved

## Concerns
Issues that should be addressed but aren't blockers.

### [W1] <Title>
- **File**: `path/to/file.py:100`
- **Severity**: Warning
- **Issue**: <What's wrong>
- **Why it matters**: <Impact/risk>
- **Suggestion**: <How to fix>
- [ ] Resolved

## Suggestions
Optional improvements for better code quality.

### [S1] <Title>
- **File**: `path/to/file.py:200`
- **Issue**: <What could be better>
- **Suggestion**: <Improvement>
- [ ] Resolved

## Checklist
- [ ] All critical issues resolved
- [ ] All concerns addressed or acknowledged
- [ ] Review complete
```

6. **Be harsh but fair**: The goal is to catch issues before they hit production. Don't hold back on criticism, but ensure every point is substantive and actionable.

---

## Mode: Resolve (`/prbot` or `/prbot resolve`)

Work through REVIEW.md and fix the identified issues.

### Steps

1. **Read REVIEW.md** from the repository root.

2. **If REVIEW.md doesn't exist**: Tell user to run `/prbot review` first.

3. **Process issues in order** (Critical -> Concerns -> Suggestions):
   - Read the relevant file and understand the context
   - Make the fix
   - Mark the checkbox as resolved: `- [x] Resolved`
   - Update REVIEW.md after each fix

4. **For each fix**:
   - Explain what you changed and why
   - If you disagree with the feedback, explain why and ask user if they want to skip it

5. **After all items processed**:
   - Show the user the final state of REVIEW.md
   - Ask: "All items have been addressed. Delete REVIEW.md and mark review complete?"
   - Only delete REVIEW.md after user confirms

6. **Deletion**:
   ```bash
   rm REVIEW.md
   ```

---

## Mode: Summarize (`/prbot summarize`)

Generate a concise summary of the PR changes and identify related tests.

### Steps

1. **Get the diff**:
   ```bash
   git diff $(git merge-base HEAD main)..HEAD
   ```

2. **Get list of changed files**:
   ```bash
   git diff --name-only $(git merge-base HEAD main)..HEAD
   ```

3. **Read each changed file** to understand the full context of changes.

4. **Identify test files** related to the changes:
   - Look for test files in the diff (files matching `*test*.py`, `*_test.py`, `test_*.py`, `*spec*.ts`, etc.)
   - Search for existing tests that cover the modified code:
     ```bash
     # Find test files related to changed modules
     git diff --name-only $(git merge-base HEAD main)..HEAD | xargs -I{} basename {} | sed 's/\.py$//' | xargs -I{} find . -name "*test*{}*" -o -name "*{}_test*" -o -name "test_{}*" 2>/dev/null
     ```
   - Check for test directories adjacent to changed files

5. **Output a summary** with this format:

```markdown
## PR Summary: <branch-name>

### Overview
<2-3 sentence high-level description of what this PR does>

### Changes

#### <Category 1> (e.g., "Core Logic", "API Changes", "Configuration")
- `path/to/file.py`: <Brief description of changes>
- `path/to/other.py`: <Brief description of changes>

#### <Category 2>
- ...

### Test Coverage

#### Tests Added/Modified in This PR
- `path/to/test_file.py`: <What it tests>

#### Existing Tests Covering Changed Code
- `path/to/existing_test.py`: <What it covers>

#### Test Gaps
- <Any changed functionality that appears to lack test coverage>

### Key Points for Reviewers
- <Important things reviewers should pay attention to>
- <Any breaking changes or migration notes>
```

6. **Be concise but complete**: The goal is to give reviewers quick context. Include enough detail to understand the changes without reading every line.

---

## Guidelines

- **Be specific**: Always include exact file paths and line numbers
- **Be critical**: Assume bugs exist until proven otherwise
- **Be constructive**: Every criticism must have a suggested fix
- **Be thorough**: Read the full context, not just the diff
- **Don't nitpick**: Focus on substantive issues, not style preferences (let linters handle style)
