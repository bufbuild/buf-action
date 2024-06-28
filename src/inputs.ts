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
import * as github from "@actions/github";
import { PushEvent, PullRequestEvent } from "@octokit/webhooks-definitions/schema"

// Inputs are the inputs to the action, matching the inputs in the action.yml.
export interface Inputs {
  version: string;
  username: string;
  token: string;
  domain: string;
  setup_only: boolean;
  pr_comment: boolean;

  input: string;
  config: string;
  paths: string[];
  exclude_paths: string[];
  exclude_imports: boolean;

  lint: boolean;
  format: boolean;
  breaking: boolean;
  breaking_against: string;
  push: boolean;
  push_create: boolean;
  push_create_visibility: string;
  push_labels: string[];
  push_git_metadata: boolean;
  push_source_control_url: string;
  archive: boolean;
  archive_labels: string[];
}

// getInputs decodes the inputs from the environment variables.
export function getInputs(): Inputs {
  console.log("CONTEXT", github.context);
  let input = {
    version: core.getInput("version"),
    username: core.getInput("username"),
    token: core.getInput("token") || getEnv("BUF_TOKEN"),
    domain: core.getInput("domain"),
    setup_only: core.getBooleanInput("setup_only"),
    pr_comment: core.getBooleanInput("pr_comment"),
    // Inputs shared between buf steps.
    input: core.getInput("input"),
    config: core.getInput("config"),
    paths: core.getMultilineInput("paths"),
    exclude_paths: core.getMultilineInput("exclude_paths"),
    exclude_imports: core.getBooleanInput("exclude_imports"),
    // Inputs specific to buf steps.
    lint: core.getBooleanInput("lint"),
    format: core.getBooleanInput("format"),
    breaking: core.getBooleanInput("breaking"),
    breaking_against: "",
    push: core.getBooleanInput("push"),
    push_create: core.getBooleanInput("push_create"),
    push_create_visibility: core.getInput("push_create_visibility"),
    push_labels: core.getMultilineInput("push_labels"),
    push_git_metadata: core.getBooleanInput("push_git_metadata"),
    push_source_control_url: core.getInput("push_source_control_url"),
    archive: core.getBooleanInput("archive"),
    archive_labels: core.getMultilineInput("archive_labels"),
  };
  if (github.context.eventName === 'push') {
    const event = github.context.payload as PushEvent
    core.info(`The head commit is: ${event.before}`)
    input.breaking_against = `${event.repository.clone_url}#format=git,commit=${event.before}`
    console.log("BREAKING AGAINST", input.breaking_against)
  }
  if (github.context.eventName === 'pull_request') {
    const event = github.context.payload as PullRequestEvent
    core.info(`The head commit is: ${event.pull_request.head.sha}`)
    input.breaking_against = `${event.repository.clone_url}#format=git,commit=${event.pull_request.base.sha}`
    console.log("BREAKING AGAINST", input.breaking_against)
  }

}

// getEnv returns the case insensitive value of the environment variable.
// Prefers the lowercase version of the variable if it exists.
export function getEnv(name: string): string {
  return (
    process.env[name.toLowerCase()] ?? process.env[name.toUpperCase()] ?? ""
  );
}
