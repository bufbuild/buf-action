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
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

// parseModules extracts the module names from the given input. The input is a
// directory.
export function parseModules(input: string): string[] {
  const bufYamlPath = path.join(input, "buf.yaml");
  const configFile = fs.readFileSync(bufYamlPath, "utf8").trim();
  const config = yaml.parse(configFile);
  core.debug(`Parsed ${bufYamlPath}: ${JSON.stringify(config)}`);
  if (config.name) {
    return [config.name];
  }
  if (config.modules) {
    return config.modules
      .map((module: { name: string | undefined }) => module.name)
      .filter((n: string | undefined) => n);
  }
  return [];
}
