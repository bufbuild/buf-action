// Copyright 2024 Buf Technologies, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { context, getOctokit } from "@actions/github";

import { getInputs, Inputs, getEnv } from "./inputs";
import { installBuf } from "./installer";
import { commentOnPR } from "./comment";
import { parseModuleNames } from "./config";

// main is the entrypoint for the action.
async function main() {
  const inputs = getInputs();
  const github = getOctokit(inputs.github_token);
  const bufPath = await installBuf(github, inputs.version);
  await login(bufPath, inputs);

  if (inputs.setup_only) {
    core.info("Setup only, skipping steps");
    return;
  }
  // Run the buf workflow.
  const steps = await runWorkflow(bufPath, inputs);
  // Create a summary of the steps.
  const summary = createSummary(inputs, steps);
  // Comment on the PR with the summary, if requested.
  if (inputs.comment) {
    await commentOnPR(context, github, summary.stringify());
  }
  // Write the summary to a file defined by GITHUB_STEP_SUMMARY.
  // NB: Write empties the buffer and must be after the comment.
  await summary.write();
  // Finally, set the status of the action.
  for (const [key, value] of Object.entries(steps) as [
    keyof Steps,
    Result | undefined,
  ][]) {
    if (value?.status == Status.Failed) {
      core.setFailed(`Failed ${key}`);
    }
  }
}

main()
  .catch((err) => core.setFailed(err.message))
  .then(() => core.debug(`done in ${process.uptime()} s`));

// Steps is the result of each step in the workflow. Each step is optional.
// Steps are run in order, buy may be batched together if independent.
interface Steps {
  build?: Result;
  lint?: Result;
  format?: Result;
  breaking?: Result;
  push?: Result;
  archive?: Result;
}

// createSummary creates a GitHub summary of the steps. The summary is a table
// with the name and status of each step.
function createSummary(inputs: Inputs, steps: Steps): typeof core.summary {
  const table = [
    [
      { data: "Name", header: true },
      { data: "Status", header: true },
    ],
    ["build", message(steps.build?.status)],
  ];
  if (inputs.lint) table.push(["lint", message(steps.lint?.status)]);
  if (inputs.format) table.push(["format", message(steps.format?.status)]);
  if (inputs.breaking)
    table.push(["breaking", message(steps.breaking?.status)]);
  if (inputs.push) table.push(["push", message(steps.push?.status)]);
  if (inputs.archive) table.push(["archive", message(steps.archive?.status)]);
  return core.summary.addTable(table);
}

// runWorkflow runs the buf workflow. It returns the results of each step.
// First, it builds the input. If the build fails, the workflow stops.
// Next, it runs lint, format, and breaking checks. If any of these fail, the workflow stops.
// Finally, it pushes or archives the label to the registry.
async function runWorkflow(bufPath: string, inputs: Inputs): Promise<Steps> {
  const steps: Steps = {};
  steps.build = await build(bufPath, inputs);
  if (steps.build.status == Status.Failed) {
    return steps;
  }
  const checks = await Promise.all([
    lint(bufPath, inputs),
    format(bufPath, inputs),
    breaking(bufPath, inputs),
  ]);
  steps.lint = checks[0];
  steps.format = checks[1];
  steps.breaking = checks[2];
  if (checks.some((result) => result.status == Status.Failed)) {
    return steps;
  }
  const moduleNames = parseModuleNames(inputs.input);
  if (moduleNames.length == 0) {
    core.info("No module names found, skipping push and archive");
    steps.push = skip();
    steps.archive = skip();
    return steps;
  }
  steps.push = await push(bufPath, inputs);
  steps.archive = await archive(bufPath, inputs);
  return steps;
}

// login logs in to the Buf registry, storing credentials.
async function login(bufPath: string, inputs: Inputs) {
  const { username, token, domain } = inputs;
  if (username == "") {
    core.debug("Skipping login, no username provided");
    return;
  }
  const resolvedToken = token || getEnv("BUF_TOKEN");
  if (resolvedToken == "") {
    throw new Error("No token provided");
  }
  core.debug(`Logging in as ${username}`);
  await exec.exec(
    bufPath,
    ["registry", "login", domain, "--username", username, "--token-stdin"],
    {
      input: Buffer.from(resolvedToken + "\n"),
    },
  );
}

// build runs the "buf build" step.
async function build(bufPath: string, inputs: Inputs): Promise<Result> {
  const args = ["build", "--error-format", "github-actions"];
  if (inputs.input) {
    args.push(inputs.input);
  }
  if (inputs.config != "") {
    args.push("--config", inputs.config);
  }
  if (inputs.disable_symlinks) {
    args.push("--disable-symlinks");
  }
  for (const path of inputs.paths) {
    args.push("--path", path);
  }
  for (const path of inputs.exclude_paths) {
    args.push("--exclude-path", path);
  }
  if (inputs.exclude_imports) {
    args.push("--exclude-imports");
  }
  return run(bufPath, args);
}

// lint runs the "buf lint" step.
async function lint(bufPath: string, inputs: Inputs): Promise<Result> {
  if (!inputs.lint) {
    core.info("Skipping lint");
    return skip();
  }
  const args = ["lint", "--error-format", "github-actions"];
  if (inputs.input) {
    args.push(inputs.input);
  }
  if (inputs.config != "") {
    args.push("--config", inputs.config);
  }
  if (inputs.disable_symlinks) {
    args.push("--disable-symlinks");
  }
  for (const path of inputs.paths) {
    args.push("--path", path);
  }
  for (const path of inputs.exclude_paths) {
    args.push("--exclude-path", path);
  }
  return run(bufPath, args);
}

// format runs the "buf format" step.
async function format(bufPath: string, inputs: Inputs): Promise<Result> {
  if (!inputs.format) {
    core.info("Skipping format");
    return skip();
  }
  const args = [
    "format",
    "--diff",
    "--error-format",
    "github-actions",
    "--exit-code",
  ];
  if (inputs.input) {
    args.push(inputs.input);
  }
  if (inputs.config) {
    args.push("--config", inputs.config);
  }
  if (inputs.disable_symlinks) {
    args.push("--disable-symlinks");
  }
  for (const path of inputs.paths) {
    args.push("--path", path);
  }
  for (const path of inputs.exclude_paths) {
    args.push("--exclude-path", path);
  }
  return run(bufPath, args);
}

// breaking runs the "buf breaking" step.
async function breaking(bufPath: string, inputs: Inputs): Promise<Result> {
  if (!inputs.breaking) {
    core.info("Skipping breaking");
    return skip();
  }
  const args = [
    "breaking",
    "--error-format",
    "github-actions",
    "--against",
    inputs.breaking_against,
  ];
  if (inputs.input) {
    args.push(inputs.input);
  }
  if (inputs.breaking_against_config) {
    args.push("--against-config", inputs.breaking_against_config);
  }
  if (inputs.config) {
    args.push("--config", inputs.config);
  }
  if (inputs.disable_symlinks) {
    args.push("--disable-symlinks");
  }
  for (const path of inputs.paths) {
    args.push("--path", path);
  }
  for (const path of inputs.exclude_paths) {
    args.push("--exclude-path", path);
  }
  if (inputs.exclude_imports) {
    args.push("--exclude-imports");
  }
  return run(bufPath, args);
}

// push runs the "buf push" step.
async function push(bufPath: string, inputs: Inputs): Promise<Result> {
  if (!inputs.push) {
    core.info("Skipping push");
    return skip();
  }
  const args = ["push", "--error-format", "github-actions"];
  if (inputs.input) {
    args.push(inputs.input);
  }
  if (inputs.push_create) {
    args.push("--create");
    if (inputs.push_create_visibility) {
      args.push("--create-visibility", inputs.push_create_visibility);
    }
  }
  if (inputs.push_git_metadata) {
    args.push("--git-metadata");
  }
  if (inputs.push_source_control_url) {
    args.push("--source-control-url", inputs.push_source_control_url);
  }
  if (inputs.disable_symlinks) {
    args.push("--disable-symlinks");
  }
  for (const label of inputs.push_labels) {
    args.push("--label", label);
  }
  return run(bufPath, args);
}

// archive runs the "buf archive" step.
async function archive(bufPath: string, inputs: Inputs): Promise<Result> {
  if (!inputs.archive) {
    core.info("Skipping archive");
    return skip();
  }
  if (inputs.archive_labels.length == 0) {
    core.info("Skipping archive, no labels provided");
    return skip();
  }
  // Archive is a special case, we want to iterate over all labels to allow
  // for partial failures. If one label fails on not exists, we continue to the
  // next. The last result is returned.
  let result = pass();
  for (const label of inputs.archive_labels) {
    const args = ["beta", "registry", "archive", "--label", label];
    if (inputs.input) {
      args.push(inputs.input);
    }
    const latestResult = await run(bufPath, args);
    if (latestResult.status == Status.Failed) {
      if (
        /Failure: label with name ".*" was not found/.test(latestResult.stderr)
      ) {
        core.info(`Skipping archive, label ${label} not found`);
        continue;
      }
      return latestResult;
    }
    result = latestResult;
  }
  return result;
}

// Status is the status of a command execution.
enum Status {
  // Unknown is the default status.
  Unknown = 0,
  // Passed is the status of a successful command execution.
  Passed,
  // Failed is the status of a failed command execution.
  Failed,
  // Skipped is the status of a skipped command execution.
  Skipped,
}

// Result is the result of a command execution.
interface Result extends exec.ExecOutput {
  status: Status;
}

// run executes the buf command with the given arguments.
async function run(bufPath: string, args: string[]): Promise<Result> {
  return exec
    .getExecOutput(bufPath, args, {
      ignoreReturnCode: true,
      env: {
        ...process.env,
        // See: https://buf.build/docs/bsr/authentication
        BUF_TOKEN: core.getInput("token") || getEnv("BUF_TOKEN"),
        // See: https://buf.build/docs/reference/inputs#https
        BUF_INPUT_HTTPS_USERNAME:
          getEnv("BUF_INPUT_HTTPS_USERNAME") || core.getInput("github_actor"),
        BUF_INPUT_HTTPS_PASSWORD:
          getEnv("BUF_INPUT_HTTPS_PASSWORD") || core.getInput("github_token"),
      },
    })
    .then((output) => ({
      ...output,
      status: output.exitCode == 0 ? Status.Passed : Status.Failed,
    }));
}

// skip returns a skipped result.
function skip(): Result {
  return { status: Status.Skipped, exitCode: 0, stdout: "", stderr: "" };
}

// pass returns a successful result.
function pass(): Result {
  return { status: Status.Passed, exitCode: 0, stdout: "", stderr: "" };
}

// message returns a human-readable message for the status. An undefined status
// is considered cancelled.
function message(status: Status | undefined): string {
  switch (status) {
    case Status.Passed:
      return "✅ passed";
    case Status.Failed:
      return "❌ failed";
    case Status.Skipped:
      return "⏩ skipped";
    default:
      return "🚫 cancelled";
  }
}
