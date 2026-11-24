import * as ExpoNotifications from "expo-notifications";

import type { Notification } from "@/types/schema";
import notificationsData from "@/data/notifications.json";

/*
 * Appointment notifications (patient replies + doctor booking requests) are created on the server
 * by the `appointments_notify` trigger (supabase/migrations/0019_notifications.sql). This file only
 * builds the app-generated reminders and shows on-device banners.
 */

const SCAN_REMINDERS = notificationsData.scanReminders;

const DAILY_TIPS = notificationsData.dailyTips;

/** Local calendar date (YYYY-MM-DD) — UTC would roll "today" over at 8 AM in Manila. */
export function localDateKey(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function generateScanReminder(): Notification | null {
  const today = localDateKey();
  const index =
    today.split("-").reduce((acc, v) => acc + parseInt(v, 10), 0) % SCAN_REMINDERS.length;
  const { title, message } = SCAN_REMINDERS[index];

  return {
    id: `scan-${today}`,
    type: "scan_reminder",
    title,
    message,
    read: false,
    created_at: new Date().toISOString(),
  };
}

export function generateDailyTip(): Notification | null {
  const today = localDateKey();
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000,
  );
  const index = dayOfYear % DAILY_TIPS.length;
  const { title, message } = DAILY_TIPS[index];

  return {
    id: `tip-${today}`,
    type: "daily_tip",
    title,
    message,
    read: false,
    created_at: new Date().toISOString(),
  };
}

/** Immediate OS banner for a notification that just arrived while the app is open. */
export async function showSystemBanner(n: Pick<Notification, "title" | "message" | "type">) {
  try {
    const { status } = await ExpoNotifications.getPermissionsAsync();
    if (status !== "granted") return;
    await ExpoNotifications.scheduleNotificationAsync({
      content: { title: n.title, body: n.message, data: { type: n.type } },
      trigger: null,
    });
  } catch {
    /* banner is best-effort — the in-app notification is the record */
  }
}
