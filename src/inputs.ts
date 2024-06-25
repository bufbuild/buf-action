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

// Inputs are the inputs to the action, matching the inputs in the action.yml.
export interface Inputs {
  version: string;
  username: string;
  token: string;
  domain: string;
  github_token: string;
  setup_only: boolean;
  comment: boolean;

  input: string;
  config: string;
  paths: string[];
  exclude_paths: string[];
  exclude_imports: boolean;

  lint: boolean;
  format: boolean;
  breaking: boolean;
  breaking_against: string;
  breaking_against_config: string;
  breaking_limit_to_input_files: boolean;
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
  return {
    version: core.getInput("version"),
    username: core.getInput("username"),
    token: core.getInput("token") || getEnv("BUF_TOKEN"),
    domain: core.getInput("domain"),
    github_token: core.getInput("github_token"),
    setup_only: core.getBooleanInput("setup_only"),
    comment: core.getBooleanInput("comment"),
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
    breaking_against: core.getInput("breaking_against"),
    breaking_against_config: core.getInput("breaking_against_config"),
    breaking_limit_to_input_files: core.getBooleanInput(
      "breaking_limit_to_input_files",
    ),
    push: core.getBooleanInput("push"),
    push_create: core.getBooleanInput("push_create"),
    push_create_visibility: core.getInput("push_create_visibility"),
    push_labels: core.getMultilineInput("push_labels"),
    push_git_metadata: core.getBooleanInput("push_git_metadata"),
    push_source_control_url: core.getInput("push_source_control_url"),
    archive: core.getBooleanInput("archive"),
    archive_labels: core.getMultilineInput("archive_labels"),
  };
}

// getEnv returns the case insensitive value of the environment variable.
// Prefers the lowercase version of the variable if it exists.
export function getEnv(name: string): string {
  return (
    process.env[name.toLowerCase()] ?? process.env[name.toUpperCase()] ?? ""
  );
}
