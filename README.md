![The Buf logo](https://raw.githubusercontent.com/bufbuild/protovalidate/main/.github/buf-logo.svg)

# buf-action

[![ci](https://github.com/bufbuild/buf-action/actions/workflows/ci.yaml/badge.svg?branch=main)][ci]
[![slack](https://img.shields.io/badge/slack-buf-%23e01563)][slack]

> [!CAUTION]
> This is in alpha and is under development, stay tuned!

This GitHub action makes it easy to use [`buf`][buf] within workflows.

- It installs and caches `buf`.
- It implements default behavior that follows best practices
  by running `buf` commands (e.g. `build`, `lint`, `breaking`, `format`, `push`) based on GitHub event triggers.
- It is easy to configure to work with any setup.

## Usage

To use the recommended default behavior, create a new `.github/workflows/buf-ci.yaml` file in your repository with the following content:

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
      - uses: bufbuild/buf-action@v0.1.1
        with:
          username: ${{ secrets.BUF_USERNAME }}
          token: ${{ secrets.BUF_TOKEN }}
```

See [action.yml](action.yml) for all options.

### Default behavior

| GitHub action event | Default behavior | `buf` commands |
| - | - | - |
| [`push`][push-event] | Push content to the BSR every time a new commit, tag, or branch is pushed to GitHub.  | `buf push` |
| [`pull_request`][pull-request-event] | Run all checks and post (or update) a summary comment on the PR every time it is updated. | `buf build`<br>`buf lint`<br>`buf format`<br>`buf breaking` |
| [`delete`][delete-event] | Archive the corresponding label on the BSR every time a Git branch or tag is deleted from GitHub. | `buf beta registry archive --label` |

This behavior is the recommended workflow for managing the development of protos in GitHub.
However, the action can also be configured in a number of ways to match your preferred workflow.

#### Skipping steps

For specific project requirements you may want to skip certain checks in CI.
By default this action uses labels on pull requests to enable skipping of lint, formatting or breaking change detection checks.
To use this behaviour you'll need to add the following labels to your repository:

- `buf skip lint`: skips lint.
- `buf skip format`: skips format. 
- `buf skip breaking`: skips breaking change detection.

When a label is applied to a PR the action will re-run skipping the check specified by the label.
All label checks are case-insensitive.
Ensure the workflow file includes the types `labeled` and `unlabeled` events to automatically re-run on label changes.


### Customizing behavior

#### Example workflows

Check out the [examples](examples) directory for more detailed workflows.

#### Setup only

To only setup the action without running any commands, set the input `setup_only` to `true`.
This will install `buf` and optionally login to the schema registry but no additional commands will be run.
Subsequent steps will have `buf` available in their $PATH and can invoke `buf` directly.

```yaml
- uses: bufbuild/buf-action@v0.1.1
  with:
    setup_only: true
- run: buf build --error-format github-actions
```

See the [only-setup.yaml](examples/only-setup.yaml) example.

#### Skip steps

To skip or disable parts of the workflow, each step corresponds to a boolean flag in the input.
For example to disable linting set the input `lint` to `false`:

```yaml
- uses: bufbuild/buf-action@v0.1.1
  with:
    lint: false
```

See [action.yml](action.yml) for all available inputs.

#### Customize when steps run

To trigger steps on different events use the GitHub action context to deduce the event type.
For example to enable formatting checks on both pull requests and push create an expression for the input `format`:

```yaml
- uses: bufbuild/buf-action@v0.1.1
  with:
    format: ${{ contains(fromJSON('["push", "pull_request"]'), github.event_name) }}
```

See [GitHub Actions expressions](https://docs.github.com/en/actions/learn-github-actions/expressions) documentation.

#### Skip checks on commit messages

To conditionally run checks based on user input, use the GitHub action context to check for the contents of the commit.
For example to disable breaking change detection on commits, create an expression on the input `breaking` to check the contents of the commit message:

```yaml
- uses: bufbuild/buf-action@v0.1.1
  with:
    breaking: |
      contains(fromJSON('["push", "pull_request"]'), github.event_name) &&
      !contains(github.event.head_commit.message, 'buf skip breaking')
```     

See [GitHub Actions job context](https://docs.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions#job-context) documentation.

#### Only push on changes

To push only on changes to the protos, restrict the push step for any changes to buf releated files.
This can be achieved by using the `paths` filter on the `push` event.

```yaml
push:
  paths:
    # Caution: This workflow could miss changes if the paths are not correctly specified.
    - '**.proto'
    - '**/buf.yaml'
    - '**/buf.lock'
    - '**/buf.md'
    - '**/README.md'
    - '**/LICENSE'
```

See the [push-on-changes.yaml](examples/push-on-changes.yaml) example.

### Versioning

To ensure the version of `buf` is consistent across workflows it's recommended to always use an explicit version.

```yaml
- uses: bufbuild/buf-action@v0.1.1
  with:
    version: 1.32.2
```

If no version is specified in the workflow config, the action will resolve the version in order of precendence:
- A version specified in the environment variable `${BUF_VERSION}`.
- The version of `buf` that is already installed on the runner (if it exists)
- The latest version of the `buf` binary from the official releases on GitHub.

### Authentication

Syncing the repository with the Buf Schema Registry (BSR) provides a seamless experience from your GitHub sources to your consumers of your schemas.
Authenticating with the BSR is required for both push and label archive steps.

To authenticate with the BSR, set the inputs `username` and `token`.
The `username` and `token` values can be stored as secrets in the repository settings.
The `token` value can be [generated from the Buf Schema Registry UI](https://buf.build/docs/bsr/authentication#create-an-api-token).

```yaml
- uses: bufbuild/buf-action@v0.1.1
  with:
    username: ${{ secrets.BUF_USERNAME }}
    token: ${{ secrets.BUF_TOKEN }}
```

Alternatively, you can set the environment variable `BUF_TOKEN`.

```yaml
- uses: bufbuild/buf-action@v1
  env:
    BUF_TOKEN: ${{ secrets.BUF_TOKEN }}
```

For more information on authentication, see the [Buf Schema Registry Authentication Reference](https://buf.build/docs/bsr/authentication).

#### Security considerations

Always use secrets to store `token` and `username` values.
Never hardcode these values in the workflow file.


### Summary comment

To help code review feedback the action outputs a GitHub summary of the current check status and comments on the pull requests.
For each subsequent run the comment updates displaying the latest status:

> The latest Buf updates on your PR.
> <table><tr><th>Name</th><th>Status</th></tr><tr><td>build</td><td>✅ passed</td></tr><tr><td>lint</td><td>⏩ skipped</td></tr><tr><td>format</td><td>✅ passed</td></tr><tr><td>breaking</td><td>✅ passed</td></tr></table>

To disable the comment, set the input `comment` to `false` and remove the permission `pull_request: write` as this is no longer required.

```yaml
name: Buf CI
runs-on: ubuntu-latest
permissions:
  contents: read
steps:
  - uses: bufbuild/buf-action@v0.1.1
    with:
      comment: false
```


### Specify inputs

To run the action for inputs not specified at the root of the repository, set the input `input` to the path of your `buf.yaml` directory.
Breaking change detection will also be required to be set to include a `subdir` configured to the same input path.

```yaml
- uses: bufbuild/buf-action@v0.1.1
  with:
    input: protos
    breaking_against: |
      ${{ github.event.repository.clone_url }}#format=git,tag=${{ github.event.pull_request.base.sha }},subdir=protos
```

Alternatively, you may wish to pre-checkout the base branch for breaking changes.

```yaml
- uses: actions/checkout@v4
  with:
    path: head
- uses: actions/checkout@v4
  with:
    path: base
    ref: ${{ github.event.pull_request.base.sha }}
- uses: bufbuild/buf-action@v0.1.1
  with:
    input: head/protos
    breaking_against: base/protos
```

For more information on inputs, see the [Buf Inputs Reference](https://buf.build/docs/reference/inputs).


### Check generation

For projects that make use of the local code generation features we recommend checking for diffs on pull requests.
This isn't available as a built-in step but can easily be added by invoking `buf`.
To check the generation of files match the committed protobuf files, use the `buf generate` command and compare them with `git diff`.
If differences exist, `git diff` returns a non-zero exit code with the `--exit-code` flag.

```yaml
- name: Run buf generate
  run: |
    buf generate --error-format github-actions
    git diff --exit-code gen
```

#### Builtin protoc plugins

Some projects require the use of builtin `protoc` plugins, such as `protoc-gen-cpp`.
To use these plugins, please additionaly install `protoc` such as with the action
[`setup-protoc`](https://github.com/marketplace/actions/setup-protoc).


## Migration to `buf-action`

If you're currently using [`buf-setup-action`][buf-setup] and other Buf Actions like [`buf-breaking-action`][buf-breaking], [`buf-lint-action`][buf-lint], or [`buf-push-action`][buf-push], you may want to migrate to this action which consolidates these functionalities into a single action with additional capabilities.

### Example Migration

Here's an example migration from using multiple actions to the new consolidated `buf-action`:

### Before (using `buf-setup-action` and other actions)

```yaml
steps:
  - uses: actions/checkout@v2
  - uses: bufbuild/buf-setup-action@v1.32.2
    with:
      version: 1.32.2
      buf_user: ${{ secrets.BUF_USERNAME }}
      buf_api_token: ${{ secrets.BUF_TOKEN }}
  - uses: bufbuild/buf-lint-action@v1
  - uses: bufbuild/buf-breaking-action@v1
    with:
      against: 'https://github.com/acme/weather.git#branch=${{ github.event.repository.default_branch }}'
  - uses: bufbuild/buf-push-action@v1
    with:
      buf_token: ${{ secrets.BUF_TOKEN }}
      create_visibility: private
      draft: ${{ github.ref_name != github.event.repository.default_branch }}
```

### After (using `buf-action`)

```yaml
name: Buf CI
on:
  push:
  pull_request:
jobs:
  buf:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: bufbuild/buf-action@v0.1.1
        with:
          version: 1.32.2
          username: ${{ secrets.BUF_USERNAME }}
          token: ${{ secrets.BUF_TOKEN }}
```

### Benefits of migrating

- **Consolidated configuration**: Manage all Buf-related tasks in one action.
- **Simplified workflow**: Less configuration and setup, with built-in best practices.
- **Improved functionality**: Additional capabilities like automatic commenting on pull requests, conditional checks with labels and more customizable behaviour.
- **Enhanced sync**: Push and archive with git metadata for improved synchronization with the Buf Schema Registry (BSR).


## Feedback and support

If you have any feedback or need support, please reach out to us on the [Buf Slack][slack].
or [GitHub Issues](https://github.com/bufbuild/buf-action/issues).


## Status: alpha

Not yet stable.


## Legal

Offered under the [Apache 2 license][license].

[buf]: https://buf.build
[buf-setup]: https://github.com/marketplace/actions/buf-setup
[buf-breaking]: https://github.com/marketplace/actions/buf-breaking
[buf-cli]: https://github.com/bufbuild/buf
[buf-lint]: https://github.com/marketplace/actions/buf-lint
[buf-push]: https://github.com/marketplace/actions/buf-push
[ci]: https://github.com/bufbuild/buf-action/actions/workflows/ci.yaml
[license]: https://github.com/bufbuild/bufisk/blob/main/LICENSE
[slack]: https://buf.build/links/slack
[bsr]: https://buf.build/docs/introduction
[push-event]: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#push
[pull-request-event]: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#pull_request
[delete-event]: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#delete
