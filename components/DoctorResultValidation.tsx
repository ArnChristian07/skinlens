import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, TextInput, View } from "react-native";
import { Text } from "@/components/Text";
import { ChevronDown, ImageOff, TriangleAlert, X } from "lucide-react-native";

import { Pill } from "@/components/ui";
import { theme } from "@/lib/theme";
import { formatter } from "@/utils/formatter";
import {
  getPatientLatestResult,
  validateAiResult,
  type PatientResultSummary,
} from "@/lib/db/doctor-review";

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function labelFor(status: PatientResultSummary["validation_status"]): string {
  if (status === "confirmed") return "Doctor agreed";
  if (status === "needs_review") return "Doctor disagreed / needs exam";
  return "Awaiting doctor review";
}

function toneFor(
  status: PatientResultSummary["validation_status"],
): "primary" | "neutral" | "warning" {
  if (status === "confirmed") return "primary";
  if (status === "needs_review") return "warning";
  return "neutral";
}

/** The classifier's classes (utils/detection-score.ts) in a dermatologist's words. */
const FINDING_LABELS: Record<string, string> = {
  acne: "Acne",
  eczema: "Eczema",
  dry: "Dry skin (xerosis)",
  oily: "Oily skin (seborrhea)",
  normal: "No condition detected",
};

function findingFor(label: string | null): string {
  if (!label) return "No finding recorded";
  return FINDING_LABELS[label.toLowerCase()] ?? formatter(label);
}

/** Below this the model's top class is a weak guess — say so next to the number. */
const LOW_CONFIDENCE = 0.6;

/**
 * Collapsible review panel inside a doctor's appointment card: shows the patient's newest scan photo
 * and AI finding, and lets an active dermatologist agree with it or mark it as needing an in-person
 * exam, with a note the patient sees. Reads and writes go through the SECURITY DEFINER RPCs from
 * migrations 0007 / 0020, so nothing here can alter the scores themselves.
 */
export function DoctorResultValidation({
  patientId,
  defaultOpen = false,
}: {
  patientId: string;
  /** Start expanded and load immediately (the patient screen). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(defaultOpen);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PatientResultSummary | null>(null);
  const [notes, setNotes] = useState("");
  const [photoOpen, setPhotoOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const row = await getPatientLatestResult(patientId);
      setResult(row);
      setNotes(row?.doctor_notes ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the latest scan.");
    } finally {
      setLoading(false);
    }
  };

  // Patient screen: load once on mount (re-runs if a different patient is shown).
  useEffect(() => {
    if (!defaultOpen) return;
    let cancelled = false;
    getPatientLatestResult(patientId)
      .then((row) => {
        if (cancelled) return;
        setResult(row);
        setNotes(row?.doctor_notes ?? "");
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Couldn't load the latest scan.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, defaultOpen]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };

  const submit = async (status: "confirmed" | "needs_review") => {
    if (!result || saving) return;
    setSaving(true);
    setError(null);
    try {
      await validateAiResult(result.id, status, notes.trim() || null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your review.");
    } finally {
      setSaving(false);
    }
  };

  const conf = result?.confidence ?? null;
  const lowConf = conf != null && conf < LOW_CONFIDENCE;
  const captured = result?.source_type?.includes("camera")
    ? "in-app camera"
    : result?.source_type?.includes("gallery")
      ? "uploaded photo"
      : null;

  return (
    <View className="flex-col gap-2">
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide AI scan review" : "Review patient's latest AI scan"}
        className="flex-row items-center gap-2 rounded-full px-3.5 py-2.5 active:opacity-70"
        style={{
          backgroundColor: theme.colors.background,
          borderWidth: 1,
          borderColor: theme.colors.cardBorder,
        }}
      >
        <Text className="flex-1 text-[13px] font-semibold" style={{ color: theme.colors.primary }}>
          {open ? "Hide AI scan" : "AI scan — photo & finding"}
        </Text>
        <ChevronDown
          size={14}
          color={theme.colors.primary}
          style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {open ? (
        <View
          className="flex-col gap-2.5 rounded-2xl p-3"
          style={{ backgroundColor: theme.colors.background }}
        >
          {loading ? (
            <View className="flex-row items-center gap-2 py-0.5">
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text className="text-xs" style={{ color: theme.colors.muted }}>
                Loading latest scan…
              </Text>
            </View>
          ) : null}

          {error ? (
            <Text className="text-xs leading-5" style={{ color: theme.colors.danger }}>
              {error}
            </Text>
          ) : null}

          {!loading && !error && result === null ? (
            <Text className="text-xs" style={{ color: theme.colors.muted }}>
              This patient has not run an AI scan yet.
            </Text>
          ) : null}

          {result && !loading ? (
            <>
              {/* Photo first — the finding means nothing without it. */}
              {result.image_url ? (
                <Pressable
                  onPress={() => setPhotoOpen(true)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel="Scan photo. Tap to enlarge."
                  className="rounded-xl overflow-hidden active:opacity-90"
                  style={{ backgroundColor: theme.colors.primarySoft }}
                >
                  <Image
                    source={{ uri: result.image_url }}
                    style={{ width: "100%", aspectRatio: 4 / 3 }}
                    resizeMode="cover"
                  />
                  <View
                    className="absolute bottom-2 right-2 rounded-full px-2.5 py-1"
                    style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
                  >
                    <Text className="text-[12px] font-semibold text-white">Tap to enlarge</Text>
                  </View>
                </Pressable>
              ) : (
                <View
                  className="flex-row items-center gap-2 rounded-xl px-3 py-2.5"
                  style={{
                    backgroundColor: theme.colors.card,
                    borderWidth: 1,
                    borderColor: theme.colors.cardBorder,
                  }}
                >
                  <ImageOff size={16} color={theme.colors.muted} />
                  <Text className="text-xs flex-1 leading-5" style={{ color: theme.colors.muted }}>
                    No photo available — the patient scanned offline or the upload hasn&apos;t
                    finished. Assess in person before agreeing.
                  </Text>
                </View>
              )}

              {/* The finding, in clinical words */}
              <View>
                <Text
                  className="text-[12px] font-bold uppercase"
                  style={{ color: theme.colors.faint, letterSpacing: 0.6 }}
                >
                  AI finding
                </Text>
                <Text className="text-[17px] font-bold mt-0.5" style={{ color: theme.colors.ink }}>
                  {findingFor(result.detection_label)}
                </Text>
                <Text className="text-xs mt-0.5 leading-5" style={{ color: theme.colors.body }}>
                  {conf != null
                    ? `Model confidence ${(conf * 100).toFixed(0)}%`
                    : "Confidence not recorded"}
                  {lowConf ? " (low — treat as a guess)" : ""}
                  {result.created_at ? ` · scanned ${fmtWhen(result.created_at)}` : ""}
                  {captured ? ` · ${captured}` : ""}
                </Text>
              </View>

              {result.patient_disputed ? (
                <View
                  className="flex-row items-start gap-2 rounded-xl px-3 py-2"
                  style={{ backgroundColor: theme.colors.warningBg }}
                >
                  <TriangleAlert
                    size={14}
                    color={theme.colors.warningText}
                    style={{ marginTop: 3 }}
                  />
                  <Text
                    className="text-xs flex-1 leading-5"
                    style={{ color: theme.colors.warningText }}
                  >
                    The patient said this finding doesn&apos;t match their skin.
                  </Text>
                </View>
              ) : null}

              <View className="flex-row flex-wrap items-center gap-2">
                <Pill
                  label={labelFor(result.validation_status)}
                  tone={toneFor(result.validation_status)}
                />
                <Pill
                  label={`SkinLens score ${Math.round(result.healthscore)}/100 · ${formatter(result.severity)}`}
                  tone="neutral"
                />
              </View>
              <Text className="text-[12px] leading-4" style={{ color: theme.colors.muted }}>
                SkinLens score is the app&apos;s wellness score shown to patients (60% photo model,
                40% questionnaire; higher = healthier). It is not a clinical grade such as IGA or
                GAGS.
              </Text>

              {result.validation_status !== "pending" && result.validated_at ? (
                <Text className="text-xs leading-5" style={{ color: theme.colors.muted }}>
                  {result.validation_status === "confirmed"
                    ? "A doctor agreed"
                    : "A doctor marked it as needing an exam"}{" "}
                  on {fmtWhen(result.validated_at)}.
                  {result.doctor_notes ? ` Note: ${result.doctor_notes}` : " No note."}
                </Text>
              ) : null}

              <TextInput
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="Note for the patient — they will see this (optional)"
                placeholderTextColor={theme.colors.muted}
                className="rounded-xl px-3 py-2.5 text-xs"
                style={{
                  minHeight: 64,
                  backgroundColor: theme.colors.card,
                  borderWidth: 1,
                  borderColor: theme.colors.cardBorder,
                  color: theme.colors.ink,
                  textAlignVertical: "top",
                }}
              />

              <Text className="text-[12px] leading-4" style={{ color: theme.colors.muted }}>
                Agree = the detected condition matches what you see. Disagree = it doesn&apos;t, or
                you need to examine the patient first. The patient sees your choice and note on
                their scan. This is not a diagnosis, and the AI numbers are never changed.
              </Text>

              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => void submit("confirmed")}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel="Agree with the AI finding"
                  className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full py-2.5 active:opacity-80"
                  style={{
                    backgroundColor: theme.colors.primary,
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  <Text className="text-[13px] font-bold text-white">
                    {saving ? "Saving…" : "Agree with AI"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void submit("needs_review")}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel="Disagree with the AI finding or mark it as needing an exam"
                  className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full bg-white py-2.5 active:opacity-80"
                  style={{
                    borderWidth: 1,
                    borderColor: theme.colors.cardBorder,
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  <Text className="text-[13px] font-bold" style={{ color: theme.colors.danger }}>
                    Disagree / needs exam
                  </Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {result?.image_url ? (
        <Modal
          visible={photoOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setPhotoOpen(false)}
        >
          <View className="flex-1 items-center justify-center" style={{ backgroundColor: "#000" }}>
            <Image
              source={{ uri: result.image_url }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="contain"
              accessibilityLabel="Scan photo, full size"
            />
            <Pressable
              onPress={() => setPhotoOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close photo"
              hitSlop={10}
              className="absolute top-12 right-5 h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
            >
              <X size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
