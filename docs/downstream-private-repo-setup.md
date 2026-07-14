# Downstream Private Repo Setup

This public repository is designed to be forked into a private repository that pulls updates from it. Follow these steps to create your own private downstream repo.

## 1. Create the private repository

Create an empty private GitHub repository, for example:

`your-account/web-daw-production`

Do **not** initialize it with a README, license, or `.gitignore`.

## 2. Clone the public repository locally

```bash
git clone git@github.com:your-account/web-daw-open-source.git web-daw-production
cd web-daw-production
```

## 3. Rename the public remote to `upstream`

```bash
git remote rename origin upstream
```

## 4. Add the private repository as `origin`

```bash
git remote add origin git@github.com:your-account/web-daw-production.git
```

Confirm the configuration:

```bash
git remote -v
```

You should see something like:

```
origin    git@github.com:your-account/web-daw-production.git (fetch)
origin    git@github.com:your-account/web-daw-production.git (push)
upstream  git@github.com:your-account/web-daw-open-source.git (fetch)
upstream  git@github.com:your-account/web-daw-open-source.git (push)
```

## 5. Push the existing history to the private repository

```bash
git push -u origin main
git push origin --tags
```

Git supports multiple remotes specifically for situations where one local repository needs to fetch from or push to multiple hosted repositories.

## 6. Add a push safeguard

Because the private repository contains proprietary code, prevent accidental pushes to the public repository from your production working copy:

```bash
git remote set-url --push upstream DISABLED
```

Afterward, `git remote -v` will resemble:

```
origin    git@github.com:your-account/web-daw-production.git (fetch)
origin    git@github.com:your-account/web-daw-production.git (push)
upstream  git@github.com:your-account/web-daw-open-source.git (fetch)
upstream  DISABLED (push)
```

You can still fetch public changes, but an accidental `git push upstream main` will fail.

## 7. Keep a separate clone for public contributions

Maintain a separate local clone of the public repository for making public changes. Never develop public fixes inside the private working copy.

## 8. Pulling public updates into the private repo

```bash
git fetch upstream
git merge upstream/main   # or merge a tagged release, e.g. upstream v1.0.0
```

Prefer merging from tagged releases (`vX.Y.Z`) rather than arbitrary `main` commits.

## Where to put private customizations

To keep upstream merges conflict-free, confine private changes to the documented extension surface (see [public-repo-architecture-plan.md](public-repo-architecture-plan.md)):

- `src/app/product/` — feature registrations, provider bindings, and branding.
- Environment configuration (`.env`) — deployment-specific values and `FEATURE_*` flags.
- Additive database migrations.

Avoid editing shared core files (`src/app/lib/daw/`, `packages/server/app/lib/daw/`, `packages/shared/`) in the private repo; propose those changes upstream instead.
