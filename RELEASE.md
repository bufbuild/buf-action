# Releasing buf-action

This document outlines how to create a release of buf-action.
We follow the best practices outlined in the [GitHub Actions documentation][github-release-docs] and [GitHub Actions Toolkit tutorial][github-release-tutorial].

1. Clone the repo, ensuring you have the latest main.

2. On a new branch, run the following commands to update the version of the action:

```bash
VERSION=X.Y.Z VERSION_SHORT=X make updateversion
```

3. Open a PR titled "Prepare for vX.Y.Z". Once it's reviewed and CI passes, merge it.

    *Make sure no new commits are merged until the release is complete.*

4. Create a new release using the Github UI:
    - Under “Choose a tag”, type in “vX.Y.Z” to create a new tag for the release upon publish.
    - Target the main branch.
    - Title the Release “vX.Y.Z”.
    - Click “set as latest release”.
    - Click "Publish this Action to the GitHub Marketplace".


5. Publish the release.

6. Pull down the latest main and move the tags for major (vX) and minor (vX.Y) releases.

```bash
git tag -fa vX -m "Update vX tag"
git tag -fa vX.Y -m "Update vX.Y tag"
git push origin vX vX.Y --force
```

[github-release-docs]: https://docs.github.com/en/actions/creating-actions/releasing-and-maintaining-actions
[github-release-tutorial]: https://github.com/actions/toolkit/blob/master/docs/action-versioning.md
