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

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as glob from "@actions/glob";

import { getEnv } from "./inputs";
import { Outputs } from "./outputs";

// State keys passed from the main step to the post step.
enum State {
  CachePrimaryKey = "cache_primary_key",
  CacheMatchedKey = "cache_matched_key",
  CacheDirPath = "cache_dir_path",
}

// Pattern for the files the cache key is derived from. The cache only changes
// when the resolved dependencies change.
const dependencyPattern = "**/buf.lock";

// restoreCache restores the Buf cache directory, keyed on the hash of all
// buf.lock files. Failures are warnings so a cache outage never fails a job.
export async function restoreCache(): Promise<void> {
  core.setOutput(Outputs.CacheHit, false);
  if (!cache.isFeatureAvailable()) {
    core.warning("Caching is not available on this runner, skipping cache");
    return;
  }
  const hash = await glob.hashFiles(dependencyPattern);
  if (hash == "") {
    core.info(`Skipping cache, no files found matching ${dependencyPattern}`);
    return;
  }
  const cacheDirPath = getCacheDirPath();
  const primaryKey = `buf-${process.platform}-${process.arch}-${hash}`;
  core.saveState(State.CacheDirPath, cacheDirPath);
  core.saveState(State.CachePrimaryKey, primaryKey);
  try {
    const matchedKey = await cache.restoreCache([cacheDirPath], primaryKey);
    if (matchedKey === undefined) {
      core.info(`Cache not found for key ${primaryKey}`);
      return;
    }
    core.saveState(State.CacheMatchedKey, matchedKey);
    core.setOutput(Outputs.CacheHit, matchedKey == primaryKey);
    core.info(`Cache restored from key ${matchedKey}`);
  } catch (error) {
    core.warning(`Failed to restore cache: ${errorMessage(error)}`);
  }
}

// saveCache saves the Buf cache directory, unless restoreCache was skipped or
// already restored an exact match.
export async function saveCache(): Promise<void> {
  const primaryKey = core.getState(State.CachePrimaryKey);
  if (primaryKey == "") {
    return;
  }
  if (core.getState(State.CacheMatchedKey) == primaryKey) {
    core.info(`Cache hit on key ${primaryKey}, not saving cache`);
    return;
  }
  const cacheDirPath = core.getState(State.CacheDirPath);
  if (!fs.existsSync(cacheDirPath)) {
    core.info(`Skipping cache save, ${cacheDirPath} does not exist`);
    return;
  }
  try {
    await cache.saveCache([cacheDirPath], primaryKey);
    core.info(`Cache saved with key ${primaryKey}`);
  } catch (error) {
    core.warning(`Failed to save cache: ${errorMessage(error)}`);
  }
}

// getCacheDirPath returns the cache directory used by the Buf CLI.
//
// This matches the CLI's resolution: $BUF_CACHE_DIR, otherwise
// %LocalAppData%\buf on Windows, otherwise $XDG_CACHE_HOME/buf, falling back
// to $HOME/.cache/buf.
function getCacheDirPath(): string {
  const bufCacheDir = getEnv("BUF_CACHE_DIR");
  if (bufCacheDir != "") {
    return bufCacheDir;
  }
  if (process.platform == "win32") {
    return path.join(getEnv("LOCALAPPDATA"), "buf");
  }
  const xdgCacheHome = getEnv("XDG_CACHE_HOME");
  if (xdgCacheHome != "") {
    return path.join(xdgCacheHome, "buf");
  }
  return path.join(os.homedir(), ".cache", "buf");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
