import AdmZip from "adm-zip";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoZipPath = path.resolve(process.argv[2] ?? "D:/Sovereign_Code.zip");
const port = Number(process.env.PIPELINEFORGE_TEST_PORT ?? 19095);
const apiBase = `http://127.0.0.1:${port}`;
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const deploymentInputs = {
  port: "backend:8080, frontend:80",
  imageRegistry: "123456789012.dkr.ecr.ap-south-1.amazonaws.com/sovereign-code",
  imageTag: "regression-sha",
  buildCommand: "",
  startCommand: "",
  testCommand: "npm test",
  domain: "sovereign.example.com",
  databaseUrl: "arn:aws:secretsmanager:ap-south-1:123456789012:secret:sovereign/database-url",
  tokenSecret: "arn:aws:secretsmanager:ap-south-1:123456789012:secret:sovereign/token-secret",
  corsOrigin: "arn:aws:secretsmanager:ap-south-1:123456789012:secret:sovereign/cors-origin",
  awsRegion: "ap-south-1",
  aksClusterName: "pf-aks-regression",
  aksNamespace: "sovereign",
  azureResourceGroup: "rg-pipelineforge-regression",
  aksIngressClass: "nginx",
  eksClusterName: "pf-eks-regression",
  eksNamespace: "sovereign",
  eksIngressClass: "alb",
  ecsClusterArn: "arn:aws:ecs:ap-south-1:123456789012:cluster/sovereign-code",
  ecsTaskExecutionRoleArn: "arn:aws:iam::123456789012:role/sovereign-task-execution",
  ecsTaskRoleArn: "arn:aws:iam::123456789012:role/sovereign-task",
  ecsTaskDefinition: "sovereign-code:42",
  ecsSubnetIds: "subnet-11111111111111111,subnet-22222222222222222",
  ecsSecurityGroupId: "sg-0123456789abcdef0",
  ecsTargetGroupArn: "arn:aws:elasticloadbalancing:ap-south-1:123456789012:targetgroup/sovereign-frontend/abc123"
};

const expectedGeneratedFiles = [
  "app/backend/Dockerfile",
  "app/frontend/Dockerfile",
  "app/backend/.dockerignore",
  "app/frontend/.dockerignore",
  "docker-compose.yml",
  "k8s/secret.yaml",
  "k8s/deployment.yaml",
  "k8s/service.yaml",
  "k8s/ingress.yaml",
  "Jenkinsfile",
  "azure-pipelines.yml",
  "aks/deployment-notes.md",
  "eks/ingress-patch.yaml",
  "eks/deployment-notes.md",
  "ecs/task-definition.json",
  "ecs/service.json",
  "ecs/deployment-notes.md"
];

const expectedBundleEntries = [
  "README.md",
  "docs/deployment-guide.md",
  "docs/required-values.md",
  "reports/sandbox-validation.json",
  "reports/pipelineforge-manifest.json",
  "reports/deployment-inputs.redacted.json",
  "generated/container/docker-compose.yml",
  "generated/cicd/Jenkinsfile",
  "generated/cicd/azure-pipelines.yml",
  "generated/kubernetes/deployment.yaml",
  "generated/cloud-targets/eks/deployment-notes.md",
  "generated/cloud-targets/ecs/task-definition.json"
];

const results = [];
let serverProcess;
let dataDir;

try {
  assert(existsSync(repoZipPath), `Sovereign Code ZIP not found at ${repoZipPath}`);
  dataDir = await mkdtemp(path.join(os.tmpdir(), "pipelineforge-regression-"));
  serverProcess = await startServer(dataDir);

  const health = await requestJson("/api/health");
  check("API health", health.status === "ok", "PipelineForge API responded.");

  const analysis = await uploadZip(repoZipPath);
  validateAnalysis(analysis);

  const generatedPaths = analysis.generatedFiles.map((file) => file.path);
  const generatedPathList = generatedPaths.join(", ");
  for (const filePath of expectedGeneratedFiles) {
    check(`Generated file: ${filePath}`, generatedPaths.includes(filePath), generatedPaths.includes(filePath) ? `${filePath} is available.` : `Missing ${filePath}. Available: ${generatedPathList}`);
  }

  const ecsFiles = filterFilesForDeploymentTarget(analysis.generatedFiles, "ecs");
  const eksFiles = filterFilesForDeploymentTarget(analysis.generatedFiles, "eks");
  const aksFiles = filterFilesForDeploymentTarget(analysis.generatedFiles, "aks");
  check("ECS target filter", ecsFiles.some((file) => file.path.startsWith("ecs/")) && !ecsFiles.some((file) => file.path.startsWith("k8s/")), "ECS target isolates ECS files plus base assets.");
  check("EKS target filter", eksFiles.some((file) => file.path.startsWith("eks/")) && eksFiles.some((file) => file.path.startsWith("k8s/")), "EKS target includes Kubernetes and EKS overlay files.");
  check("AKS target filter", aksFiles.some((file) => file.path.startsWith("aks/")) && aksFiles.some((file) => file.path.startsWith("k8s/")), "AKS target includes Kubernetes and AKS handoff files.");

  const sandbox = await postJson("/api/sandbox/validate", {
    repoName: analysis.repoName,
    files: ecsFiles,
    deploymentInputs
  });
  check("ECS sandbox status", sandbox.status === "ready", `Sandbox status is ${sandbox.status}.`);
  check("ECS sandbox has no failed checks", sandbox.summary.failed === 0, `${sandbox.summary.failed} failed checks.`);

  const runtime = await postJson("/api/sandbox/runtime", {
    repoName: analysis.repoName,
    files: ecsFiles,
    deploymentInputs
  });
  check("ECS runtime status", runtime.status === "ready", `Runtime status is ${runtime.status}.`);
  check("ECS runtime placeholders resolved", hasPassedCheck(runtime, "Runtime placeholders"), "No unresolved runtime placeholders remain.");
  check("ECS runtime structure", hasPassedCheck(runtime, "ECS runtime structure"), "ECS task and service JSON are structurally valid.");

  const security = await postJson("/api/security/gates", {
    repoName: analysis.repoName,
    files: ecsFiles
  });
  check("Security gates are non-blocking", security.status === "ready", `Security status is ${security.status}.`);
  check("Security gates have no failed checks", security.summary.failed === 0, `${security.summary.failed} failed checks.`);

  const autoFix = await postJson("/api/autofix/preview", { files: eksFiles });
  check("Auto-fix preview returns files", Array.isArray(autoFix.files) && autoFix.files.length === eksFiles.length, "Auto-fix preview preserved generated file set.");

  const bundleBuffer = await postZip("/api/release-bundle", {
    analysis,
    files: analysis.generatedFiles,
    deploymentInputs
  });
  validateReleaseBundle(bundleBuffer);

  printSummary();
} catch (error) {
  printSummary();
  console.error(`\nRegression failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (serverProcess) await stopServer(serverProcess);
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
}

async function startServer(tempDataDir) {
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      PIPELINEFORGE_DATA_DIR: tempDataDir,
      PIPELINEFORGE_PERSIST_ANALYSIS: "false"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  child.once("exit", (code) => {
    if (code !== null && code !== 0) output += `\nServer exited with code ${code}.`;
  });

  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`PipelineForge API exited before health check passed.\n${output.trim()}`);
    }
    try {
      const health = await requestJson("/api/health");
      if (health.status === "ok") return child;
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Timed out waiting for PipelineForge API on ${apiBase}.\n${output.trim()}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

async function uploadZip(filePath) {
  const body = new FormData();
  const zipBuffer = await readFile(filePath);
  body.append("repo", new Blob([zipBuffer], { type: "application/zip" }), path.basename(filePath));

  const response = await fetch(`${apiBase}/api/analyze/upload`, {
    method: "POST",
    body
  });

  return parseResponse(response, "JSON");
}

async function requestJson(route) {
  const response = await fetch(`${apiBase}${route}`);
  return parseResponse(response, "JSON");
}

async function postJson(route, payload) {
  const response = await fetch(`${apiBase}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseResponse(response, "JSON");
}

async function postZip(route, payload) {
  const response = await fetch(`${apiBase}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseResponse(response, "ZIP");
}

async function parseResponse(response, expected) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }
  if (expected === "ZIP") return Buffer.from(await response.arrayBuffer());
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON but received ${contentType || "unknown content type"}.`);
  }
  return response.json();
}

function validateAnalysis(analysis) {
  check("Repository name", analysis.repoName === "Sovereign_Code", `Detected repo ${analysis.repoName}.`);
  check("Multi-service detection", Array.isArray(analysis.stack.services) && analysis.stack.services.length >= 2, `${analysis.stack.services?.length ?? 0} services detected.`);

  const services = new Map((analysis.stack.services ?? []).map((service) => [service.kind, service]));
  check("Backend service port", services.get("backend")?.port === "8080", `Backend port is ${services.get("backend")?.port ?? "missing"}.`);
  check("Frontend service port", services.get("frontend")?.port === "80", `Frontend port is ${services.get("frontend")?.port ?? "missing"}.`);
  check("PostgreSQL detection", analysis.stack.databases.includes("PostgreSQL"), `Databases: ${analysis.stack.databases.join(", ") || "none"}.`);

  const requiredEnv = new Set(analysis.stack.requiredEnv ?? []);
  for (const key of ["DATABASE_URL", "TOKEN_SECRET", "CORS_ORIGIN"]) {
    check(`Required env: ${key}`, requiredEnv.has(key), `${key} is detected as a production input.`);
  }
}

function validateReleaseBundle(buffer) {
  const zip = new AdmZip(buffer);
  const entries = new Set(zip.getEntries().map((entry) => entry.entryName));

  for (const entry of expectedBundleEntries) {
    check(`Bundle entry: ${entry}`, entries.has(entry), `${entry} is included.`);
  }

  const redacted = zip.readAsText("reports/deployment-inputs.redacted.json");
  check("Bundle redacts database URL", redacted.includes("\"databaseUrl\": \"<redacted>\""), "databaseUrl is redacted.");
  check("Bundle redacts token secret", redacted.includes("\"tokenSecret\": \"<redacted>\""), "tokenSecret is redacted.");
  check("Bundle includes manifest v2", zip.readAsText("reports/pipelineforge-manifest.json").includes("\"bundleVersion\": 2"), "Manifest bundleVersion is 2.");
}

function filterFilesForDeploymentTarget(files, target) {
  const base = files.filter((file) => isBaseGeneratedFile(file.path));
  if (target === "ecs") return [...base, ...files.filter((file) => file.path.startsWith("ecs/"))];
  if (target === "eks") return [...base, ...files.filter((file) => file.path.startsWith("k8s/") || file.path.startsWith("eks/"))];
  return [...base, ...files.filter((file) => file.path.startsWith("k8s/") || file.path.startsWith("aks/"))];
}

function isBaseGeneratedFile(filePath) {
  const lowerPath = filePath.toLowerCase();
  return lowerPath.endsWith("dockerfile") || lowerPath.endsWith(".dockerignore") || filePath === "docker-compose.yml" || filePath === "Jenkinsfile" || filePath === "azure-pipelines.yml";
}

function hasPassedCheck(result, name) {
  return result.checks.some((check) => check.name === name && check.status === "passed");
}

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) throw new Error(`${name}: ${detail}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printSummary() {
  if (!results.length) return;

  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  console.log(`\nPipelineForge Sovereign Code regression: ${passed}/${results.length} passed`);
  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name} - ${result.detail}`);
  }
  if (failed === 0) console.log("\nAll regression checks passed.");
}
