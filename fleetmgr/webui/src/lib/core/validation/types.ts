export type ValidationErrors = Record<string, string>;

export interface ValidationResult {
  ok: boolean;
  errors: ValidationErrors;
  warnings?: string[];
}
