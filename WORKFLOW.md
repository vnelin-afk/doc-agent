# Project Workflow Rules

## 🎯 Purpose
This file defines boundaries, handoff triggers, and sync mechanisms between Cowork (planning) and Claude Code (execution). Both agents and you must follow these rules throughout the project lifecycle.

---

## 📋 Boundaries & Responsibilities

### Cowork (Planning & Strategy)
**What Cowork does:**
- Strategic planning, architecture decisions
- Creating and updating: SPEC.md, PLAN.md, ARCHITECTURE.md
- Researching solutions, evaluating approaches
- Designing file/folder structure
- Making cross-project decisions
- Generating Figma diagrams for architecture visualization
- Recommending and managing skills/plugins

**What Cowork does NOT do:**
- Writing implementation code
- Debugging errors
- Running tests or commands
- Making file-level edits to source code
- Installing dependencies

### Claude Code (Execution & Implementation)
**What Claude Code does:**
- Writing, editing, refactoring code
- Debugging, fixing errors
- Running tests, scripts, commands
- Managing dependencies (npm, pip, etc)
- File-level operations (create, edit, delete)
- Updating ARCHITECTURE.md after completing tasks
- Updating CHANGELOG.md with what was done

**What Claude Code does NOT do:**
- Changing project strategy/direction
- Adding new features to SPEC.md
- Redesigning architecture without approval
- Making cross-task planning decisions

---

## 🔄 Handoff Triggers

### FROM You TO Cowork
**Message Cowork when you need:**
- "Need to change project architecture"
- "Task blocked, what's the solution?"
- "Add [new feature] to the project"
- "Review overall progress"
- "Current approach isn't working, need alternatives"
- "Should we use [technology A] or [technology B]?"
- "Something doesn't fit the current architecture"

**Cowork will:**
- Analyze the situation
- Update relevant .md files
- Provide recommendations
- Tell you: "Updated PLAN.md. Sync Claude Code: run '/refresh' and read updated files."

### FROM Cowork TO You (redirect to Claude Code)
**If you ask Cowork:**
- "How to fix [technical error]?" 
  → Response: "This is a technical issue. Ask Claude Code in VS Code."
  
- "Debug [code issue]"
  → Response: "Claude Code handles debugging. Paste the error there."
  
- "Implement [specific function]"
  → Response: "This is task execution. Tell Claude Code: 'Execute task #N'"

### FROM You TO Claude Code
**Message Claude Code when you need:**
- "Execute task #N from tasks.md"
- "Fix error: [paste error message/stack trace]"
- "Implement [specific function/feature]"
- "Run tests"
- "Why is [this code] not working?"
- "Refactor [specific file/function]"
- "Add [dependency/package]"

**Claude Code will:**
- Execute the task
- Update ARCHITECTURE.md with changes
- Update CHANGELOG.md with work done
- Mark task status in tasks.md
- Tell you: "Task #N complete. Review [files] before continuing."

### FROM Claude Code TO You (redirect to Cowork)
**If Claude Code encounters:**
- "Should we change the approach?"
  → Response: "This is an architecture decision. Discuss in Cowork Project."
  
- "This conflicts with current architecture"
  → Response: "Architecture conflict detected. Check ARCHITECTURE.md in Cowork or escalate."
  
- "Need to add new tasks/features"
  → Response: "Feature/task planning is done in Cowork. Update PLAN.md there."

---

## 📁 Context Files (must stay in sync)

### Files maintained by Cowork (read by Claude Code):

**1. SPEC.md** - Project specification
- What we're building
- Core features
- Tech stack
- Constraints
- Success criteria

**2. PLAN.md** - Execution roadmap
- Current phase
- Next 5 tasks
- Blocked items
- Phase breakdown with user action points

**3. tasks.md** - Detailed task list
- Task descriptions
- Status (TODO/IN_PROGRESS/DONE/BLOCKED)
- Assignment (Claude Code / User)
- Expected results
- Dependencies

### Files maintained by Claude Code (read by Cowork):

**4. ARCHITECTURE.md** - Current system state
- Folder/file structure
- Key components and their purposes
- Data flow
- External dependencies
- **Known issues/limitations** (critical for Cowork to see)
- Last updated timestamp

**5. CHANGELOG.md** - Work history
- What was done in each task
- What changed in architecture
- Decisions made during implementation
- Issues discovered

### File maintained by both:

**6. .claude/CLAUDE.md** - Instructions for Claude Code
- Created by Cowork during initialization
- Can be updated by either agent with user approval

---

## 🔁 Sync Mechanism

### After Claude Code completes a task:

```
1. Update ARCHITECTURE.md with:
   - New files/components added
   - Modified components
   - New dependencies
   - Known issues discovered
   
2. Update CHANGELOG.md with:
   - Task number and name
   - What was implemented
   - Architecture changes
   - Issues found (if any)
   
3. Update tasks.md:
   - Mark task as DONE
   - Add completion timestamp
   
4. Tell user:
   "Task #N complete. 
   
   Changes:
   - [file1]: [what changed]
   - [file2]: [what changed]
   
   Updated ARCHITECTURE.md and CHANGELOG.md.
   Review before continuing to task #N+1."
```

### When Cowork updates the plan:

```
1. Update PLAN.md with new tasks/changes
2. Update tasks.md if task details changed
3. Update SPEC.md if scope changed

4. Tell user:
   "Plan updated:
   - [Change 1]
   - [Change 2]
   
   Sync with Claude Code:
   1. Go to VS Code
   2. Tell Claude Code: '/refresh'
   3. Claude Code will re-read all context files
   4. Continue with updated plan"
```

### Sync markers in files:

Add these comments at the top of each file:

```markdown
<!-- LAST_UPDATED: 2026-04-15 14:30 -->
<!-- UPDATED_BY: Cowork | Claude Code -->
<!-- SYNC_REQUIRED: YES | NO -->
```

**Claude Code checks before each task:**
- Read PLAN.md, check SYNC_REQUIRED
- If YES → re-read all context files
- Set SYNC_REQUIRED: NO
- Execute task

---

## 🚨 Error Escalation Path

### Level 1: Quick Fix (stay in Claude Code)
**Examples:**
- Syntax errors, typos
- Missing imports
- Simple configuration issues
- Dependency version conflicts

**Action:**
- Fix immediately
- Continue task
- No escalation needed

### Level 2: Technical Investigation (Claude Code + research)
**Examples:**
- Unexpected API behavior
- Library compatibility issues
- Performance problems
- Complex bugs

**Action:**
1. Research the issue
2. Propose solution
3. Tell user: "Found issue: [description]. Proposed fix: [solution]. Approve?"
4. After approval → implement fix
5. Continue task

### Level 3: Architecture Review (escalate to Cowork)
**Examples:**
- Current approach fundamentally doesn't work
- Need to refactor large parts of codebase
- External API limitation discovered
- Technology choice was wrong

**Action:**
1. Stop work immediately
2. Document the issue in ARCHITECTURE.md under "Known Issues"
3. Tell user: "⚠️ Escalating to Cowork: [reason]. Current task paused."
4. User goes to Cowork to discuss solution
5. Wait for updated plan before continuing

---

## 🛠️ Skill Requirements Detection

### When starting a new project, Cowork checks if these skills are needed:

**For web/UI projects:**
- [ ] `frontend-design` - High-quality UI/UX components
- [ ] `docx` - Documentation exports (user guides, specs)
- [ ] `pdf` - Report generation, exports

**For data/analytics projects:**
- [ ] `xlsx` - Spreadsheet creation, data exports
- [ ] `pdf-reading` - Processing uploaded PDFs
- [ ] `file-reading` - Handling various file formats

**For backend/API projects:**
- [ ] `senior-backend` - API design, database optimization
- [ ] `senior-architect` - System architecture, scaling

**For any project:**
- [ ] `skill-creator` - Creating custom skills for repeated patterns

### Skill request workflow:

```
If Cowork detects a task that would benefit from a skill not yet added:

"Task #N involves [activity].
The '[skill-name]' skill specializes in this and would improve quality.

This skill provides: [description]

Should I add it to the project?
- Yes → I'll add it and use it for relevant tasks
- No → I'll work without it
- Later → Remind me when we reach this task"
```

---

## 🚀 Project Initialization Checklist

### When you start a new Cowork Project, Cowork MUST:

**Step 1: Gather Information**
```
Ask you:
1. Project type? (web app / API / CLI tool / data pipeline / other)
2. Brief description? (1-2 sentences)
3. Do you have existing files to upload? (yes/no)
4. Any specific tech stack requirements? (or "recommend")
5. Any constraints? (timeline, limitations, must-use technologies)
```

**Step 2: Generate Core Files**
```
Create:
- [ ] SPEC.md (project specification)
- [ ] ARCHITECTURE.md (initial architecture design)
- [ ] PLAN.md (phased execution roadmap)
- [ ] tasks.md (detailed task breakdown)
- [ ] .claude/CLAUDE.md (instructions for Claude Code)
- [ ] CHANGELOG.md (empty, ready for Claude Code)
- [ ] README.md (project overview)
```

**Step 3: Skill Recommendations**
```
Based on project type, suggest required skills:
"Recommended skills for this project:
- [skill1]: [why needed]
- [skill2]: [why needed]

Add these now? [Yes/No/Customize]"
```

**Step 4: Folder Structure**
```
Design and create appropriate folder structure:

Example for web app:
project/
├── .claude/
│   └── CLAUDE.md
├── src/
│   ├── components/
│   ├── utils/
│   └── index.js
├── tests/
├── docs/
├── SPEC.md
├── ARCHITECTURE.md
├── PLAN.md
├── tasks.md
├── CHANGELOG.md
└── README.md
```

**Step 5: Architecture Visualization**
```
Generate Figma diagram showing:
- System components
- Data flow
- External integrations
- User interaction points

Present diagram and ask: "Review architecture diagram. Approve or request changes?"
```

**Step 6: Final Approval**
```
Show summary:
"Project initialized:
✓ [N] files created
✓ [N] skills added
✓ Folder structure ready
✓ Architecture diagram approved

Export to local folder? [path]
After export, next steps:
1. Open folder in VS Code
2. Claude Code will auto-read .claude/CLAUDE.md
3. Tell Claude Code: 'Execute task #1 from tasks.md'

Ready to export?"
```

---

## 💬 Communication Templates

### Standard phrases to use:

**When you approve a task:**
```
"Approved. Task #N → Claude Code."
```

**When you modify a task:**
```
"Modify task #N: [specific changes needed]. Update PLAN.md."
```

**When you report a problem:**

**Technical issue** (for Claude Code):
```
"Error in task #N: [paste error message or describe issue]"
```

**Strategic issue** (for Cowork):
```
"Task #N blocked: [reason]. Need alternative approach."
```

**When switching contexts:**
```
"Syncing to Claude Code" → you're moving to VS Code
"Back to planning" → you're returning to Cowork
```

**When requesting sync:**
```
In Claude Code: "/refresh" → re-read all context files
In Cowork: "Sync status?" → check what needs updating
```

---

## ✅ Quality Gates (checkpoints before moving forward)

### After each task completion:

**Claude Code must:**
- [ ] Update ARCHITECTURE.md
- [ ] Update CHANGELOG.md
- [ ] Mark task in tasks.md
- [ ] Run tests (if applicable)
- [ ] Commit changes with clear message

**You must:**
- [ ] Review changed files
- [ ] Test functionality (if applicable)
- [ ] Approve or request changes
- [ ] Check if architecture needs updating in Cowork

### After each phase completion:

**Cowork reviews:**
- [ ] All tasks in phase are DONE
- [ ] ARCHITECTURE.md reflects current state
- [ ] No major issues in CHANGELOG.md
- [ ] Ready for next phase

**You must:**
- [ ] Demo/test complete phase functionality
- [ ] Approve phase completion
- [ ] Review and approve next phase plan

---

## 🔧 Troubleshooting Decision Tree

```
Problem occurred → ask yourself:

Q: Is it a code error / technical bug?
└─ YES → Go to Claude Code in VS Code
    └─ Fixed? → Continue task
    └─ Can't fix? → Escalate to Level 3

Q: Is it about project direction / features?
└─ YES → Go to Cowork Project
    └─ Update SPEC.md / PLAN.md
    └─ Sync to Claude Code

Q: Is it about how to implement something?
└─ YES → Ask Claude Code first
    └─ If needs architecture change → Escalate to Cowork

Q: Is it about choosing technologies / approaches?
└─ YES → Go to Cowork Project
    └─ Cowork researches and recommends
    └─ Update SPEC.md with decision
    └─ Sync to Claude Code

Q: Not sure where to ask?
└─ Default: Ask in Claude Code
    └─ Claude Code will redirect if needed
```

---

## 📊 Progress Tracking

### Task statuses in tasks.md:

- **TODO** - Not started, ready to begin
- **IN_PROGRESS** - Claude Code is working on it
- **BLOCKED** - Waiting for you (API key, testing, decision)
- **DONE** - Completed and approved by you
- **SKIPPED** - Decided not to do (document why in PLAN.md)

### Phase tracking in PLAN.md:

```markdown
## Phase Status

### Phase 1: Foundation ✅ COMPLETED
Tasks #1-5 | Duration: 3 days

### Phase 2: Core Features 🔄 IN PROGRESS  
Tasks #6-10 | Current: Task #7

### Phase 3: Integration ⏳ UPCOMING
Tasks #11-15 | Blocked on: Phase 2 completion
```

---

## 🎓 Best Practices

### For You:

1. **One task at a time** - Don't approve task #N+1 before testing #N
2. **Keep context fresh** - If you made changes in Cowork, sync Claude Code
3. **Document decisions** - When you choose an approach, add it to SPEC.md
4. **Test at checkpoints** - Don't wait until the end to test everything
5. **Use the right tool** - Technical = Claude Code, Strategic = Cowork

### For Cowork:

1. **Be specific in tasks** - "Add login form" is better than "Add auth"
2. **Set clear expectations** - Each task should have "Expected result"
3. **Break down complexity** - Big tasks → multiple smaller tasks
4. **Think ahead** - Identify dependencies between tasks
5. **Keep plans realistic** - Better to have 10 clear tasks than 50 vague ones

### For Claude Code:

1. **Read context first** - Always check SPEC.md, ARCHITECTURE.md before coding
2. **Update as you go** - Don't wait until end of task to update docs
3. **Test before marking done** - Run basic tests before telling user "complete"
4. **Document issues** - If you find problems, add to ARCHITECTURE.md
5. **Ask when unsure** - Better to clarify than implement wrong thing

---

## 🔐 Final Rules (non-negotiable)

1. **Never skip initialization** - Every project starts with this workflow
2. **Always sync after changes** - Cowork updates → tell Claude Code to /refresh
3. **Escalate architecture issues** - Don't let Claude Code redesign in silence
4. **Keep ARCHITECTURE.md current** - It's the source of truth for project state
5. **One source of truth** - If PLAN.md and tasks.md conflict, PLAN.md wins
6. **User approves tasks** - Claude Code never auto-continues to next task
7. **Document everything** - If it's not in .md files, it doesn't exist

---

**Version**: 1.0  
**Last Updated**: 2026-04-15  
**Compatible with**: Cowork (all versions), Claude Code (VS Code extension)
