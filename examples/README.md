# Examples

This directory contains examples of how to use the `buf` GitHub Action.

## Workflows

- [buf-ci.yaml](./buf-ci.yaml): Recommended configuration for using `buf` in a CI environment.

- [only-checks/buf-ci.yaml](./only-checks/buf-ci.yaml): How to use `buf` to only run checks on pull requests.
- [only-setup/buf-ci.yaml](./only-setup/buf-ci.yaml): How to use `buf` to only install `buf`.
- [only-setup-defaults/buf-ci.yaml](./only-setup-defaults/buf-ci.yaml): Showcases the default steps of the `buf` action.
- [only-sync/buf-ci.yaml](./only-sync/buf-ci.yaml): How to use `buf` to only sync the repository labels.

- [push-on-changes/buf-ci.yaml](./push-on-changes/buf-ci.yaml): Pushes changes only on detecting protobuf file changes.

- [skip-on-commits/buf-ci.yaml](./skip-on-commits/buf-ci.yaml): How to use commit messages to skip `buf` checks on push.
- [skip-on-labels/buf-ci.yaml](./skip-on-labels/buf-ci.yaml): How to use custom labels to skip `buf` checks on pull requests.

- [validate-push/buf-ci.yaml](./validate-push/buf-ci.yaml): Validate checks before pushing to the repository.

- [version-env/buf-ci.yaml](./version-env/buf-ci.yaml): Resolve the `buf` version from an environment variable (`BUF_VERSION`).
- [version-input/buf-ci.yaml](./version-input/buf-ci.yaml): Resolve the `buf` version from an action input (`version`).
- [version-latest/buf-ci.yaml](./version-latest/buf-ci.yaml): Use the latest `buf` version.
