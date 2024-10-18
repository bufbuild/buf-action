# Migration Guide

This guide explains what changed when migrating from the individual Buf actions
([buf-setup-action][buf-setup], [buf-breaking-action][buf-breaking],
[buf-lint-action][buf-lint], [buf-push-action][buf-push]) to the new
consolidated `buf-action`.

## [buf-setup-action][buf-setup]

To migrate from `buf-setup-action` to `buf-action`, refer to the table below for the necessary changes:

| Old Parameter       | New Parameter       | Description         |
|:--------------------|:--------------------|:--------------------|
| `version`           | `version`           | Unchanged. Version of `buf` CLI to install. |
| `buf_user`          | N/A                 | Removed. The username is not required for login. |
| `buf_api_token`     | `token`             | Renamed. Buf API token for BSR requests. |
| `buf_domain`        | `domain`            | Renamed. Buf domain for BSR requests. Enterprise only. |
| N/A                 | `setup_only`        | Added. Installs `buf` and optionally login to the BSR but no additional commands will be run. Set to `true` to make `buf-action` behave like `buf-setup-action`. Defaults to `false`. For more details, refer to the setup-only example in the [README](./README.md#setup-only) |
| N/A                 | `github_action`     | Added. Github actor for API requests. Defaults to the current actor in the Github context. |
| `github_token`      | `github_token`      | Unchanged. GitHub token for API requests. Defaults to token in the Github Context. |

Example migration:

```diff
 steps:
   - uses: actions/checkout@v4
-  - uses: bufbuild/buf-setup-action@v1.45.0
+  - uses: bufbuild/buf-action@v1
     with:
-      buf_user: ${{ secrets.buf_user }}
-      buf_api_token: ${{ secrets.buf_api_token }}
+      version: '1.45.0' # Optional. Defaults to the latest release.
+      token: ${{ secrets.buf_api_token }}
+      setup_only: true
   - run: buf --version
```

> [!NOTE]
> The `buf` CLI version is no longer dependent on the action version.

## [buf-breaking-action][buf-breaking]

To migrate from `buf-breaking-action` to `buf-action`, refer to the table below for the necessary changes:

| Old Parameter       | New Parameter       | Description                                                      |
|:--------------------|:--------------------|:-----------------------------------------------------------------|
| `input`             | `input`             | Unchanged. The input directory to build. Defaults to the current directory. See the [README](./README.md#specify-the-input-directory) for more details on specifying inputs. | 
| `against`           | `breaking_against`  | Renamed. Specifies the reference to check breaking changes against. We recommend not setting this parameter and instead relying on the default behavior. |
| `buf_input_https_username`| N/A           | Removed. The username is not required for login. |
| `buf_input_https_password`| N/A           | Removed. To support multiple registries use the mulitple format of `BUF_TOKEN` as an enviornemt variable. See the [buf token formats documentation][buf-token-formats] for more details.  |
| `buf_token`         | `token`             | Renamed. Buf API token for BSR requests.                          |

Example migration:

```diff
 steps:
   - uses: actions/checkout@v4
-  - uses: bufbuild/buf-setup-action@v1
-  - uses: bufbuild/buf-breaking-action@v1
+  - uses: bufbuild/buf-action@v1
     with:
-      buf_token: ${{ secrets.BUF_TOKEN }}
+      token: ${{ secrets.BUF_TOKEN }}
-      against: 'https://github.com/acme/weather.git#branch=main'
+      # This example shows how to maintain behavior when migrating, but we recommend unsetting this parameter and relying on the default behavior instead.
+      breaking_against: 'https://github.com/acme/weather.git#branch=main'
```

## [buf-lint-action][buf-lint]

To migrate from `buf-lint-action` to `buf-action`, refer to the table below for the necessary changes.

| Old Parameter       | New Parameter       | Description                                                      |
|:--------------------|:--------------------|:-----------------------------------------------------------------|
| `input`             | `input`             | Unchanged. The input directory to lint. Defaults to the current directory. See the [README](./README.md#specify-the-input-directory) for more details on specifying inputs. | 
| `buf_token`         | `token`             | Renamed. Buf API token for BSR requests.                          |

Example migration:

```diff
 steps:
   - uses: actions/checkout@v4
-  - uses: bufbuild/buf-setup-action@v1
-  - uses: bufbuild/buf-lint-action@v1
+  - uses: bufbuild/buf-action@v1
     with:
       input: proto
-      buf_token: ${{ secrets.BUF_TOKEN }}
+      token: ${{ secrets.BUF_TOKEN }}
```

## [buf-push-action][buf-push]

To migrate from `buf-push-action` to `buf-action`, refer to the table below for the necessary changes:

| Old Parameter       | New Parameter       | Description                                                      |
|:--------------------|:--------------------|:-----------------------------------------------------------------|
| `input`             | `input`             | Unchanged. The input directory to push. Defaults to the current directory. See the [README](./README.md#specify-the-input-directory) for more details on specifying inputs. | 
| `buf_token`         | `token`             | Renamed. Buf API token for BSR requests.                          |
| `draft`             | N/A                 | Removed. Drafts are deprecated in favor of labels. Labels are set using [git metadata][git-metadata]. |
| `create_visibility` | N/A                 | Removed. Repositories will always be created with `private` visibility if they do not exist. |
| N/A                 | `push_disable_create`| Added. Disables automatic creation of repositories. Defaults to `false`. |

Example migration:

```diff
 steps:
   - uses: actions/checkout@v4
-  - uses: bufbuild/buf-setup-action@v1
-  - uses: bufbuild/buf-push-action@v1
+  - uses: bufbuild/buf-action@v1
     with:
-      buf_token: ${{ secrets.BUF_TOKEN }}
+      token: ${{ secrets.BUF_TOKEN }}
-      create_visibility: private
-      draft: ${{ github.ref_name != 'main'}}
```

To further customize the push action call the `buf push` command directly. 
For example:

```diff
 steps:
   - uses: actions/checkout@v4
   - uses: bufbuild/buf-action@v1
      with:
        token: ${{ secrets.BUF_TOKEN }}
+       setup_only: true # Disables default behavior.
+  - if: ${{ github.event_name == 'push' }}
+    run: buf push --error-format github-actions --create --git-metadata
```

> [!NOTE]
> Labels are a new feature in the `buf` CLI. For more information, see the [commits and labels][commits-labels] documentation.

[buf]: https://buf.build  
[buf-setup]: https://github.com/marketplace/actions/buf-setup  
[buf-breaking]: https://github.com/marketplace/actions/buf-breaking  
[buf-cli]: https://github.com/bufbuild/buf  
[buf-lint]: https://github.com/marketplace/actions/buf-lint  
[buf-push]: https://github.com/marketplace/actions/buf-push
[git-metadata]: https://buf.build/docs/reference/cli/buf/push/?h=git+metadata#git-metadata
[buf-token-formats]: https://buf.build/docs/bsr/authentication/#buf_token-formats
[commits-labels]: https://buf.build/docs/concepts/commits-labels/
