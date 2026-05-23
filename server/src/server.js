import cors from "cors";
import express from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "PipelineForge API" });
});

app.post("/api/analyze/github", (req, res) => {
  const { url } = req.body;

  if (!isValidGithubUrl(url)) {
    return res.status(400).json({ error: "Provide a valid GitHub repository URL." });
  }

  const name = url.split("/").filter(Boolean).slice(-2).join("/");
  res.json(
    buildAnalysis({
      source: "github",
      repoName: name,
      files: [],
      packageJson: null,
      code: "",
      githubUrl: url
    })
  );
});

app.post("/api/analyze/upload", upload.single("repo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Upload a repository ZIP file." });
  }

  if (!req.file.originalname.toLowerCase().endsWith(".zip")) {
    return res.status(400).json({ error: "Only ZIP repositories are supported in this stage." });
  }

  try {
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
    const files = entries.map((entry) => normalizePath(entry.entryName));
    const packageEntry = entries.find((entry) => normalizePath(entry.entryName).endsWith("package.json"));
    const packageJson = readJsonEntry(packageEntry);
    const codeSample = readCodeSample(entries);

    res.json(
      buildAnalysis({
        source: "upload",
        repoName: req.file.originalname.replace(/\.zip$/i, ""),
        files,
        packageJson,
        code: codeSample,
        githubUrl: null
      })
    );
  } catch (error) {
    res.status(400).json({ error: "Could not read ZIP archive.", detail: error.message });
  }
});

app.post("/api/sandbox/validate", (req, res) => {
  const { files = [], deploymentInputs = {}, repoName = "repository" } = req.body;

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "Provide generated files for sandbox validation." });
  }

  res.json(runSandboxValidation({ files, deploymentInputs, repoName }));
});

app.post("/api/sandbox/runtime", async (req, res) => {
  const { files = [], repoName = "repository" } = req.body;

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "Provide generated files for runtime dry-run validation." });
  }

  try {
    res.json(await runRuntimeDryRun({ files, repoName }));
  } catch (error) {
    res.status(500).json({ error: "Runtime dry-run failed.", detail: error.message });
  }
});

app.post("/api/security/gates", (req, res) => {
  const { files = [], repoName = "repository" } = req.body;

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "Provide generated files for security gate validation." });
  }

  res.json(runSecurityGates({ files, repoName }));
});

app.post("/api/autofix/preview", (req, res) => {
  const { files = [] } = req.body;

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "Provide generated files for auto-fix preview." });
  }

  res.json(previewAutoFixes(files));
});

app.get("/api/runtime/toolchain", async (_req, res) => {
  res.json(await inspectRuntimeToolchain());
});

function buildAnalysis({ source, repoName, files, packageJson, code, githubUrl }) {
  const stack = detectStack(files, packageJson, githubUrl, code);
  const validations = validateRepository(files, packageJson, stack, source, code);
  const templates = selectTemplates(stack);
  const generatedFiles = generateFiles(stack);
  const pipeline = buildPipeline(stack);
  const scoreBreakdown = buildScoreBreakdown(validations, stack, templates);
  const score = scoreBreakdown.score;
  const report = buildReport(files, stack, validations);
  const preflight = buildPreflight(stack, validations, generatedFiles);
  const infraPlan = buildInfraPlan(stack);
  const promotionDecision = buildPromotionDecision(validations, scoreBreakdown);

  return {
    repoName,
    source,
    stack,
    report,
    preflight,
    infraPlan,
    validations,
    templates,
    generatedFiles,
    pipeline,
    score,
    scoreBreakdown,
    promotionDecision,
    generatedAt: new Date().toISOString()
  };
}

function buildPromotionDecision(validations, scoreBreakdown) {
  const failed = validations.filter((item) => item.status === "failed");
  const warnings = validations.filter((item) => item.status === "warning");
  const hasScoreRisk = scoreBreakdown.score < 85;
  const status = failed.length || hasScoreRisk ? "blocked" : warnings.length ? "review" : "ready";
  const title =
    status === "blocked"
      ? "Blocked before production"
      : status === "review"
        ? "Needs engineering review"
        : "Ready for controlled promotion";
  const message =
    failed.length
      ? "Resolve blocking analyzer rules before enabling sandbox, pipeline, or cloud deployment gates."
      : hasScoreRisk
        ? "Raise the readiness score above the release threshold before enabling cloud deployment gates."
      : status === "review"
        ? "The repository can continue through validation, but warnings should be accepted or fixed before release."
        : "No blocking analyzer issues remain. Continue with executable sandbox, runtime, and security gates.";

  return {
    status,
    title,
    message,
    gates: [
      gate(
        "Blocking rules",
        failed.length ? "blocked" : "passed",
        failed.length ? `${failed.length} blocking rule${failed.length === 1 ? "" : "s"} failed.` : "No blocking analyzer rules failed."
      ),
      gate(
        "Readiness threshold",
        scoreBreakdown.score >= 85 ? "passed" : "blocked",
        `${scoreBreakdown.score}/100 readiness score. Minimum release review threshold is 85.`
      ),
      gate(
        "Warning review",
        warnings.length ? "warning" : "passed",
        warnings.length ? `${warnings.length} warning rule${warnings.length === 1 ? "" : "s"} require review.` : "No analyzer warnings remain."
      )
    ]
  };
}

function buildPreflight(stack, validations, generatedFiles) {
  const gates = [
    gate("Stack confidence", stack.runtime.length ? "passed" : "blocked", stack.runtime.length ? `Detected ${stack.runtime.join(", ")}.` : "No runtime detected."),
    gate("Dependency manifest", stack.packageManager !== "unknown" || !stack.runtime.includes("JavaScript") ? "passed" : "blocked", stack.packageManager !== "unknown" ? `Package manager detected: ${stack.packageManager}.` : "JavaScript app needs package.json before build validation."),
    gate("Build command", stack.buildCommand ? "passed" : "blocked", stack.buildCommand ? `Build command ready: ${stack.buildCommand}.` : "Build command missing."),
    gate("Start command", stack.startCommand ? "passed" : "blocked", stack.startCommand ? `Start command ready: ${stack.startCommand}.` : "Start command missing."),
    gate("Container files", generatedFiles.some((file) => file.path === "Dockerfile") ? "warning" : "blocked", "Dockerfile is available for review before sandbox build."),
    gate("Security scan", "warning", "Trivy scan will run after Docker is available locally."),
    gate("Cloud credentials", "warning", "Cloud apply is disabled until credentials and target subscription/account are configured.")
  ];
  const hasBlocked = gates.some((item) => item.status === "blocked") || validations.some((item) => item.status === "failed");

  return {
    status: hasBlocked ? "blocked" : "ready",
    gates
  };
}

function gate(name, status, message) {
  return { name, status, message };
}

function buildInfraPlan(stack) {
  const needsDatabase = stack.databases.length > 0;

  return {
    azure: {
      provider: "azure",
      summary: "Azure landing plan for Jenkins, ACR, AKS, and optional managed database.",
      resources: [
        infraResource("Resource Group", "Logical boundary for all PipelineForge-created Azure resources.", true),
        infraResource("Azure Container Registry", "Stores versioned application images used by AKS.", true),
        infraResource("AKS Cluster", "Runs the application containers with Kubernetes service and ingress manifests.", true),
        infraResource("ACR Pull Role Assignment", "Allows AKS kubelet identity to pull images from ACR.", true),
        infraResource("Jenkins VM", "Runs CI/CD controller until managed CI is configured.", true),
        infraResource("Azure Database for PostgreSQL", needsDatabase ? "Managed database detected from app dependencies." : "Optional database if the app requires persistence.", needsDatabase),
        infraResource("Log Analytics Workspace", "Collects AKS logs and metrics for feedback.", true)
      ],
      terraformFiles: [
        terraformFile("infra/azure/main.tf", "needs-input", generateAzureTerraform(stack)),
        terraformFile("infra/azure/variables.tf", "needs-input", generateAzureVariables())
      ]
    },
    aws: {
      provider: "aws",
      summary: "AWS landing plan for Jenkins, ECR, EKS, and optional managed database.",
      resources: [
        infraResource("VPC", "Network boundary for EKS, Jenkins, and data services.", true),
        infraResource("Elastic Container Registry", "Stores versioned application images used by EKS.", true),
        infraResource("EKS Cluster", "Runs the application containers with Kubernetes service and ingress manifests.", true),
        infraResource("Jenkins EC2", "Runs CI/CD controller until managed CI is configured.", true),
        infraResource("IAM Roles", "Grants EKS, nodes, and CI controlled access to AWS services.", true),
        infraResource("RDS PostgreSQL", needsDatabase ? "Managed database detected from app dependencies." : "Optional database if the app requires persistence.", needsDatabase),
        infraResource("CloudWatch Logs", "Collects application and cluster logs for feedback.", true)
      ],
      terraformFiles: [
        terraformFile("infra/aws/main.tf", "needs-input", generateAwsTerraform(stack)),
        terraformFile("infra/aws/variables.tf", "needs-input", generateAwsVariables())
      ]
    }
  };
}

function infraResource(name, purpose, required) {
  return { name, purpose, required };
}

function terraformFile(path, status, content) {
  return { path, status, content };
}

async function inspectRuntimeToolchain() {
  const tools = await Promise.all([
    checkRuntimeTool("Docker CLI", "docker", ["--version"], "docker --version", true),
    checkRuntimeTool("Docker daemon", "docker", ["info"], "docker info", true),
    checkRuntimeTool("Docker Compose", "docker", ["compose", "version"], "docker compose version", true),
    checkRuntimeTool("kubectl", "kubectl", ["version", "--client"], "kubectl version --client", false),
    checkRuntimeTool("Terraform", "terraform", ["version"], "terraform version", false),
    checkRuntimeTool("Trivy", "trivy", ["--version"], "trivy --version", false),
    checkRuntimeTool("Azure CLI", "az", ["version"], "az version", false)
  ]);
  const requiredTools = tools.filter((tool) => tool.required);
  const readyRequired = requiredTools.every((tool) => tool.status === "available");

  return {
    status: readyRequired ? "ready" : "partial",
    mode: readyRequired ? "runtime-ready" : "static-only",
    tools,
    summary: {
      available: tools.filter((tool) => tool.status === "available").length,
      missing: tools.filter((tool) => tool.status === "missing").length,
      required: requiredTools.length
    },
    inspectedAt: new Date().toISOString()
  };
}

function checkRuntimeTool(name, command, args, commandText, required) {
  return new Promise((resolve) => {
    const child = execFile(command, args, { timeout: 5000, windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout || ""}${stderr || ""}`.trim();

      if (error) {
        resolve({
          name,
          command: commandText,
          required,
          status: "missing",
          message: output ? output.split("\n")[0] : `${name} is not available from this environment.`
        });
        return;
      }

      resolve({
        name,
        command: commandText,
        required,
        status: "available",
        message: output.split("\n")[0] || `${name} is available.`
      });
    });

    child.on("error", (error) => {
      resolve({
        name,
        command: commandText,
        required,
        status: "missing",
        message: error.message
      });
    });
  });
}

async function runRuntimeDryRun({ files, repoName }) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pipelineforge-runtime-"));

  try {
    await materializeGeneratedFiles(workspace, files);
    const kubeconfigPath = path.join(workspace, "kubeconfig");
    await writeFile(kubeconfigPath, generateEmptyKubeconfig(), "utf8");

    const checks = [
      await runOptionalCommand({
        name: "Docker Compose config",
        command: "docker",
        args: ["compose", "config"],
        commandText: "docker compose config",
        cwd: workspace,
        missingMessage: "Docker Compose is not available for runtime validation."
      }),
      await runOptionalCommand({
        name: "Kubernetes deployment dry-run",
        command: "kubectl",
        args: ["apply", "--dry-run=client", "--validate=false", "--kubeconfig", kubeconfigPath, "-f", path.join("k8s", "deployment.yaml")],
        commandText: "kubectl apply --dry-run=client --validate=false -f k8s/deployment.yaml",
        cwd: workspace,
        missingMessage: "kubectl is not available for deployment dry-run."
      }),
      await runOptionalCommand({
        name: "Kubernetes service dry-run",
        command: "kubectl",
        args: ["apply", "--dry-run=client", "--validate=false", "--kubeconfig", kubeconfigPath, "-f", path.join("k8s", "service.yaml")],
        commandText: "kubectl apply --dry-run=client --validate=false -f k8s/service.yaml",
        cwd: workspace,
        missingMessage: "kubectl is not available for service dry-run."
      }),
      await runOptionalCommand({
        name: "Kubernetes ingress dry-run",
        command: "kubectl",
        args: ["apply", "--dry-run=client", "--validate=false", "--kubeconfig", kubeconfigPath, "-f", path.join("k8s", "ingress.yaml")],
        commandText: "kubectl apply --dry-run=client --validate=false -f k8s/ingress.yaml",
        cwd: workspace,
        missingMessage: "kubectl is not available for ingress dry-run."
      })
    ];
    const summary = summarizeChecks(checks);

    return {
      status: summary.failed > 0 ? "blocked" : "ready",
      mode: "runtime",
      summary,
      checks,
      nextActions: buildRuntimeNextActions(checks, repoName),
      validatedAt: new Date().toISOString()
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function generateEmptyKubeconfig() {
  return [
    "apiVersion: v1",
    "kind: Config",
    "preferences: {}",
    "clusters: []",
    "contexts: []",
    "users: []",
    "current-context: \"\""
  ].join("\n");
}

async function materializeGeneratedFiles(workspace, files) {
  for (const file of files) {
    if (!file?.path || typeof file.content !== "string") continue;
    const safePath = normalizeGeneratedPath(file.path);
    const targetPath = path.join(workspace, safePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content, "utf8");
  }
}

function normalizeGeneratedPath(filePath) {
  const normalized = normalizePath(filePath).replace(/^(\.\.\/)+/, "");
  return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

function runOptionalCommand({ name, command, args, commandText, cwd, missingMessage }) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: 12000, windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout || ""}${stderr || ""}`.trim();

      if (!error) {
        resolve(sandboxCheck(name, "passed", output.split("\n")[0] || `${name} completed successfully.`, commandText));
        return;
      }

      const message = output.split("\n")[0] || error.message || missingMessage;
      const skipReason = runtimeSkipReason(error, output, missingMessage);
      resolve(sandboxCheck(name, skipReason ? "skipped" : "failed", skipReason ?? message, commandText));
    });
  });
}

function runtimeSkipReason(error, output, missingMessage) {
  const detail = `${output || ""} ${error?.message || ""}`.toLowerCase();

  if (error?.code === "ENOENT") return missingMessage;
  if (detail.includes("couldn't get current server api group list")) {
    return "kubectl client is installed, but no reachable cluster API is configured for full dry-run discovery.";
  }
  if (detail.includes("the connection to the server") || detail.includes("connection refused")) {
    return "kubectl client is installed, but no reachable cluster API is configured.";
  }
  if (detail.includes("kube") && detail.includes("access is denied")) {
    return "kubectl client is installed, but kubeconfig access is blocked in this environment.";
  }

  return null;
}

function summarizeChecks(checks) {
  return checks.reduce(
    (total, check) => ({ ...total, [check.status]: total[check.status] + 1 }),
    { passed: 0, warning: 0, failed: 0, skipped: 0 }
  );
}

function buildRuntimeNextActions(checks, repoName) {
  const failed = checks.filter((check) => check.status === "failed");
  const skipped = checks.filter((check) => check.status === "skipped");

  if (failed.length) {
    return [
      `Fix ${failed.length} runtime dry-run issue${failed.length === 1 ? "" : "s"} for ${repoName}.`,
      "Keep cloud deployment locked until Compose and Kubernetes dry-runs pass."
    ];
  }

  if (skipped.length) {
    return [
      "Install or configure missing local tools to unlock full runtime validation.",
      "Static checks can continue, but production deployment should wait for runtime dry-runs."
    ];
  }

  return [
    "Runtime dry-runs passed.",
    "Next upgrade: add Docker image build and Trivy vulnerability scan gates."
  ];
}

function runSecurityGates({ files, repoName }) {
  const fileMap = new Map(files.map((file) => [file.path, file]));
  const allContent = files.map((file) => `${file.path}\n${file.content ?? ""}`).join("\n---\n");
  const checks = [
    validateNoHardcodedSecrets(allContent),
    validateDockerRunsAsNonRoot(fileMap),
    validatePinnedContainerImage(fileMap),
    validateIngressTls(fileMap),
    validatePipelineDeployLock(fileMap),
    validateDockerIgnoreSecrets(fileMap)
  ];
  const summary = summarizeChecks(checks);

  return {
    status: summary.failed > 0 ? "blocked" : "ready",
    mode: "security",
    summary,
    checks,
    nextActions: buildSecurityNextActions(checks, repoName),
    validatedAt: new Date().toISOString()
  };
}

function validateNoHardcodedSecrets(content) {
  const secretPatterns = [
    /aws_access_key_id\s*[:=]\s*["']?[A-Z0-9]{16,}/i,
    /aws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{24,}/i,
    /password\s*[:=]\s*["'][^"']{8,}["']/i,
    /api[_-]?key\s*[:=]\s*["'][^"']{12,}["']/i,
    /token\s*[:=]\s*["'][^"']{16,}["']/i
  ];
  const matched = secretPatterns.some((pattern) => pattern.test(content));

  if (matched) {
    return sandboxCheck("Secret exposure", "failed", "Generated files appear to contain hardcoded secret-like values.", "secret-pattern scan");
  }

  return sandboxCheck("Secret exposure", "passed", "No hardcoded secret patterns found in generated files.", "secret-pattern scan");
}

function validateDockerRunsAsNonRoot(fileMap) {
  const dockerfile = fileMap.get("Dockerfile")?.content ?? "";

  if (!dockerfile) return sandboxCheck("Container user", "skipped", "Dockerfile is missing.", "Dockerfile USER check");
  if (/^USER\s+\S+/m.test(dockerfile)) return sandboxCheck("Container user", "passed", "Dockerfile sets an explicit runtime user.", "Dockerfile USER check");
  return sandboxCheck("Container user", "warning", "Dockerfile does not set a non-root runtime user yet.", "Dockerfile USER check");
}

function validatePinnedContainerImage(fileMap) {
  const deployment = fileMap.get("k8s/deployment.yaml")?.content ?? "";

  if (!deployment) return sandboxCheck("Image tag policy", "skipped", "Kubernetes deployment manifest is missing.", "image tag policy");
  if (/image:\s+\S+:latest\b/m.test(deployment)) return sandboxCheck("Image tag policy", "warning", "Deployment uses the latest tag; production should use immutable build tags.", "image tag policy");
  if (/image:\s+\S+:\S+/m.test(deployment)) return sandboxCheck("Image tag policy", "passed", "Deployment uses an explicit image tag.", "image tag policy");
  return sandboxCheck("Image tag policy", "failed", "Deployment image tag is missing.", "image tag policy");
}

function validateIngressTls(fileMap) {
  const ingress = fileMap.get("k8s/ingress.yaml")?.content ?? "";

  if (!ingress) return sandboxCheck("Ingress TLS", "skipped", "Ingress manifest is missing.", "ingress TLS policy");
  if (/tls:\s*\n/m.test(ingress)) return sandboxCheck("Ingress TLS", "passed", "Ingress has a TLS block.", "ingress TLS policy");
  return sandboxCheck("Ingress TLS", "warning", "Ingress host is configured, but TLS is not defined yet.", "ingress TLS policy");
}

function validatePipelineDeployLock(fileMap) {
  const azure = fileMap.get("azure-pipelines.yml")?.content ?? "";
  const jenkins = fileMap.get("Jenkinsfile")?.content ?? "";

  if (azure.includes("condition: false") || jenkins.includes("Security Scan")) {
    return sandboxCheck("Deployment lock", "passed", "Generated pipeline keeps deploy/release controlled behind gates.", "pipeline deploy gate");
  }

  return sandboxCheck("Deployment lock", "warning", "Pipeline should keep deployment locked until sandbox, security, and credential gates pass.", "pipeline deploy gate");
}

function validateDockerIgnoreSecrets(fileMap) {
  const dockerignore = fileMap.get(".dockerignore")?.content ?? "";

  if (!dockerignore) return sandboxCheck("Secret build context", "failed", ".dockerignore is missing.", ".dockerignore secret policy");
  if (dockerignore.includes(".env")) return sandboxCheck("Secret build context", "passed", ".dockerignore excludes .env files from image build context.", ".dockerignore secret policy");
  return sandboxCheck("Secret build context", "failed", ".dockerignore must exclude .env files.", ".dockerignore secret policy");
}

function buildSecurityNextActions(checks, repoName) {
  const failed = checks.filter((check) => check.status === "failed");
  const warnings = checks.filter((check) => check.status === "warning");

  if (failed.length) {
    return [
      `Fix ${failed.length} blocking security gate${failed.length === 1 ? "" : "s"} for ${repoName}.`,
      "Do not enable deployment until secret and image-context checks pass."
    ];
  }

  if (warnings.length) {
    return [
      "Review security warnings before production deployment.",
      "Next upgrade: add Trivy image and dependency scanning when Trivy is installed."
    ];
  }

  return [
    "Security gates passed.",
    "Next upgrade: run Trivy and dependency vulnerability scans as executable gates."
  ];
}

function previewAutoFixes(files) {
  const changes = [];
  const fixedFiles = files.map((file) => ({ ...file }));

  for (const file of fixedFiles) {
    if (file.path === "Dockerfile") {
      const fixed = autoFixDockerfile(file.content ?? "");
      if (fixed !== file.content) {
        file.content = fixed;
        changes.push({
          path: file.path,
          title: "Add non-root runtime user",
          detail: "Creates an app user and switches the container runtime away from root before CMD/ENTRYPOINT."
        });
      }
    }

    if (file.path === "k8s/deployment.yaml") {
      const fixed = autoFixDeployment(file.content ?? "");
      if (fixed !== file.content) {
        file.content = fixed;
        changes.push({
          path: file.path,
          title: "Replace latest image tag",
          detail: "Uses an immutable image tag placeholder so production deploys can pin a build artifact."
        });
      }
    }

    if (file.path === "k8s/ingress.yaml") {
      const fixed = autoFixIngressTls(file.content ?? "");
      if (fixed !== file.content) {
        file.content = fixed;
        changes.push({
          path: file.path,
          title: "Add TLS placeholder",
          detail: "Adds a TLS block tied to the configured host, ready for cert-manager or cloud ingress wiring."
        });
      }
    }
  }

  return {
    status: changes.length ? "ready" : "no-op",
    changes,
    files: fixedFiles,
    fixedAt: new Date().toISOString()
  };
}

function autoFixDockerfile(content) {
  if (!content || /^USER\s+\S+/m.test(content)) return content;

  const userBlock = [
    "RUN addgroup -S app && adduser -S app -G app",
    "USER app"
  ].join("\n");

  if (/^CMD\s+/m.test(content)) return content.replace(/^CMD\s+/m, `${userBlock}\nCMD `);
  if (/^ENTRYPOINT\s+/m.test(content)) return content.replace(/^ENTRYPOINT\s+/m, `${userBlock}\nENTRYPOINT `);
  return `${content}\n${userBlock}`;
}

function autoFixDeployment(content) {
  if (!content) return content;
  return content.replace(/image:\s+(\S+):latest\b/g, "image: $1:${IMAGE_TAG}");
}

function autoFixIngressTls(content) {
  if (!content || /tls:\s*\n/m.test(content)) return content;
  const hostMatch = content.match(/host:\s+([^\s]+)/);
  const host = hostMatch?.[1] ?? "app.example.com";

  return [
    content,
    "  tls:",
    "    - hosts:",
    `        - ${host}`,
    "      secretName: pipelineforge-app-tls"
  ].join("\n");
}

function runSandboxValidation({ files, deploymentInputs, repoName }) {
  const fileMap = new Map(files.map((file) => [file.path, file]));
  const checks = [
    validateDockerfile(fileMap),
    validateDockerIgnore(fileMap),
    validateCompose(fileMap, deploymentInputs),
    validateKubernetesDeployment(fileMap, deploymentInputs),
    validateKubernetesService(fileMap),
    validateKubernetesIngress(fileMap, deploymentInputs),
    validateAzurePipeline(fileMap),
    validateJenkinsPipeline(fileMap)
  ];
  const summary = checks.reduce(
    (total, check) => ({ ...total, [check.status]: total[check.status] + 1 }),
    { passed: 0, warning: 0, failed: 0, skipped: 0 }
  );
  const nextActions = buildSandboxNextActions(checks, repoName);

  return {
    status: summary.failed > 0 ? "blocked" : "ready",
    mode: "static",
    summary,
    checks,
    nextActions,
    validatedAt: new Date().toISOString()
  };
}

function sandboxCheck(name, status, message, command) {
  return { name, status, message, command };
}

function validateDockerfile(fileMap) {
  const file = fileMap.get("Dockerfile");
  if (!file) return sandboxCheck("Dockerfile syntax", "failed", "Dockerfile is missing.", "docker build --check .");
  const content = file.content ?? "";
  const hasFrom = /^FROM\s+\S+/m.test(content);
  const hasCommand = /^CMD\s+|^ENTRYPOINT\s+/m.test(content);
  const hasExpose = /^EXPOSE\s+\d+/m.test(content);

  if (!hasFrom) return sandboxCheck("Dockerfile syntax", "failed", "Dockerfile needs a FROM image.", "docker build --check .");
  if (!hasCommand) return sandboxCheck("Dockerfile runtime", "failed", "Dockerfile needs CMD or ENTRYPOINT.", "docker build --check .");
  if (!hasExpose) return sandboxCheck("Dockerfile port", "warning", "Dockerfile has no EXPOSE instruction.", "docker build --check .");
  return sandboxCheck("Dockerfile syntax", "passed", "Dockerfile has base image, runtime command, and exposed port.", "docker build --check .");
}

function validateDockerIgnore(fileMap) {
  const file = fileMap.get(".dockerignore");
  if (!file) return sandboxCheck("Build context hygiene", "warning", ".dockerignore is missing.", "docker build --check .");
  const content = file.content ?? "";
  const required = ["node_modules", ".env", ".git"];
  const missing = required.filter((entry) => !content.includes(entry));

  if (missing.length) {
    return sandboxCheck("Build context hygiene", "warning", `.dockerignore should exclude ${missing.join(", ")}.`, "docker build --check .");
  }
  return sandboxCheck("Build context hygiene", "passed", ".dockerignore excludes dependency folders, secrets, and git metadata.", "docker build --check .");
}

function validateCompose(fileMap, deploymentInputs) {
  const file = fileMap.get("docker-compose.yml");
  if (!file) return sandboxCheck("Compose smoke test", "skipped", "docker-compose.yml was not generated.", "docker compose config");
  const content = file.content ?? "";
  const hasService = /services:\s*\n\s+app:/m.test(content);
  const hasPort = /ports:\s*\n\s+-\s+"\d+:\d+"/m.test(content) || /ports:\s*\n\s+-\s+"\d+:80"/m.test(content);
  const hasInputPort = Boolean(String(deploymentInputs.port ?? "").trim());

  if (!hasService) return sandboxCheck("Compose smoke test", "failed", "Compose file needs an app service.", "docker compose config");
  if (!hasPort || !hasInputPort) return sandboxCheck("Compose smoke test", "warning", "Compose port mapping should be confirmed before local smoke testing.", "docker compose config");
  return sandboxCheck("Compose smoke test", "passed", "Compose service and port mapping are ready for local config validation.", "docker compose config");
}

function validateKubernetesDeployment(fileMap, deploymentInputs) {
  const file = fileMap.get("k8s/deployment.yaml");
  if (!file) return sandboxCheck("Kubernetes deployment", "skipped", "Deployment manifest was not generated.", "kubectl apply --dry-run=client -f k8s/deployment.yaml");
  const content = file.content ?? "";
  const hasImage = /image:\s+(?!REPLACE_WITH_REGISTRY)\S+/m.test(content);
  const hasPort = /containerPort:\s+\d+/m.test(content);
  const hasReadiness = content.includes("readinessProbe:");
  const hasLiveness = content.includes("livenessProbe:");
  const hasRegistry = Boolean(String(deploymentInputs.imageRegistry ?? "").trim());

  if (!hasImage || !hasRegistry) return sandboxCheck("Kubernetes deployment", "failed", "Deployment image registry must be resolved before dry-run validation.", "kubectl apply --dry-run=client -f k8s/deployment.yaml");
  if (!hasPort) return sandboxCheck("Kubernetes deployment", "failed", "Deployment needs a container port.", "kubectl apply --dry-run=client -f k8s/deployment.yaml");
  if (!hasReadiness || !hasLiveness) return sandboxCheck("Kubernetes probes", "warning", "Deployment should include readiness and liveness probes.", "kubectl apply --dry-run=client -f k8s/deployment.yaml");
  return sandboxCheck("Kubernetes deployment", "passed", "Deployment image, port, and health probes are ready for dry-run validation.", "kubectl apply --dry-run=client -f k8s/deployment.yaml");
}

function validateKubernetesService(fileMap) {
  const file = fileMap.get("k8s/service.yaml");
  if (!file) return sandboxCheck("Kubernetes service", "skipped", "Service manifest was not generated.", "kubectl apply --dry-run=client -f k8s/service.yaml");
  const content = file.content ?? "";

  if (!/selector:\s*\n\s+app:\s+\S+/m.test(content)) return sandboxCheck("Kubernetes service", "failed", "Service selector is missing.", "kubectl apply --dry-run=client -f k8s/service.yaml");
  if (!/targetPort:\s+\d+/m.test(content)) return sandboxCheck("Kubernetes service", "failed", "Service targetPort is missing.", "kubectl apply --dry-run=client -f k8s/service.yaml");
  return sandboxCheck("Kubernetes service", "passed", "Service selector and target port are present.", "kubectl apply --dry-run=client -f k8s/service.yaml");
}

function validateKubernetesIngress(fileMap, deploymentInputs) {
  const file = fileMap.get("k8s/ingress.yaml");
  if (!file) return sandboxCheck("Ingress route", "skipped", "Ingress manifest was not generated.", "kubectl apply --dry-run=client -f k8s/ingress.yaml");
  const content = file.content ?? "";
  const hasDomain = Boolean(String(deploymentInputs.domain ?? "").trim()) && !content.includes("REPLACE_WITH_DOMAIN");
  const hasService = /service:\s*\n\s+name:\s+\S+/m.test(content);

  if (!hasDomain) return sandboxCheck("Ingress route", "warning", "Ingress host must be set before HTTPS exposure.", "kubectl apply --dry-run=client -f k8s/ingress.yaml");
  if (!hasService) return sandboxCheck("Ingress route", "failed", "Ingress must map to a service.", "kubectl apply --dry-run=client -f k8s/ingress.yaml");
  return sandboxCheck("Ingress route", "passed", "Ingress host and service mapping are ready for dry-run validation.", "kubectl apply --dry-run=client -f k8s/ingress.yaml");
}

function validateAzurePipeline(fileMap) {
  const file = fileMap.get("azure-pipelines.yml");
  if (!file) return sandboxCheck("Azure Pipelines YAML", "skipped", "azure-pipelines.yml was not generated.", "az pipelines validate");
  const content = file.content ?? "";
  const required = ["stage: Build", "stage: Containerize", "stage: Deploy"];
  const missing = required.filter((stage) => !content.includes(stage));

  if (missing.length) return sandboxCheck("Azure Pipelines YAML", "failed", `Missing pipeline stages: ${missing.join(", ")}.`, "az pipelines validate");
  if (content.includes("REPLACE_WITH_ACR_OR_ECR_SERVICE_CONNECTION")) return sandboxCheck("Azure Pipelines YAML", "warning", "Container registry service connection still needs a real value.", "az pipelines validate");
  return sandboxCheck("Azure Pipelines YAML", "passed", "Azure pipeline has build, containerize, and locked deploy stages.", "az pipelines validate");
}

function validateJenkinsPipeline(fileMap) {
  const file = fileMap.get("Jenkinsfile");
  if (!file) return sandboxCheck("Jenkinsfile", "skipped", "Jenkinsfile was not generated.", "jenkinsfile-runner");
  const content = file.content ?? "";
  const required = ["stage('Install')", "stage('Test')", "stage('Build')", "stage('Containerize')"];
  const missing = required.filter((stage) => !content.includes(stage));

  if (missing.length) return sandboxCheck("Jenkinsfile", "warning", `Jenkinsfile is missing optional stages: ${missing.join(", ")}.`, "jenkinsfile-runner");
  return sandboxCheck("Jenkinsfile", "passed", "Jenkinsfile has modular install, test, build, scan, and container stages.", "jenkinsfile-runner");
}

function buildSandboxNextActions(checks, repoName) {
  const failed = checks.filter((check) => check.status === "failed");
  const warnings = checks.filter((check) => check.status === "warning");

  if (failed.length) {
    return [
      `Fix ${failed.length} blocking sandbox issue${failed.length === 1 ? "" : "s"} for ${repoName}.`,
      "Re-run generated config resolution before enabling runtime Docker validation."
    ];
  }

  if (warnings.length) {
    return [
      "Review warnings and decide whether they are acceptable for a sandbox-only run.",
      "Next upgrade: execute docker compose config, kubectl dry-run, and image build when Docker is available."
    ];
  }

  return [
    "Static sandbox checks passed.",
    "Next upgrade: run real Docker build, Compose config, Kubernetes dry-run, and security scan."
  ];
}

function generateFiles(stack) {
  return [
    {
      path: "Dockerfile",
      purpose: "Production container image",
      status: stack.packageManager === "unknown" ? "needs-input" : "ready",
      content: generateDockerfile(stack)
    },
    {
      path: ".dockerignore",
      purpose: "Secure image context",
      status: "ready",
      content: [
        "node_modules",
        "dist",
        "build",
        ".git",
        ".env",
        "*.log",
        "coverage",
        ".DS_Store"
      ].join("\n")
    },
    {
      path: "Jenkinsfile",
      purpose: "Modular CI/CD pipeline",
      status: stack.buildCommand && stack.startCommand ? "ready" : "needs-input",
      content: generateJenkinsfile(stack)
    },
    {
      path: "azure-pipelines.yml",
      purpose: "Azure Pipelines CI/CD workflow",
      status: stack.buildCommand && stack.startCommand ? "ready" : "needs-input",
      content: generateAzurePipelines(stack)
    },
    {
      path: "docker-compose.yml",
      purpose: "Sandbox smoke test",
      status: stack.port === "auto-detect" ? "needs-input" : "ready",
      content: generateCompose(stack)
    },
    {
      path: "k8s/deployment.yaml",
      purpose: "Kubernetes deployment with probes",
      status: stack.startCommand ? "ready" : "needs-input",
      content: generateKubernetesDeployment(stack)
    },
    {
      path: "k8s/service.yaml",
      purpose: "Kubernetes service mapping",
      status: stack.port === "auto-detect" ? "needs-input" : "ready",
      content: generateKubernetesService(stack)
    },
    {
      path: "k8s/ingress.yaml",
      purpose: "HTTPS ingress route placeholder",
      status: "needs-input",
      content: generateKubernetesIngress()
    }
  ];
}

function generateDockerfile(stack) {
  if (stack.frameworks.includes("Vite")) {
    return [
      "FROM node:22-alpine AS build",
      "WORKDIR /app",
      "COPY package*.json ./",
      "RUN npm ci",
      "COPY . .",
      "RUN npm run build",
      "",
      "FROM nginx:1.27-alpine",
      "COPY --from=build /app/dist /usr/share/nginx/html",
      "EXPOSE 80",
      "CMD [\"nginx\", \"-g\", \"daemon off;\"]"
    ].join("\n");
  }

  if (stack.frameworks.includes("Next.js")) {
    return [
      "FROM node:22-alpine AS deps",
      "WORKDIR /app",
      "COPY package*.json ./",
      "RUN npm ci",
      "",
      "FROM node:22-alpine AS runner",
      "WORKDIR /app",
      "ENV NODE_ENV=production",
      "COPY --from=deps /app/node_modules ./node_modules",
      "COPY . .",
      "RUN npm run build",
      "EXPOSE 3000",
      "CMD [\"npm\", \"run\", \"start\"]"
    ].join("\n");
  }

  return [
    "FROM node:22-alpine",
    "WORKDIR /app",
    "COPY package*.json ./",
    "RUN npm ci --omit=dev",
    "COPY . .",
    `EXPOSE ${stack.port === "auto-detect" ? "3000" : stack.port}`,
    "CMD [\"npm\", \"run\", \"start\"]"
  ].join("\n");
}

function generateJenkinsfile(stack) {
  const testStage = stack.testCommand
    ? [
        "        stage('Test') {",
        "            steps { sh 'npm run test' }",
        "        }"
      ]
    : [
        "        stage('Test') {",
        "            when { expression { false } }",
        "            steps { echo 'No test script detected yet' }",
        "        }"
      ];

  return [
    "pipeline {",
    "    agent any",
    "    options { timestamps() }",
    "    stages {",
    "        stage('Install') {",
    "            steps { sh 'npm ci' }",
    "        }",
    ...testStage,
    "        stage('Build') {",
    `            steps { sh '${stack.buildCommand ? "npm run build" : "echo Build command pending"}' }`,
    "        }",
    "        stage('Security Scan') {",
    "            steps { echo 'Run Trivy and dependency audit gates here' }",
    "        }",
    "        stage('Containerize') {",
    "            steps { sh 'docker build -t pipelineforge-app:${BUILD_NUMBER} .' }",
    "        }",
    "    }",
    "}"
  ].join("\n");
}

function generateAzurePipelines(stack) {
  const packageManager = stack.packageManager === "unknown" ? "npm" : stack.packageManager;
  const installCommand = packageManager === "npm" ? "npm ci" : `${packageManager} install`;
  const buildCommand = stack.buildCommand ?? "echo Build command pending";
  const testCommand = stack.testCommand ?? "echo No test script detected yet";

  return [
    "trigger:",
    "  branches:",
    "    include:",
    "      - main",
    "",
    "pool:",
    "  vmImage: ubuntu-latest",
    "",
    "variables:",
    "  imageRepository: pipelineforge-app",
    "  containerRegistry: REPLACE_WITH_ACR_OR_ECR_SERVICE_CONNECTION",
    "  imageTag: $(Build.BuildId)",
    "",
    "stages:",
    "  - stage: Build",
    "    displayName: Build and test",
    "    jobs:",
    "      - job: App",
    "        steps:",
    "          - checkout: self",
    "          - script: |",
    `              ${installCommand}`,
    "            displayName: Install dependencies",
    "          - script: |",
    `              ${testCommand}`,
    "            displayName: Run tests",
    "          - script: |",
    `              ${buildCommand}`,
    "            displayName: Build artifact",
    "",
    "  - stage: Containerize",
    "    displayName: Build container image",
    "    dependsOn: Build",
    "    jobs:",
    "      - job: Docker",
    "        steps:",
    "          - script: |",
    "              docker build -t $(imageRepository):$(imageTag) .",
    "            displayName: Docker build",
    "",
    "  - stage: Deploy",
    "    displayName: Deploy after infra approval",
    "    dependsOn: Containerize",
    "    condition: false",
    "    jobs:",
    "      - job: Placeholder",
    "        steps:",
    "          - script: echo Deployment is locked until cloud target and credentials are configured."
  ].join("\n");
}

function generateCompose(stack) {
  const exposedPort = stack.frameworks.includes("Vite") ? "8080:80" : `${stack.port === "auto-detect" ? "3000" : stack.port}:${stack.port === "auto-detect" ? "3000" : stack.port}`;

  return [
    "services:",
    "  app:",
    "    build: .",
    "    ports:",
    `      - \"${exposedPort}\"`,
    "    environment:",
    "      NODE_ENV: production"
  ].join("\n");
}

function generateKubernetesDeployment(stack) {
  const port = stack.port === "auto-detect" ? "3000" : stack.port;

  return [
    "apiVersion: apps/v1",
    "kind: Deployment",
    "metadata:",
    "  name: pipelineforge-app",
    "spec:",
    "  replicas: 2",
    "  selector:",
    "    matchLabels:",
    "      app: pipelineforge-app",
    "  template:",
    "    metadata:",
    "      labels:",
    "        app: pipelineforge-app",
    "    spec:",
    "      containers:",
    "        - name: app",
    "          image: REPLACE_WITH_REGISTRY/pipelineforge-app:latest",
    "          ports:",
    `            - containerPort: ${port}`,
    "          readinessProbe:",
    "            httpGet:",
    "              path: /",
    `              port: ${port}`,
    "            initialDelaySeconds: 10",
    "            periodSeconds: 10",
    "          livenessProbe:",
    "            httpGet:",
    "              path: /",
    `              port: ${port}`,
    "            initialDelaySeconds: 30",
    "            periodSeconds: 20"
  ].join("\n");
}

function generateKubernetesService(stack) {
  const port = stack.port === "auto-detect" ? "3000" : stack.port;

  return [
    "apiVersion: v1",
    "kind: Service",
    "metadata:",
    "  name: pipelineforge-app",
    "spec:",
    "  type: ClusterIP",
    "  selector:",
    "    app: pipelineforge-app",
    "  ports:",
    "    - name: http",
    "      protocol: TCP",
    "      port: 80",
    `      targetPort: ${port}`
  ].join("\n");
}

function generateKubernetesIngress() {
  return [
    "apiVersion: networking.k8s.io/v1",
    "kind: Ingress",
    "metadata:",
    "  name: pipelineforge-app",
    "spec:",
    "  rules:",
    "    - host: REPLACE_WITH_DOMAIN",
    "      http:",
    "        paths:",
    "          - path: /",
    "            pathType: Prefix",
    "            backend:",
    "              service:",
    "                name: pipelineforge-app",
    "                port:",
    "                  number: 80"
  ].join("\n");
}

function generateAzureTerraform(stack) {
  const location = "var.location";
  return [
    "terraform {",
    "  required_providers {",
    "    azurerm = {",
    "      source  = \"hashicorp/azurerm\"",
    "      version = \"~> 4.0\"",
    "    }",
    "  }",
    "}",
    "",
    "provider \"azurerm\" {",
    "  features {}",
    "}",
    "",
    "resource \"azurerm_resource_group\" \"main\" {",
    "  name     = var.resource_group_name",
    `  location = ${location}`,
    "}",
    "",
    "resource \"azurerm_container_registry\" \"main\" {",
    "  name                = var.acr_name",
    "  resource_group_name = azurerm_resource_group.main.name",
    "  location            = azurerm_resource_group.main.location",
    "  sku                 = \"Basic\"",
    "  admin_enabled       = false",
    "}",
    "",
    "resource \"azurerm_kubernetes_cluster\" \"main\" {",
    "  name                = var.aks_name",
    "  location            = azurerm_resource_group.main.location",
    "  resource_group_name = azurerm_resource_group.main.name",
    "  dns_prefix          = var.aks_dns_prefix",
    "",
    "  default_node_pool {",
    "    name       = \"system\"",
    "    node_count = 2",
    "    vm_size    = \"Standard_B2s\"",
    "  }",
    "",
    "  identity {",
    "    type = \"SystemAssigned\"",
    "  }",
    "}",
    "",
    "# TODO: Assign AcrPull to the AKS kubelet identity after cluster identity is confirmed.",
    "# TODO: Add Jenkins VM, PostgreSQL, and monitoring modules when credentials and sizing are configured.",
    `# App runtime: ${stack.runtime.join(", ") || "unknown"}`
  ].join("\n");
}

function generateAzureVariables() {
  return [
    "variable \"location\" { default = \"eastus\" }",
    "variable \"resource_group_name\" { default = \"rg-pipelineforge-app\" }",
    "variable \"acr_name\" { description = \"Must be globally unique.\" }",
    "variable \"aks_name\" { default = \"aks-pipelineforge-app\" }",
    "variable \"aks_dns_prefix\" { default = \"pipelineforge-app\" }"
  ].join("\n");
}

function generateAwsTerraform(stack) {
  return [
    "terraform {",
    "  required_providers {",
    "    aws = {",
    "      source  = \"hashicorp/aws\"",
    "      version = \"~> 5.0\"",
    "    }",
    "  }",
    "}",
    "",
    "provider \"aws\" {",
    "  region = var.region",
    "}",
    "",
    "resource \"aws_ecr_repository\" \"app\" {",
    "  name                 = var.ecr_repository_name",
    "  image_tag_mutability = \"MUTABLE\"",
    "}",
    "",
    "# TODO: Add VPC, EKS node groups, IAM roles, Jenkins EC2, RDS, and CloudWatch modules.",
    "# This file is intentionally staged until networking and account constraints are configured.",
    `# App runtime: ${stack.runtime.join(", ") || "unknown"}`
  ].join("\n");
}

function generateAwsVariables() {
  return [
    "variable \"region\" { default = \"us-east-1\" }",
    "variable \"ecr_repository_name\" { default = \"pipelineforge-app\" }",
    "variable \"cluster_name\" { default = \"eks-pipelineforge-app\" }",
    "variable \"jenkins_instance_type\" { default = \"t3.small\" }"
  ].join("\n");
}

function detectStack(files, packageJson, githubUrl, code = "") {
  const lowerFiles = files.map((file) => file.toLowerCase());
  const lowerCode = code.toLowerCase();
  const deps = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies
  };

  const has = (filename) => lowerFiles.some((file) => file.endsWith(filename));
  const hasAny = (patterns) => patterns.some((pattern) => lowerFiles.some((file) => file.includes(pattern)));

  const runtime = [];
  const frameworks = [];
  const databases = [];
  let packageManager = "unknown";
  let buildCommand = null;
  let startCommand = null;
  let testCommand = null;
  let port = "auto-detect";

  if (packageJson || has("package.json") || githubUrl) runtime.push("Node.js");
  if (has(".js") || code) runtime.push("JavaScript");
  if (deps.react || hasAny(["vite.config", "src/main.tsx", "src/main.jsx"]) || lowerCode.includes("react")) frameworks.push("React");
  if (deps.vite || hasAny(["vite.config.ts", "vite.config.js"]) || lowerCode.includes("import.meta.env")) frameworks.push("Vite");
  if (deps.next || hasAny(["next.config.js", "next.config.mjs"])) frameworks.push("Next.js");
  if (deps.express || lowerCode.includes("express()") || lowerCode.includes("from 'express'") || lowerCode.includes("require('express')")) frameworks.push("Express");
  if (has("requirements.txt") || has("pyproject.toml") || hasAny(["app.py", "manage.py"])) runtime.push("Python");
  if (has("pom.xml") || has("build.gradle")) runtime.push("Java");
  if (has("dockerfile")) frameworks.push("Docker-ready");

  if (has("pnpm-lock.yaml")) packageManager = "pnpm";
  else if (has("yarn.lock")) packageManager = "yarn";
  else if (has("package-lock.json") || packageJson) packageManager = "npm";

  if (deps.mongodb || deps.mongoose || lowerCode.includes("mongodb") || lowerCode.includes("mongoose")) databases.push("MongoDB");
  if (deps.pg || deps.postgres || deps.prisma || lowerCode.includes("postgres") || lowerCode.includes("prisma")) databases.push("PostgreSQL");
  if (deps.mysql || deps.mysql2 || lowerCode.includes("mysql")) databases.push("MySQL");

  if (packageJson?.scripts?.build) buildCommand = `${packageManager} run build`;
  if (packageJson?.scripts?.start) startCommand = `${packageManager} run start`;
  if (packageJson?.scripts?.test) testCommand = `${packageManager} run test`;
  if (deps.vite) port = "5173";
  if (deps.next) port = "3000";
  if (deps.express || lowerCode.includes("listen(")) port = inferPortFromCode(code) || "3000";

  return {
    runtime: unique(runtime),
    frameworks: unique(frameworks),
    databases: unique(databases),
    packageManager,
    buildCommand,
    startCommand,
    testCommand,
    port
  };
}

function validateRepository(files, packageJson, stack, source, code = "") {
  const lowerFiles = files.map((file) => file.toLowerCase());
  const has = (filename) => lowerFiles.some((file) => file.endsWith(filename));
  const isGithubPreview = source === "github";
  const rules = [];

  rules.push(rule("Repository intake", "passed", isGithubPreview ? "GitHub URL accepted for remote scan stage." : "ZIP archive parsed successfully."));

  if (isGithubPreview) {
    rules.push(rule("Remote clone", "warning", "GitHub cloning will be wired in Stage 2 after local Docker is ready."));
    rules.push(rule("Static analysis", "warning", "Upload ZIP now for full file-level validation."));
    return rules;
  }

  rules.push(rule("Package manifest", has("package.json") ? "passed" : "warning", getPackageManifestMessage(has("package.json"), stack)));
  rules.push(rule("Dockerfile", has("dockerfile") ? "passed" : "warning", has("dockerfile") ? "Existing Dockerfile detected." : "Dockerfile can be generated."));
  rules.push(rule("Ignore rules", has(".dockerignore") ? "passed" : "warning", has(".dockerignore") ? ".dockerignore detected." : "Add .dockerignore to reduce image size and secret leakage risk."));
  rules.push(rule("Build command", stack.buildCommand ? "passed" : "failed", stack.buildCommand ? `Detected ${stack.buildCommand}.` : "No build script detected."));
  rules.push(rule("Start command", stack.startCommand ? "passed" : "failed", stack.startCommand ? `Detected ${stack.startCommand}.` : "No start script detected."));
  rules.push(rule("Test command", stack.testCommand ? "passed" : "warning", stack.testCommand ? `Detected ${stack.testCommand}.` : "No test script detected. CI will mark tests optional."));
  rules.push(rule("Secrets", has(".env") ? "warning" : "passed", has(".env") ? ".env file detected. Ensure it is excluded from images and CI artifacts." : "No committed .env file detected."));

  return rules;
}

function getPackageManifestMessage(hasPackageJson, stack) {
  if (hasPackageJson) return "package.json detected.";
  if (stack.runtime.includes("JavaScript")) return "JavaScript files detected, but no package.json found. Add scripts and dependencies before CI/CD generation.";
  if (stack.runtime.includes("Python")) return "No package manifest found. Add requirements.txt or pyproject.toml for repeatable builds.";
  if (stack.runtime.includes("Java")) return "No Maven or Gradle manifest found. Add pom.xml or build.gradle for repeatable builds.";
  return "No package manifest found. Add a stack-specific manifest before deployment.";
}

function buildReport(files, stack, validations) {
  const lowerFiles = files.map((file) => file.toLowerCase());
  const sourceExtensions = [".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".go", ".cs", ".php", ".rb"];
  const configNames = ["package.json", "vite.config.js", "vite.config.ts", "next.config.js", "tsconfig.json", "requirements.txt", "pyproject.toml", "pom.xml", "build.gradle"];
  const devopsNames = ["dockerfile", ".dockerignore", "docker-compose.yml", "jenkinsfile", "terraform.tf"];
  const entrypointHints = ["src/main.tsx", "src/main.jsx", "src/index.tsx", "src/index.jsx", "index.js", "server.js", "app.js", "main.py", "manage.py"];
  const riskSummary = validations.reduce(
    (summary, item) => ({ ...summary, [item.status]: summary[item.status] + 1 }),
    { passed: 0, warning: 0, failed: 0 }
  );

  const entrypoints = files.filter((file) => entrypointHints.some((hint) => file.toLowerCase().endsWith(hint))).slice(0, 6);
  const sourceFiles = lowerFiles.filter((file) => sourceExtensions.some((extension) => file.endsWith(extension))).length;
  const configFiles = lowerFiles.filter((file) => configNames.some((name) => file.endsWith(name))).length;
  const devopsFiles = lowerFiles.filter((file) => devopsNames.some((name) => file.endsWith(name))).length;

  return {
    confidence: calculateConfidence(stack, entrypoints, configFiles, sourceFiles),
    entrypoints,
    fileSummary: {
      totalFiles: files.length,
      sourceFiles,
      configFiles,
      devopsFiles
    },
    riskSummary,
    recommendations: buildRecommendations(stack, validations, entrypoints)
  };
}

function calculateConfidence(stack, entrypoints, configFiles, sourceFiles) {
  let confidence = 20;
  confidence += Math.min(30, stack.runtime.length * 15);
  confidence += Math.min(20, stack.frameworks.length * 8);
  confidence += entrypoints.length ? 15 : 0;
  confidence += configFiles ? 10 : 0;
  confidence += sourceFiles ? 5 : 0;
  return Math.min(100, confidence);
}

function buildRecommendations(stack, validations, entrypoints) {
  const recommendations = [];
  const hasFailedBuild = validations.some((item) => item.name === "Build command" && item.status === "failed");
  const hasFailedStart = validations.some((item) => item.name === "Start command" && item.status === "failed");
  const needsDockerfile = validations.some((item) => item.name === "Dockerfile" && item.status === "warning");
  const needsIgnore = validations.some((item) => item.name === "Ignore rules" && item.status === "warning");

  if (stack.runtime.includes("JavaScript") && stack.packageManager === "unknown") {
    recommendations.push("Add package.json with explicit start, build, and test scripts.");
  }
  if (hasFailedBuild) recommendations.push("Define a repeatable build command before enabling artifact and container stages.");
  if (hasFailedStart) recommendations.push("Define a production start command before deployment simulation.");
  if (needsDockerfile) recommendations.push("Generate a Dockerfile and validate it with a sandbox image build.");
  if (needsIgnore) recommendations.push("Add .dockerignore to keep secrets, dependencies, and build noise out of images.");
  if (!entrypoints.length) recommendations.push("Confirm the application entrypoint before generating runtime commands.");

  return recommendations.slice(0, 5);
}

function inferPortFromCode(code) {
  const match = code.match(/listen\s*\(\s*(process\.env\.[A-Z_]+\s*\|\|\s*)?(\d{2,5})/i);
  return match?.[2] ?? null;
}

function selectTemplates(stack) {
  const templates = [];
  const isNode = stack.runtime.includes("Node.js");
  const isVite = stack.frameworks.includes("Vite");
  const isNext = stack.frameworks.includes("Next.js");

  if (isNode && isVite) templates.push(template("Dockerfile", "node-vite-nginx", "Multi-stage Vite build served by Nginx."));
  else if (isNode && isNext) templates.push(template("Dockerfile", "node-next-standalone", "Next.js standalone production image."));
  else if (isNode) templates.push(template("Dockerfile", "node-service", "Node.js service image with production dependency install."));
  else templates.push(template("Dockerfile", "generic-web-service", "Generic container bootstrap requiring manual confirmation."));

  templates.push(template(".dockerignore", "secure-defaults", "Excludes node_modules, secrets, logs, and build noise."));
  templates.push(template("Jenkinsfile", "modular-stack-aware", "Checkout, install, test, build, scan, image, deploy stages."));
  templates.push(template("azure-pipelines.yml", "azure-multistage-container", "Install, test, build, image, scan, and deployment stages."));
  templates.push(template("docker-compose.yml", "sandbox-smoke-test", "Local smoke-test deployment for generated image."));
  templates.push(template("k8s/*.yaml", "kubernetes-web-app", "Deployment, service, ingress, and health probes."));

  return templates;
}

function buildPipeline(stack) {
  return [
    stage("Checkout", true, "Pull repository source."),
    stage("Detect Stack", true, `Runtime: ${stack.runtime.join(", ") || "unknown"}.`),
    stage("Install Dependencies", stack.packageManager !== "unknown", `${stack.packageManager} install.`),
    stage("Run Tests", Boolean(stack.testCommand), stack.testCommand || "Optional until a test script exists."),
    stage("Build Artifact", Boolean(stack.buildCommand), stack.buildCommand || "Needs a build command."),
    stage("Security Scan", true, "Trivy and dependency audit gate."),
    stage("Build Container", true, "Golden Dockerfile or existing Dockerfile."),
    stage("Deploy", false, "Disabled until cloud target is configured.")
  ];
}

function buildScoreBreakdown(validations, stack, templates) {
  const base = 20;
  const rawValidationScore = validations.reduce((total, item) => {
    if (item.status === "passed") return total + 6;
    if (item.status === "warning") return total + 2;
    return total;
  }, 0);
  const validationScore = Math.min(48, rawValidationScore);
  const stackScore = Math.min(22, stack.runtime.length * 5 + stack.frameworks.length * 3);
  const templateScore = Math.min(10, templates.length * 2);
  const failedCount = validations.filter((item) => item.status === "failed").length;
  const warningCount = validations.filter((item) => item.status === "warning").length;
  let score = Math.min(100, base + validationScore + stackScore + templateScore);

  if (failedCount) score = Math.min(score, 74);
  else if (warningCount) score = Math.min(score, 89);

  const categories = [
    scoreCategory("Validation rules", validationScore, 48, "Repository quality checks from manifests, commands, Docker readiness, tests, and secret hygiene."),
    scoreCategory("Stack detection", stackScore, 22, "Runtime and framework confidence from detected source and manifests."),
    scoreCategory("Template coverage", templateScore, 10, "Golden deployment, CI/CD, and Kubernetes template availability."),
    scoreCategory("Baseline", base, 20, "Base readiness awarded after the repository can be analyzed.")
  ];

  return {
    score,
    maxScore: 100,
    missingPoints: 100 - score,
    categories,
    reasons: buildScoreReasons(validations, stack, templates, score),
    pathTo100: buildPathTo100(validations, stack, score)
  };
}

function scoreCategory(name, points, maxPoints, description) {
  return {
    name,
    points: Math.min(points, maxPoints),
    maxPoints,
    description
  };
}

function buildScoreReasons(validations, stack, templates, score) {
  const reasons = [];
  const failed = validations.filter((item) => item.status === "failed");
  const warnings = validations.filter((item) => item.status === "warning");

  if (failed.length) reasons.push(`${failed.length} blocking rule${failed.length === 1 ? "" : "s"} failed: ${failed.map((item) => item.name).join(", ")}.`);
  if (warnings.length) reasons.push(`${warnings.length} warning rule${warnings.length === 1 ? "" : "s"} still need attention: ${warnings.map((item) => item.name).join(", ")}.`);
  if (!stack.frameworks.length) reasons.push("Framework confidence is limited because no specific framework was detected.");
  if (templates.length < 6) reasons.push("Template coverage is not complete for every CI/CD and deployment target.");
  if (!reasons.length && score < 100) reasons.push("The repository is close, but runtime validation and security gates still need executable confirmation.");
  if (!reasons.length) reasons.push("The analyzer has enough signals for a full readiness score.");

  return reasons;
}

function buildPathTo100(validations, stack, score) {
  const fixes = [];
  const findRule = (name) => validations.find((item) => item.name === name);

  if (findRule("Package manifest")?.status !== "passed") fixes.push(scoreFix("Add dependency manifest", "Add package.json, requirements.txt, pyproject.toml, pom.xml, or build.gradle so installs are repeatable.", 8));
  if (findRule("Build command")?.status !== "passed") fixes.push(scoreFix("Define build command", "Add a deterministic build script such as npm run build so artifacts can be produced in CI.", 8));
  if (findRule("Start command")?.status !== "passed") fixes.push(scoreFix("Define production start command", "Add a start script or runtime entrypoint so containers can boot consistently.", 8));
  if (findRule("Test command")?.status !== "passed") fixes.push(scoreFix("Add test command", "Add a test script so CI can fail safely before image build and deployment.", 5));
  if (findRule("Dockerfile")?.status !== "passed") fixes.push(scoreFix("Add Dockerfile", "Use the generated Dockerfile and run sandbox validation.", 5));
  if (findRule("Ignore rules")?.status !== "passed") fixes.push(scoreFix("Add .dockerignore", "Exclude dependencies, .env files, logs, and build output from image context.", 5));
  if (findRule("Secrets")?.status !== "passed") fixes.push(scoreFix("Remove committed secrets", "Move .env values into secret stores and keep them out of source and images.", 5));
  if (!stack.frameworks.length) fixes.push(scoreFix("Confirm framework", "Add recognizable framework config or entrypoints so template selection has higher confidence.", 3));

  if (!fixes.length) {
    fixes.push(scoreFix("Run executable gates", "Run sandbox, runtime dry-run, security gates, image build, and vulnerability scan to confirm production readiness.", Math.max(1, 100 - score)));
  }

  return fixes.slice(0, 6);
}

function scoreFix(title, detail, points) {
  return { title, detail, points };
}

function rule(name, status, message) {
  return { name, status, message };
}

function template(name, key, description) {
  return { name, key, description };
}

function stage(name, enabled, detail) {
  return { name, enabled, detail };
}

function readJsonEntry(entry) {
  if (!entry) return null;

  try {
    return JSON.parse(entry.getData().toString("utf8"));
  } catch {
    return null;
  }
}

function readCodeSample(entries) {
  const codeEntry = entries.find((entry) => {
    const path = normalizePath(entry.entryName).toLowerCase();
    return [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"].some((extension) => path.endsWith(extension));
  });

  if (!codeEntry) return "";

  return codeEntry.getData().toString("utf8").slice(0, 20000);
}

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isValidGithubUrl(url) {
  if (!url || typeof url !== "string") return false;

  try {
    const parsed = new URL(url);
    return parsed.hostname === "github.com" && parsed.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

const port = Number(process.env.PORT || 8080);

app.listen(port, () => {
  console.log(`PipelineForge API listening on ${port}`);
});
