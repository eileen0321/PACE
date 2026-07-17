import { getDb } from '../db';
import type { Subscription } from '../../types/models';

// SQLite subscriptions 미러 — RC(RevenueCat)가 단일 진실원천이고 이 테이블은 오프라인 부팅 시
// 마지막으로 알려진 entitlement를 즉시 보여주기 위한 캐시(PACE_ARCHITECTURE.md의 jlpt-master
// RevenueCat 계약 참고). useSubscriptionStore가 RC CustomerInfo를 받을 때마다 write-through.
export async function saveEntitlement(userId: string, subscription: Subscription): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO subscriptions (id, user_id, plan, status, renewal_date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET plan=excluded.plan, status=excluded.status, renewal_date=excluded.renewal_date, updated_at=excluded.updated_at`,
    [`sub-${userId}`, userId, subscription.plan, subscription.status, subscription.expiresAt, new Date().toISOString()]
  );
}

export async function getEntitlement(userId: string): Promise<Subscription | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>(`SELECT * FROM subscriptions WHERE user_id = ?`, [userId]);
  if (!row) return null;
  return { plan: row.plan, status: row.status, expiresAt: row.renewal_date };
}

export async function clearEntitlement(userId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM subscriptions WHERE user_id = ?`, [userId]);
}
