# GitHub Publishing Strategy

This project uses a two-branch, two-remote git strategy to maintain a private development branch with internal files while publishing a clean public version to GitHub.

## The Problem

Some files should remain in version control (for use with Claude Code, internal specs, IDE settings, etc.) but must never appear in the public GitHub repository. Git does not support filtering files on push, so the solution requires separate branches and remotes.

## Structure

**Two remotes:**
- `origin` — private git server (e.g. self-hosted GitLab). Receives all branches including private files.
- `github` — GitHub. Receives only the `public` branch, pushed as `main`.

**Two branches:**
- `main` — development branch. Contains all files. Only pushed to `origin`.
- `public` — sanitized branch for GitHub.

## Setup (one-time)

### 1. Add GitHub as a second remote
```bash
git remote add github git@github.com:<org>/<repo>.git
```

### 2. Create the `public` branch and strip private files
This is the simple crucial step. The --orphan flag creates a new branch with no history. All the files from main show up as "added" files in git. Using webstorms git rollback, _remove all files not intended for public._ Then double-check and edit files to be appropriate to the public release, e.g. package.json and README.

```bash
git checkout --orphan public
# remove private files from staging.
# edit files like package.json and readme to reflect public info. 
git commit -m "initial public commit"
git push -u origin public
# push public branch to main on github
git push github public:main 

# Return to development branch
git checkout main
```

### 3. push future changes to public
This approach is more hands-on and far simpler than Claude's elaborate suggestion.
```bash
git checkout public
git merge main --no-commit --no-ff

# review and remove all private files from staging
git push # to gitlab
git push github public:main
git checkout main 
```
