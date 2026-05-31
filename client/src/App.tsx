import {
  Activity,
  Boxes,
  CheckCircle2,
  Cloud,
  Code2,
  FileArchive,
  Github,
  GitPullRequestArrow,
  KeyRound,
  Layers3,
  LockKeyhole,
  LogIn,
  Mail,
  Play,
  Rocket,
  Settings2,
  ShieldCheck,
  UploadCloud,
  UserPlus,
  XCircle
} from "lucide-react";
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { Analysis, AutoFixResult, CloudPlan, RuleStatus, RuntimeToolchain, SandboxResult, SandboxStatus } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
type WorkflowStep = "source" | "analyze" | "validate" | "generate" | "infra" | "pipeline";
type GeneratedFile = Analysis["generatedFiles"][number];
type DeploymentInputs = {
  port: string;
  buildCommand: string;
  startCommand: string;
  testCommand: string;
  imageRegistry: string;
  domain: string;
  databaseUrl: string;
  tokenSecret: string;
  corsOrigin: string;
};

const emptyDeploymentInputs: DeploymentInputs = {
  port: "",
  buildCommand: "",
  startCommand: "",
  testCommand: "",
  imageRegistry: "",
  domain: "",
  databaseUrl: "",
  tokenSecret: "",
  corsOrigin: ""
};

function App() {
  const [mode, setMode] = useState<"github" | "upload">("github");
  const [activeStep, setActiveStep] = useState<WorkflowStep>("source");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [cloudProvider, setCloudProvider] = useState<"azure" | "aws">("azure");
  const [ciProvider, setCiProvider] = useState<"azure-pipelines" | "jenkins">("azure-pipelines");
  const [githubUrl, setGithubUrl] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [recentAnalyses, setRecentAnalyses] = useState<Analysis[]>([]);
  const [deploymentInputs, setDeploymentInputs] = useState<DeploymentInputs>(emptyDeploymentInputs);
  const [generatedFileOverrides, setGeneratedFileOverrides] = useState<Record<string, string>>({});
  const [sandboxResult, setSandboxResult] = useState<SandboxResult | null>(null);
  const [runtimeResult, setRuntimeResult] = useState<SandboxResult | null>(null);
  const [securityResult, setSecurityResult] = useState<SandboxResult | null>(null);
  const [autoFixResult, setAutoFixResult] = useState<AutoFixResult | null>(null);
  const [runtimeToolchain, setRuntimeToolchain] = useState<RuntimeToolchain | null>(null);
  const [isSandboxLoading, setIsSandboxLoading] = useState(false);
  const [isRuntimeLoading, setIsRuntimeLoading] = useState(false);
  const [isSecurityLoading, setIsSecurityLoading] = useState(false);
  const [isAutoFixLoading, setIsAutoFixLoading] = useState(false);
  const [isToolchainLoading, setIsToolchainLoading] = useState(false);
  const [isBundleLoading, setIsBundleLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentGeneratedFiles = analysis ? applyGeneratedOverrides(resolveGeneratedFiles(analysis, deploymentInputs), generatedFileOverrides) : [];

  useEffect(() => {
    let cancelled = false;

    async function loadProjectHistory() {
      try {
        const response = await fetch(`${API_BASE}/api/projects`);
        const records = await parseResponse(response) as Analysis[];
        if (!cancelled) {
          setRecentAnalyses(records.slice(0, 5));
        }
      } catch {
        if (!cancelled) {
          setRecentAnalyses([]);
        }
      }
    }

    void loadProjectHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  async function analyzeGithub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAnalysis(async () => {
      const response = await fetch(`${API_BASE}/api/analyze/github`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: githubUrl })
      });
      return parseResponse(response);
    });
  }

  async function analyzeUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!zipFile) {
      setError("Choose a ZIP file first.");
      return;
    }

    await runAnalysis(async () => {
      const body = new FormData();
      body.append("repo", zipFile);
      const response = await fetch(`${API_BASE}/api/analyze/upload`, {
        method: "POST",
        body
      });
      return parseResponse(response);
    });
  }

  async function runAnalysis(request: () => Promise<Analysis>) {
    setIsLoading(true);
    setError(null);

    try {
      const result = await request();
      setAnalysis(result);
      setRecentAnalyses((items) => [result, ...items.filter((item) => item.repoName !== result.repoName)].slice(0, 5));
      setDeploymentInputs(defaultDeploymentInputs(result));
      setGeneratedFileOverrides({});
      setSandboxResult(null);
      setRuntimeResult(null);
      setSecurityResult(null);
      setAutoFixResult(null);
      setActiveStep("analyze");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Analysis failed.");
    } finally {
      setIsLoading(false);
    }
  }

  function reopenAnalysis(item: Analysis) {
    setAnalysis(item);
    setDeploymentInputs(defaultDeploymentInputs(item));
    setGeneratedFileOverrides({});
    setSandboxResult(null);
    setRuntimeResult(null);
    setSecurityResult(null);
    setAutoFixResult(null);
    setActiveStep("analyze");
  }

  async function runSandboxValidation() {
    if (!analysis) return;

    setIsSandboxLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/sandbox/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoName: analysis.repoName,
          files: currentGeneratedFiles,
          deploymentInputs
        })
      });
      setSandboxResult(await parseResponse(response));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Sandbox validation failed.");
    } finally {
      setIsSandboxLoading(false);
    }
  }

  async function inspectRuntimeToolchain() {
    setIsToolchainLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/runtime/toolchain`);
      setRuntimeToolchain(await parseResponse(response));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Runtime inspection failed.");
    } finally {
      setIsToolchainLoading(false);
    }
  }

  async function runRuntimeDryRun() {
    if (!analysis) return;

    setIsRuntimeLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/sandbox/runtime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoName: analysis.repoName,
          files: currentGeneratedFiles
        })
      });
      setRuntimeResult(await parseResponse(response));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Runtime dry-run failed.");
    } finally {
      setIsRuntimeLoading(false);
    }
  }

  async function runSecurityGates() {
    if (!analysis) return;

    setIsSecurityLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/security/gates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoName: analysis.repoName,
          files: currentGeneratedFiles
        })
      });
      setSecurityResult(await parseResponse(response));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Security gate validation failed.");
    } finally {
      setIsSecurityLoading(false);
    }
  }

  async function previewAutoFixes() {
    if (!analysis) return;

    setIsAutoFixLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/autofix/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: currentGeneratedFiles })
      });
      setAutoFixResult(await parseResponse(response));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Auto-fix preview failed.");
    } finally {
      setIsAutoFixLoading(false);
    }
  }

  function applyAutoFixes() {
    if (!autoFixResult) return;

    setGeneratedFileOverrides(Object.fromEntries(autoFixResult.files.map((file) => [file.path, file.content])));
    setAutoFixResult(null);
    setSandboxResult(null);
    setRuntimeResult(null);
    setSecurityResult(null);
  }

  async function downloadReleaseBundle() {
    if (!analysis) return;

    setIsBundleLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/release-bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis,
          files: currentGeneratedFiles,
          deploymentInputs
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "Release bundle export failed." }));
        throw new Error(data.error ?? "Release bundle export failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeFileName(analysis.repoName)}-release-bundle.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Release bundle export failed.");
    } finally {
      setIsBundleLoading(false);
    }
  }

  if (!isAuthenticated) {
    return (
    <main className="shell">
      <section className="hero-band">
        <nav className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark">
              <GitPullRequestArrow size={22} />
            </div>
            <span>PipelineForge</span>
          </div>
          <div className="status-pill">
            <Activity size={16} />
            Phase 3 Config Actions
          </div>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <ShieldCheck size={16} />
              DevOps validation before deployment
            </div>
            <h1>Forge deployable pipelines from raw repositories.</h1>
            <p>
              Upload a repo or point to GitHub. PipelineForge detects the stack, validates risky gaps,
              generates deployment configs, and moves each decision through a controlled workflow.
            </p>
          </div>

          <AuthPanel
            authMode={authMode}
            isAuthenticated={isAuthenticated}
            onAuthModeChange={setAuthMode}
            onAuthenticate={() => {
              setIsAuthenticated(true);
              setActiveStep("source");
            }}
          />
        </div>
      </section>
    </main>
    );
  }

  return (
    <main className="shell">
      <nav className="topbar app-topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <GitPullRequestArrow size={22} />
          </div>
          <span>PipelineForge</span>
        </div>
        <div className="status-pill">
          <Activity size={16} />
          Workspace
        </div>
      </nav>
      <section className="workflow-shell">
        <WorkflowNav activeStep={activeStep} analysis={analysis} onChange={setActiveStep} />
        <ReadinessHeader analysis={analysis} />

        {activeStep === "source" ? (
          <section className="workspace-grid" id="repo-intake">
            <div className="panel intake-panel">
              <div className="panel-heading">
                <span className="panel-kicker">Repository intake</span>
                <h2>Choose a source</h2>
              </div>

              <div className="mode-switch" role="tablist" aria-label="Repository source">
                <button className={mode === "github" ? "active" : ""} onClick={() => setMode("github")} type="button">
                  <Github size={18} />
                  GitHub
                </button>
                <button className={mode === "upload" ? "active" : ""} onClick={() => setMode("upload")} type="button">
                  <FileArchive size={18} />
                  ZIP upload
                </button>
              </div>

              {mode === "github" ? (
                <form className="repo-form" onSubmit={analyzeGithub}>
                  <label htmlFor="githubUrl">GitHub repository URL</label>
                  <input
                    id="githubUrl"
                    placeholder="https://github.com/org/repository"
                    value={githubUrl}
                    onChange={(event) => setGithubUrl(event.target.value)}
                  />
                  <button className="primary-button full" disabled={isLoading} type="submit">
                    <Github size={18} />
                    {isLoading ? "Analyzing..." : "Analyze GitHub repo"}
                  </button>
                </form>
              ) : null}

              {mode === "upload" ? (
                <form className="repo-form" onSubmit={analyzeUpload}>
                  <label htmlFor="repoZip">Local repository ZIP</label>
                  <input id="repoZip" type="file" accept=".zip" onChange={(event) => setZipFile(event.target.files?.[0] ?? null)} />
                  <button className="primary-button full" disabled={isLoading} type="submit">
                    <UploadCloud size={18} />
                    {isLoading ? "Analyzing..." : "Analyze uploaded ZIP"}
                  </button>
                </form>
              ) : null}

              {error ? <div className="error-message">{error}</div> : null}
            </div>

            <div className="panel intake-guide">
              <span className="panel-kicker">Phase 2 focus</span>
              <h2>Controlled analysis before generation</h2>
              <p>PipelineForge now separates the workflow so each stage can be tested, trusted, and promoted independently.</p>
              <div className="checklist">
                <span><CheckCircle2 size={17} /> Stack detection</span>
                <span><CheckCircle2 size={17} /> Validation rules</span>
                <span><CheckCircle2 size={17} /> Generated config preview</span>
                <span><CheckCircle2 size={17} /> Jenkins stage readiness</span>
              </div>
              <RecentAnalyses analyses={recentAnalyses} onReopen={reopenAnalysis} />
            </div>
          </section>
        ) : null}

        {activeStep === "analyze" ? <AnalysisReport analysis={analysis} onNavigate={setActiveStep} /> : null}
        {activeStep === "validate" ? (
          <ValidationView
            analysis={analysis}
            autoFixResult={autoFixResult}
            deploymentInputs={deploymentInputs}
            generatedFiles={currentGeneratedFiles}
            isAutoFixLoading={isAutoFixLoading}
            isSandboxLoading={isSandboxLoading}
            isRuntimeLoading={isRuntimeLoading}
            isSecurityLoading={isSecurityLoading}
            isToolchainLoading={isToolchainLoading}
            onApplyAutoFixes={applyAutoFixes}
            onDeploymentInputsChange={setDeploymentInputs}
            onInspectToolchain={inspectRuntimeToolchain}
            onPreviewAutoFixes={previewAutoFixes}
            onRunRuntime={runRuntimeDryRun}
            onRunSandbox={runSandboxValidation}
            onRunSecurity={runSecurityGates}
            runtimeResult={runtimeResult}
            runtimeToolchain={runtimeToolchain}
            sandboxResult={sandboxResult}
            securityResult={securityResult}
          />
        ) : null}
        {activeStep === "generate" ? (
          <GenerationView analysis={analysis} generatedFiles={currentGeneratedFiles} isBundleLoading={isBundleLoading} onDownloadBundle={downloadReleaseBundle} />
        ) : null}
        {activeStep === "infra" ? <InfraView analysis={analysis} cloudProvider={cloudProvider} onCloudProviderChange={setCloudProvider} /> : null}
        {activeStep === "pipeline" ? <PipelineView analysis={analysis} ciProvider={ciProvider} onCiProviderChange={setCiProvider} /> : null}
      </section>
    </main>
  );
}

function AuthPanel({
  authMode,
  isAuthenticated,
  onAuthModeChange,
  onAuthenticate
}: {
  authMode: "login" | "signup";
  isAuthenticated: boolean;
  onAuthModeChange: (mode: "login" | "signup") => void;
  onAuthenticate: () => void;
}) {
  function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAuthenticate();
  }

  return (
    <div className="auth-panel" aria-label="Account access">
      <div className="auth-tabs">
        <button className={authMode === "login" ? "active" : ""} onClick={() => onAuthModeChange("login")} type="button">
          <LogIn size={17} />
          Log in
        </button>
        <button className={authMode === "signup" ? "active" : ""} onClick={() => onAuthModeChange("signup")} type="button">
          <UserPlus size={17} />
          Sign up
        </button>
      </div>

      <div className="panel-heading">
        <span className="panel-kicker">{isAuthenticated ? "Session ready" : "Secure workspace"}</span>
        <h2>{authMode === "login" ? "Access PipelineForge" : "Create your workspace"}</h2>
      </div>

      <form className="repo-form auth-form" onSubmit={submitAuth}>
        {authMode === "signup" ? (
          <>
            <label htmlFor="name">Full name</label>
            <input id="name" autoComplete="name" placeholder="Alex Morgan" />
          </>
        ) : null}
        <label htmlFor="email">Email</label>
        <div className="input-icon">
          <Mail size={17} />
          <input id="email" autoComplete="email" placeholder="you@company.com" type="email" />
        </div>
        <label htmlFor="password">Password</label>
        <div className="input-icon">
          <KeyRound size={17} />
          <input id="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} placeholder="••••••••" type="password" />
        </div>
        <button className="primary-button full" type="submit">
          {authMode === "login" ? <LogIn size={18} /> : <UserPlus size={18} />}
          {authMode === "login" ? "Continue" : "Create account"}
        </button>
      </form>

      <button className="ghost-button full" type="button" onClick={onAuthenticate}>
        <Github size={18} />
        Continue with GitHub
      </button>
    </div>
  );
}

function WorkflowNav({ activeStep, analysis, onChange }: { activeStep: WorkflowStep; analysis: Analysis | null; onChange: (step: WorkflowStep) => void }) {
  const steps: Array<{ id: WorkflowStep; label: string; enabled: boolean }> = [
    { id: "source", label: "Source", enabled: true },
    { id: "analyze", label: "Analyze", enabled: Boolean(analysis) },
    { id: "validate", label: "Validate", enabled: Boolean(analysis) },
    { id: "generate", label: "Generate", enabled: Boolean(analysis) },
    { id: "infra", label: "Infra", enabled: Boolean(analysis) },
    { id: "pipeline", label: "Pipeline", enabled: Boolean(analysis) }
  ];

  return (
    <div className="workflow-nav" aria-label="PipelineForge workflow">
      {steps.map((step, index) => (
        <button
          className={activeStep === step.id ? "active" : ""}
          disabled={!step.enabled}
          key={step.id}
          onClick={() => onChange(step.id)}
          type="button"
        >
          <span>{index + 1}</span>
          {step.label}
        </button>
      ))}
    </div>
  );
}

function ReadinessHeader({ analysis }: { analysis: Analysis | null }) {
  return (
    <div className="readiness-bar">
      <div className="score-ring compact" style={{ "--score": `${analysis?.score ?? 0}%` } as CSSProperties}>
        <div>
          <strong>{analysis?.score ?? "--"}</strong>
          <span>score</span>
        </div>
      </div>
      <div>
        <span className="panel-kicker">Production readiness</span>
        <h2>{analysis?.repoName ?? "No repository analyzed yet"}</h2>
      </div>
      <Metric icon={<Boxes size={20} />} label="Templates" value={analysis?.templates.length.toString() ?? "Pending"} />
      <Metric icon={<ShieldCheck size={20} />} label="Rules" value={analysis?.validations.length.toString() ?? "Pending"} />
    </div>
  );
}

function FocusedPanel({ kicker, title, children, className = "" }: { kicker: string; title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`panel focused-panel ${className}`}>
      <div className="panel-heading">
        <span className="panel-kicker">{kicker}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function RecentAnalyses({ analyses, onReopen }: { analyses: Analysis[]; onReopen: (analysis: Analysis) => void }) {
  if (!analyses.length) return null;

  return (
    <div className="recent-analyses">
      <strong>Recent analyses</strong>
      {analyses.map((item) => (
        <button key={`${item.repoName}-${item.generatedAt}`} type="button" onClick={() => onReopen(item)}>
          <span>{item.repoName}</span>
          <em>{item.score}/100</em>
        </button>
      ))}
    </div>
  );
}

function AnalysisReport({ analysis, onNavigate }: { analysis: Analysis | null; onNavigate: (step: WorkflowStep) => void }) {
  if (!analysis) return <EmptyState />;

  return (
    <div className="results-grid">
      <ForgeRunnerConsole analysis={analysis} />
      <FocusedPanel kicker="Detected stack" title="Runtime intelligence">
        <StackDetails analysis={analysis} />
      </FocusedPanel>
      <FocusedPanel kicker="Analyzer report" title="Repository profile">
        <div className="detail-list">
          <div><span>Confidence</span><strong>{analysis.report.confidence}%</strong></div>
          <div><span>Total files</span><strong>{analysis.report.fileSummary.totalFiles}</strong></div>
          <div><span>Source files</span><strong>{analysis.report.fileSummary.sourceFiles}</strong></div>
          <div><span>Config files</span><strong>{analysis.report.fileSummary.configFiles}</strong></div>
          <div><span>DevOps files</span><strong>{analysis.report.fileSummary.devopsFiles}</strong></div>
        </div>
      </FocusedPanel>
      <FocusedPanel kicker="Readiness score" title="Readiness score breakdown">
        <ScoreExplanation analysis={analysis} />
      </FocusedPanel>
      <FocusedPanel kicker="Promotion decision" title={analysis.promotionDecision?.title ?? "Release decision"}>
        <PromotionDecision analysis={analysis} />
      </FocusedPanel>
      <FocusedPanel kicker="Release actions" title="Next gated work">
        <ReleaseActionQueue analysis={analysis} onNavigate={onNavigate} />
      </FocusedPanel>
      <FocusedPanel kicker="Readiness report" title="Export decision summary">
        <ReadinessReport analysis={analysis} />
      </FocusedPanel>
      <FocusedPanel kicker="Entrypoints" title="Application launch hints">
        <div className="template-list">
          {(analysis.report.entrypoints.length ? analysis.report.entrypoints : ["No entrypoint confirmed yet."]).map((entrypoint) => (
            <div key={entrypoint}>
              <strong>{entrypoint}</strong>
              <span>{analysis.report.entrypoints.length ? "Detected from repository structure." : "PipelineForge will require confirmation before deployment."}</span>
            </div>
          ))}
        </div>
      </FocusedPanel>
      <FocusedPanel kicker="Recommendations" title="Next production fixes">
        <RecommendationList recommendations={analysis.report.recommendations} onNavigate={onNavigate} />
      </FocusedPanel>
    </div>
  );
}

function ReleaseActionQueue({ analysis, onNavigate }: { analysis: Analysis; onNavigate: (step: WorkflowStep) => void }) {
  const actions = buildReleaseActions(analysis);

  return (
    <div className="action-queue">
      {actions.map((action) => (
        <div className="action-item" key={`${action.title}-${action.stage}`}>
          <div>
            <strong>{action.title}</strong>
            <span>{action.detail}</span>
          </div>
          <button className="ghost-button" type="button" onClick={() => onNavigate(action.stage)}>
            Open {stageLabel(action.stage)}
          </button>
        </div>
      ))}
    </div>
  );
}

function buildReleaseActions(analysis: Analysis) {
  const actions: Array<{ title: string; detail: string; stage: WorkflowStep }> = [];
  const failedRules = analysis.validations.filter((rule) => rule.status === "failed");
  const warningRules = analysis.validations.filter((rule) => rule.status === "warning");
  const missingGeneratedInputs = analysis.generatedFiles.filter((file) => file.status === "needs-input");

  failedRules.forEach((rule) => {
    actions.push({
      title: `Fix ${rule.name}`,
      detail: rule.message,
      stage: stageForValidation(rule.name)
    });
  });

  if (analysis.promotionDecision?.status === "blocked" && !failedRules.length) {
    actions.push({
      title: "Raise readiness threshold",
      detail: analysis.promotionDecision.message,
      stage: "validate"
    });
  }

  if (missingGeneratedInputs.length) {
    actions.push({
      title: "Resolve generated config inputs",
      detail: `${missingGeneratedInputs.length} file${missingGeneratedInputs.length === 1 ? "" : "s"} still need deployment values before sandbox checks.`,
      stage: "validate"
    });
  }

  warningRules.slice(0, 3).forEach((rule) => {
    actions.push({
      title: `Review ${rule.name}`,
      detail: rule.message,
      stage: stageForValidation(rule.name)
    });
  });

  if (!actions.length) {
    actions.push({
      title: "Run executable validation gates",
      detail: "Continue with sandbox checks, runtime dry-runs, and security gates before cloud deployment.",
      stage: "validate"
    });
  }

  return actions.slice(0, 5);
}

function stageForValidation(name: string): WorkflowStep {
  if (name.includes("Package") || name.includes("Build") || name.includes("Start") || name.includes("Test")) return "source";
  if (name.includes("Dockerfile") || name.includes("Ignore")) return "generate";
  if (name.includes("Secrets")) return "validate";
  return "validate";
}

function stageLabel(stage: WorkflowStep) {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

function ScoreExplanation({ analysis }: { analysis: Analysis }) {
  const scoreBreakdown = getScoreBreakdown(analysis);
  const isComplete = scoreBreakdown.missingPoints === 0;

  return (
    <div className="score-explanation">
      <div className="score-loss">
        <strong>{scoreBreakdown.missingPoints}</strong>
        <span>{isComplete ? "all analyzer scoring criteria satisfied" : "points remaining to reach production-ready confidence"}</span>
      </div>
      <div className="score-categories">
        {scoreBreakdown.categories.map((category) => (
          <div key={category.name}>
            <div>
              <strong>{category.name}</strong>
              <span>{Math.min(category.points, category.maxPoints)}/{category.maxPoints}</span>
            </div>
            <progress value={Math.min(category.points, category.maxPoints)} max={category.maxPoints} />
            <p>{category.description}</p>
          </div>
        ))}
      </div>
      <div className="score-reasons">
        <strong>{isComplete ? "Score confirmation" : "Readiness constraints"}</strong>
        {scoreBreakdown.reasons.map((reason) => (
          <span key={reason}>{reason}</span>
        ))}
      </div>
      <div className="score-fixes">
        <strong>{isComplete ? "Next assurance gates" : "Path to 100"}</strong>
        {scoreBreakdown.pathTo100.map((fix) => (
          <div key={fix.title}>
            <span>{fix.title}</span>
            <em>+{fix.points}</em>
            <p>{fix.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PromotionDecision({ analysis }: { analysis: Analysis }) {
  const decision = analysis.promotionDecision ?? getPromotionDecision(analysis);
  const badgeClass = decision.status === "ready" ? "ready" : decision.status === "blocked" ? "blocked" : "needs-input";

  return (
    <div className="promotion-decision">
      <div className="decision-summary">
        <div>
          <strong>{decision.title}</strong>
          <span>{decision.message}</span>
        </div>
        <em className={`review-badge ${badgeClass}`}>{decision.status}</em>
      </div>
      <div className="rule-list">
        {decision.gates.map((gate) => (
          <div className="rule-row" key={gate.name}>
            {gate.status === "passed" ? statusIcon("passed") : gate.status === "blocked" ? statusIcon("failed") : statusIcon("warning")}
            <div>
              <strong>{gate.name}</strong>
              <span>{gate.message}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadinessReport({ analysis }: { analysis: Analysis }) {
  const report = buildReadinessReport(analysis);
  const decision = analysis.promotionDecision ?? getPromotionDecision(analysis);

  return (
    <div className="readiness-report">
      <div className="report-preview">
        <strong>{analysis.repoName}</strong>
        <span>{analysis.score}/100 readiness score</span>
        <p>{decision.title}: {decision.message}</p>
      </div>
      <div className="report-actions">
        <button className="ghost-button" type="button" onClick={() => downloadGeneratedFile(`${safeFileName(analysis.repoName)}-readiness-report.md`, report.markdown)}>
          Download Markdown
        </button>
        <button className="ghost-button" type="button" onClick={() => downloadGeneratedFile(`${safeFileName(analysis.repoName)}-readiness-report.json`, report.json)}>
          Download JSON
        </button>
      </div>
    </div>
  );
}

function buildReadinessReport(analysis: Analysis) {
  const scoreBreakdown = getScoreBreakdown(analysis);
  const markdown = [
    `# PipelineForge Readiness Report`,
    "",
    `Repository: ${analysis.repoName}`,
    `Source: ${analysis.source}`,
    `Score: ${analysis.score}/${scoreBreakdown.maxScore}`,
    `Generated: ${new Date(analysis.generatedAt).toLocaleString()}`,
    "",
    "## Detected Stack",
    `- Runtime: ${analysis.stack.runtime.join(", ") || "Unknown"}`,
    `- Frameworks: ${analysis.stack.frameworks.join(", ") || "Unknown"}`,
    `- Package manager: ${analysis.stack.packageManager}`,
    `- Build command: ${analysis.stack.buildCommand ?? "Missing"}`,
    `- Start command: ${analysis.stack.startCommand ?? "Missing"}`,
    `- Port: ${analysis.stack.port}`,
    "",
    "## Readiness Constraints",
    ...scoreBreakdown.reasons.map((reason) => `- ${reason}`),
    "",
    "## Production Readiness Path",
    ...scoreBreakdown.pathTo100.map((fix) => `- ${fix.title} (+${fix.points}): ${fix.detail}`),
    "",
    "## Validation Rules",
    ...analysis.validations.map((rule) => `- ${rule.status.toUpperCase()} - ${rule.name}: ${rule.message}`),
    "",
    "## Generated Assets",
    ...analysis.generatedFiles.map((file) => `- ${file.path}: ${file.status}`)
  ].join("\n");

  return {
    markdown,
    json: JSON.stringify(
      {
        repoName: analysis.repoName,
        source: analysis.source,
        score: analysis.score,
        scoreBreakdown,
        promotionDecision: analysis.promotionDecision ?? getPromotionDecision(analysis),
        stack: analysis.stack,
        validations: analysis.validations,
        generatedFiles: analysis.generatedFiles.map(({ path, purpose, status }) => ({ path, purpose, status })),
        generatedAt: analysis.generatedAt
      },
      null,
      2
    )
  };
}

function safeFileName(name: string) {
  return name.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "") || "pipelineforge";
}

function getScoreBreakdown(analysis: Analysis): Analysis["scoreBreakdown"] {
  if (analysis.scoreBreakdown) return analysis.scoreBreakdown;

  const warningNames = analysis.validations.filter((item) => item.status === "warning").map((item) => item.name);
  const failedNames = analysis.validations.filter((item) => item.status === "failed").map((item) => item.name);
  const missingPoints = Math.max(0, 100 - analysis.score);
  const reasons = [
    failedNames.length ? `${failedNames.length} blocking rule${failedNames.length === 1 ? "" : "s"} failed: ${failedNames.join(", ")}.` : "",
    warningNames.length ? `${warningNames.length} warning rule${warningNames.length === 1 ? "" : "s"} still need attention: ${warningNames.join(", ")}.` : "",
    !failedNames.length && !warningNames.length ? "Run executable sandbox, runtime, and security gates to confirm production readiness." : ""
  ].filter(Boolean);

  return {
    score: analysis.score,
    maxScore: 100,
    missingPoints,
    categories: [
      {
        name: "Validation rules",
        points: Math.max(0, analysis.score - 32),
        maxPoints: 48,
        description: "Repository quality checks from manifests, commands, Docker readiness, tests, and secret hygiene."
      },
      {
        name: "Stack detection",
        points: Math.min(22, analysis.stack.runtime.length * 5 + analysis.stack.frameworks.length * 3),
        maxPoints: 22,
        description: "Runtime and framework confidence from detected source and manifests."
      },
      {
        name: "Template coverage",
        points: Math.min(10, analysis.templates.length * 2),
        maxPoints: 10,
        description: "Golden deployment, CI/CD, and Kubernetes template availability."
      },
      {
        name: "Baseline",
        points: 20,
        maxPoints: 20,
        description: "Base readiness awarded after the repository can be analyzed."
      }
    ],
    reasons,
    pathTo100: analysis.report.recommendations.length
      ? analysis.report.recommendations.map((item) => ({ title: item, detail: item, points: 5 }))
      : [{ title: "Run validation gates", detail: "Run sandbox, runtime dry-run, security gates, and auto-fix checks.", points: Math.max(1, missingPoints) }]
  };
}

function getPromotionDecision(analysis: Analysis): Analysis["promotionDecision"] {
  const scoreBreakdown = getScoreBreakdown(analysis);
  const failed = analysis.validations.filter((item) => item.status === "failed");
  const warnings = analysis.validations.filter((item) => item.status === "warning");
  const hasScoreRisk = scoreBreakdown.score < 85;
  const status = failed.length || hasScoreRisk ? "blocked" : warnings.length ? "review" : "ready";
  const title = status === "blocked" ? "Blocked before production" : status === "review" ? "Needs engineering review" : "Ready for controlled promotion";
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
      {
        name: "Blocking rules",
        status: failed.length ? "blocked" : "passed",
        message: failed.length ? `${failed.length} blocking rule${failed.length === 1 ? "" : "s"} failed.` : "No blocking analyzer rules failed."
      },
      {
        name: "Readiness threshold",
        status: scoreBreakdown.score >= 85 ? "passed" : "blocked",
        message: `${scoreBreakdown.score}/100 readiness score. Minimum release review threshold is 85.`
      },
      {
        name: "Warning review",
        status: warnings.length ? "warning" : "passed",
        message: warnings.length ? `${warnings.length} warning rule${warnings.length === 1 ? "" : "s"} require review.` : "No analyzer warnings remain."
      }
    ]
  };
}

function ForgeRunnerConsole({ analysis }: { analysis: Analysis }) {
  const stack = [...analysis.stack.runtime, ...analysis.stack.frameworks].join(" + ") || "Unknown";

  return (
    <div className="ops-console" aria-label="Pipeline preview">
      <div className="console-header">
        <span />
        <span />
        <span />
        <strong>forge-runner</strong>
      </div>
      <div className="console-body">
        <ConsoleRow icon={<Code2 size={17} />} label="Stack" value={stack} />
        <ConsoleRow icon={<Layers3 size={17} />} label="Blueprint" value={analysis.templates[0]?.key ?? "pending"} />
        <ConsoleRow icon={<ShieldCheck size={17} />} label="Validation" value={`${analysis.validations.length} rules evaluated`} />
        <ConsoleRow icon={<Cloud size={17} />} label="Cloud" value="target awaiting selection" />
      </div>
    </div>
  );
}

function ConsoleRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="console-row">
      <div>
        {icon}
        <span>{label}</span>
      </div>
      <code>{value}</code>
    </div>
  );
}

function RecommendationList({ recommendations, onNavigate }: { recommendations: string[]; onNavigate: (step: WorkflowStep) => void }) {
  return (
    <div className="template-list">
      {recommendations.map((item) => (
        <div className="recommendation-row" key={item}>
          <strong>{item}</strong>
          <span>{recommendationTarget(item)}</span>
          <button className="ghost-button" type="button" onClick={() => onNavigate(recommendationStep(item))}>
            Open stage
          </button>
        </div>
      ))}
    </div>
  );
}

function recommendationTarget(item: string) {
  if (item.includes("Dockerfile") || item.includes(".dockerignore")) return "Review in Generate.";
  if (item.includes("start") || item.includes("build") || item.includes("package.json")) return "Fix in source repo, then re-analyze.";
  if (item.includes("entrypoint")) return "Confirm before Pipeline and Infra.";
  return "Review before sandbox validation.";
}

function recommendationStep(item: string): WorkflowStep {
  if (item.includes("Dockerfile") || item.includes(".dockerignore")) return "generate";
  if (item.includes("entrypoint")) return "pipeline";
  if (item.includes("start") || item.includes("build") || item.includes("package.json")) return "source";
  return "validate";
}

function GenerationView({
  analysis,
  generatedFiles,
  isBundleLoading,
  onDownloadBundle
}: {
  analysis: Analysis | null;
  generatedFiles: GeneratedFile[];
  isBundleLoading: boolean;
  onDownloadBundle: () => void;
}) {
  const readyCount = generatedFiles.filter((file) => file.status === "ready").length;
  const needsInputCount = generatedFiles.filter((file) => file.status === "needs-input").length;

  return (
    <div className="results-grid paired-grid">
      <FocusedPanel kicker="Generated configs" title="Preview and export">
        <div className="resolution-summary">
          <Metric icon={<CheckCircle2 size={20} />} label="Ready files" value={`${readyCount}/${generatedFiles.length}`} />
          <Metric icon={<Settings2 size={20} />} label="Needs input" value={needsInputCount.toString()} />
        </div>
        <p className="panel-note">Resolve production inputs in Validate, then return here to preview and export deployable files.</p>
        <div className="release-bundle-card">
          <div>
            <strong>Release bundle</strong>
            <span>Download generated files, readiness report, manifest, and redacted deployment inputs as one ZIP package.</span>
          </div>
          <button className="primary-button" type="button" disabled={!analysis || !generatedFiles.length || isBundleLoading} onClick={onDownloadBundle}>
            {isBundleLoading ? "Packaging..." : "Download bundle"}
          </button>
        </div>
        <GeneratedFiles files={generatedFiles} />
      </FocusedPanel>
      <FocusedPanel kicker="Blueprint plan" title="Why these files were selected">
        <TemplateList analysis={analysis} />
      </FocusedPanel>
    </div>
  );
}

function DeploymentInputsPanel({
  analysis,
  inputs,
  onChange
}: {
  analysis: Analysis | null;
  inputs: DeploymentInputs;
  onChange: (inputs: DeploymentInputs) => void;
}) {
  const updateInput = (key: keyof DeploymentInputs, value: string) => onChange({ ...inputs, [key]: value });

  return (
    <div className="deployment-inputs">
      <div className="input-grid">
        <label>
          <span>App port</span>
          <input value={inputs.port} placeholder="3000" onChange={(event) => updateInput("port", event.target.value)} />
        </label>
        <label>
          <span>Image registry</span>
          <input
            value={inputs.imageRegistry}
            placeholder="123456789.dkr.ecr.ap-south-1.amazonaws.com"
            onChange={(event) => updateInput("imageRegistry", event.target.value)}
          />
        </label>
        <label>
          <span>Build command</span>
          <input value={inputs.buildCommand} placeholder="npm run build" onChange={(event) => updateInput("buildCommand", event.target.value)} />
        </label>
        <label>
          <span>Start command</span>
          <input value={inputs.startCommand} placeholder="npm run start" onChange={(event) => updateInput("startCommand", event.target.value)} />
        </label>
        <label>
          <span>Test command</span>
          <input value={inputs.testCommand} placeholder="npm test" onChange={(event) => updateInput("testCommand", event.target.value)} />
        </label>
        <label>
          <span>Public domain</span>
          <input value={inputs.domain} placeholder="app.company.com" onChange={(event) => updateInput("domain", event.target.value)} />
        </label>
        <label>
          <span>Database URL</span>
          <input value={inputs.databaseUrl} placeholder="postgres://user:pass@host:5432/db" onChange={(event) => updateInput("databaseUrl", event.target.value)} />
        </label>
        <label>
          <span>Token secret</span>
          <input value={inputs.tokenSecret} placeholder="secret-store reference" onChange={(event) => updateInput("tokenSecret", event.target.value)} />
        </label>
        <label>
          <span>CORS origin</span>
          <input value={inputs.corsOrigin} placeholder="https://app.company.com" onChange={(event) => updateInput("corsOrigin", event.target.value)} />
        </label>
      </div>
      <div className="resolution-list">
        <span className={inputs.port ? "resolved" : ""}>Port mapping</span>
        <span className={inputs.imageRegistry ? "resolved" : ""}>Container registry</span>
        <span className={inputs.domain ? "resolved" : ""}>Ingress host</span>
        <span className={inputs.databaseUrl ? "resolved" : ""}>Database secret</span>
        <span className={inputs.tokenSecret ? "resolved" : ""}>Token secret</span>
        <span className={inputs.corsOrigin ? "resolved" : ""}>CORS origin</span>
        <span className={analysis?.stack.startCommand || inputs.startCommand ? "resolved" : ""}>Runtime start command</span>
      </div>
    </div>
  );
}

function ValidationView({
  analysis,
  autoFixResult,
  deploymentInputs,
  generatedFiles,
  isAutoFixLoading,
  isRuntimeLoading,
  isSandboxLoading,
  isSecurityLoading,
  isToolchainLoading,
  onApplyAutoFixes,
  onDeploymentInputsChange,
  onInspectToolchain,
  onPreviewAutoFixes,
  onRunRuntime,
  onRunSandbox,
  onRunSecurity,
  runtimeResult,
  runtimeToolchain,
  sandboxResult,
  securityResult
}: {
  analysis: Analysis | null;
  autoFixResult: AutoFixResult | null;
  deploymentInputs: DeploymentInputs;
  generatedFiles: GeneratedFile[];
  isAutoFixLoading: boolean;
  isRuntimeLoading: boolean;
  isSandboxLoading: boolean;
  isSecurityLoading: boolean;
  isToolchainLoading: boolean;
  onApplyAutoFixes: () => void;
  onDeploymentInputsChange: (inputs: DeploymentInputs) => void;
  onInspectToolchain: () => void;
  onPreviewAutoFixes: () => void;
  onRunRuntime: () => void;
  onRunSandbox: () => void;
  onRunSecurity: () => void;
  runtimeResult: SandboxResult | null;
  runtimeToolchain: RuntimeToolchain | null;
  sandboxResult: SandboxResult | null;
  securityResult: SandboxResult | null;
}) {
  if (!analysis) return <EmptyState />;

  const unresolvedFiles = generatedFiles.filter((file) => file.status !== "ready");
  const unresolvedCount = unresolvedFiles.length;
  const readyCount = generatedFiles.length - unresolvedCount;

  return (
    <div className="results-grid paired-grid">
      <FocusedPanel kicker="Validation engine" title="Rule outcomes">
        <RuleList analysis={analysis} />
      </FocusedPanel>
      <FocusedPanel kicker="Preflight gates" title={analysis.preflight.status === "ready" ? "Ready for sandbox" : "Blocked before execution"}>
        <div className="rule-list">
          {analysis.preflight.gates.map((gate) => (
            <div className="rule-row" key={gate.name}>
              {gateIcon(gate.status)}
              <div>
                <strong>{gate.name}</strong>
                <span>{gate.message}</span>
              </div>
            </div>
          ))}
        </div>
      </FocusedPanel>
      <FocusedPanel kicker="Sandbox validation" title="Generated config execution check" className="wide-panel">
        <div className="validation-command-grid">
          <div className="validation-stack">
            <RuntimeToolchainPanel isLoading={isToolchainLoading} onInspect={onInspectToolchain} toolchain={runtimeToolchain} />
            <div className="validation-input-card">
              <div className="validation-input-heading">
                <div>
                  <strong>Required deployment inputs</strong>
                  <span>Complete these values here, then run sandbox checks without leaving Validate.</span>
                </div>
                <em className={`review-badge ${unresolvedCount ? "needs-input" : "ready"}`}>
                  {readyCount}/{generatedFiles.length} ready
                </em>
              </div>
              <DeploymentInputsPanel analysis={analysis} inputs={deploymentInputs} onChange={onDeploymentInputsChange} />
            </div>
            {unresolvedCount ? <MissingGeneratedInputs files={unresolvedFiles} /> : null}
          </div>
          <div className="validation-stack">
            <div className="sandbox-actions">
              <div>
                <p>
                  Run deterministic checks against the resolved generated files before Docker or cloud execution is allowed.
                </p>
                <span>{unresolvedCount ? `${unresolvedCount} generated files still need input.` : "All generated files are ready for sandbox checks."}</span>
              </div>
              <button className="primary-button" type="button" disabled={isSandboxLoading || unresolvedCount > 0} onClick={onRunSandbox}>
                <Play size={17} />
                {isSandboxLoading ? "Running..." : "Run sandbox checks"}
              </button>
            </div>
            <SandboxResultView result={sandboxResult} />
            <RuntimeDryRunPanel
              disabled={isRuntimeLoading || unresolvedCount > 0 || !sandboxResult || sandboxResult.status === "blocked"}
              disabledReason={validationGateReason(unresolvedCount, sandboxResult)}
              isLoading={isRuntimeLoading}
              onRun={onRunRuntime}
              result={runtimeResult}
            />
            <SecurityGatePanel
              autoFixResult={autoFixResult}
              disabled={isSecurityLoading || unresolvedCount > 0 || !sandboxResult || sandboxResult.status === "blocked"}
              disabledReason={validationGateReason(unresolvedCount, sandboxResult)}
              isAutoFixLoading={isAutoFixLoading}
              isLoading={isSecurityLoading}
              onApplyAutoFixes={onApplyAutoFixes}
              onPreviewAutoFixes={onPreviewAutoFixes}
              onRun={onRunSecurity}
              result={securityResult}
            />
            <ValidationEvidenceBundle
              generatedFiles={generatedFiles}
              runtimeResult={runtimeResult}
              sandboxResult={sandboxResult}
              securityResult={securityResult}
            />
          </div>
        </div>
      </FocusedPanel>
    </div>
  );
}

function validationGateReason(unresolvedCount: number, sandboxResult: SandboxResult | null) {
  if (unresolvedCount > 0) return `${unresolvedCount} generated file${unresolvedCount === 1 ? "" : "s"} still need input.`;
  if (!sandboxResult) return "Run sandbox checks first.";
  if (sandboxResult.status === "blocked") return "Fix blocked sandbox checks first.";
  return null;
}

function ValidationEvidenceBundle({
  generatedFiles,
  runtimeResult,
  sandboxResult,
  securityResult
}: {
  generatedFiles: GeneratedFile[];
  runtimeResult: SandboxResult | null;
  sandboxResult: SandboxResult | null;
  securityResult: SandboxResult | null;
}) {
  const unresolvedCount = generatedFiles.filter((file) => file.status !== "ready").length;
  const items = [
    evidenceItem("Config resolution", unresolvedCount ? "warning" : "passed", unresolvedCount ? `${unresolvedCount} files need input.` : "All generated files are resolved."),
    evidenceItem("Sandbox checks", sandboxResult?.status === "ready" ? "passed" : sandboxResult?.status === "blocked" ? "failed" : "warning", sandboxResult ? `${sandboxResult.summary.passed} passed, ${sandboxResult.summary.failed} failed.` : "Static sandbox checks are pending."),
    evidenceItem("Runtime dry-runs", runtimeResult?.status === "ready" ? "passed" : runtimeResult?.status === "blocked" ? "failed" : "warning", runtimeResult ? `${runtimeResult.summary.passed} passed, ${runtimeResult.summary.skipped} skipped.` : "Runtime dry-runs are pending."),
    evidenceItem("Security gates", securityResult?.status === "ready" ? "passed" : securityResult?.status === "blocked" ? "failed" : "warning", securityResult ? `${securityResult.summary.passed} passed, ${securityResult.summary.warning} warnings.` : "Security gate evidence is pending.")
  ];

  return (
    <div className="evidence-bundle">
      <div>
        <strong>Validation evidence bundle</strong>
        <span>Release proof collected before cloud deployment unlocks.</span>
      </div>
      <div className="evidence-list">
        {items.map((item) => (
          <div key={item.name}>
            {statusIcon(item.status)}
            <div>
              <strong>{item.name}</strong>
              <span>{item.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function evidenceItem(name: string, status: RuleStatus, detail: string) {
  return { name, status, detail };
}

function SecurityGatePanel({
  autoFixResult,
  disabled,
  disabledReason,
  isAutoFixLoading,
  isLoading,
  onApplyAutoFixes,
  onPreviewAutoFixes,
  onRun,
  result
}: {
  autoFixResult: AutoFixResult | null;
  disabled: boolean;
  disabledReason: string | null;
  isAutoFixLoading: boolean;
  isLoading: boolean;
  onApplyAutoFixes: () => void;
  onPreviewAutoFixes: () => void;
  onRun: () => void;
  result: SandboxResult | null;
}) {
  const canAutoFix = Boolean(result?.checks.some((check) => check.status === "warning" || check.status === "failed"));

  return (
    <div className="runtime-dryrun">
      <div className="sandbox-actions compact">
        <div>
          <strong>Security gates</strong>
          <span>Scan generated files for secret exposure, container policy, ingress TLS, and deployment gate risks.</span>
        </div>
        <button className="primary-button" type="button" disabled={disabled} onClick={onRun}>
          <ShieldCheck size={17} />
          {isLoading ? "Scanning..." : "Run security gates"}
        </button>
      </div>
      {disabledReason ? <p className="gate-note">{disabledReason}</p> : null}
      {result ? <SandboxResultView result={result} /> : null}
      <div className="autofix-panel">
        <div>
          <strong>Safe auto-fix</strong>
          <span>Preview controlled config hardening for common security warnings before applying changes.</span>
        </div>
        <button className="ghost-button" type="button" disabled={!canAutoFix || isAutoFixLoading} onClick={onPreviewAutoFixes}>
          <Settings2 size={17} />
          {isAutoFixLoading ? "Previewing..." : "Preview fixes"}
        </button>
      </div>
      {autoFixResult ? (
        <div className="autofix-result">
          <div className="validation-input-heading">
            <div>
              <strong>{autoFixResult.status === "ready" ? "Fixes ready" : "No safe fixes needed"}</strong>
              <span>{autoFixResult.changes.length} controlled change{autoFixResult.changes.length === 1 ? "" : "s"} prepared.</span>
            </div>
            <button className="primary-button" type="button" disabled={!autoFixResult.changes.length} onClick={onApplyAutoFixes}>
              Apply fixes
            </button>
          </div>
          <div className="template-list">
            {(autoFixResult.changes.length ? autoFixResult.changes : [{ path: "generated files", title: "No changes", detail: "Generated configs already satisfy current safe auto-fix rules." }]).map((change) => (
              <div key={`${change.path}-${change.title}`}>
                <strong>{change.title}</strong>
                <code>{change.path}</code>
                <span>{change.detail}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RuntimeDryRunPanel({
  disabled,
  disabledReason,
  isLoading,
  onRun,
  result
}: {
  disabled: boolean;
  disabledReason: string | null;
  isLoading: boolean;
  onRun: () => void;
  result: SandboxResult | null;
}) {
  return (
    <div className="runtime-dryrun">
      <div className="sandbox-actions compact">
        <div>
          <strong>Runtime dry-runs</strong>
          <span>Execute local Compose and Kubernetes client dry-runs after static sandbox checks pass.</span>
        </div>
        <button className="primary-button" type="button" disabled={disabled} onClick={onRun}>
          <Play size={17} />
          {isLoading ? "Running..." : "Run runtime dry-runs"}
        </button>
      </div>
      {disabledReason ? <p className="gate-note">{disabledReason}</p> : null}
      {result ? <SandboxResultView result={result} /> : null}
    </div>
  );
}

function RuntimeToolchainPanel({
  isLoading,
  onInspect,
  toolchain
}: {
  isLoading: boolean;
  onInspect: () => void;
  toolchain: RuntimeToolchain | null;
}) {
  return (
    <div className="toolchain-panel">
      <div className="validation-input-heading">
        <div>
          <strong>Runtime toolchain</strong>
          <span>{toolchain ? `Mode: ${toolchain.mode}` : "Inspect local tools before real Docker and Kubernetes execution."}</span>
        </div>
        <button className="ghost-button" type="button" disabled={isLoading} onClick={onInspect}>
          <Settings2 size={17} />
          {isLoading ? "Inspecting..." : "Inspect tools"}
        </button>
      </div>
      {toolchain ? (
        <>
          <div className="resolution-summary toolchain-summary">
            <Metric icon={<CheckCircle2 size={20} />} label="Available" value={toolchain.summary.available.toString()} />
            <Metric icon={<XCircle size={20} />} label="Missing" value={toolchain.summary.missing.toString()} />
          </div>
          <div className="toolchain-list">
            {toolchain.tools.map((tool) => (
              <div key={tool.name}>
                {tool.status === "available" ? <CheckCircle2 className="status passed" size={19} /> : <Activity className="status warning" size={19} />}
                <div>
                  <strong>{tool.name}</strong>
                  <span>{tool.message}</span>
                  <code>{tool.command}</code>
                </div>
                <em className={`review-badge ${tool.status === "available" ? "ready" : "needs-input"}`}>{tool.required ? "Required" : "Optional"}</em>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MissingGeneratedInputs({ files }: { files: GeneratedFile[] }) {
  return (
    <div className="missing-inputs">
      <strong>Still waiting on</strong>
      <div>
        {files.map((file) => (
          <span key={file.path}>{file.path}</span>
        ))}
      </div>
    </div>
  );
}

function SandboxResultView({ result }: { result: SandboxResult | null }) {
  if (!result) {
    return (
      <div className="sandbox-empty">
        <strong>Awaiting sandbox run</strong>
        <span>Resolve generation inputs, then run static checks for Docker, Kubernetes, Compose, and CI/CD readiness.</span>
      </div>
    );
  }

  return (
    <div className="sandbox-result">
      <div className="metrics-strip nested">
        <Metric icon={<CheckCircle2 size={20} />} label="Passed" value={result.summary.passed.toString()} />
        <Metric icon={<Activity size={20} />} label="Warnings" value={result.summary.warning.toString()} />
        <Metric icon={<XCircle size={20} />} label="Failed" value={result.summary.failed.toString()} />
        <Metric icon={<Settings2 size={20} />} label="Mode" value={result.mode} />
      </div>
      <div className="rule-list">
        {result.checks.map((check) => (
          <div className="rule-row" key={check.name}>
            {sandboxIcon(check.status)}
            <div>
              <strong>{check.name}</strong>
              <span>{check.message}</span>
              <code>{check.command}</code>
            </div>
          </div>
        ))}
      </div>
      {result.nextActions.length ? (
        <div className="next-actions">
          <strong>Next actions</strong>
          {result.nextActions.map((action) => (
            <span key={action}>{action}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function sandboxIcon(status: SandboxStatus) {
  if (status === "passed") return <CheckCircle2 className="status passed" size={22} />;
  if (status === "failed") return <XCircle className="status failed" size={22} />;
  return <Activity className="status warning" size={22} />;
}

function gateIcon(status: "passed" | "warning" | "blocked") {
  if (status === "passed") return <CheckCircle2 className="status passed" size={22} />;
  if (status === "blocked") return <XCircle className="status failed" size={22} />;
  return <Activity className="status warning" size={22} />;
}

function PipelineView({
  analysis,
  ciProvider,
  onCiProviderChange
}: {
  analysis: Analysis | null;
  ciProvider: "azure-pipelines" | "jenkins";
  onCiProviderChange: (provider: "azure-pipelines" | "jenkins") => void;
}) {
  const pipelineFile = analysis?.generatedFiles.find((file) => file.path === (ciProvider === "azure-pipelines" ? "azure-pipelines.yml" : "Jenkinsfile"));

  return (
    <div className="pipeline-layout">
      <div className="pipeline-left">
        <FocusedPanel kicker="CI/CD provider" title="Pipeline target">
        <div className="mode-switch cloud-switch" role="tablist" aria-label="CI/CD provider">
          <button className={ciProvider === "azure-pipelines" ? "active" : ""} onClick={() => onCiProviderChange("azure-pipelines")} type="button">
            Azure Pipelines
          </button>
          <button className={ciProvider === "jenkins" ? "active" : ""} onClick={() => onCiProviderChange("jenkins")} type="button">
            Jenkins
          </button>
        </div>
        <PipelineList analysis={analysis} />
        </FocusedPanel>
      </div>
      <div className="pipeline-right">
        <FocusedPanel kicker="Pipeline preview" title={pipelineFile?.path ?? "Pipeline file"}>
          {pipelineFile ? (
            <div className="generated-list">
              <details open>
                <summary>
                  <strong>{pipelineFile.path}</strong>
                  <span>{pipelineFile.purpose}</span>
                  <em className={`review-badge ${pipelineFile.status}`}>{formatFileStatus(pipelineFile.status)}</em>
                </summary>
                <div className="file-actions">
                  <button className="ghost-button" type="button" onClick={() => downloadGeneratedFile(pipelineFile.path, pipelineFile.content)}>
                    Download
                  </button>
                  <button className="ghost-button" type="button" onClick={() => navigator.clipboard?.writeText(pipelineFile.content)}>
                    Copy
                  </button>
                </div>
                <pre>{pipelineFile.content}</pre>
              </details>
            </div>
          ) : (
            <p>No pipeline file generated yet.</p>
          )}
        </FocusedPanel>
        <FocusedPanel kicker="Release controls" title="Execution gates">
          <div className="metrics-strip nested">
            <Metric icon={<ShieldCheck size={20} />} label="Preflight" value={analysis?.preflight.status ?? "Pending"} />
            <Metric icon={<Rocket size={20} />} label="Sandbox deploy" value="Next" />
            <Metric icon={<Cloud size={20} />} label="Cloud apply" value="Locked" />
            <Metric icon={<LockKeyhole size={20} />} label="Drift detection" value="Later" />
          </div>
          <PromotionRunbook analysis={analysis} ciProvider={ciProvider} />
        </FocusedPanel>
        <FocusedPanel kicker="Release package" title="Pipeline handoff checklist">
          <PipelineHandoffChecklist analysis={analysis} pipelineFile={pipelineFile} />
        </FocusedPanel>
      </div>
    </div>
  );
}

function PipelineHandoffChecklist({ analysis, pipelineFile }: { analysis: Analysis | null; pipelineFile: GeneratedFile | undefined }) {
  const checks = [
    {
      name: "Pipeline file",
      status: pipelineFile ? "passed" as RuleStatus : "failed" as RuleStatus,
      detail: pipelineFile ? `${pipelineFile.path} is selected for the current provider.` : "No pipeline file is selected yet."
    },
    {
      name: "Blocking gates",
      status: analysis?.promotionDecision?.status === "blocked" ? "failed" as RuleStatus : "passed" as RuleStatus,
      detail: analysis?.promotionDecision?.message ?? "Analyze a repository to calculate release gates."
    },
    {
      name: "Manual approvals",
      status: "warning" as RuleStatus,
      detail: "Cloud deployment still requires explicit credentials, environment, and Terraform approval."
    }
  ];

  return (
    <div className="handoff-list">
      {checks.map((check) => (
        <div key={check.name}>
          {statusIcon(check.status)}
          <div>
            <strong>{check.name}</strong>
            <span>{check.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PromotionRunbook({ analysis, ciProvider }: { analysis: Analysis | null; ciProvider: "azure-pipelines" | "jenkins" }) {
  if (!analysis) return null;

  const unresolvedFiles = analysis.generatedFiles.filter((file) => file.status !== "ready");
  const runbook = [
    {
      title: "Pipeline provider",
      status: "passed" as RuleStatus,
      detail: ciProvider === "azure-pipelines" ? "Azure Pipelines selected for this app release." : "Jenkins selected as the pipeline target."
    },
    {
      title: "Preflight decision",
      status: analysis.preflight.status === "ready" ? "passed" as RuleStatus : "failed" as RuleStatus,
      detail: analysis.preflight.status === "ready" ? "Preflight gates are ready for sandbox execution." : "Resolve blocked preflight gates before release."
    },
    {
      title: "Generated config inputs",
      status: unresolvedFiles.length ? "warning" as RuleStatus : "passed" as RuleStatus,
      detail: unresolvedFiles.length ? `${unresolvedFiles.length} generated file${unresolvedFiles.length === 1 ? "" : "s"} still need input.` : "Generated files are resolved for the selected stack."
    },
    {
      title: "Cloud deployment lock",
      status: "warning" as RuleStatus,
      detail: "Cloud apply stays locked until sandbox, security, credentials, and Terraform review pass."
    }
  ];

  return (
    <div className="runbook-list">
      {runbook.map((item) => (
        <div className="runbook-item" key={item.title}>
          {statusIcon(item.status)}
          <div>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function InfraView({
  analysis,
  cloudProvider,
  onCloudProviderChange
}: {
  analysis: Analysis | null;
  cloudProvider: "azure" | "aws";
  onCloudProviderChange: (provider: "azure" | "aws") => void;
}) {
  if (!analysis) return <EmptyState />;

  const plan = analysis.infraPlan[cloudProvider];

  return (
    <div className="results-grid paired-grid">
      <FocusedPanel kicker="Infrastructure planner" title="Choose cloud target">
        <div className="mode-switch cloud-switch" role="tablist" aria-label="Cloud provider">
          <button className={cloudProvider === "azure" ? "active" : ""} onClick={() => onCloudProviderChange("azure")} type="button">
            Azure
          </button>
          <button className={cloudProvider === "aws" ? "active" : ""} onClick={() => onCloudProviderChange("aws")} type="button">
            AWS
          </button>
        </div>
        <p>{plan.summary}</p>
        <ResourceList plan={plan} />
      </FocusedPanel>
      <FocusedPanel kicker="Terraform preview" title={`${cloudProvider.toUpperCase()} starter files`}>
        <GeneratedInfraFiles plan={plan} />
      </FocusedPanel>
      <FocusedPanel kicker={`${cloudProvider.toUpperCase()} handoff`} title="Manual cloud inputs" className="wide-panel">
        <CloudHandoffChecklist analysis={analysis} cloudProvider={cloudProvider} />
      </FocusedPanel>
    </div>
  );
}

function CloudHandoffChecklist({ analysis, cloudProvider }: { analysis: Analysis; cloudProvider: "azure" | "aws" }) {
  const services = analysis.stack.services ?? [];
  const backend = services.find((service) => service.kind === "backend");
  const frontend = services.find((service) => service.kind === "frontend");
  const requiredEnv = analysis.stack.requiredEnv ?? [];

  const cloudInputs =
    cloudProvider === "aws"
      ? [
          "AWS account ID",
          "AWS region",
          "ECR backend repository URL",
          "ECR frontend repository URL",
          "EKS cluster name and namespace",
          "RDS PostgreSQL endpoint",
          "ACM certificate ARN",
          "Route 53 hosted zone or external DNS target",
          "Azure Pipelines AWS service connection"
        ]
      : [
          "Azure subscription ID",
          "Resource group",
          "ACR login server",
          "AKS cluster name and namespace",
          "Azure PostgreSQL endpoint",
          "Key Vault name",
          "TLS certificate or ingress host",
          "Azure Pipelines service connection"
        ];

  const secretInputs = ["DATABASE_URL", "TOKEN_SECRET", "CORS_ORIGIN"].filter((item) => requiredEnv.includes(item) || item !== "DATABASE_URL");

  return (
    <div className="cloud-handoff">
      <div className="handoff-summary">
        <div>
          <Cloud size={18} />
          <span>{cloudProvider === "aws" ? "Recommended runtime: EKS + ECR + RDS PostgreSQL" : "Recommended runtime: AKS + ACR + Azure PostgreSQL"}</span>
        </div>
        <div>
          <LockKeyhole size={18} />
          <span>Cloud apply stays locked until registry, domain, secrets, and credentials are mapped.</span>
        </div>
      </div>

      <div className="handoff-columns">
        <div>
          <strong>Service map</strong>
          <ul>
            <li>{backend ? `${backend.serviceName}: ${backend.port}` : "Backend service pending"}</li>
            <li>{frontend ? `${frontend.serviceName}: ${frontend.port}` : "Frontend service pending"}</li>
            <li>{analysis.stack.databases.includes("PostgreSQL") ? "PostgreSQL backing service required" : "No managed database detected"}</li>
          </ul>
        </div>
        <div>
          <strong>Cloud values to collect</strong>
          <ul>
            {cloudInputs.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <strong>Deployment secrets</strong>
          <ul>
            {secretInputs.map((item) => (
              <li key={item}>{item}</li>
            ))}
            <li>Public domain / ingress host</li>
            <li>Immutable backend and frontend image tags</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function ResourceList({ plan }: { plan: CloudPlan }) {
  return (
    <div className="template-list">
      {plan.resources.map((resource) => (
        <div key={resource.name}>
          <strong>{resource.name}</strong>
          <em className={`review-badge ${resource.required ? "ready" : "needs-input"}`}>{resource.required ? "Required" : "Optional"}</em>
          <span>{resource.purpose}</span>
        </div>
      ))}
    </div>
  );
}

function GeneratedInfraFiles({ plan }: { plan: CloudPlan }) {
  return (
    <div className="generated-list">
      {plan.terraformFiles.map((file) => (
        <details key={file.path}>
          <summary>
            <strong>{file.path}</strong>
            <span>Terraform starter file</span>
            <em className={`review-badge ${file.status}`}>{formatFileStatus(file.status)}</em>
          </summary>
          <div className="file-actions">
            <button className="ghost-button" type="button" onClick={() => downloadGeneratedFile(file.path, file.content)}>
              Download
            </button>
            <button className="ghost-button" type="button" onClick={() => navigator.clipboard?.writeText(file.content)}>
              Copy
            </button>
          </div>
          <pre>{file.content}</pre>
        </details>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <FocusedPanel kicker="Awaiting repository" title="Start with a source">
      <p>Choose GitHub or ZIP upload to run analysis.</p>
    </FocusedPanel>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StackDetails({ analysis }: { analysis: Analysis | null }) {
  const rows = [
    ["Runtime", analysis?.stack.runtime.join(", ") || "Pending"],
    ["Framework", analysis?.stack.frameworks.join(", ") || "Pending"],
    ["Package manager", analysis?.stack.packageManager || "Pending"],
    ["Build", analysis?.stack.buildCommand || "Pending"],
    ["Start", analysis?.stack.startCommand || "Pending"],
    ["Port", analysis?.stack.port || "Pending"]
  ];

  return (
    <div className="detail-list">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function RuleList({ analysis }: { analysis: Analysis | null }) {
  const rules = analysis?.validations ?? [
    { name: "Repository intake", status: "warning" as RuleStatus, message: "Waiting for a repository source." },
    { name: "Stack detection", status: "warning" as RuleStatus, message: "Rules activate after analysis." },
    { name: "Template match", status: "warning" as RuleStatus, message: "Golden templates will be selected automatically." }
  ];

  return (
    <div className="rule-list">
      {rules.map((item) => (
        <div className="rule-row" key={item.name}>
          {statusIcon(item.status)}
          <div>
            <strong>{item.name}</strong>
            <span>{item.message}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplateList({ analysis }: { analysis: Analysis | null }) {
  const templates = analysis?.templates ?? [
    { name: "Dockerfile", key: "stack-aware", description: "Selected after framework detection." },
    { name: "Jenkinsfile", key: "modular", description: "Stages enable based on runtime signals." },
    { name: "docker-compose.yml", key: "sandbox", description: "Local smoke-test deployment." }
  ];

  return (
    <div className="template-list">
      {templates.map((item) => (
        <div key={`${item.name}-${item.key}`}>
          <strong>{item.name}</strong>
          <code>{item.key}</code>
          <span>{item.description}</span>
        </div>
      ))}
    </div>
  );
}

function PipelineList({ analysis }: { analysis: Analysis | null }) {
  const pipeline = analysis?.pipeline ?? [
    { name: "Checkout", enabled: true, detail: "Ready." },
    { name: "Detect Stack", enabled: true, detail: "Ready." },
    { name: "Deploy", enabled: false, detail: "Cloud target not configured." }
  ];

  return (
    <div className="pipeline-list">
      {pipeline.map((stage) => (
        <div className={stage.enabled ? "stage enabled" : "stage"} key={stage.name}>
          <div className="stage-dot">{stage.enabled ? <Play size={12} /> : null}</div>
          <div>
            <strong>{stage.name}</strong>
            <span>{stage.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function GeneratedFiles({ files }: { files: GeneratedFile[] }) {
  const displayFiles = files.length ? files : [
    { path: "Dockerfile", purpose: "Container blueprint", status: "needs-input" as const, content: "Analyze a repository to preview generated files." }
  ];

  return (
    <div className="generated-list">
      {displayFiles.map((file) => (
        <details key={file.path}>
          <summary>
            <strong>{file.path}</strong>
            <span>{file.purpose}</span>
            <em className={`review-badge ${file.status}`}>{formatFileStatus(file.status)}</em>
          </summary>
          <div className="file-actions">
            <button className="ghost-button" type="button" onClick={() => downloadGeneratedFile(file.path, file.content)}>
              Download
            </button>
            <button className="ghost-button" type="button" onClick={() => navigator.clipboard?.writeText(file.content)}>
              Copy
            </button>
          </div>
          <pre>{file.content}</pre>
        </details>
      ))}
    </div>
  );
}

function defaultDeploymentInputs(analysis: Analysis): DeploymentInputs {
  const stack = analysis.stack;

  return {
    port: stack.port === "auto-detect" ? "" : stack.port,
    buildCommand: stack.buildCommand ?? "",
    startCommand: stack.startCommand ?? "",
    testCommand: stack.testCommand ?? "",
    imageRegistry: "",
    domain: "",
    databaseUrl: "",
    tokenSecret: "",
    corsOrigin: ""
  };
}

function resolveGeneratedFiles(analysis: Analysis | null, inputs: DeploymentInputs): GeneratedFile[] {
  if (!analysis) return [];

  return analysis.generatedFiles.map((file) => {
    const content = applyDeploymentInputs(file, inputs);
    const status = resolveFileStatus(file, inputs, analysis);
    return { ...file, content, status };
  });
}

function applyGeneratedOverrides(files: GeneratedFile[], overrides: Record<string, string>): GeneratedFile[] {
  return files.map((file) => (overrides[file.path] ? { ...file, content: overrides[file.path] } : file));
}

function applyDeploymentInputs(file: GeneratedFile, inputs: DeploymentInputs) {
  const port = inputs.port.trim();
  const registry = inputs.imageRegistry.trim().replace(/\/$/, "");
  const domain = inputs.domain.trim();
  let content = file.content;

  if (registry) {
    content = content
      .replaceAll("REPLACE_WITH_REGISTRY", registry)
      .replaceAll("REPLACE_WITH_ACR_OR_ECR_SERVICE_CONNECTION", registry);
  }

  if (domain) {
    content = content.replaceAll("REPLACE_WITH_DOMAIN", domain);
  }

  if (inputs.databaseUrl?.trim()) {
    content = content.replaceAll("REPLACE_WITH_DATABASE_URL", inputs.databaseUrl.trim());
  }

  if (inputs.tokenSecret?.trim()) {
    content = content.replaceAll("REPLACE_WITH_TOKEN_SECRET", inputs.tokenSecret.trim());
  }

  if (inputs.corsOrigin?.trim()) {
    content = content.replaceAll("REPLACE_WITH_CORS_ORIGIN", inputs.corsOrigin.trim());
  }

  if (inputs.buildCommand.trim()) {
    content = content.replaceAll("echo Build command pending", inputs.buildCommand.trim());
  }

  if (inputs.testCommand.trim()) {
    content = content.replaceAll("echo No test script detected yet", inputs.testCommand.trim());
  }

  if (!port) return content;

  if (file.path === "Dockerfile") {
    return content.replace(/EXPOSE \d+/g, `EXPOSE ${port}`);
  }

  if (file.path === "docker-compose.yml") {
    return content.replace(/- "\d+:\d+"/g, `- "${port}:${port}"`).replace(/- "\d+:80"/g, `- "${port}:80"`);
  }

  if (file.path === "k8s/deployment.yaml") {
    return content.replace(/containerPort: \d+/g, `containerPort: ${port}`).replace(/^(\s+port: )\d+$/gm, `$1${port}`);
  }

  if (file.path === "k8s/service.yaml") {
    return content.replace(/targetPort: \d+/g, `targetPort: ${port}`);
  }

  return content;
}

function resolveFileStatus(file: GeneratedFile, inputs: DeploymentInputs, analysis: Analysis): GeneratedFile["status"] {
  if (file.status === "blocked") return "blocked";

  const hasPackageManifest = analysis.stack.packageManager !== "unknown";
  const hasPort = Boolean(inputs.port.trim());
  const hasBuild = Boolean(inputs.buildCommand.trim());
  const hasStart = Boolean(inputs.startCommand.trim());
  const hasRegistry = Boolean(inputs.imageRegistry.trim());
  const hasDomain = Boolean(inputs.domain.trim());
  const hasDatabaseUrl = Boolean(inputs.databaseUrl?.trim());
  const hasTokenSecret = Boolean(inputs.tokenSecret?.trim());
  const hasCorsOrigin = Boolean(inputs.corsOrigin?.trim());
  const isMultiService = Boolean(analysis.stack.services?.length && analysis.stack.services.length > 1);

  if (file.path.toLowerCase().endsWith("dockerfile")) return hasPackageManifest || isMultiService || (hasPort && hasStart) ? "ready" : file.status;
  if (file.path.endsWith(".dockerignore")) return "ready";
  if (file.path === "Jenkinsfile" || file.path === "azure-pipelines.yml") return isMultiService ? hasRegistry ? "ready" : file.status : hasBuild && hasStart ? "ready" : file.status;
  if (file.path === "docker-compose.yml" || file.path === "k8s/service.yaml") return isMultiService || hasPort ? "ready" : file.status;
  if (file.path === "k8s/secret.yaml") return hasDatabaseUrl && hasTokenSecret && hasCorsOrigin ? "ready" : file.status;
  if (file.path === "k8s/deployment.yaml") return isMultiService ? hasRegistry && hasDatabaseUrl && hasTokenSecret ? "ready" : file.status : hasPort && hasStart && hasRegistry ? "ready" : file.status;
  if (file.path === "k8s/ingress.yaml") return hasDomain ? "ready" : file.status;

  return file.status;
}

function formatFileStatus(status: "ready" | "needs-input" | "blocked") {
  if (status === "ready") return "Ready";
  if (status === "blocked") return "Blocked";
  return "Needs input";
}

function downloadGeneratedFile(path: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = path;
  link.click();
  URL.revokeObjectURL(url);
}

function statusIcon(status: RuleStatus) {
  if (status === "passed") return <CheckCircle2 className="status passed" size={22} />;
  if (status === "failed") return <XCircle className="status failed" size={22} />;
  return <Activity className="status warning" size={22} />;
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    const body = await response.text();
    const preview = body.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(
      `PipelineForge API returned ${contentType || "a non-JSON response"}. Confirm the API is running on port 8095 and Vite is proxying /api correctly.${preview ? ` Preview: ${preview}` : ""}`
    );
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed.");
  }
  return data;
}

export default App;
