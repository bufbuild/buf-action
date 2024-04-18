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
import { Context } from "@actions/github/lib/context";
import { GitHub } from "@actions/github/lib/utils";

const commentTag = "<!-- Buf results -->";

export async function commentOnPR(
  context: Context,
  github: InstanceType<typeof GitHub>,
  comment: string,
): Promise<boolean> {
  try {
    const { owner, repo } = context.repo;
    const prNumber = context.payload.pull_request?.number;
    if (!prNumber) {
      core.info("This is not a PR, skipping commenting");
      return false;
    }
    const content = {
      owner: owner,
      repo: repo,
      body: comment + commentTag,
    };
    // Check if a comment already exists and update it.
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner: owner,
      repo: repo,
      issue_number: prNumber,
    });
    const previousComment = comments.find((comment) =>
      comment.body.includes(commentTag),
    );
    if (previousComment) {
      await github.rest.issues.updateComment({
        ...content,
        comment_id: previousComment.id,
      });
      core.info(`Updated comment ${previousComment.id} on PR #${prNumber}`);
    } else {
      await github.rest.issues.createComment({
        ...content,
        issue_number: prNumber,
      });
      core.info(`Commented on PR #${prNumber}`);
    }
    return true;
  } catch (error) {
    core.info(`Error occurred while commenting on PR: ${error}`);
    return false;
  }
}
