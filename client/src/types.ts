export type RuleStatus = "passed" | "warning" | "failed";
export type SandboxStatus = "passed" | "warning" | "failed" | "skipped";

export type Analysis = {
  repoName: string;
  source: "github" | "upload";
  stack: {
    runtime: string[];
    frameworks: string[];
    databases: string[];
    packageManager: string;
    buildCommand: string | null;
    startCommand: string | null;
    testCommand: string | null;
    port: string;
    buildRequired?: boolean;
    requiredEnv?: string[];
    services?: Array<{
      name: string;
      serviceName: string;
      kind: "frontend" | "backend" | string;
      path: string;
      port: string;
      healthPath: string;
      packageManager: string;
      buildCommand: string | null;
      startCommand: string | null;
      testCommand: string | null;
      hasDockerfile: boolean;
      buildRequired: boolean;
      dependencies: string[];
    }>;
  };
  report: {
    confidence: number;
    entrypoints: string[];
    fileSummary: {
      totalFiles: number;
      sourceFiles: number;
      configFiles: number;
      devopsFiles: number;
    };
    riskSummary: {
      passed: number;
      warning: number;
      failed: number;
    };
    recommendations: string[];
  };
  preflight: {
    status: "ready" | "blocked";
    gates: Array<{
      name: string;
      status: "passed" | "warning" | "blocked";
      message: string;
    }>;
  };
  infraPlan: {
    azure: CloudPlan;
    aws: CloudPlan;
  };
  validations: Array<{
    name: string;
    status: RuleStatus;
    message: string;
  }>;
  templates: Array<{
    name: string;
    key: string;
    description: string;
  }>;
  generatedFiles: Array<{
    path: string;
    purpose: string;
    status: "ready" | "needs-input" | "blocked";
    content: string;
  }>;
  pipeline: Array<{
    name: string;
    enabled: boolean;
    detail: string;
  }>;
  score: number;
  scoreBreakdown: {
    score: number;
    maxScore: number;
    missingPoints: number;
    categories: Array<{
      name: string;
      points: number;
      maxPoints: number;
      description: string;
    }>;
    reasons: string[];
    pathTo100: Array<{
      title: string;
      detail: string;
      points: number;
    }>;
  };
  promotionDecision: {
    status: "ready" | "review" | "blocked";
    title: string;
    message: string;
    gates: Array<{
      name: string;
      status: "passed" | "warning" | "blocked";
      message: string;
    }>;
  };
  generatedAt: string;
};

export type CloudPlan = {
  provider: "azure" | "aws";
  summary: string;
  resources: Array<{
    name: string;
    purpose: string;
    required: boolean;
  }>;
  terraformFiles: Array<{
    path: string;
    status: "ready" | "needs-input" | "blocked";
    content: string;
  }>;
};

export type SandboxResult = {
  status: "ready" | "blocked";
  mode: "static" | "runtime" | "security";
  summary: {
    passed: number;
    warning: number;
    failed: number;
    skipped: number;
  };
  checks: Array<{
    name: string;
    status: SandboxStatus;
    message: string;
    command: string;
  }>;
  nextActions: string[];
  validatedAt: string;
};

export type RuntimeToolchain = {
  status: "ready" | "partial";
  mode: "runtime-ready" | "static-only";
  summary: {
    available: number;
    missing: number;
    required: number;
  };
  tools: Array<{
    name: string;
    command: string;
    required: boolean;
    status: "available" | "missing";
    message: string;
  }>;
  inspectedAt: string;
};

export type AutoFixResult = {
  status: "ready" | "no-op";
  changes: Array<{
    path: string;
    title: string;
    detail: string;
  }>;
  files: Array<{
    path: string;
    purpose: string;
    status: "ready" | "needs-input" | "blocked";
    content: string;
  }>;
  fixedAt: string;
};

export type PrivacyStatus = {
  rawRepositoryStorage: "disabled" | "enabled";
  analysisPersistence: "enabled" | "disabled";
  dataDir: string;
  uploadHandling: string;
  secretHandling: string;
  retention: {
    analysisRecords: string;
    rawUploads: string;
  };
  controls: string[];
};
