import { useEffect, useState } from "react";
import { ActivityIndicator, TextInput, ToastAndroid, View } from "react-native";
import { Text } from "@/components/Text";
import { useRouter } from "expo-router";
import { CircleAlert } from "lucide-react-native";

import { FadeItem } from "@/components/FadeItem";
import { KeyboardAwareScroll } from "@/components/KeyboardAwareView";
import { StyledSafeAreaView as SafeAreaView } from "@/components/StyledSafeAreaView";
import { ScreenGradient } from "@/components/ScreenGradient";
import { BackHeader, Notice, PrimaryButton } from "@/components/ui";
import { cardShadow, theme } from "@/lib/theme";
import { getMyDoctorProfile, updateMyDoctorProfile } from "@/lib/db/appointments";

// Every doctor on SkinLens is a dermatologist — specialty isn't editable.
const SPECIALTY = "Dermatology";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View
      className="bg-white rounded-[20px] py-4 px-4 gap-3 mt-4"
      style={{ borderWidth: 1, borderColor: theme.colors.cardBorder, ...cardShadow }}
    >
      <Text className="text-base font-semibold" style={{ color: theme.colors.ink }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function FieldLabel({ label }: { label: string }) {
  return (
    <Text className="text-sm" style={{ color: theme.colors.muted }}>
      {label}
    </Text>
  );
}

export default function DoctorEditProfileScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [clinicName, setClinicName] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const prof = await getMyDoctorProfile();
        if (!alive) return;
        if (!prof) {
          setError("Link your clinic first — then you can edit your profile.");
          return;
        }
        setDisplayName(prof.displayName);
        setClinicName(prof.clinicName);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Couldn't load your profile.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleSave = async () => {
    setError(null);
    if (displayName.trim().length < 2) {
      setError("Enter your display name (at least 2 characters).");
      return;
    }
    setSaving(true);
    try {
      await updateMyDoctorProfile({ displayName, specialty: SPECIALTY });
      ToastAndroid.show("Profile updated", ToastAndroid.SHORT);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your profile.");
    } finally {
      setSaving(false);
    }
  };

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
            title="Edit Profile"
            subtitle="How patients see you when booking"
            onBack={() => router.back()}
          />
        </View>
      </FadeItem>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={theme.colors.primary} size="small" />
        </View>
      ) : (
        <KeyboardAwareScroll contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
          {error ? (
            <View className="mt-3">
              <Notice icon={CircleAlert} copy={error} />
            </View>
          ) : null}

          <FadeItem index={1}>
            <Section title="Doctor Info">
              <View className="gap-1.5">
                <FieldLabel label="Display Name" />
                <View
                  className="bg-white rounded-2xl px-4"
                  style={{ borderWidth: 1, borderColor: theme.colors.cardBorder }}
                >
                  <TextInput
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="Dr. Jane Cruz"
                    placeholderTextColor={theme.colors.faint}
                    maxLength={80}
                    className="py-3"
                    style={{ color: theme.colors.ink }}
                  />
                </View>
              </View>

            </Section>
          </FadeItem>

          {clinicName ? (
            <FadeItem index={2}>
              <Section title="Clinic">
                <Text className="text-sm" style={{ color: theme.colors.body }}>
                  {clinicName}
                </Text>
                <Text className="text-xs" style={{ color: theme.colors.faint }}>
                  Your clinic is set by invite code. Use “Switch clinic” on the Account tab to
                  change it.
                </Text>
              </Section>
            </FadeItem>
          ) : null}

          <FadeItem index={3}>
            <View className="mt-5">
              <PrimaryButton
                label={saving ? "Please wait…" : "Save Changes"}
                onPress={handleSave}
                disabled={saving || !clinicName}
              />
            </View>
          </FadeItem>
        </KeyboardAwareScroll>
      )}
    </SafeAreaView>
  );
}
