import { Image, Pressable, useWindowDimensions, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight } from "lucide-react-native";

import { Text } from "@/components/Text";
import Skeleton from "@/components/Skeleton";
import { ClinicalCard, Pill } from "@/components/ui";
import { theme } from "@/lib/theme";
import {
  isRemoteImageUrl,
  type AppointmentRow,
  type AppointmentStatus,
} from "@/lib/db/appointments";

function initialOf(name: string): string {
  const clean = name.trim().replace(/^@/, "");
  return (clean.charAt(0) || "?").toUpperCase();
}

export function PatientAvatar({
  name,
  url,
  size = 40,
  ring,
}: {
  name: string;
  url?: string | null;
  size?: number;
  /** Optional border colour (e.g. on the dark hero). */
  ring?: string;
}) {
  const border = ring ? { borderWidth: 2, borderColor: ring } : null;
  if (isRemoteImageUrl(url)) {
    return (
      <Image
        source={{ uri: (url as string).trim() }}
        style={{
          height: size,
          width: size,
          borderRadius: 999,
          backgroundColor: theme.colors.primarySoft,
          ...border,
        }}
        accessibilityLabel={`${name} profile photo`}
      />
    );
  }
  return (
    <LinearGradient
      colors={[...theme.gradients.icon]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        height: size,
        width: size,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        ...border,
      }}
    >
      <Text className="font-bold text-white" style={{ fontSize: Math.round(size * 0.4) }}>
        {initialOf(name)}
      </Text>
    </LinearGradient>
  );
}

/** Pill-shaped segmented control (filters inside a screen). */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string; count?: number }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <View
      className="flex-row p-1 rounded-full"
      style={{
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.cardBorder,
      }}
      accessibilityRole="tablist"
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full py-2 active:opacity-80"
            style={{ backgroundColor: active ? theme.colors.primary : "transparent" }}
          >
            <Text
              className="text-[13px] font-bold"
              style={{ color: active ? "#FFFFFF" : theme.colors.muted }}
              numberOfLines={1}
            >
              {o.label}
            </Text>
            {o.count ? (
              <Text
                className="text-[13px]"
                style={{ color: active ? "rgba(255,255,255,0.75)" : theme.colors.faint }}
              >
                {o.count}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One tappable patient line used by every doctor list: avatar, name, the reason for the visit,
 * a time/status detail and a trailing meta or status pill. Tapping opens the patient screen.
 */
export function PatientRow({
  name,
  avatarUrl,
  concern,
  detail,
  note,
  meta,
  metaTone = "faint",
  pill,
  chevron = false,
  onPress,
  divider = false,
  selected = false,
}: {
  name: string;
  avatarUrl?: string | null;
  /** Why the patient is coming (self-reported concern / AI finding). */
  concern?: string | null;
  detail: string;
  /** Extra line under the detail, e.g. the doctor's verdict on the scan (History). */
  note?: string | null;
  meta?: string;
  /** Colour of the trailing meta (amber for waiting requests). */
  metaTone?: "faint" | "warning" | "primary";
  /** Trailing status chip, e.g. "Completed". Shown instead of nothing when there's no meta. */
  pill?: { label: string; tone: "primary" | "neutral" | "warning" };
  chevron?: boolean;
  onPress?: () => void;
  divider?: boolean;
  /** Highlighted (the open patient in the tablet two-pane layout). */
  selected?: boolean;
}) {
  const metaColor =
    metaTone === "warning"
      ? theme.colors.warningText
      : metaTone === "primary"
        ? theme.colors.primary
        : theme.colors.faint;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={selected ? { selected: true } : undefined}
      accessibilityLabel={[name, concern, detail, meta ?? pill?.label].filter(Boolean).join(", ")}
      className="flex-row items-center gap-3 py-3 active:opacity-70"
      style={{
        ...(divider ? { borderTopWidth: 1, borderTopColor: theme.colors.divider } : null),
        ...(selected
          ? {
              backgroundColor: theme.colors.primarySoft,
              marginHorizontal: -10,
              paddingHorizontal: 10,
              borderRadius: 14,
            }
          : null),
      }}
    >
      <PatientAvatar name={name} url={avatarUrl} size={42} />
      <View className="flex-1">
        <Text
          className="text-[15px] font-bold"
          style={{ color: theme.colors.ink }}
          numberOfLines={1}
        >
          {name}
        </Text>
        {concern ? (
          <Text
            className="text-[13px] mt-0.5"
            style={{ color: theme.colors.body }}
            numberOfLines={1}
          >
            {concern}
          </Text>
        ) : null}
        <Text
          className="text-[13px] mt-0.5"
          style={{ color: theme.colors.muted }}
          numberOfLines={1}
        >
          {detail}
        </Text>
        {note ? (
          <Text
            className="text-[13px] mt-0.5"
            style={{ color: theme.colors.primaryDeep }}
            numberOfLines={2}
          >
            {note}
          </Text>
        ) : null}
      </View>
      {meta ? (
        <Text className="text-[12px] font-bold" style={{ color: metaColor }}>
          {meta}
        </Text>
      ) : pill ? (
        <Pill label={pill.label} tone={pill.tone} />
      ) : null}
      {chevron && onPress ? <ChevronRight size={18} color={theme.colors.faint} /> : null}
    </Pressable>
  );
}

/** Section header used across the doctor tabs: title, optional count and trailing link. */
export function SectionHeader({
  title,
  count,
  actionLabel,
  onAction,
  pill = false,
}: {
  title: string;
  count?: number;
  actionLabel?: string;
  onAction?: () => void;
  /** Count in a tinted pill and an arrow on the link (Home's style). */
  pill?: boolean;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Text className="font-bold text-[16px]" style={{ color: theme.colors.ink }}>
        {title}
      </Text>
      {pill && count !== undefined ? (
        <View
          className="rounded-full px-2 py-0.5"
          style={{ backgroundColor: theme.colors.primarySoft }}
        >
          <Text className="text-[12px] font-bold" style={{ color: theme.colors.primaryDeep }}>
            {count}
          </Text>
        </View>
      ) : count ? (
        <Text className="text-[16px]" style={{ color: theme.colors.faint }}>
          {count}
        </Text>
      ) : null}
      <View className="flex-1" />
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={10}
          accessibilityRole="link"
          accessibilityLabel={actionLabel}
          className="flex-row items-center gap-0.5 active:opacity-60"
        >
          <Text
            className={pill ? "text-xs font-bold" : "text-[13px] font-semibold"}
            style={{ color: theme.colors.primary }}
          >
            {actionLabel}
          </Text>
          {pill ? <ChevronRight size={14} color={theme.colors.primary} /> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

export function CardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ClinicalCard className="flex-col">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} className="flex-row items-center gap-3 py-3">
          <Skeleton className="h-11 w-11 rounded-full" />
          <View className="flex-1 gap-1.5">
            <Skeleton className="h-4 w-32 rounded-md" />
            <Skeleton className="h-3 w-44 rounded-md" />
          </View>
          <Skeleton className="h-5 w-14 rounded-full" />
        </View>
      ))}
    </ClinicalCard>
  );
}

/** "9:30 AM" */
export function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "in 25 min", "in 2h 10m", "now", "15 min ago" */
export function fmtCountdown(at: Date, now: number): string {
  const mins = Math.round((at.getTime() - now) / 60000);
  if (mins === 0) return "now";
  const abs = Math.abs(mins);
  const text =
    abs < 60 ? `${abs} min` : `${Math.floor(abs / 60)}h${abs % 60 ? ` ${abs % 60}m` : ""}`;
  return mins > 0 ? `in ${text}` : `${text} ago`;
}

/** One status chip wording for every doctor list. */
export function visitStatusPill(status: AppointmentStatus): {
  label: string;
  tone: "primary" | "neutral" | "warning";
} {
  switch (status) {
    case "requested":
      return { label: "New request", tone: "warning" };
    case "needs_reschedule":
      return { label: "Rebooking", tone: "warning" };
    case "scheduled":
      return { label: "Booked", tone: "primary" };
    case "completed":
      return { label: "Completed", tone: "primary" };
    case "declined":
      return { label: "Declined", tone: "neutral" };
    default:
      return { label: "Cancelled", tone: "neutral" };
  }
}

/** The date that matters for a visit: booked time, else the requested time, else when it was made. */
export function visitDate(row: AppointmentRow): Date | null {
  const iso = row.scheduled_at ?? row.preferred_time ?? row.created_at;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Nov 20, 2026 · 10:30 AM" */
export function fmtVisitDate(row: AppointmentRow): string {
  const d = visitDate(row);
  if (!d) return "No date";
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${fmtTime(d)}`;
}

/** Tablet / landscape width where the doctor lists show the patient beside the list. */
export const WIDE_BREAKPOINT = 768;

export function useIsWide(): boolean {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}
