import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { DoctorPatientDetail } from "@/components/DoctorPatientDetail";
import { FadeItem } from "@/components/FadeItem";
import { KeyboardAwareScroll } from "@/components/KeyboardAwareView";
import { StyledSafeAreaView as SafeAreaView } from "@/components/StyledSafeAreaView";
import { ScreenGradient } from "@/components/ScreenGradient";
import { BackHeader, UiModal } from "@/components/ui";
import { useDoctorBoard } from "@/hooks/useDoctorBoard";
import { patientDisplayFor } from "@/lib/db/appointments";
import { theme } from "@/lib/theme";

/** Doctor's patient screen for one appointment (opened from any doctor list). */
export default function DoctorPatientScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const board = useDoctorBoard();
  const row = board.rows.find((r) => r.id === id) ?? null;
  const name = row ? patientDisplayFor(row, board.patientNames) : "Patient";

  return (
    <SafeAreaView
      edges={["top"]}
      className="flex-1"
      style={{ backgroundColor: theme.colors.background }}
    >
      <ScreenGradient />
      <FadeItem index={0}>
        <View className="px-5 pt-4 pb-1 mt-2">
          <BackHeader
            title={name}
            subtitle={(row && board.reasonFor(row)) || "Patient"}
            onBack={() => router.back()}
          />
        </View>
      </FadeItem>

      <KeyboardAwareScroll
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 40,
          width: "100%",
          maxWidth: 760,
          alignSelf: "center",
        }}
      >
        <DoctorPatientDetail
          board={board}
          appointmentId={id ?? ""}
          onOpenAppointment={(r) => router.setParams({ id: r.id })}
        />
      </KeyboardAwareScroll>

      {/* Action errors (failed decline / cancel / mark done) surface here like on the tabs. */}
      <ActionErrorModal board={board} />
    </SafeAreaView>
  );
}

function ActionErrorModal({ board }: { board: ReturnType<typeof useDoctorBoard> }) {
  return (
    <UiModal
      visible={board.actionError !== null}
      onDismiss={board.dismissActionError}
      title={board.actionErrorTitle}
      message={board.actionError ?? ""}
      actions={[{ label: "OK", kind: "primary", onPress: board.dismissActionError }]}
    />
  );
}
