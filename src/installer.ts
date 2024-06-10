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
import * as tc from "@actions/tool-cache";
import { GitHub } from "@actions/github/lib/utils";
import * as semver from "semver";
import { getEnv } from "./inputs";

// requiredVersion is the minimum version of buf required.
const requiredVersion = ">=1.32.0";

// installBuf installs the buf binary and returns the path to the binary. The
// versionInput should be an explicit version of buf.
export async function installBuf(
  github: InstanceType<typeof GitHub>,
  versionInput: string,
): Promise<string> {
  let resolvedVersion = resolveVersion(versionInput);
  if (resolvedVersion != "" && !tc.isExplicitVersion(resolvedVersion)) {
    throw new Error(
      `The version provided must be an explicit version: ${resolvedVersion}`,
    );
  }
  // Check if the binary is already available.
  const bufName = "buf";
  const binName = process.platform === "win32" ? "buf.exe" : "buf";
  const whichBuf = await exec.exec("which", [binName], {
    ignoreReturnCode: true,
    silent: true,
  });
  if (whichBuf === 0) {
    const bufVersion = await exec.getExecOutput(binName, ["--version"], {
      silent: true,
    });
    const version = bufVersion.stdout.trim();
    core.info(`Using buf (${version}) found in $PATH`);
    if (!semver.satisfies(version, requiredVersion)) {
      throw new Error(
        `The version of buf (${version}) does not satisfy the required version (${requiredVersion})`,
      );
    }
    if (resolvedVersion != "" && !semver.eq(version, resolvedVersion)) {
      throw new Error(
        `The version of buf (${version}) does not equal the resolved version (${resolvedVersion})`,
      );
    }
    return binName;
  }
  if (resolvedVersion === "") {
    resolvedVersion = await latestVersion(github);
  }
  if (!semver.satisfies(resolvedVersion, requiredVersion)) {
    throw new Error(
      `The resolved version of buf (${resolvedVersion}) does not satisfy the required version (${requiredVersion})`,
    );
  }
  // Fetch the version of buf to use.
  let cachePath = tc.find(bufName, resolvedVersion);
  if (!cachePath) {
    core.info(`Downloading buf (${resolvedVersion})`);
    const downloadPath = await downloadBuf(resolvedVersion);
    await exec.exec("chmod", ["+x", downloadPath]);
    cachePath = await tc.cacheFile(
      downloadPath,
      binName,
      bufName,
      resolvedVersion,
    );
  }
  core.addPath(cachePath);
  core.info(`Setup buf (${resolvedVersion}) at ${cachePath}`);
  return binName;
}

// resolveVersion from the input or environment.
function resolveVersion(versionSpec: string): string {
  if (versionSpec) {
    core.info(`Using the version of buf from the input: ${versionSpec}`);
    return versionSpec;
  } else if (getEnv("BUF_VERSION")) {
    const resolvedVersion = getEnv("BUF_VERSION");
    core.info(`Using the version of buf from $BUF_VERSION: ${resolvedVersion}`);
    return resolvedVersion;
  }
  return "";
}

// latestVersion returns the latest version of buf from GitHub releases.
async function latestVersion(
  github: InstanceType<typeof GitHub>,
): Promise<string> {
  const release = await github.rest.repos.getLatestRelease({
    owner: "bufbuild",
    repo: "buf",
  });
  const resolvedVersion = release.data.tag_name.replace(/^v/, "");
  core.info(`Using the latest release of buf: ${resolvedVersion}`);
  return resolvedVersion;
}

// platformTable is a mapping of platform to architecture to executable URL.
// The platform and architecture are based on the Node.js process properties.
// The available platforms can be found at:
// - https://nodejs.org/api/process.html#process_process_platform
// - https://nodejs.org/api/process.html#process_process_arch
type platformTable = {
  [platform in NodeJS.Platform]?: {
    [arch in NodeJS.Architecture]?: string;
  };
};

// downloadBuf downloads the buf binary and returns the path to the binary.
async function downloadBuf(version: string): Promise<string> {
  const table: platformTable = {
    darwin: {
      x64: "buf-Darwin-x86_64",
      arm64: "buf-Darwin-arm64",
    },
    linux: {
      x64: "buf-Linux-x86_64",
      arm64: "buf-Linux-aarch64",
    },
    win32: {
      x64: "buf-Windows-x86_64.exe",
      arm64: "buf-Windows-arm64.exe",
    },
  };
  const platform = table[process.platform];
  if (!platform) {
    throw new Error(
      `The "${process.platform}" platform is not supported with a Buf release.`,
    );
  }
  const executable = platform[process.arch];
  if (!executable) {
    throw new Error(
      `The "${process.arch}" architecture is not supported with a Buf release.`,
    );
  }
  const downloadURL = `https://github.com/bufbuild/buf/releases/download/v${version}/${executable}`;
  try {
    return await tc.downloadTool(downloadURL);
  } catch (error) {
    throw new Error(
      `Failed to download buf version ${version} from "${downloadURL}": ${error}`,
    );
  }
}
