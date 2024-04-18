# Examples

This directory contains examples of how to use the `buf` GitHub Action.

## Workflows

- [buf-ci.yaml](./buf-ci.yaml): Recommended configuration for using `buf` in a CI environment.

- [only-check.yaml](./only-check.yaml): How to use `buf` to only run checks on pull requests.
- [only-setup.yaml](./only-setup.yaml): How to use `buf` to only install `buf`.
- [only-setup-defaults.yaml](./only-setup-defaults.yaml): Showcases the default steps of the `buf` action.
- [only-sync.yaml](./only-sync.yaml): How to use `buf` to only sync the repository labels.

- [push-on-changes.yaml](./push-on-changes.yaml): Pushes changes only on detecting protobuf file changes.

- [skip-on-commits.yaml](./skip-on-commits.yaml): How to use commit messages to skip `buf` checks on push.
- [skip-on-labels.yaml](./skip-on-labels.yaml): How to use custom labels to skip `buf` checks on pull requests.

- [validate-push.yaml](./validate-push.yaml): Validate checks before pushing to the repository.

- [version-env.yaml](./version-env.yaml): Resolve the `buf` version from an environment variable (`BUF_VERSION`).
- [version-file.yaml](./version-file.yaml): Resolve the `buf` version from a file (`.bufversion`).
- [version-input.yaml](./version-input.yaml): Resolve the `buf` version from an action input (`version`).
- [version-latest.yaml](./version-latest.yaml): Use the latest `buf` version.
