#!/bin/sh

git config --global --add safe.directory $GITHUB_WORKSPACE
cd $GITHUB_WORKSPACE
node /index.js
