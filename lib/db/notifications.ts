import type { Notification } from "@/types/schema";
import { supabase } from "@/utils/supabase";

import { requireUser } from "./auth";
import { getDatabase } from "./database";
import { enqueueSync, removeSyncEntry } from "./sync-queue";

/**
 * Supabase `public.notifications` is the source of truth (0019 migration): appointment notices are
 * inserted there by database triggers, scan reminders / tips by the app. SQLite is an offline cache
 * plus a holding area for writes that haven't reached the server yet (they sit in sync_queue).
 */

type LocalRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  read: number;
  created_at: string;
};

type ServerRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
};

const SERVER_LIMIT = 100;

function rowToNotification(row: LocalRow): Notification {
  return {
    id: row.id,
    type: row.type as Notification["type"],
    title: row.title,
    message: row.message,
    read: row.read === 1,
    created_at: row.created_at,
  };
}

async function currentUserId(): Promise<string | null> {
  try {
    return (await requireUser()).id;
  } catch {
    return null;
  }
}

/** Writes still waiting for the server, so a fresh server fetch doesn't undo them. */
async function pendingOps(userId: string) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ operation: string; record_id: string | null; payload: string }>(
    `SELECT operation, record_id, payload FROM sync_queue WHERE table_name = 'notifications'`,
  );
  const deleted = new Set<string>();
  const read = new Set<string>();
  const inserted = new Set<string>();
  let clearedBefore: string | null = null;
  let readAllBefore: string | null = null;
  for (const r of rows) {
    let p: { user_id?: string; before?: string } = {};
    try {
      p = JSON.parse(r.payload);
    } catch {
      continue;
    }
    if (p.user_id && p.user_id !== userId) continue;
    if (r.operation === "delete") {
      if (r.record_id) deleted.add(r.record_id);
      else if (p.before && (!clearedBefore || p.before > clearedBefore)) clearedBefore = p.before;
    } else if (r.operation === "update") {
      if (r.record_id) read.add(r.record_id);
      else if (p.before && (!readAllBefore || p.before > readAllBefore)) readAllBefore = p.before;
    } else if (r.record_id) {
      inserted.add(r.record_id);
    }
  }
  return { deleted, read, inserted, clearedBefore, readAllBefore };
}

async function readLocal(userId: string): Promise<LocalRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<LocalRow>(
    `SELECT id, user_id, type, title, message, read, created_at
     FROM notifications WHERE user_id = ? ORDER BY created_at DESC`,
    [userId],
  );
}

/** Server list merged with not-yet-synced local writes; refreshes the SQLite cache. */
export async function getNotifications(): Promise<Notification[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const db = await getDatabase();
  const local = await readLocal(userId);

  let server: ServerRow[];
  try {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, user_id, type, title, message, read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(SERVER_LIMIT);
    if (error) throw error;
    server = (data ?? []) as ServerRow[];
  } catch {
    // Offline (or the server rejected us): the cache is the best we have.
    return local.map(rowToNotification);
  }

  const pending = await pendingOps(userId);
  const localById = new Map(local.map((r) => [r.id, r]));
  const merged = new Map<string, LocalRow>();

  for (const s of server) {
    if (pending.deleted.has(s.id)) continue;
    if (pending.clearedBefore && s.created_at <= pending.clearedBefore) continue;
    const readLocally =
      localById.get(s.id)?.read === 1 ||
      pending.read.has(s.id) ||
      (!!pending.readAllBefore && s.created_at <= pending.readAllBefore);
    merged.set(s.id, { ...s, read: s.read || readLocally ? 1 : 0 });
  }
  // Locally created reminders the server hasn't received yet.
  for (const id of pending.inserted) {
    const row = localById.get(id);
    if (row && !merged.has(id)) merged.set(id, row);
  }

  const list = [...merged.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));

  // No wrapping transaction: getDatabase() serializes every statement, so a nested transaction
  // would deadlock. Upserting in place keeps concurrent readers from ever seeing an empty table.
  try {
    const keep = list.map((n) => n.id);
    if (keep.length === 0) {
      await db.runAsync(`DELETE FROM notifications WHERE user_id = ?`, [userId]);
    } else {
      await db.runAsync(
        `DELETE FROM notifications WHERE user_id = ? AND id NOT IN (${keep.map(() => "?").join(",")})`,
        [userId, ...keep],
      );
    }
    const syncedAt = new Date().toISOString();
    for (const n of list) {
      await db.runAsync(
        `INSERT OR REPLACE INTO notifications (id, user_id, type, title, message, read, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [n.id, userId, n.type, n.title, n.message, n.read, n.created_at, syncedAt],
      );
    }
  } catch (err) {
    console.warn("[notifications] cache refresh failed:", err);
  }

  return list.map(rowToNotification);
}

/**
 * Pushes one write now; if that fails (offline, flaky) the queued entry stays and SyncManager
 * replays it on reconnect.
 */
async function pushOrQueue(
  operation: "upsert" | "update" | "delete",
  recordId: string | null,
  payload: Record<string, unknown>,
  push: () => PromiseLike<{ error: unknown }>,
): Promise<void> {
  const queuedId = await enqueueSync("notifications", operation, recordId, payload);
  try {
    const { error } = await push();
    if (error) throw error;
    await removeSyncEntry(queuedId);
  } catch {
    /* stays queued */
  }
}

/** App-generated notifications only (scan reminders, daily tips) — RLS rejects any other type. */
export async function insertNotification(
  notification: Omit<Notification, "read"> & { read?: boolean },
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const db = await getDatabase();
  const read = notification.read ? 1 : 0;

  // OR IGNORE: re-generating today's reminder must not reset its read flag.
  await db.runAsync(
    `INSERT OR IGNORE INTO notifications (id, user_id, type, title, message, read, created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      notification.id,
      userId,
      notification.type,
      notification.title,
      notification.message,
      read,
      notification.created_at,
    ],
  );

  const row = {
    id: notification.id,
    user_id: userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    read: !!notification.read,
    created_at: notification.created_at,
  };
  await pushOrQueue("upsert", notification.id, row, () =>
    supabase.from("notifications").upsert(row, { onConflict: "id", ignoreDuplicates: true }),
  );
}

export async function markNotificationAsRead(id: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const db = await getDatabase();
  await db.runAsync(`UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?`, [id, userId]);
  await pushOrQueue("update", id, { id, user_id: userId, read: true }, () =>
    supabase.from("notifications").update({ read: true }).eq("id", id).eq("user_id", userId),
  );
}

export async function markAllNotificationsAsRead(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const db = await getDatabase();
  const before = new Date().toISOString();
  await db.runAsync(`UPDATE notifications SET read = 1 WHERE user_id = ?`, [userId]);
  await pushOrQueue("update", null, { user_id: userId, read: true, before }, () =>
    supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false)
      .lte("created_at", before),
  );
}

export async function deleteNotification(id: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM notifications WHERE id = ? AND user_id = ?`, [id, userId]);
  await pushOrQueue("delete", id, { id, user_id: userId }, () =>
    supabase.from("notifications").delete().eq("id", id).eq("user_id", userId),
  );
}

export async function clearAllNotifications(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const db = await getDatabase();
  const before = new Date().toISOString();
  await db.runAsync(`DELETE FROM notifications WHERE user_id = ?`, [userId]);
  await pushOrQueue("delete", null, { user_id: userId, before }, () =>
    supabase.from("notifications").delete().eq("user_id", userId).lte("created_at", before),
  );
}
