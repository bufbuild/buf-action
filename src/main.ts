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
  const table = [
    [
      { data: "Name", header: true },
      { data: "Status", header: true },
    ],
    ["build", message(steps.build?.status)],
    ["lint", message(steps.lint?.status)],
    ["format", message(steps.format?.status)],
    ["breaking", message(steps.breaking?.status)],
  ];
  const summary = core.summary
    .addRaw("The latest Buf updates on your PR.", true)
    .addTable(table);
  // Comment on the PR with the summary, if requested.
  if (inputs.comment) {
    await commentOnPR(context, github, summary.stringify());
  }
  // Write the summary to a file defined by GITHUB_STEP_SUMMARY.
  // NB: Write empties the buffer must be after the comment.
  await summary.write();
  // Finally, set the status of the action.
  for (const [key, value] of Object.entries(steps)) {
    if (value?.status == Status.Failed) {
      core.setFailed(`Failed ${key}`);
    }
  }
}

main()
  .catch((err) => core.setFailed(err.message))
  .then(() => core.debug(`done in ${process.uptime()} s`));

interface Steps {
  build?: Result;
  lint?: Result;
  format?: Result;
  breaking?: Result;
  push?: Result;
  archive?: Result;
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

async function archive(bufPath: string, inputs: Inputs): Promise<Result> {
  if (!inputs.archive) {
    core.info("Skipping archive");
    return skip();
  }
  const args = ["beta", "registry", "archive"];
  if (inputs.input) {
    args.push(inputs.input);
  }
  for (const label of inputs.archive_labels) {
    args.push("--label", label);
  }
  return run(bufPath, args);
}

enum Status {
  Unknown = 0,
  Passed,
  Failed,
  Skipped,
}

interface Result extends exec.ExecOutput {
  status: Status;
}

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

function skip(): Result {
  return { status: Status.Skipped, exitCode: 0, stdout: "", stderr: "" };
}

function message(status: Status): string {
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
