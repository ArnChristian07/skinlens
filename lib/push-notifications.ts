import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // shouldShowAlert is deprecated in SDK 57 — banner + list replace it.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

async function cancelByType(type: string) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.content.data?.type === type) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
}

/**
 * Every Monday at 10:00 local time. A calendar trigger (not TIME_INTERVAL) repeats on its own and
 * re-arming it on launch doesn't push the next one a full week away.
 */
export async function scheduleWeeklyScanReminder() {
  const granted = await requestNotificationPermissions();
  if (!granted) return;

  await cancelByType("scan_reminder");
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Weekly scan due",
      body: "Take a photo under similar lighting to compare with last week.",
      data: { type: "scan_reminder" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 2, // 1 = Sunday … 7 = Saturday
      hour: 10,
      minute: 0,
    },
  });
}

/** Every day at 08:00 local time. */
export async function scheduleDailySkincareTip() {
  const granted = await requestNotificationPermissions();
  if (!granted) return;

  await cancelByType("daily_tip");
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Skin tip for today",
      body: "Apply SPF 30 or higher each morning, even when it is cloudy.",
      data: { type: "daily_tip" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 8,
      minute: 0,
    },
  });
}

export async function cancelAllScheduledNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
