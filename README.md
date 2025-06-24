![The Buf logo](.github/buf-logo.svg)

# buf-action

[![ci](https://github.com/bufbuild/buf-action/actions/workflows/ci.yaml/badge.svg?branch=main)][ci]
[![slack](https://img.shields.io/badge/slack-buf-%23e01563)][slack]

This GitHub action makes it easy to run [`buf`][buf] within a workflow to check for
[build](https://buf.build/docs/reference/cli/buf/build),
[lint](https://buf.build/docs/lint/overview),
[format](https://buf.build/docs/format/style),
and [breaking change](https://buf.build/docs/breaking/overview) errors,
as well as to automatically [publish schema changes](https://buf.build/docs/bsr/module/publish) to the [Buf Schema Registry (BSR)](https://buf.build/product/bsr).

![Annotations example for lint and breaking changes](./static/img/annotations-example.png "Annotations example")

## Usage

To use this action with the recommended default behavior, create a new `.github/workflows/buf-ci.yaml` file in your repository with the following content:

```yaml
name: Buf CI
on:
  push:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]
  delete:
permissions:
  contents: read
  pull-requests: write
jobs:
  buf:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: bufbuild/buf-action@v1
        with:
          token: ${{ secrets.BUF_TOKEN }}
```

This default configuration:

-   Uses `buf push` to [push named modules to the BSR](https://buf.build/docs/bsr/module/publish/) when you push a Git commit, tag, or branch to GitHub.
-   Runs all Buf checks (`build`, `lint`, `format`, and `breaking`), posting a [summary comment](https://buf.build/docs/bsr/ci-cd/github-actions/#configure-summary-comment) for any pull request.
-   Archives corresponding [labels](https://buf.build/docs/bsr/commits-labels/#labels) in the BSR when you delete a Git branch or tag.

## Documentation

For comprehensive configuration options, advanced workflows, and detailed examples, see the [Buf GitHub Action Documentation](https://buf.build/docs/bsr/ci-cd/github-actions).

## Examples

Check out the [examples](examples) directory for various workflow configurations.

## Migrating from individual Buf actions

If you're currently using any of our individual actions
([buf-setup-action][buf-setup], [buf-breaking-action][buf-breaking], [buf-lint-action][buf-lint], [buf-push-action][buf-push]),
we recommend migrating to this consolidated action that has additional capabilities. Benefits to migrating include:
- Less configuration and setup, with built-in best practices.
- Enhanced integration with Git data when pushing to the BSR.
- Status comments on pull requests.
- Easy configuration for custom behavior.

See the [migration guide](MIGRATION.md) for more information.

## Debugging

To debug the action, rerun the workflow with debug logging enabled.
This will run all buf commands with the `--debug` flag.
See the [re-run jobs with debug logging](https://github.blog/changelog/2022-05-24-github-actions-re-run-jobs-with-debug-logging/) for more information.

## Feedback and support

If you have any feedback or need support, please reach out to us on the [Buf Slack][slack],
or [GitHub Issues](https://github.com/bufbuild/buf-action/issues).

## Status: stable

This action is stable and ready for production use.

## Legal

Offered under the [Apache 2 license][license].

[buf]: https://buf.build
[buf-setup]: https://github.com/marketplace/actions/buf-setup
[buf-breaking]: https://github.com/marketplace/actions/buf-breaking
[buf-lint]: https://github.com/marketplace/actions/buf-lint
[buf-push]: https://github.com/marketplace/actions/buf-push
[ci]: https://github.com/bufbuild/buf-action/actions/workflows/ci.yaml
[license]: https://github.com/bufbuild/buf-action/blob/main/LICENSE
[slack]: https://buf.build/links/slack
