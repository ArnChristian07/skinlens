import { useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { ArrowUpDown, CalendarClock, ChevronRight, Stethoscope } from "lucide-react-native";

import { Text } from "@/components/Text";
import { FadeItem } from "@/components/FadeItem";
import { CoachTarget } from "@/components/TutorialCoach";
import { useCoachScroller } from "@/hooks/useCoachScroller";
import { relativeAgo } from "@/components/DoctorAppointmentCard";
import { DoctorPatientDetail } from "@/components/DoctorPatientDetail";
import { fmtSlot } from "@/components/DoctorScheduleSheet";
import { CardListSkeleton, PatientAvatar, useIsWide } from "@/components/DoctorUi";
import { KeyboardAwareScroll } from "@/components/KeyboardAwareView";
import { StyledSafeAreaView as SafeAreaView } from "@/components/StyledSafeAreaView";
import { ScreenGradient } from "@/components/ScreenGradient";
import {
  ClinicalCard,
  EmptyState,
  Pill,
  ScreenHeader,
  SecondaryButton,
  UiModal,
} from "@/components/ui";
import { parseIso, useDoctorBoard, useNow } from "@/hooks/useDoctorBoard";
import { cardShadow, theme } from "@/lib/theme";
import { TAB_BAR_CLEARANCE } from "@/lib/tabs-config";
import {
  isPendingStatus,
  patientAvatarFor,
  patientDisplayFor,
  type AppointmentRow,
} from "@/lib/db/appointments";

type Filter = "all" | "new" | "awaiting";
type Sort = "oldest" | "soonest";

/** Requests older than this show their age in amber. */
const STALE_MS = 48 * 60 * 60 * 1000;
/** Width of the list column next to the patient pane on tablets. */
const LIST_PANE_WIDTH = 380;

const time = (iso: string | null, fallback: number) => parseIso(iso)?.getTime() ?? fallback;

/**
 * Pending visit requests at the clinic — the doctor's inbox. Phones: one card per patient, each
 * opens the patient screen. Tablets: the list on the left, the selected patient on the right.
 */
export default function DoctorRequests() {
  const board = useDoctorBoard();
  const { rows, loading, refreshing, error, refresh, patientNames, patientAvatars } = board;
  const scrollRef = useRef<ScrollView>(null);
  const { onScroll, scrollIntoView } = useCoachScroller(scrollRef);
  const wide = useIsWide();
  const now = useNow();

  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("oldest");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pending = useMemo(() => rows.filter((r) => isPendingStatus(r.status)), [rows]);
  const counts = {
    all: pending.length,
    new: pending.filter((r) => r.status === "requested").length,
    awaiting: pending.filter((r) => r.status === "needs_reschedule").length,
  };

  const list = useMemo(() => {
    const filtered = pending.filter((r) =>
      filter === "all"
        ? true
        : filter === "new"
          ? r.status === "requested"
          : r.status === "needs_reschedule",
    );
    const byOldest = (a: AppointmentRow, b: AppointmentRow) =>
      time(a.created_at, 0) - time(b.created_at, 0);
    // Soonest requested time first; "any time" requests go last.
    const bySoonest = (a: AppointmentRow, b: AppointmentRow) =>
      time(a.preferred_time, Infinity) - time(b.preferred_time, Infinity) || byOldest(a, b);
    return [...filtered].sort(sort === "oldest" ? byOldest : bySoonest);
  }, [pending, filter, sort]);

  // Tablet: keep the chosen patient open; once they're booked / declined, fall back to the next one.
  const selected = wide ? (list.find((r) => r.id === selectedId) ?? list[0] ?? null) : null;

  const open = (a: AppointmentRow) => (wide ? setSelectedId(a.id) : board.openPatient(a));

  const oldest = useMemo(
    () => [...pending].sort((x, y) => time(x.created_at, 0) - time(y.created_at, 0))[0] ?? null,
    [pending],
  );
  const subtitle = loading
    ? "Patients waiting for a visit time"
    : pending.length === 0
      ? "No one is waiting"
      : `${pending.length} waiting · oldest ${relativeAgo(oldest?.created_at ?? null)}`;

  const listBody = (
    <>
      <FadeItem index={0}>
        <View className="mt-2">
          <ScreenHeader title="Requests" subtitle={subtitle} />
        </View>
      </FadeItem>

      <FadeItem index={1}>
        <CoachTarget
          id="doctor.requests"
          scrollIntoView={scrollIntoView}
          className="mt-4 flex-row items-center gap-2"
        >
          <FilterChip
            label="All"
            count={counts.all}
            active={filter === "all"}
            onPress={() => setFilter("all")}
          />
          <FilterChip
            label="New"
            count={counts.new}
            active={filter === "new"}
            onPress={() => setFilter("new")}
          />
          <FilterChip
            label="Rebooking"
            count={counts.awaiting}
            active={filter === "awaiting"}
            onPress={() => setFilter("awaiting")}
          />
          <View className="flex-1" />
          <Pressable
            onPress={() => setSort(sort === "oldest" ? "soonest" : "oldest")}
            accessibilityRole="button"
            accessibilityLabel={`Sort: ${sort === "oldest" ? "oldest request first" : "soonest requested time first"}. Tap to change.`}
            hitSlop={8}
            className="flex-row items-center gap-1 active:opacity-70"
          >
            <ArrowUpDown size={14} color={theme.colors.primary} />
            <Text className="text-[13px] font-semibold" style={{ color: theme.colors.primary }}>
              {sort === "oldest" ? "Oldest" : "Soonest"}
            </Text>
          </Pressable>
        </CoachTarget>
      </FadeItem>

      <View className="mt-4" key={`${filter}-${sort}`}>
        {loading ? (
          <CardListSkeleton />
        ) : error ? (
          <ClinicalCard>
            <EmptyState title="Couldn't load requests" copy={error} />
            <SecondaryButton label="Try again" onPress={() => void refresh()} />
          </ClinicalCard>
        ) : list.length === 0 ? (
          <FadeItem index={2}>
            <ClinicalCard>
              <EmptyState
                title={filter === "all" ? "Inbox zero" : "Nothing here"}
                copy={
                  filter === "awaiting"
                    ? "No patients are choosing a new time right now."
                    : "New visit requests for your clinic will show up here."
                }
              />
            </ClinicalCard>
          </FadeItem>
        ) : (
          <View className="flex-col gap-3">
            {list.map((a, i) => (
              <FadeItem key={a.id} index={Math.min(2 + i, 8)}>
                <RequestCard
                  row={a}
                  name={patientDisplayFor(a, patientNames)}
                  avatarUrl={patientAvatarFor(a, patientAvatars)}
                  concern={board.reasonFor(a)}
                  assignedToOther={board.cardProps(a).assignedToOther}
                  stale={now - time(a.created_at, now) > STALE_MS}
                  selected={wide && selected?.id === a.id}
                  onPress={() => open(a)}
                />
              </FadeItem>
            ))}
          </View>
        )}
      </View>
    </>
  );

  return (
    <SafeAreaView
      edges={["top"]}
      className="flex-1"
      style={{ backgroundColor: theme.colors.background }}
    >
      <ScreenGradient />
      <View className="flex-1 flex-row">
        <ScrollView
          ref={scrollRef}
          style={wide ? { width: LIST_PANE_WIDTH, flexGrow: 0 } : { flex: 1 }}
          showsVerticalScrollIndicator={false}
          // Padding lives here, not in className: NativeWind drops className styles when an explicit
          // `style` is also passed, which left the list flush against the screen edges.
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: TAB_BAR_CLEARANCE }}
          onScroll={onScroll}
          scrollEventThrottle={32}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
        >
          {listBody}
        </ScrollView>

        {wide ? (
          <View
            className="flex-1"
            style={{ borderLeftWidth: 1, borderLeftColor: theme.colors.divider }}
          >
            {selected ? (
              <KeyboardAwareScroll
                key={selected.id}
                contentContainerStyle={{
                  paddingHorizontal: 24,
                  paddingTop: 16,
                  paddingBottom: TAB_BAR_CLEARANCE,
                }}
              >
                <DoctorPatientDetail
                  board={board}
                  appointmentId={selected.id}
                  onOpenAppointment={(r) => board.openPatient(r)}
                />
              </KeyboardAwareScroll>
            ) : (
              <View className="flex-1 items-center justify-center px-8">
                <Text className="text-[15px]" style={{ color: theme.colors.muted }}>
                  {loading ? "Loading…" : "Select a request to see the patient."}
                </Text>
              </View>
            )}
          </View>
        ) : null}
      </View>

      <UiModal
        visible={board.actionError !== null}
        onDismiss={board.dismissActionError}
        title={board.actionErrorTitle}
        message={board.actionError ?? ""}
        actions={[{ label: "OK", kind: "primary", onPress: board.dismissActionError }]}
      />
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${count}`}
      accessibilityState={{ selected: active }}
      className="flex-row items-center gap-1.5 rounded-full px-3.5 py-2 active:opacity-70"
      style={{
        backgroundColor: active ? theme.colors.primary : theme.colors.card,
        borderWidth: 1,
        borderColor: active ? theme.colors.primary : theme.colors.cardBorder,
      }}
    >
      <Text
        className="text-[13px] font-bold"
        style={{ color: active ? "#FFFFFF" : theme.colors.body }}
      >
        {label}
      </Text>
      {count > 0 ? (
        <Text
          className="text-[12px] font-bold"
          style={{ color: active ? "rgba(255,255,255,0.8)" : theme.colors.faint }}
        >
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** One waiting patient: who + status, the reason for the visit, and the time they asked for. */
function RequestCard({
  row,
  name,
  avatarUrl,
  concern,
  assignedToOther,
  stale,
  selected,
  onPress,
}: {
  row: AppointmentRow;
  name: string;
  avatarUrl: string | null;
  concern: string | null;
  assignedToOther: string | null;
  stale: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const rebooking = row.status === "needs_reschedule";
  const t = parseIso(row.preferred_time);
  const when = rebooking ? "Choosing a new time" : t ? fmtSlot(t) : "Any time that suits";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={selected ? { selected: true } : undefined}
      accessibilityLabel={[
        name,
        rebooking ? "rebooking" : "new request",
        concern,
        when,
        `requested ${relativeAgo(row.created_at)}`,
      ]
        .filter(Boolean)
        .join(", ")}
      className="active:opacity-90"
      style={{
        backgroundColor: theme.colors.card,
        borderRadius: theme.radius.card,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.primary : theme.colors.cardBorder,
        padding: 16,
        ...cardShadow,
      }}
    >
      {/* Who */}
      <View className="flex-row items-center gap-3">
        <PatientAvatar name={name} url={avatarUrl} size={46} />
        <View className="flex-1">
          <Text
            className="text-[16px] font-bold"
            style={{ color: theme.colors.ink }}
            numberOfLines={1}
          >
            {name}
          </Text>
          <Text
            className="text-[13px] mt-0.5"
            style={{
              color: stale ? theme.colors.warningText : theme.colors.muted,
              fontWeight: stale ? "600" : "400",
            }}
          >
            Requested {relativeAgo(row.created_at)}
            {stale ? " · waiting long" : ""}
          </Text>
        </View>
        <Pill label={rebooking ? "Rebooking" : "New"} tone={rebooking ? "warning" : "primary"} />
      </View>

      {/* Why */}
      <View
        className="flex-row items-start gap-2 rounded-2xl px-3 py-2.5 mt-3"
        style={{ backgroundColor: theme.colors.background }}
      >
        <Stethoscope size={15} color={theme.colors.primary} style={{ marginTop: 2 }} />
        <Text
          className="text-[14px] flex-1 leading-5"
          style={{ color: concern ? theme.colors.ink : theme.colors.faint }}
          numberOfLines={2}
        >
          {concern ?? "No concern given — open to see the scan"}
        </Text>
      </View>

      {/* When */}
      <View className="flex-row items-center gap-2 mt-3">
        <CalendarClock
          size={15}
          color={rebooking ? theme.colors.warningText : theme.colors.muted}
        />
        <Text
          className="text-[13px] font-semibold flex-1"
          style={{ color: rebooking ? theme.colors.warningText : theme.colors.body }}
          numberOfLines={1}
        >
          {when}
        </Text>
        {assignedToOther ? (
          <Text className="text-[12px]" style={{ color: theme.colors.faint }} numberOfLines={1}>
            For {assignedToOther}
          </Text>
        ) : null}
        <ChevronRight size={18} color={theme.colors.faint} />
      </View>
    </Pressable>
  );
}
