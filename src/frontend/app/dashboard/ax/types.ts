export interface AxStep {
  endpoint: string;
  method?: string;
  inputs: Record<string, unknown>;
  outputKey: string;
  description?: string;
}

export interface AxPlan {
  steps: AxStep[];
}

export interface AxStepResult {
  outputKey: string;
  response: unknown;
  success: boolean;
  error?: string;
  description?: string;
}

export interface AxExecutionResult {
  overallSuccess: boolean;
  stepResults: AxStepResult[];
  elapsedMs: number;
  message: string;
}

export interface AxConfig {
  maxWaitSeconds: number;
}
