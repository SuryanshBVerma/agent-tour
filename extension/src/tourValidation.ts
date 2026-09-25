import Ajv, { ErrorObject } from "ajv";
import schema from "../schema/tour.schema.json";
import { isSafeRelativePath } from "./pathRules";
import { Tour } from "./types";

export type ValidationResult =
  | { ok: true; tour: Tour }
  | { ok: false; errors: string[] };

const ajv = new Ajv({ allErrors: true, strict: true });
const validateSchema = ajv.compile<Tour>(schema);

/**
 * Validates parsed tour JSON: the schema first, then rules JSON Schema cannot express
 * (range order, path safety beyond the pattern, id matching the file name).
 */
export function validateTour(data: unknown, expectedId?: string): ValidationResult {
  if (!validateSchema(data)) {
    return { ok: false, errors: (validateSchema.errors ?? []).map(formatError) };
  }
  const tour = data;
  const errors: string[] = [];
  if (expectedId !== undefined && tour.id !== expectedId) {
    errors.push(`/id "${tour.id}" must match the file name "${expectedId}.json"`);
  }
  tour.steps.forEach((step, i) => {
    if (step.range.end < step.range.start) {
      errors.push(`/steps/${i}/range end (${step.range.end}) is before start (${step.range.start})`);
    }
    if (!isSafeRelativePath(step.file)) {
      errors.push(`/steps/${i}/file "${step.file}" must be workspace-relative`);
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, tour };
}

function formatError(error: ErrorObject): string {
  const where = error.instancePath || "/";
  if (error.keyword === "additionalProperties") {
    return `${where} has unknown property "${String(error.params.additionalProperty)}"`;
  }
  if (error.keyword === "enum") {
    return `${where} must be one of ${(error.params.allowedValues as unknown[]).join(", ")}`;
  }
  return `${where} ${error.message ?? "is invalid"}`;
}
