import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { Text } from "@/components/Text";
import { DoctorAppointmentCard } from "@/components/DoctorAppointmentCard";
import { DoctorProfileValidation } from "@/components/DoctorProfileValidation";
import { DoctorResultValidation } from "@/components/DoctorResultValidation";
import { CardListSkeleton, fmtVisitDate, visitDate, visitStatusPill } from "@/components/DoctorUi";
import { ClinicalCard, EmptyState, Pill } from "@/components/ui";
import { theme } from "@/lib/theme";
import type { AppointmentRow } from "@/lib/db/appointments";
import type { useDoctorBoard } from "@/hooks/useDoctorBoard";

type Board = ReturnType<typeof useDoctorBoard>;

function SectionLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <View className="mt-6 mb-2.5">
      <Text className="font-bold text-[17px]" style={{ color: theme.colors.ink }}>
        {title}
      </Text>
      {hint ? (
        <Text className="text-[13px] mt-0.5 leading-5" style={{ color: theme.colors.muted }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Everything a dermatologist needs for one appointment, top to bottom: the visit (who, when, why,
 * and the actions its status allows), the clinical review (scan photo + AI finding, patient-reported
 * profile) and the patient's other visits at this clinic. Used by the phone route
 * (/(modules)/doctor-patient) and the tablet Requests pane.
 */
export function DoctorPatientDetail({
  board,
  appointmentId,
  onOpenAppointment,
}: {
  board: Board;
  appointmentId: string;
  /** Opens another visit of the same patient. */
  onOpenAppointment: (row: AppointmentRow) => void;
}) {
  const { rows, loading, error } = board;
  const row = rows.find((r) => r.id === appointmentId) ?? null;

  const otherVisits = useMemo(() => {
    if (!row) return [];
    return rows
      .filter((r) => r.patient_id === row.patient_id && r.id !== row.id)
      .sort((a, b) => (visitDate(b)?.getTime() ?? 0) - (visitDate(a)?.getTime() ?? 0));
  }, [rows, row]);

  if (!row) {
    if (loading) return <CardListSkeleton count={2} />;
    return (
      <ClinicalCard>
        <EmptyState
          title={error ? "Couldn't load this visit" : "Visit not found"}
          copy={error ?? "It may have been removed, or it belongs to a different clinic."}
        />
      </ClinicalCard>
    );
  }

  // The review RPCs only answer while the patient has a non-cancelled / non-declined visit here.
  const reviewable = row.status !== "cancelled" && row.status !== "declined";
  const verdict = board.verdictFor(row);

  return (
    <View>
      <DoctorAppointmentCard {...board.cardProps(row)} />

      <SectionLabel
        title="Clinical review"
        hint={
          reviewable
            ? "Check the scan and the patient's own answers before the visit. Your verdicts and notes are shown to the patient."
            : undefined
        }
      />
      {reviewable ? (
        <View className="flex-col gap-3">
          <ClinicalCard>
            <DoctorResultValidation
              key={`scan-${row.patient_id}`}
              patientId={row.patient_id}
              defaultOpen
            />
          </ClinicalCard>
          <ClinicalCard>
            <DoctorProfileValidation
              key={`profile-${row.patient_id}`}
              patientId={row.patient_id}
              defaultOpen
            />
          </ClinicalCard>
        </View>
      ) : (
        <ClinicalCard>
          <Text className="text-[13px] leading-5" style={{ color: theme.colors.muted }}>
            This visit was {row.status}. Scan and profile details are only available while the
            patient has an open or completed visit at your clinic.
            {verdict ? `\n\nLast review — ${verdict}` : ""}
          </Text>
        </ClinicalCard>
      )}

      <SectionLabel
        title="Other visits at your clinic"
        hint={otherVisits.length === 0 ? "This is the patient's first visit here." : undefined}
      />
      {otherVisits.length > 0 ? (
        <ClinicalCard style={{ paddingVertical: 4 }}>
          {otherVisits.map((v, i) => {
            const pill = visitStatusPill(v.status);
            return (
              <Pressable
                key={v.id}
                onPress={() => onOpenAppointment(v)}
                accessibilityRole="button"
                accessibilityLabel={`${fmtVisitDate(v)}, ${pill.label}. Open visit.`}
                className="flex-row items-center gap-3 py-3 active:opacity-70"
                style={
                  i > 0 ? { borderTopWidth: 1, borderTopColor: theme.colors.divider } : undefined
                }
              >
                <Text className="flex-1 text-[14px]" style={{ color: theme.colors.ink }}>
                  {fmtVisitDate(v)}
                </Text>
                <Pill label={pill.label} tone={pill.tone} />
                <ChevronRight size={18} color={theme.colors.faint} />
              </Pressable>
            );
          })}
        </ClinicalCard>
      ) : null}
    </View>
  );
}
