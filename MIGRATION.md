# Migration Guide

This document describes the changes that need to be made to migrate from any of the 
individual actions ([buf-setup-action][buf-setup], [buf-breaking-action][buf-breaking], [buf-lint-action][buf-lint], [buf-push-action][buf-push]).

## [buf-setup-action][buf-setup]

To migrate to `buf-action` while retaining the same behavior as the deprecated
`buf-setup-action`, set the `setup_only` input to `true` and set the `version`
input to the Buf CLI version you want to pin to. Here is an example:

```diff
 steps:
   - uses: actions/checkout@v2
-  - uses: bufbuild/buf-setup-action@v1.45.0
+  - uses: bufbuild/buf-action@v1
+    with:
+      version: '1.45.0' # Optional. Default is 'latest'
+      setup_only: true  # Optional. Only installs the `buf` CLI.
   - run: buf --version  # Outputs the version of the `buf` CLI
```

The version of the `buf` CLI is no longer tied to the version of the action.
See the setup-only example in the [README](./README.md#setup-only) for more
details.

## [buf-breaking-action][buf-breaking]

To migrate from `buf-breaking-action` to `buf-action`, the `against` parameter
has been renamed to `breaking_against` and will default to the head of the
current branch of the pull request. In the following example, we replace with
`buf-action` and remove the `against` parameter as it is the same as the default:

```diff
 steps:
   - uses: actions/checkout@v2
-  - uses: bufbuild/buf-setup-action@v1
-  - uses: bufbuild/buf-breaking-action@v1
+  - uses: bufbuild/buf-action@v1
     with:
-      against: 'https://github.com/acme/weather.git#branch=main'
```

For more details on specifying inputs see the example in the 
[README](./README.md#specify-the-input-directory).

## [buf-lint-action][buf-lint]

To migrate from `buf-lint-action` we can replace it with the default
`buf-action` behaviour that runs `buf lint` on the input directory. No input
changes are required. Here is an example:

```diff
 steps:
   - uses: actions/checkout@v2
-  - uses: bufbuild/buf-setup-action@v1
-  - uses: bufbuild/buf-lint-action@v1
+  - uses: bufbuild/buf-action@v1
     with:
      input: proto
```

## [buf-push-action][buf-push]

To migrate from `buf-push-action` to `buf-action`, there are a few changes that
need to be made:
  - `buf_token` has been renamed to `token`.
  - `create_visibility` has been removed. The default visibility is `private`.
  - `draft` has been removed. The default behavior of the action is to set the
    labels using the `--git-metadata` flag. This will set the `--label` flag to
    the branch name. Drafts have been deprecated in favor of labels.

The new actions default behavior is to push the branch name as a label. This
behavior will be similar to existing workflows that use drafts. Here is an
example of how a migration would look:

```diff
 steps:
   - uses: actions/checkout@v2
-  - uses: bufbuild/buf-setup-action@v1
-  - uses: bufbuild/buf-push-action@v1
+  - uses: bufbuild/buf-action@v1
     with:
-      buf_token: ${{ secrets.BUF_TOKEN }}
+      token: ${{ secrets.BUF_TOKEN }}
-      create_visibility: private
-      draft: ${{ github.ref_name != 'main'}}
```

[buf]: https://buf.build
[buf-setup]: https://github.com/marketplace/actions/buf-setup
[buf-breaking]: https://github.com/marketplace/actions/buf-breaking
[buf-cli]: https://github.com/bufbuild/buf
[buf-lint]: https://github.com/marketplace/actions/buf-lint
[buf-push]: https://github.com/marketplace/actions/buf-push
