# GitHub Publishing Strategy

This project uses a two-branch, two-remote git strategy to maintain a private development branch with internal files while publishing a clean public version to GitHub.

## The Problem

Some files should remain in version control (for use with Claude Code, internal specs, IDE settings, etc.) but must never appear in the public GitHub repository. Git does not support filtering files on push, so the solution requires separate branches and remotes.

## Structure

**Two remotes:**
- `origin` — private git server (e.g. self-hosted GitLab/Gitea). Receives all branches including private files.
- `github` — GitHub. Receives only the `public` branch, pushed as `main`.

**Two branches:**
- `main` — development branch. Contains all files. Only pushed to `origin`.
- `public` — sanitized branch for GitHub. Private files are removed from tracking and added to `.gitignore` on this branch. Never directly edited — always synced from `main` via the publish script.

## Setup (one-time)

### 1. Add GitHub as a second remote
```bash
git remote add github git@github.com:<org>/<repo>.git
```

### 2. Create the `public` branch and strip private files
```bash
git checkout -b public

# Remove private files from git tracking (they stay on disk)
git rm --cached <private-file-1> <private-file-2>
git rm --cached -r <private-directory/>

# Add them to .gitignore on this branch
echo "<private-file-1>" >> .gitignore
echo "<private-file-2>" >> .gitignore
echo "<private-directory/>" >> .gitignore

git add .gitignore
git commit -m "Remove private files for public release"

# Push public branch to GitHub as main
git push github public:main

# Return to development branch
git checkout main
```

### 3. Add a publish script to `package.json`
```json
"publish:github": "git checkout public && git checkout main -- src/ package.json package-lock.json README.md .gitignore && git add -A && git diff --cached --quiet || git commit -m 'Sync from main' && git push github public:main && git checkout main"
```

Adjust the file/directory list in `git checkout main -- ...` to match whatever belongs in the public release. Every path listed here is explicitly opted in — anything not listed stays private by default.

## Day-to-Day Workflow

**Normal development:**
```bash
# Work freely on main — commit private files without concern
git add .
git commit -m "..."
git push origin main
```

**Publishing to GitHub:**
```bash
npm run publish:github
```

This command:
1. Switches to `public` branch
2. Copies only the listed public files/dirs from `main`
3. Commits if there are changes
4. Pushes `public` to GitHub as `main`
5. Switches back to `main`

## Adding a New File to the Public Release

Edit the `publish:github` script in `package.json` and add the new path to the `git checkout main -- ...` list.

## Private Files in This Project

The following are committed on `main` but never published to GitHub:
- `CLAUDE.md` — Claude Code instructions
- `broken-link-checker-spec.md` — internal project spec
- `.claude/` — Claude Code settings and memory
- `.idea/` — JetBrains IDE files (also gitignored globally)

These are listed in `.gitignore` on the `public` branch but not on `main`.

## Why Not Other Approaches

- **Single branch + filter on push** — git does not support this natively
- **`.gitattributes` with `export-ignore`** — only applies to `git archive`, not `git push`
- **git-crypt** — designed for encrypting secrets already in a repo, not for ongoing branch hygiene
- **Two separate repositories** — duplicates all history and makes syncing error-prone
