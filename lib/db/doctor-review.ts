import type { ValidationStatus } from "@/types/schema";
import { supabase } from "@/utils/supabase";

import { isMissingFunctionError } from "./pg-errors";

/** Row returned by the get_patient_latest_result RPC (migration 0007). */
export type PatientResultSummary = {
  id: number;
  severity: string;
  healthscore: number;
  confidence: number | null;
  detection_label: string | null;
  validation_status: ValidationStatus;
  doctor_notes: string | null;
  validated_at: string | null;
  created_at: string;
  /** Remote scan photo (migration 0020); null when never uploaded or before 0020. */
  image_url?: string | null;
  /** How the photo was taken, e.g. "scan_camera" / "scan_gallery". */
  source_type?: string | null;
  /** The patient answered "doesn't match my skin" for this detection (0020). */
  patient_disputed?: boolean | null;
};

/** One patient's reason for visiting, for request cards (migration 0020). */
export type PatientConcern = {
  patient_id: string;
  main_concerns: string | null;
  latest_detection: string | null;
};

const MIGRATION_HINT =
  "Reviews aren't available yet: the clinic database is missing supabase/migrations/0007_result_validation.sql. Ask the clinic admin to run it once in the Supabase SQL editor, then reopen.";

function rpcError(error: { message: string }): Error {
  if (isMissingFunctionError(error)) return new Error(MIGRATION_HINT);
  return new Error(error.message);
}

/**
 * Reads one patient's newest AI result. The RPC checks the caller is an active doctor whose clinic
 * holds an active appointment for that patient. Returns the remote scan photo (0020) but no survey
 * data — just what the review panel needs.
 */
export async function getPatientLatestResult(
  patientId: string,
): Promise<PatientResultSummary | null> {
  const { data, error } = await supabase.rpc("get_patient_latest_result", {
    p_patient_id: patientId,
  });
  if (error) throw rpcError(error);
  return (data as PatientResultSummary | null) ?? null;
}

/**
 * Writes the dermatologist verdict. Only status + notes are sent; the RPC sets validated_by /
 * validated_at itself and can never alter scores or detection.
 */
export async function validateAiResult(
  resultId: number,
  status: Extract<ValidationStatus, "confirmed" | "needs_review">,
  notes: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("validate_ai_result", {
    p_result_id: resultId,
    p_status: status,
    p_notes: notes,
  });
  if (error) throw rpcError(error);
}

/**
 * Batched reason-for-visit for the doctor's queue. Best-effort: returns {} when the 0020 RPC isn't
 * deployed yet, so the cards just fall back to no concern line.
 */
export async function getPatientConcerns(
  patientIds: string[],
): Promise<Record<string, PatientConcern>> {
  if (patientIds.length === 0) return {};
  const { data, error } = await supabase.rpc("get_patient_concerns", { p_ids: patientIds });
  if (error) {
    if (!isMissingFunctionError(error)) console.warn("[doctor-review] concerns:", error.message);
    return {};
  }
  const out: Record<string, PatientConcern> = {};
  for (const row of (data ?? []) as PatientConcern[]) {
    if (row?.patient_id) out[row.patient_id] = row;
  }
  return out;
}
