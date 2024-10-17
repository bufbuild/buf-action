# Migration Guide

This document describes the changes that need to be made to migrate from any of the 
individual actions ([buf-setup-action][buf-setup], [buf-breaking-action][buf-breaking], [buf-lint-action][buf-lint], [buf-push-action][buf-push]).

## [buf-setup-action][buf-setup]

The `buf-setup-action` has been deprecated in favor of the `buf-action` action. 

```yaml
steps:
  - uses: actions/checkout@v2
  - uses: bufbuild/buf-setup-action@v1.45.0
```

The version of the `buf` CLI is no longer tied to the version of the action. 
To specify the version use the `version` parameter.

```yaml
steps:
  - uses: actions/checkout@v2
  - uses: bufbuild/buf-action@v1
    with:
      version: '1.45.0' # Optional. Default is 'latest'
      setup_only: true  # Optional. Only installs the `buf` CLI.
  - run: buf --version  # Outputs the version of the `buf` CLI
```

See the setup-only example in the [README](./README.md#setup-only).

## [buf-breaking-action][buf-breaking]

The `buf-breaking-action` has been deprecated in favor of the `buf-action` action.

```yaml
steps:
  - uses: bufbuild/buf-breaking-action@v1
    with:
      against: 'https://github.com/acme/weather.git#branch=main'
```

The `against` parameter has been renamed to `breaking_against` and will default
to the head of the current branch of the pull request.

See the specify the input directory example in the [README](./README.md#specify-the-input-directory).

## [buf-lint-action][buf-lint]

The `buf-lint-action` has been deprecated in favor of the `buf-action` action.

```yaml
steps:
  - uses: actions/checkout@v2
  - uses: bufbuild/buf-setup-action@v1
  - uses: bufbuild/buf-lint-action@v1
```

No input changes are required. Remove the `buf-lint-action` and replace it with the `buf-action` action.

```yaml
steps:
  - uses: actions/checkout@v2
  - uses: bufbuild/buf-action@v1
```

## [buf-push-action][buf-push]

The `buf-push-action` has been deprecated in favor of the `buf-action` action.

```yaml
steps:
  - uses: actions/checkout@v2
  - uses: bufbuild/buf-setup-action@v1
  - uses: bufbuild/buf-push-action@v1
    with:
      buf_token: ${{ secrets.BUF_TOKEN }}
      create_visibility: private
      draft: ${{ github.ref_name != 'main'}}
```

The following parameters have been altered:
  - `create_visibility` is not editable. The default visibility is `private`.
  - `draft` is not setable. The default behavior of the action is to set the
    labels using the `--git-metadata` flag. This will set the `--label` flag to
    the branch name.


```yaml
steps:
  - uses: actions/checkout@v4
  - uses: bufbuild/buf-action@v1
    with:
      token: ${{ secrets.BUF_TOKEN }}
```


[buf]: https://buf.build
[buf-setup]: https://github.com/marketplace/actions/buf-setup
[buf-breaking]: https://github.com/marketplace/actions/buf-breaking
[buf-cli]: https://github.com/bufbuild/buf
[buf-lint]: https://github.com/marketplace/actions/buf-lint
[buf-push]: https://github.com/marketplace/actions/buf-push
