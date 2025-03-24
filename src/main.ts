// Copyright 2024-2025 Buf Technologies, Inc.
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
import { GitHub } from "@actions/github/lib/utils";
import { context, getOctokit } from "@actions/github";

import { create } from "@bufbuild/protobuf";

import { createConnectTransport } from "@connectrpc/connect-web";
import { createClient, ConnectError, Code } from "@connectrpc/connect";
import { LabelService } from "@buf/bufbuild_registry.bufbuild_es/buf/registry/module/v1/label_service_pb";
import { LabelRefSchema } from "@buf/bufbuild_registry.bufbuild_es/buf/registry/module/v1/label_pb";
import * as parseDiff from "parse-diff";

import { getInputs, Inputs, getEnv } from "./inputs";
import { Outputs } from "./outputs";
import { installBuf } from "./installer";
import { findCommentOnPR, commentOnPR } from "./comment";
import { parseModuleNames, ModuleName } from "./config";

// URL for the public GitHub API.
const publicGitHubApiUrl = "https://api.github.com";

// main is the entrypoint for the action.
async function main() {
  const inputs = getInputs();
  const github = getOctokit(inputs.github_token);
  // Check if the action is running on a GitHub Enterprise instance.
  // If so, use the public GitHub API for resolving the Buf version etc.
  let publicGithubToken = inputs.github_token;
  let publicGithub: InstanceType<typeof GitHub> | undefined = github;
  const apiUrl = process.env.GITHUB_API_URL || ``;
  if (!apiUrl.startsWith(publicGitHubApiUrl)) {
    core.info("Running on GitHub Enterprise, using public GitHub API.");
    publicGithubToken = inputs.public_github_token;
    if (publicGithubToken == "") {
      publicGithub = undefined;
    } else {
      publicGithub = getOctokit(publicGithubToken, {
        baseUrl: publicGitHubApiUrl,
      });
    }
  }
  const [bufPath, bufVersion] = await installBuf(
    publicGithub,
    publicGithubToken,
    inputs.version,
  );
  core.setOutput(Outputs.BufVersion, bufVersion);
  core.setOutput(Outputs.BufPath, bufPath);
  core.saveState(Outputs.BufPath, bufPath);
  if (inputs.github_actor == "dependabot[bot]") {
    core.info("Skipping steps for dependabot");
    return;
  }
  await login(bufPath, inputs);
  if (inputs.setup_only) {
    core.info("Setup only, skipping steps");
    return;
  }
  // Parse the module names from the input.
  const moduleNames = await parseModuleNames(bufPath, inputs.input);
  // Run the buf workflow.
  const steps = await runWorkflow(bufPath, inputs, moduleNames);
  // Create a summary of the steps.
  const summary = createSummary(inputs, steps, moduleNames);
  // Comment on the PR with the summary, if requested.
  if (inputs.pr_comment) {
    const commentID = await findCommentOnPR(context, github);
    await commentOnPR(
      context,
      github,
      commentID,
      `The latest Buf updates on your PR. Results from workflow <a href="${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}">${context.workflow} / ${context.job} (pull_request)</a>.\n\n${summary.stringify()}`,
    );
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
function createSummary(
  inputs: Inputs,
  steps: Steps,
  moduleNames: ModuleName[],
): typeof core.summary {
  const table = [
    [
      { data: "Build", header: true },
      { data: "Format", header: true },
      { data: "Lint", header: true },
      { data: "Breaking", header: true },
      { data: "Updated (UTC)", header: true },
    ],
    [
      message(steps.build),
      message(steps.format),
      message(steps.lint),
      message(steps.breaking),
      new Date().toLocaleString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "numeric",
        hour12: true,
        timeZone: "UTC",
      }),
    ],
  ];
  // If push or archive is enabled add a link to the registry.
  let output = core.summary.addTable(table);
  if (inputs.push && moduleNames.length > 0) {
    const modules = moduleNames.map(
      (moduleName) =>
        `<a href="https://${moduleName.name}">${moduleName.name}</a>`,
    );
    output = output.addRaw(`Pushed to ${modules.join(", ")}.`, true);
  }
  if (inputs.archive && moduleNames.length > 0) {
    const modules = moduleNames.map(
      (moduleName) =>
        `<a href="https://${moduleName.name}">${moduleName.name}</a>`,
    );
    output = output.addRaw(
      `Archived labels ${inputs.archive_labels.join(", ")} to ${modules.join(", ")}.`,
      true,
    );
  }
  return output;
}

// runWorkflow runs the buf workflow. It returns the results of each step.
// First, it builds the input. If the build fails, the workflow stops.
// Next, it runs lint, format, and breaking checks. If any of these fail, the workflow stops.
// Finally, it pushes or archives the label to the registry.
async function runWorkflow(
  bufPath: string,
  inputs: Inputs,
  moduleNames: ModuleName[],
): Promise<Steps> {
  const steps: Steps = {};
  steps.build = await build(bufPath, inputs);
  if (steps.build.status == Status.Failed) {
    if (steps.build.stderr.match(/had no .proto files/)) {
      core.info(
        'Did you forget to add the "actions/checkout@v4" checkout step to your workflow?',
      );
    }
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
  steps.push = await push(bufPath, inputs, moduleNames);
  steps.archive = await archive(inputs, moduleNames);
  return steps;
}

// login logs in to the Buf registry, storing credentials.
async function login(bufPath: string, inputs: Inputs) {
  const { token, domain } = inputs;
  if (token == "") {
    core.debug("Skipping login, no token provided");
    return;
  }
  core.debug(`Logging in to ${domain}`);
  await exec.exec(bufPath, ["registry", "login", domain, "--token-stdin"], {
    input: Buffer.from(token + "\n"),
  });
}

// build runs the "buf build" step.
async function build(bufPath: string, inputs: Inputs): Promise<Result> {
  const args = ["build", "--error-format", "github-actions"];
  if (inputs.input) {
    args.push(inputs.input);
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
    core.debug("Skipping lint");
    return skip();
  }
  const args = ["lint", "--error-format", "github-actions"];
  if (inputs.input) {
    args.push(inputs.input);
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
    core.debug("Skipping format");
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
  for (const path of inputs.paths) {
    args.push("--path", path);
  }
  for (const path of inputs.exclude_paths) {
    args.push("--exclude-path", path);
  }
  const result = await run(bufPath, args);
  if (result.status == Status.Failed && result.stdout.startsWith("diff")) {
    // If the format step fails, parse the diff and write github annotations.
    const diff = parseDiff(result.stdout);
    result.stdout = ""; // Clear the stdout to count the number of changes.
    for (const file of diff) {
      result.stdout += `::error file=${file.to}::Format diff -${file.deletions}/+${file.additions}.\n`;
    }
    console.log(result.stdout);
  }
  return result;
}

// breaking runs the "buf breaking" step.
async function breaking(bufPath: string, inputs: Inputs): Promise<Result> {
  if (!inputs.breaking) {
    core.debug("Skipping breaking");
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
async function push(
  bufPath: string,
  inputs: Inputs,
  moduleNames: ModuleName[],
): Promise<Result> {
  if (!inputs.push) {
    core.debug("Skipping push");
    return skip();
  }
  if (moduleNames.length == 0) {
    core.debug("Skipping push, no named modules detected");
    return skip();
  }
  // We want push to succeed without additional user configuration even if the action is being run on an
  // enterprise GitHub instance. Because enterprise GitHub instances can have an arbitrary URL, the Buf CLI with not be
  // able to automatically detect the source control url, so we set it explicitly.
  const sourceControlUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/commit/${context.sha}`;
  const args = [
    "push",
    "--error-format",
    "github-actions",
    "--exclude-unnamed",
    "--git-metadata",
    "--source-control-url",
    sourceControlUrl,
  ];
  if (!inputs.push_disable_create) {
    args.push("--create");
  }
  if (inputs.input) {
    args.push(inputs.input);
  }
  return run(bufPath, args);
}

// archive runs the "buf archive" step.
async function archive(
  inputs: Inputs,
  moduleNames: ModuleName[],
): Promise<Result> {
  if (!inputs.archive) {
    core.debug("Skipping archive");
    return skip();
  }
  if (moduleNames.length == 0) {
    core.debug("Skipping archive, no named modules detected");
    return skip();
  }
  if (inputs.archive_labels.length == 0) {
    core.debug("Skipping archive, no labels provided");
    return skip();
  }
  for (const moduleName of moduleNames) {
    const baseURL = `https://${moduleName.registry}`;
    const transport = createConnectTransport({
      baseUrl: baseURL,
    });
    const client = createClient(LabelService, transport);
    for (const label of inputs.archive_labels) {
      const labelRef = create(LabelRefSchema, {
        value: {
          case: "name",
          value: {
            owner: moduleName.owner,
            module: moduleName.module,
            label: label,
          },
        },
      });
      try {
        await client.archiveLabels(
          { labelRefs: [labelRef] },
          {
            headers: {
              Authorization: `Bearer ${inputs.token}`,
            },
          },
        );
        core.info(`Archived label ${label} for ${moduleName.name}`);
      } catch (err) {
        const connectError = ConnectError.from(err);
        if (connectError.code == Code.NotFound) {
          core.info(
            `Skipping archive, label ${label} not found for ${moduleName.name}`,
          );
          continue;
        }
        core.error(
          `Failed to archive label ${label} for ${moduleName.name}: ${connectError.message}`,
        );
        return {
          status: Status.Failed,
          exitCode: 1,
          stdout: "",
          stderr: connectError.message,
        };
      }
    }
  }
  return pass();
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
  if (core.isDebug()) {
    args = ["--debug", ...args];
  }
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
function message(result: Result | undefined): string {
  switch (result?.status) {
    case Status.Passed:
      return "<code>✅ passed</code>";
    case Status.Failed:
      return `<code>❌ failed (${result.stdout.split("\n").length - 1})</code>`;
    case Status.Skipped:
      return "<code>⏩ skipped</code>";
    default:
      return "<code>🚫 cancelled</code>";
  }
}
