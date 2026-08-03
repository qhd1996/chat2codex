import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import YAML from "yaml";

const root = path.resolve(import.meta.dir, "..");

describe("novice acceptance documentation and Windows CI", () => {
  test("documents every environment, action, fault, evidence, and external boundary", async () => {
    const runbook = await readFile(path.join(root, "docs", "quality", "novice-acceptance-runbook.md"), "utf8");
    const troubleshooting = await readFile(path.join(root, "docs", "windows", "novice-troubleshooting.md"), "utf8");
    for (const value of ["fresh_user", "upgrade_user", "recovery_user", "setup weixin", "doctor", "text → image → file", "Plan mode", "wrong token", "expired generation", "disk full", "permission", "kill/restart", "30", "SHA-256", "zero residual", "package_smoke", "clean_windows_vm", "unproven"]) expect(runbook).toContain(value);
    for (const field of ["What happened", "Safe state", "Next action", "do not expose", "token", "prompt", "identity", "path", "purge", "explicit confirmation"]) expect(troubleshooting).toContain(field);
    for (const boundary of ["production", "real ~/.codex", "Hook", "Desktop restart", "Computer Use", "real Weixin"]) expect(runbook).toContain(boundary);
  });

  test("retains hosted native evidence as explicit personal P1 diagnostics", async () => {
    const evidence = await readFile(path.join(root, "docs", "superpowers", "verification", "personal-native-hosted-evidence.md"), "utf8");
    for (const value of ["30836801914", "journey/file_acl_owner_read", "exit_86", "DIST-HARDEN-001", "P1", "DIST-002", "DIST-003", "always uploads", "No timeout", "Rollback"]) expect(evidence).toContain(value);
  });

  test("runs the novice fast, native, 30-run, pack, extraction, and residual gates on Windows", async () => {
    const workflow = await readFile(path.join(root, ".github", "workflows", "windows-quality.yml"), "utf8");
    const matrix = await readFile(path.join(root, "scripts", "run-novice-matrix.mjs"), "utf8");
    const matrixPublisher = await readFile(path.join(root, "scripts", "publish-novice-matrix-evidence.mjs"), "utf8");
    expect(matrix).toContain("tests/novice-package-matrix.test.ts");
    expect(matrix).not.toContain("novice-native-lifecycle-probe.mjs");
    expect(matrix).not.toContain("nativeCommand");
    expect(matrix).not.toContain("nativeContract");
    expect(matrix).toContain(`path.join(os.tmpdir(), ".novice-matrix-" + process.pid)`);
    expect(matrix).not.toContain(`path.join(path.dirname(reportPath), ".novice-matrix-" + process.pid)`);
    for (const value of ["windows-latest", "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7", "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7", 'node-version: "24"', "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2", "bun-version: 1.3.9", "bun install --frozen-lockfile", "Run novice fast diagnostics", "Run novice restart diagnostics", "bun run test:novice:30", "novice-standard-user-lifecycle.ps1", "bun audit", "bun pm pack", "verify-distribution-package.mjs", "residual"]) expect(workflow).toContain(value);
    for (const value of ["Upload novice repetition evidence", "Publish novice repetition evidence", "publish-novice-matrix-evidence.mjs", ".tmp/novice-repository-30.json", "if: always()"]) expect(workflow).toContain(value);
    expect(workflow).not.toContain("Select-Object -Single");
    expect(workflow).toContain("Select-Object -First 1");
    expect(workflow).not.toMatch(/(?:npm|bun)\s+(?:install|add)\s+-g|openspec\s+(?:init|update|archive)/iu);
    const cleanJob = workflow.slice(workflow.indexOf("  clean-package-acceptance:"));
    const parsed = YAML.parse(workflow);
    expect(parsed?.on?.push?.branches).toEqual(["candidate/novice-0.8.0-novice.21"]);
    expect(parsed?.env?.C2C_EXPECTED_CANDIDATE_VERSION).toBe("0.8.0-novice.21");
    expect(parsed?.env?.C2C_EXPECTED_CANDIDATE_SHA256).toBe("a08280a11efea6856da875a90934585effcb1c021185745a6fea9f9d7a1d2980");
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    expect(packageJson.packageManager).toBe("bun@" + parsed?.jobs?.["novice-acceptance"]?.steps?.find((step: any) => step.name === "Set up Bun")?.with?.["bun-version"]);
    for (const value of ["C2C_EXPECTED_CANDIDATE_VERSION", "C2C_EXPECTED_CANDIDATE_SHA256", "candidate_version_mismatch", "candidate_archive_hash_mismatch"]) expect(workflow).toContain(value);
    expect(parsed?.on?.workflow_dispatch).toBeDefined();
    expect(parsed?.jobs?.["novice-acceptance"]?.if).toContain("[native-only]");
    expect(parsed?.jobs?.["novice-acceptance"]?.if).toContain("[matrix-only]");
    const nativeOnly = parsed?.jobs?.["native-lifecycle-diagnostic"];
    expect(nativeOnly?.if).toContain("[native-only]");
    expect(nativeOnly?.steps?.map((step: any) => step.name)).toEqual(["Check out repository","Set up Node","Set up Bun","Install frozen dependencies","Build candidate","Run native temporary lifecycle diagnostic","Upload native lifecycle diagnostic","Publish native lifecycle diagnostic"]);
    expect(JSON.stringify(nativeOnly)).not.toContain("Run thirty repetitions");
    expect(JSON.stringify(nativeOnly)).not.toContain("Pack reviewed candidate");
    const matrixOnly = parsed?.jobs?.["matrix-repetition-diagnostic"];
    expect(matrixOnly?.if).toContain("[matrix-only]");
    expect(matrixOnly?.steps?.map((step: any) => step.name)).toEqual([
      "Check out repository", "Set up Node", "Set up Bun", "Install frozen dependencies", "Build candidate",
      "Run one matrix repetition diagnostic", "Upload one matrix repetition diagnostic",
      "Publish one matrix repetition diagnostic", "Enforce one matrix repetition diagnostic",
    ]);
    expect(matrixOnly?.steps?.find((step: any) => step.name === "Run one matrix repetition diagnostic")?.["continue-on-error"]).toBe(true);
    expect(matrixOnly?.steps?.find((step: any) => step.name === "Run one matrix repetition diagnostic")?.run).toContain("--repetitions 1");
    expect(matrixOnly?.steps?.find((step: any) => step.name === "Upload one matrix repetition diagnostic")?.if).toContain("always()");
    expect(matrixOnly?.steps?.find((step: any) => step.name === "Publish one matrix repetition diagnostic")?.if).toBe("always() && steps.matrix.outcome == 'failure'");
    const matrixEnforce = matrixOnly?.steps?.find((step: any) => step.name === "Enforce one matrix repetition diagnostic");
    expect(matrixEnforce?.if).toBe("always()");
    expect(matrixEnforce?.run).toContain("matrix_diagnostic_failed");
    expect(JSON.stringify(matrixOnly)).not.toContain("Run thirty repetitions");
    expect(JSON.stringify(matrixOnly)).not.toContain("Pack reviewed candidate");
    expect(nativeOnly?.steps?.find((step: any) => step.name === "Run native temporary lifecycle diagnostic")?.run).toContain("scripts/novice-standard-user-lifecycle.ps1");
    expect(parsed?.on?.workflow_dispatch?.inputs?.gate?.options).toEqual(["full", "clean-package"]);
    expect(parsed?.env?.C2C_CLEAN_PACKAGE_ONLY).toContain("inputs.gate == 'clean-package'");
    expect(parsed?.env?.C2C_CLEAN_PACKAGE_ONLY).toContain("contains(github.event.head_commit.message, '[clean-package-only]')");
    for (const stepName of ["Run novice fast diagnostics", "Run novice restart diagnostics", "Run native temporary lifecycle gate", "Run thirty repetitions", "Audit dependencies"]) {
      expect(parsed?.jobs?.["novice-acceptance"]?.steps?.find((step: any) => step.name === stepName)?.if).toBe("env.C2C_CLEAN_PACKAGE_ONLY != 'true'");
    }
    expect(parsed?.jobs?.["novice-acceptance"]?.steps?.find((step: any) => step.name === "Upload novice repetition evidence")?.if).toBe("env.C2C_CLEAN_PACKAGE_ONLY != 'true' && always() && hashFiles('.tmp/novice-repository-30.json') != ''");
    const matrixPublish = parsed?.jobs?.["novice-acceptance"]?.steps?.find((step: any) => step.name === "Publish novice repetition evidence");
    expect(matrixPublish?.if).toBe("env.C2C_CLEAN_PACKAGE_ONLY != 'true' && always()");
    expect(matrixPublish?.run).toContain("publish-novice-matrix-evidence.mjs");
    expect(matrixPublisher).toContain("workflow_publication/report_missing");
    expect(matrixPublish?.run).toContain("exit 0");
    const nativeStep = parsed?.jobs?.["novice-acceptance"]?.steps?.find((step: any) => step.name === "Run native temporary lifecycle gate");
    expect(nativeStep?.shell).toBe("pwsh");
    expect(nativeStep?.run).toContain("NATIVE_LIFECYCLE_FAIL");
    expect(nativeStep?.run).toContain("::error::");
    expect(nativeStep?.run).toContain("native_lifecycle_diagnostic_missing");
    expect(nativeStep?.env?.C2C_NATIVE_LIFECYCLE_REPORT).toBe(".tmp/native-lifecycle-status.json");
    expect(nativeStep?.run).toContain("scripts/novice-standard-user-lifecycle.ps1");
    expect(nativeStep?.["continue-on-error"]).toBe(true);
    expect(nativeStep?.run).toContain("workflow_invocation/report_missing");
    const standardUserScript = await readFile(path.join(root, "scripts", "novice-standard-user-lifecycle.ps1"), "utf8");
    for (const value of ["New-ScheduledTaskAction", "New-ScheduledTaskPrincipal", "LogonType Interactive", "RunLevel Limited", "Register-ScheduledTask", ".Principal.RunLevel -ne 'Limited'", ".Principal.LogonType -ne 'Interactive'", "Start-ScheduledTask", "Stop-ScheduledTask", "Unregister-ScheduledTask", "novice-native-lifecycle-worker.ps1", "residualTasks", "residualUsers", "residualProcesses", "profileExists", "task_cleanup", "ownedRootExists"]) expect(standardUserScript).toContain(value);
    expect(standardUserScript).not.toContain("ProcessStartInfo");
    expect(standardUserScript).not.toContain("Start-AsUser");
    expect(standardUserScript).not.toContain("New-LocalUser");
    expect(standardUserScript).not.toContain("Remove-LocalUser");
    expect(standardUserScript).not.toContain("Password");
    expect(standardUserScript).not.toMatch(/Register-ScheduledTask[^\r\n]*-Force/iu);
    expect(standardUserScript).toContain("$taskDeadline = [DateTime]::UtcNow.AddSeconds(15)");
    expect(standardUserScript).toContain("Where-Object TaskName -EQ $taskName");
    const nativeWorker = await readFile(path.join(root, "scripts", "novice-native-lifecycle-worker.ps1"), "utf8");
    for (const value of ["[IO.Directory]::CreateDirectory($OwnedRoot)", "$env:TEMP = $OwnedRoot", "$env:TMP = $OwnedRoot", "$env:USERPROFILE = $ProfilePath", "$env:HOME = $ProfilePath", "$env:C2C_NATIVE_LIFECYCLE_REPORT = $ReportPath", "WindowsIdentity", "WindowsPrincipal", "administrator", "sidHash", "& $NodeBin $LifecycleScript", "$nodeExit = $LASTEXITCODE", "exit $nodeExit"]) expect(nativeWorker).toContain(value);
    expect(nativeWorker).not.toMatch(/Password|UserName/iu);
    for (const value of ["worker/node_check", "worker/script_check", "worker/node_invoke", "worker/report_missing", "NODE_MISSING", "SCRIPT_MISSING", "Write-FailureReport"]) expect(nativeWorker).toContain(value);
    expect(nativeWorker).not.toContain("$_.Exception.Message");
    expect(standardUserScript).toContain("Join-Path ([IO.Path]::GetTempPath()) ('C2C-Native-'");
    expect(standardUserScript).toContain("GetAccessControl($ownedRoot");
    expect(standardUserScript).toContain("$owner.Value -ne $currentSid");
    expect(standardUserScript).not.toContain("Join-Path 'C:\\Windows\\Temp'");
    expect(standardUserScript).not.toContain("ProfilesDirectory");
    expect(standardUserScript).not.toContain("Join-Path 'C:\\Users'");
    expect(standardUserScript).toContain("code=('exit_' + $childExit)");
    for (const value of ["scheduled_task/action", "scheduled_task/settings", "scheduled_task/register", "scheduled_task/verify_logon", "scheduled_task/verify_runlevel", "scheduled_task/start", "scheduled_task/exit", "scheduled_task/report_missing", "identity_report"]) expect(standardUserScript).toContain(value);
    expect(standardUserScript).toContain("$limitedIdentity.administrator -ne $false");
    expect(standardUserScript).toContain("$limitedIdentity.sidHash -ne $currentSidHash");
    expect(standardUserScript).toContain("profileMode='disposable_env'");
    const childRead = standardUserScript.indexOf("$value = Get-Content -LiteralPath $childReport -Raw | ConvertFrom-Json");
    const taskExit = standardUserScript.indexOf("if ($childExit -ne 0)");
    expect(childRead).toBeGreaterThan(-1);
    expect(childRead).toBeLessThan(taskExit);
    expect(standardUserScript).toContain("if ($value -and $value.verdict -ne 'pass' -and $value.failure) { $failure = $value.failure }");
    expect(standardUserScript).toContain("if ($report.verdict -ne 'pass')");
    expect(standardUserScript).not.toContain("if ($failure) { Write-Host ('NATIVE_LIFECYCLE_FAIL '");
    expect(standardUserScript).not.toContain("-Timeout");
    const nativeUpload = parsed?.jobs?.["novice-acceptance"]?.steps?.find((step: any) => step.name === "Upload native lifecycle evidence");
    expect(nativeUpload?.if).toBe("env.C2C_CLEAN_PACKAGE_ONLY != 'true' && always() && hashFiles('.tmp/native-lifecycle-status.json') != ''");
    expect(nativeUpload?.with?.path).toBe(".tmp/native-lifecycle-status.json");
    const nativePublish = parsed?.jobs?.["novice-acceptance"]?.steps?.find((step: any) => step.name === "Publish native lifecycle evidence");
    expect(nativePublish?.if).toBe("env.C2C_CLEAN_PACKAGE_ONLY != 'true' && always()");
    expect(nativePublish?.run).toContain("publish-native-lifecycle-evidence.mjs");
    expect(nativePublish?.run).toContain("workflow_publication/process_failure");
    expect(nativePublish?.run).toContain("exit 0");
    expect(nativePublish?.run).not.toContain("$output | Write-Host");
    expect(parsed?.jobs?.["novice-acceptance"]?.steps?.some((step: any) => /Enforce native lifecycle/u.test(step.name))).toBeFalse();
    const nativeOnlyPublish = nativeOnly?.steps?.find((step: any) => step.name === "Publish native lifecycle diagnostic");
    expect(nativeOnlyPublish?.if).toBe("always()");
    expect(nativeOnlyPublish?.run).toContain("publish-native-lifecycle-evidence.mjs");
    expect(nativeOnlyPublish?.run).toContain("workflow_publication/process_failure");
    expect(nativeOnlyPublish?.run).toContain('\"code\":\"unavailable\"');
    expect(nativeOnlyPublish?.run).toContain("exit 0");
    expect(nativeOnlyPublish?.run).not.toContain("$output | Write-Host");
    expect(nativeOnly?.steps?.some((step: any) => /Enforce native lifecycle/u.test(step.name))).toBeFalse();
    expect(workflow).toContain("[clean-package-only]");
    expect(workflow).toContain("if ($env:C2C_CLEAN_PACKAGE_ONLY -ne 'true')");
    expect(parsed?.on?.pull_request).toBeDefined();
    const parsedSteps = parsed?.jobs?.["clean-package-acceptance"]?.steps;
    expect(Array.isArray(parsedSteps)).toBe(true);
    const cleanupStep = parsedSteps.find((step: any) => step.name === "Finalize exact owned cleanup and zero-residual proof");
    expect(cleanupStep?.if).toBe("always()");
    for (const value of [
      "Get-LocalUser -ErrorAction Stop | Where-Object Name -EQ $userName",
      "Remove-LocalUser -Name $userName -ErrorAction Stop",
      "Get-CimInstance Win32_Process -ErrorAction Stop",
      "Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop",
      "Remove-Item -LiteralPath $ownedRoot -Recurse -Force -ErrorAction Stop",
      "@('/Query', '/FO', 'CSV', '/NH')",
      "$taskListExitCode -ne 0",
      "clean_package_task_query_uncertain",
      "InspectionComplete",
      "CleanupErrorCodes",
    ]) expect(cleanupStep?.run).toContain(value);
    expect(cleanupStep?.run).not.toContain("$absentTaskExitCodes");
    expect(cleanupStep?.run).not.toContain("SilentlyContinue");
    expect(parsedSteps.find((step: any) => step.name === "Upload redacted clean-package evidence")?.if).toBe("always()");
    const cleanPublish = parsedSteps.find((step: any) => step.name === "Publish bounded clean-package evidence");
    expect(cleanPublish?.if).toBe("always()");
    for (const value of ["clean_package_evidence", "failureCode", "failureStage", "failureDetailCode", "InspectionComplete", "MatchingProcesses", "ResidualTestUsers", "ResidualTask", "GITHUB_STEP_SUMMARY", "::error title=Clean package evidence::", "exit 0"]) expect(cleanPublish?.run).toContain(value);
    expect(cleanPublish?.run).not.toContain("Get-Content $report");
    const cleanRun = parsedSteps.find((step: any) => step.name === "Run package-only clean Windows novice acceptance")?.run;
    for (const value of ["$acceptanceOutput", "$acceptanceExit", "NOVICE_CLEAN_WINDOWS_FAILURE", "$failureStage", "$failureDetailCode", "attestation_task_readiness", "attestation_another_user_acl", "attestation_owned_root_cleanup", "novice_acceptance_failed"]) expect(cleanRun).toContain(value);
    for (const value of ["needs: novice-acceptance", "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4", "@openai/codex@0.146.0", "C2C_RUNNER_ENVIRONMENT", "--environment-kind equivalent_isolated_windows", "--fresh-profile", "--repository-absent", "--prior-package-absent", "--repository-commit", "--run-identity", "--codex-bin", "--report", "--cleanup", "verify-novice-evidence.mjs", "OwnedRootExists", "MatchingProcesses"]) expect(cleanJob).toContain(value);
    expect(cleanJob).toContain("Join-Path $npmRoot 'node_modules/@openai'");
    expect(cleanJob).toContain("Where-Object Name -EQ 'codex.exe'");
    for (const value of ["$environmentRoot", "--environment-root $environmentRoot", "--sha256 $metadata.sha256", "--repository-commit $metadata.repositoryCommit", "--run-identity $runIdentity", "CHAT2CODEX_NOVICE_ENVIRONMENT_ROOT", "CHAT2CODEX_NOVICE_RUN_IDENTITY"]) expect(cleanJob).toContain(value);
    const acceptance = await readFile(path.join(root, "scripts", "run-novice-acceptance.mjs"), "utf8");
    const attestation = await readFile(path.join(root, "scripts", "novice-clean-windows-attestation.mjs"), "utf8");
    const packageMatrix = await readFile(path.join(root, "src", "quality", "novice-package-matrix.ts"), "utf8");
    const anotherUserAcl = await readFile(path.join(root, "scripts", "novice-another-user-acl.ps1"), "utf8");
    expect(acceptance).toContain("--protected-real-codex-home");
    expect(acceptance).toContain("USERPROFILE: plan.environment.userProfile");
    expect(acceptance).toContain("directory === plan.environment.codexHome");
    expect(acceptance).toContain("plan.qualifyingEnvironment");
    expect(attestation).toContain("snapshotTree(protectedRealCodexHome)");
    expect(attestation).toContain("Projected fresh Codex Home");
    expect(attestation).toContain("projectedGlobalNpmRoot");
    expect(attestation).toContain("protectedGlobalNpmRootBefore");
    expect(attestation).toContain("Scheduled Task readiness deadline exceeded: ");
    expect(attestation).toContain("queryTaskDiagnostic(taskPath)");
    expect(attestation).toContain("readRedactedLogTail(logFile)");
    expect(attestation).toContain("cleanWindowsFailureLine");
    for (const stage of ["install_1", "another_user_acl", "install_2", "start_1", "doctor", "stop_1", "start_2", "stop_2", "uninstall_1", "uninstall_2", "install_3", "key_rotation", "uninstall_3", "protected_checks", "owned_root_cleanup", "attestation_build"]) expect(attestation).toContain(`stage = "${stage}"`);
    expect(acceptance).toContain("parseCleanWindowsFailureOutput");
    expect(acceptance).toContain("cleanWindowsFailureLine");
    expect(attestation).toContain(`const logFile = path.join(home, ".data", "logs", "probe.log")`);
    expect(attestation).toContain(`"--stderr", logFile`);
    expect(attestation).toContain("startTask(taskPath, readyPath, stopPath, statePath, logFile, commands)");
    expect(attestation).toContain("async function startTask(taskPath, readyPath, stopPath, statePath, logFile, commands)");
    expect(attestation).toContain(`"; writers=" + writers`);
    expect(attestation).toContain(`ToString('yyyy-MM-ddTHH:mm:ss.fffZ')`);
    expect(attestation).not.toContain(`CreationDate.ToUniversalTime().ToString('o')`);
    expect(packageMatrix).toContain(`ToString('yyyy-MM-ddTHH:mm:ss.fffZ')`);
    expect(packageMatrix).not.toContain(`CreationDate.ToUniversalTime().ToString('o')`);
    expect(attestation).toContain("waitJson(readyPath, 15_000)");
    expect(attestation).toContain(`Another-interactive-user ACL denial probe failed: " + redactFailure(result.stderr)`);
    expect(anotherUserAcl).not.toContain("IsPathFullyQualified");
    expect(anotherUserAcl).not.toContain("ConvertTo-SecureString");
    expect(anotherUserAcl).toContain("$secure.AppendChar($character)");
    expect(anotherUserAcl).toContain("$secure.MakeReadOnly()");
    expect(anotherUserAcl).toContain("Diagnostics.ProcessStartInfo");
    expect(anotherUserAcl).toContain("$startInfo.UserName = $userName");
    expect(anotherUserAcl).toContain("$startInfo.Password = $secure");
    expect(anotherUserAcl).toContain("$startInfo.UseShellExecute = $false");
    expect(anotherUserAcl).toContain("$startInfo.RedirectStandardOutput = $captureOutput");
    expect(anotherUserAcl).toContain("$identity = Invoke-AsTestUser $whoamiPath '/user /fo csv /nh' $true");
    expect(anotherUserAcl).toContain("$createdUser.SID.Value");
    expect(anotherUserAcl).toContain("Another-user denial probe identity is invalid: exit");
    expect(anotherUserAcl).toContain("&|<>^%!");
    expect(anotherUserAcl).toContain(`$read = Invoke-AsTestUser $cmdPath ('/d /q /c type "' + $keyPath + '" >nul 2>&1') $false`);
    expect(anotherUserAcl).toContain(`$delete = Invoke-AsTestUser $cmdPath ('/d /q /c del /f /q "' + $keyPath + '" >nul 2>&1') $false`);
    expect(anotherUserAcl).toContain(`$replace = Invoke-AsTestUser $cmdPath ('/d /q /c echo tampered>"' + $keyPath + '" 2>nul') $false`);
    expect(anotherUserAcl).toContain("Another interactive user deleted an owner-only key.");
    expect(anotherUserAcl).toContain("Another interactive user replaced an owner-only key.");
    expect(anotherUserAcl).toContain("Owner-only key bytes changed during another-user probes.");
    expect(anotherUserAcl).not.toContain("^>nul");
    expect(anotherUserAcl).not.toContain("-EncodedCommand");
    expect(anotherUserAcl).not.toContain("Start-Process");
    expect(anotherUserAcl).toContain("$keyPath -notmatch '^[A-Za-z]:");
    expect(acceptance).toContain("spawnSync(node, [npmCli, \"root\", \"-g\"]");
    for (const value of ["47c2272faf764904a5c8cba903b05b679b20a0cb", "0.8.0-orchestrator.4", "novice-supported-old-package", "--old-archive $oldArchive.FullName", "--old-sha256 $oldMetadata.sha256", "--old-version $oldMetadata.version"]) expect(workflow).toContain(value);
    for (const value of ["old package frozen install failed", "old package build failed", "old package pack failed", "--old-commit $oldMetadata.repositoryCommit"]) expect(workflow).toContain(value);
    expect(cleanJob).not.toContain("novice-attestation-owned");
    expect(cleanJob).toContain("$needle = 'novice-owned-environment'");
    expect(cleanJob).not.toContain("actions/checkout");
    expect(cleanJob).not.toMatch(/Add-Member.*(?:environmentKind|freshProfile|repositoryAbsent|priorPackageAbsent)/iu);
    for (const value of ["clean-run-status.json", "zero-residual-proof.json", "ResidualTestUsers", "ResidualTask", "Remove-LocalUser", "Start-Process -FilePath schtasks.exe", "-WindowStyle Hidden", "finally", "Finalize exact owned cleanup", "$userName", "$taskPath = '\\Chat2Codex\\' + $taskName"]) expect(cleanJob).toContain(value);
    expect(cleanJob).toMatch(/if:\s*always\(\)[\s\S]*clean-run-status\.json/u);
    expect(cleanJob).not.toContain("Where-Object Name -Like 'C2CN*'");
    const repositorySteps = parsed?.jobs?.["novice-acceptance"]?.steps ?? [];
    const buildIndex = repositorySteps.findIndex((step: any) => step.name === "Build candidate before package-bound novice tests");
    const fastIndex = repositorySteps.findIndex((step: any) => step.name === "Run novice fast diagnostics");
    expect(buildIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeLessThan(fastIndex);
    expect(repositorySteps[buildIndex]?.run).toBe("bun run build");
    const nativeLifecycleRun = repositorySteps.find((step: any) => step.name === "Run native temporary lifecycle gate")?.run;
    expect(nativeLifecycleRun).toContain("scripts/novice-standard-user-lifecycle.ps1");
    expect(nativeLifecycleRun).toContain("NATIVE_LIFECYCLE_FAIL");
    expect(nativeLifecycleRun).toContain("workflow_invocation/report_missing");
    expect(nativeLifecycleRun).not.toContain("exit $exitCode");
    const publisher = await readFile(path.join(root, "scripts", "publish-native-lifecycle-evidence.mjs"), "utf8");
    const evidenceSource = await readFile(path.join(root, "src", "quality", "native-lifecycle-workflow-evidence.ts"), "utf8");
    for (const value of ["workflow_publication/summary_write", "GITHUB_STEP_SUMMARY", "process.exitCode = 0"]) expect(publisher).toContain(value);
    for (const value of ["workflow_publication/report_missing", "workflow_publication/report_invalid", "workflow_enforcement/report_missing", "workflow_enforcement/report_invalid"]) expect(evidenceSource).toContain(value);
    expect(workflow).not.toContain("enforce-native-lifecycle-evidence.mjs");
    for (const requiredBlocking of ["Run novice fast diagnostics", "Run novice restart diagnostics", "Run thirty repetitions", "Audit dependencies", "Pack reviewed candidate", "Verify extracted package and residual evidence", "clean-package-acceptance"]) expect(workflow).toContain(requiredBlocking);
    expect(workflow).not.toMatch(/timeout-minutes:s*(?:[6-9][0-9]|[1-9][0-9]{2,})/u);
  });
});
