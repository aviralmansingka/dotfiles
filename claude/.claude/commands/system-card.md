# System Card Skill

Generate structured documentation for software systems and components.

## Usage

```
/system-card <component-name> [options]
```

**Options:**
- `--update` - Update specific sections of an existing card
- `--fresh` - Generate a complete new card (default)
- `--section <name>` - With --update, specify which section to regenerate

**Examples:**
```
/system-card scheduler
/system-card auth-service --update --section testing
/system-card api-gateway --fresh
/system-card worker-service --update --section deployment
```

## Output Location

All system cards are written to:
```
~/obsidian/personal/5_modal/system-cards/<component-name>.md
```

---

## Workflow

### Phase 1: Discovery

1. Search for the component in the codebase:
   - Look for directories/files matching the component name
   - Find main entry points (main.go, index.ts, __main__.py, etc.)
   - Identify configuration files
   - Locate README or existing documentation

2. Map the component structure:
   - Core source files
   - Test files
   - Configuration/deployment files
   - Dependencies (go.mod, package.json, requirements.txt, Cargo.toml)

### Phase 2: Background Knowledge

Fill in each subsection by exploring the codebase:

#### WHAT
- Read main entry point and package/module comments
- Summarize in 2-3 sentences what this component is

#### DOES
- List core functionalities (bullet points)
- Identify public APIs/interfaces
- Note key behaviors

#### DOES NOT
- Explicitly call out what's out of scope
- Note common misconceptions
- Identify related functionality handled elsewhere

#### DEPENDENCIES
For each dependency:
- Name and purpose
- How it's used (API calls, library import, service communication)
- Version constraints if relevant

#### DEPENDED ON BY
- Search codebase for imports/references to this component
- Identify downstream consumers
- Note integration points

#### SCOPE & RESPONSIBILITIES
- What this component owns
- Data it manages
- Decisions it makes

#### NON-RESPONSIBILITIES
- What it delegates to other components
- What it assumes is handled elsewhere

### Phase 3: Running the System

Document commands for running the component.

#### Validation Protocol

For each command:

1. **Classify the command:**
   - `SAFE`: Read-only, local, no credentials needed
   - `REQUIRES_ACCESS`: Needs cluster access, credentials, or has side effects

2. **For SAFE commands:**
   - Attempt to run the command
   - If successful, document with output snippet
   - If failed, mark as `[NEEDS VERIFICATION]` with error

3. **For REQUIRES_ACCESS commands:**
   - Mark as `[UNVALIDATED]`
   - Document expected output indicators
   - Ask user: "Please run this command and confirm you see: <expected output>"
   - Only remove `[UNVALIDATED]` after user confirmation

#### Command Documentation Format

```markdown
### Development

#### Starting the service locally

\`\`\`bash
make run-local
\`\`\`

**Expected output:**
> Server listening on :8080
> Connected to database

**Status:** [VALIDATED] / [UNVALIDATED] / [NEEDS VERIFICATION]

---
```

### Phase 4: Testing

Analyze the test structure:

1. **Locate tests:**
   - `*_test.go`, `*.test.ts`, `test_*.py`, `*_spec.rb`, etc.
   - `tests/`, `__tests__/`, `spec/` directories

2. **Identify test types:**
   - Unit tests (isolated, mocked dependencies)
   - Integration tests (real dependencies, docker-compose, etc.)
   - E2E tests (full system tests)

3. **Document test commands:**
   - How to run all tests
   - How to run specific test files/suites
   - How to run with coverage

4. **Assess coverage:**
   - List well-tested behaviors
   - Identify testing gaps as TODOs

#### Testing Gaps Format

```markdown
### Testing Gaps

- [ ] Missing: Error handling for timeout scenarios
- [ ] Missing: Integration test for cache invalidation
- [ ] Sparse: Edge cases in date parsing logic
```

### Phase 5: Design

#### Key Tradeoffs

For each significant design decision:
- What was chosen
- What was traded off
- Why (if documented or inferable)

#### Architectural Patterns

Identify and document patterns:
- Event-driven, request-response, pub-sub
- CQRS, event sourcing
- Microservice boundaries
- Data flow patterns

#### Dependency Analysis

How do dependencies shape this component?
- What constraints do they impose?
- What capabilities do they provide?
- Version coupling concerns

#### FAQ

**Protocol:**
1. Generate questions a newcomer would ask
2. For each question, locate the answer in the document
3. If answer is NOT in the document, add the information to the relevant section FIRST
4. Then write the FAQ entry with a reference to the section

Format:
```markdown
### FAQ

**Q: How does the scheduler handle node failures?**
A: See [DOES NOT](#does-not) - failure detection is handled by the health-checker service.
The scheduler receives failure events and reschedules affected workloads.

**Q: Why does this use polling instead of webhooks?**
A: See [Key Tradeoffs](#key-tradeoffs) - webhooks were considered but polling was
chosen for reliability in the face of network partitions.
```

### Phase 6: Deployment

Document how the component is deployed to production.

#### Deployment Overview

Provide a high-level summary of the deployment:

1. **Pod Configuration:**
   - Search for Kubernetes manifests (deployments, statefulsets, daemonsets)
   - Look in `ops/kubernetes/`, `deploy/`, `k8s/`, or Helm chart directories
   - Document:
     - Number of replicas (min/max for autoscaling)
     - Resource requests/limits (CPU, memory)
     - Pod disruption budgets
     - Affinity/anti-affinity rules

2. **Service Division:**
   - How is the component divided across pods/services?
   - Are there multiple deployment targets (e.g., web, worker, background)?
   - Multi-region considerations
   - Environment differences (dev vs prod)

3. **Scaling Configuration:**
   - Autoscaler type (HPA, KEDA, custom)
   - Scaling triggers (CPU, memory, queue depth, custom metrics)
   - Polling intervals and thresholds

#### Deployment Pipelines

Document the CI/CD workflow:

1. **Locate pipeline configurations:**
   - `.github/workflows/` for GitHub Actions
   - `.gitlab-ci.yml` for GitLab CI
   - `Jenkinsfile`, `buildkite/`, `circleci/`, etc.

2. **Document for each pipeline:**
   - Trigger conditions (push to main, PR, manual)
   - Build steps (image build, tests, linting)
   - Image registry and tagging strategy
   - Deployment steps (kubectl apply, helm upgrade, ArgoCD sync)
   - Rollback procedures

3. **Environment promotion:**
   - How changes flow from dev → staging → production
   - Approval gates or manual steps
   - Feature flags or gradual rollouts

#### Deployment Code Layout

Document where deployment-related code lives:

1. **Directory structure:**
   - Kubernetes manifests location
   - Helm chart structure (if applicable)
   - Kustomize overlays (if applicable)

2. **Key files:**
   - Main deployment definition
   - Service/ingress definitions
   - ConfigMaps and Secrets references
   - Values files for different environments

3. **Infrastructure dependencies:**
   - External secrets providers
   - Service mesh configuration
   - Ingress controllers
   - Certificate management

#### Deployment Documentation Format

```markdown
### Deployment Overview

**Pod Configuration:**
- Replicas: {min}-{max} (autoscaled)
- CPU: {requests} / {limits}
- Memory: {requests} / {limits}
- Disruption budget: {minAvailable or maxUnavailable}

**Service Division:**
| Service | Purpose | Replicas |
|---------|---------|----------|
| {name} | {purpose} | {count} |

**Scaling:**
- Scaler: {type}
- Triggers: {metrics and thresholds}
```

---

## System Card Template

```markdown
# System Card: {component-name}

> Generated: {date} | Source: {repo-path}

## Background Knowledge

### WHAT

{2-3 sentence overview}

### DOES

- {functionality 1}
- {functionality 2}
- ...

### DOES NOT

- {exclusion 1}
- {exclusion 2}
- ...

### DEPENDENCIES

| Dependency | Purpose | How Used |
|------------|---------|----------|
| {name} | {purpose} | {usage} |

### DEPENDED ON BY

| Consumer | Integration Point |
|----------|-------------------|
| {name} | {how it uses this component} |

### SCOPE & RESPONSIBILITIES

- {responsibility 1}
- {responsibility 2}

### NON-RESPONSIBILITIES

- {non-responsibility 1}
- {non-responsibility 2}

---

## Running the System

### Development

{commands with validation status}

### Production

{commands with validation status}

---

## Testing

### Unit Tests

**Location:** `{path}`
**Framework:** {framework}
**Run command:**
\`\`\`bash
{command}
\`\`\`

### Integration Tests

**Location:** `{path}`
**Framework:** {framework}
**Run command:**
\`\`\`bash
{command}
\`\`\`

### Test Organization

{description of test structure}

### Well-Tested Behaviors

- {behavior 1}
- {behavior 2}

### Testing Gaps

- [ ] {gap 1}
- [ ] {gap 2}

---

## Design

### Key Tradeoffs

#### {Tradeoff 1 Title}

**Chosen:** {what was chosen}
**Traded off:** {what was given up}
**Rationale:** {why}

### Architectural Patterns

- {pattern 1}: {how it's applied}
- {pattern 2}: {how it's applied}

### Dependency Analysis

{analysis of how dependencies shape the design}

### FAQ

**Q: {question 1}**
A: {answer with section reference}

**Q: {question 2}**
A: {answer with section reference}

---

## Deployment

### Deployment Overview

**Pod Configuration:**
- Replicas: {min}-{max} (autoscaled)
- CPU: {requests} / {limits}
- Memory: {requests} / {limits}
- Disruption budget: {minAvailable or maxUnavailable}

**Service Division:**

| Service | Purpose | Replicas | Resources |
|---------|---------|----------|-----------|
| {name} | {purpose} | {min}-{max} | {cpu/memory} |

**Scaling Configuration:**
- Scaler: {HPA/KEDA/custom}
- Triggers: {metrics and thresholds}
- Polling interval: {interval}

**Multi-Region:**
- Regions: {list of regions}
- Region-specific configuration: {differences}

### Deployment Pipelines

**Production Pipeline:**
- Trigger: {push to main / manual / etc.}
- Location: `{path to workflow file}`

**Build Steps:**
1. {step 1}
2. {step 2}

**Image Registry:**
- Registry: {ECR/GCR/DockerHub/etc.}
- Repository: `{repository-name}`
- Tagging strategy: {git sha / semver / etc.}

**Deployment Steps:**
1. {step 1}
2. {step 2}

**Rollback Procedure:**
{how to rollback a failed deployment}

### Deployment Code Layout

**Directory Structure:**
```
{path}/
├── {file/folder 1}  # {description}
├── {file/folder 2}  # {description}
└── {file/folder 3}  # {description}
```

**Key Files:**

| File | Purpose |
|------|---------|
| `{path}` | {description} |

**Environment Values Files:**

| Environment | File | Key Differences |
|-------------|------|-----------------|
| dev | `{path}` | {differences} |
| prod | `{path}` | {differences} |

**Infrastructure Dependencies:**
- Secrets provider: {external-secrets / vault / etc.}
- Ingress controller: {nginx / traefik / etc.}
- Certificate management: {cert-manager / etc.}
```

---

## Response Format

After completing the system card:

1. Write the card to `~/obsidian/personal/5_modal/system-cards/{component}.md`
2. Report:
   - Summary of what was documented
   - Any `[UNVALIDATED]` commands needing user verification
   - Testing gaps identified
   - Deployment configuration needing verification (replica counts, resource limits)
   - Sections that need more information

If `--update` mode:
1. Read existing card
2. Regenerate only the specified section(s)
3. Preserve other sections unchanged
