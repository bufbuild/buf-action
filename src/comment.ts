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

// commentTag is the tag used to identify the comment. This is a non-visible
// string injected into the comment body.
const commentTag = "<!-- Buf results -->";

// findCommentOnPR finds the comment on the PR that contains the Buf results.
// If the comment is found, it returns the comment ID. If the comment is not
// found, it returns undefined. On failure, it returns undefined but does not
// throw an error.
export async function findCommentOnPR(
  context: Context,
  github: InstanceType<typeof GitHub>,
): Promise<number | undefined> {
  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request?.number;
  if (!prNumber) {
    core.info("This is not a PR, skipping finding comment");
    return undefined;
  }
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner: owner,
    repo: repo,
    issue_number: prNumber,
  });
  const previousComment = comments.find((comment) =>
    comment.body?.includes(commentTag),
  );
  if (previousComment) {
    core.info(`Found previous comment ${previousComment.id}`);
    return previousComment.id;
  }
  return undefined;
}

// commentOnPR comments on the PR with the summary of the Buf results. The
// summary should be a markdown formatted string. This function returns true if
// the comment was successfully created or updated. On failure, it returns
// false but does not throw an error.
export async function commentOnPR(
  context: Context,
  github: InstanceType<typeof GitHub>,
  commentID: number | undefined,
  body: string,
): Promise<number | undefined> {
  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request?.number;
  if (!prNumber) {
    core.info("This is not a PR, skipping commenting");
    return undefined;
  }
  const content = {
    owner: owner,
    repo: repo,
    body: body + commentTag,
  };
  if (commentID) {
    await github.rest.issues.updateComment({
      ...content,
      comment_id: commentID,
    });
    core.info(`Updated comment ${commentID} on PR #${prNumber}`);
    return commentID;
  }
  const comment = await github.rest.issues.createComment({
    ...content,
    issue_number: prNumber,
  });
  core.info(`Commented ${comment.data.id} on PR #${prNumber}`);
  return comment.data.id;
}
