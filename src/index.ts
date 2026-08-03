#!/usr/bin/env node

import { runCli } from "./cli.js";
import { renderFailureDetailLine } from "./util/failure-detail.js";

try {
  await runCli();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  const failureDetail = renderFailureDetailLine(error);
  if (failureDetail) console.error(failureDetail);
  process.exitCode = 1;
}
