import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { Notification, NotificationSettings } from "@/types/schema";
import {
  generateDailyTip,
  generateScanReminder,
  localDateKey,
  showSystemBanner,
} from "@/lib/notifications";
import {
  cancelAllScheduledNotifications,
  scheduleDailySkincareTip,
  scheduleWeeklyScanReminder,
} from "@/lib/push-notifications";
import {
  clearAllNotifications as dbClearAll,
  deleteNotification as dbDeleteNotification,
  getNotifications,
  insertNotification,
  markAllNotificationsAsRead as dbMarkAllAsRead,
  markNotificationAsRead as dbMarkAsRead,
} from "@/lib/db/notifications";
import {
  doctorNotificationSettingsSchema,
  notificationSettingsSchema,
  parseJson,
} from "@/lib/validation";
import { supabase } from "@/utils/supabase";

const NOTIFICATION_SETTINGS_KEY = "notification_settings";
// The doctor-only toggle lives under its own key: saving it into the main
// blob would persist the default scanReminders=true, and the next launch
// would then schedule patient scan reminders on a doctor's phone.
const DOCTOR_NOTIFICATION_SETTINGS_KEY = "doctor_notification_settings";
// Per user: the last local date each reminder kind was generated. Without it a
// reminder the user deleted came straight back on the next home-screen focus.
const GENERATED_KEY = "notifications_generated";

type NotificationContextType = {
  settings: NotificationSettings;
  notifications: Notification[];
  unreadCount: number;
  updateSettings: (settings: Partial<NotificationSettings>) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  generateNotifications: () => Promise<void>;
  refresh: () => Promise<void>;
};

const defaultSettings: NotificationSettings = {
  scanReminders: true,
  dailyTips: false,
  appointmentRequests: true,
};

function sortAndDedupe(list: Notification[]): Notification[] {
  return Array.from(new Map(list.map((n) => [n.id, n])).values())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 100);
}

type ServerRow = {
  id: string;
  user_id: string;
  type: Notification["type"];
  title: string;
  message: string;
  read: boolean;
  created_at: string;
};

function fromServer(row: ServerRow): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    read: row.read,
    created_at: row.created_at,
  };
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<NotificationSettings>(defaultSettings);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // Whose notifications are on screen. The provider sits above every route, so
  // it must follow sign-in / sign-out / account switches itself.
  const [userId, setUserId] = useState<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  // Guards concurrent generateNotifications() calls (home focus + pull to refresh can overlap).
  const generatingRef = useRef(false);
  // Latest settings as seen by the mutation callbacks below (they are
  // useCallback([]) so they can't close over the state without going stale).
  const settingsRef = useRef(settings);
  // Serializes cancel/reschedule: two rapid toggles used to interleave and
  // could leave a reminder scheduled for a feature just switched off.
  const settingsChainRef = useRef<Promise<void>>(Promise.resolve());
  // Ids already shown, so a realtime INSERT for a row the last fetch already
  // returned doesn't fire a second banner.
  const knownIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const n of notifications) knownIdsRef.current.add(n.id);
  }, [notifications]);

  const reload = useCallback(async () => {
    const forUser = userIdRef.current;
    if (!forUser) {
      setNotifications([]);
      return;
    }
    try {
      const list = await getNotifications();
      // A slow fetch must not paint the previous account's list after a switch.
      if (userIdRef.current === forUser) setNotifications(sortAndDedupe(list));
    } catch (err) {
      console.error("Error loading notifications:", err);
    }
  }, []);

  /* ---------- settings (device-level) ---------- */

  useEffect(() => {
    (async () => {
      try {
        const stored = parseJson(
          await AsyncStorage.getItem(NOTIFICATION_SETTINGS_KEY),
          notificationSettingsSchema,
        );
        let next = settingsRef.current;
        if (stored) {
          // Older saves predate newer keys — fill them from the defaults.
          next = { ...defaultSettings, ...stored };
          // Calendar triggers are idempotent to re-arm (fixed time of day), so
          // a launch no longer pushes the next reminder a full interval away.
          if (next.scanReminders) await scheduleWeeklyScanReminder();
          if (next.dailyTips) await scheduleDailySkincareTip();
        }
        const doctorSaved = parseJson(
          await AsyncStorage.getItem(DOCTOR_NOTIFICATION_SETTINGS_KEY),
          doctorNotificationSettingsSchema,
        );
        if (doctorSaved?.appointmentRequests !== undefined) {
          next = { ...next, appointmentRequests: doctorSaved.appointmentRequests };
        }
        settingsRef.current = next;
        setSettings(next);
      } catch (err) {
        console.error("Error loading notification settings:", err);
      }
    })();
  }, []);

  /* ---------- follow the signed-in account ---------- */

  useEffect(() => {
    const apply = (id: string | null) => {
      if (userIdRef.current === id) return;
      userIdRef.current = id;
      knownIdsRef.current = new Set();
      setUserId(id);
      setNotifications([]);
    };
    supabase.auth
      .getSession()
      .then(({ data }) => apply(data.session?.user.id ?? null))
      .catch(() => apply(null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session?.user.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return;
    // Fetch-on-sign-in: setState happens in async continuations after awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();

    // Live updates: trigger-created appointment notices (and changes made on
    // the user's other devices) arrive without a manual refresh. RLS limits
    // the stream to the user's own rows; the filter just saves bandwidth.
    let channel: RealtimeChannel | null = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (userIdRef.current !== userId) return;
          if (payload.eventType === "INSERT") {
            const n = fromServer(payload.new as ServerRow);
            const isNew = !knownIdsRef.current.has(n.id);
            knownIdsRef.current.add(n.id);
            setNotifications((prev) =>
              prev.some((p) => p.id === n.id) ? prev : sortAndDedupe([n, ...prev]),
            );
            const wantsBanner =
              n.type === "appointment_reply" ||
              (n.type === "appointment_request" && settingsRef.current.appointmentRequests);
            if (isNew && wantsBanner) void showSystemBanner(n);
          } else if (payload.eventType === "UPDATE") {
            const n = fromServer(payload.new as ServerRow);
            setNotifications((prev) =>
              prev.map((p) => (p.id === n.id ? { ...p, read: p.read || n.read } : p)),
            );
          } else if (payload.eventType === "DELETE") {
            const id = (payload.old as Partial<ServerRow>).id;
            if (id) setNotifications((prev) => prev.filter((p) => p.id !== id));
          }
        },
      )
      .subscribe();

    // Realtime drops while backgrounded — catch up on return.
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") void reload();
    });

    return () => {
      appStateSub.remove();
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [userId, reload]);

  /* ---------- mutations ---------- */

  const updateSettings = useCallback(async (partial: Partial<NotificationSettings>) => {
    // Read from the ref (not the useCallback closure) so two toggles in
    // quick succession both see the result of the first one.
    const next = { ...settingsRef.current, ...partial };
    settingsRef.current = next;
    setSettings(next);

    // Only the reminder toggles own scheduled OS notifications; flipping
    // e.g. appointmentRequests must not (re)schedule a doctor's reminders.
    const touchesSchedule = "scanReminders" in partial || "dailyTips" in partial;
    const apply = async () => {
      if ("appointmentRequests" in partial) {
        await AsyncStorage.setItem(
          DOCTOR_NOTIFICATION_SETTINGS_KEY,
          JSON.stringify({ appointmentRequests: next.appointmentRequests }),
        );
      }
      if (!touchesSchedule) return;
      await AsyncStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(next));
      // Cancel everything first so toggles that are switched off stop firing,
      // then re-schedule what is still enabled.
      await cancelAllScheduledNotifications();
      if (next.scanReminders) await scheduleWeeklyScanReminder();
      if (next.dailyTips) await scheduleDailySkincareTip();
    };
    const run = settingsChainRef.current.then(apply, apply);
    settingsChainRef.current = run.catch(() => {});
    await run;
  }, []);

  const markAsRead = useCallback(
    async (id: string) => {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      try {
        await dbMarkAsRead(id);
      } catch (err) {
        // Optimistic only — without this the item stayed visibly read while
        // the row was unchanged, so it "un-read itself" on the next reload.
        console.error("[notifications] markAsRead failed:", err);
        await reload();
      }
    },
    [reload],
  );

  const markAllAsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await dbMarkAllAsRead();
    } catch (err) {
      console.error("[notifications] markAllAsRead failed:", err);
      await reload();
    }
  }, [reload]);

  const deleteNotification = useCallback(
    async (id: string) => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      try {
        await dbDeleteNotification(id);
      } catch (err) {
        console.error("[notifications] delete failed:", err);
        await reload();
      }
    },
    [reload],
  );

  const clearAll = useCallback(async () => {
    setNotifications([]);
    try {
      await dbClearAll();
    } catch (err) {
      console.error("[notifications] clearAll failed:", err);
      await reload();
    }
  }, [reload]);

  /**
   * Adds today's scan reminder / skin tip (once per local day per account), then
   * re-reads the list so appointment notices that arrived meanwhile show too.
   */
  const generateNotifications = useCallback(async () => {
    const forUser = userIdRef.current;
    if (!forUser || generatingRef.current) return;
    generatingRef.current = true;
    try {
      const key = `${GENERATED_KEY}:${forUser}`;
      let generated: Record<string, string> = {};
      try {
        generated = JSON.parse((await AsyncStorage.getItem(key)) ?? "{}");
      } catch {
        generated = {};
      }
      const today = localDateKey();
      const fresh: Notification[] = [];
      if (settingsRef.current.scanReminders && generated.scan !== today) {
        const n = generateScanReminder();
        if (n) fresh.push(n);
        generated.scan = today;
      }
      if (settingsRef.current.dailyTips && generated.tip !== today) {
        const n = generateDailyTip();
        if (n) fresh.push(n);
        generated.tip = today;
      }
      for (const n of fresh) await insertNotification(n);
      if (fresh.length > 0) {
        await AsyncStorage.setItem(key, JSON.stringify(generated)).catch(() => {});
      }
      await reload();
    } finally {
      generatingRef.current = false;
    }
  }, [reload]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        settings,
        notifications,
        unreadCount,
        updateSettings,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        clearAll,
        generateNotifications,
        refresh: reload,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return context;
}
