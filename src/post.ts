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

import { getInputs, Inputs } from "./inputs";
import { Outputs } from "./outputs";

// main is the entrypoint for the action's post step.
async function main() {
  const inputs = getInputs();
  const bufPath = core.getState(Outputs.BufPath);
  await logout(bufPath, inputs);
}

main()
  .catch((err) => core.setFailed(err.message))
  .then(() => core.debug(`done in ${process.uptime()} s`));

// logout logs out of the Buf registry, removing credentials.
async function logout(bufPath: string, inputs: Inputs) {
  const { domain } = inputs;
  core.debug(`Logging out of ${domain}`);
  await exec.exec(bufPath, ["registry", "logout", domain]);
}
