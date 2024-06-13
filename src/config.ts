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

export interface ModuleName {
  registry: string;
  owner: string;
  module: string;
}

// parseModuleNames extracts the module names from the given input. The input
// is a directory containing a buf.yaml file.
export function parseModuleNames(input: string): ModuleName[] {
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
      .filter((n: string | undefined) => n)
      .map((n: string) => parseModuleName(n));
  }
  return [];
}

// resolveHost returns the host of the module names. If multiple hosts are
// detected, an error is thrown.
export function resolveHostFromModuleNames(moduleNames: ModuleName[]): string {
  const hosts = new Set<string>();
  for (const moduleName of moduleNames) {
    hosts.add(moduleName.registry);
  }
  if (hosts.size != 1) {
    throw new Error(`Multiple hosts detected: ${Array.from(hosts)}`);
  }
  return hosts.values().next().value;
}

// parseModuleName parses the module name into its registry, owner, and
// repository parts.
export function parseModuleName(moduleName: string): ModuleName {
  const parts = moduleName.split("/");
  if (parts.length != 3) {
    throw new Error(`Invalid module name: ${moduleName}`);
  }
  return {
    registry: parts[0],
    owner: parts[1],
    module: parts[2],
  };
}
