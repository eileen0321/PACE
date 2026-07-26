import * as SQLite from 'expo-sqlite';
import { SCHEMA_SQL } from './schema';

// ⚠️ 실기기 테스트로 발견한 버그: dbInstance만 캐싱하면 openDatabaseAsync가 아직 resolve되기 전에
// 여러 곳(예: Start Shorts를 빠르게 여러 번 탭)에서 getDb()를 동시에 호출할 경우 dbInstance가 계속
// null로 보여 각자 별도 커넥션을 열고 동시에 execAsync(SCHEMA_SQL)을 실행 — SQLite 네이티브 브릿지에서
// NullPointerException(NativeDatabase.prepareAsync rejected)을 유발했다. in-flight Promise 자체를
// 캐싱해 동시 호출도 같은 초기화를 기다리게 한다.
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// 2026-07-27 감사 발견(데이터층 HIGH 1) — 예전엔 초기화가 CREATE TABLE IF NOT EXISTS(SCHEMA_SQL)뿐이라
// 마이그레이션이 전혀 없었다. 초기 릴리즈 이후 viewing_sessions에 status/synced 컬럼이 추가됐는데,
// IF NOT EXISTS는 이미 존재하는 테이블엔 no-op이므로 "예전 스키마로 설치했던 기기"는 그 컬럼 없이 남고
// → startSession/endSession의 status·synced write가 "no such column"으로 조용히 전부 실패(호출부가
// .catch(()=>{})로 삼킴) → 사용 기록이 통째로 유실됐다. 스토어 출시 후 스키마가 한 번이라도 바뀌면
// 기존 사용자에게서 이 침묵 유실이 재발한다. PRAGMA user_version 기반 마이그레이션으로 막는다.
const CURRENT_DB_VERSION = 1;

// 컬럼 존재를 PRAGMA table_info로 "결정적으로" 확인하고, 없을 때만 ADD COLUMN 한다(에러 메시지 삼키기
// 방식보다 안전 — 신규 설치는 이미 컬럼이 있어 ALTER 자체가 안 돈다). NOT NULL 컬럼은 DEFAULT가 있어야
// SQLite가 ADD COLUMN을 허용한다.
async function ensureColumn(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  decl: string
): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (cols.some((c) => c.name === column)) return;
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

// 마이그레이션은 절대 getDb를 실패시키면 안 된다 — 마이그레이션이 던져도 캐치해서 삼키고 DB는 그대로
// 돌려준다(마이그레이션 실패가 "현재(마이그레이션 없던 시절)"보다 상황을 더 나쁘게 만들지 않도록).
async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const version = row?.user_version ?? 0;
    if (version >= CURRENT_DB_VERSION) return;

    // v0 → v1: 초기 릴리즈 이후 추가된 컬럼을 기존 설치에도 보강(멱등). 신규 설치는 SCHEMA_SQL이 이미
    // 만들어놨으므로 ensureColumn이 스킵한다.
    await ensureColumn(db, 'viewing_sessions', 'status', 'TEXT');
    await ensureColumn(db, 'viewing_sessions', 'synced', 'INTEGER NOT NULL DEFAULT 0');

    await db.execAsync(`PRAGMA user_version = ${CURRENT_DB_VERSION}`);
  } catch (e) {
    if (__DEV__) console.warn('[db] 마이그레이션 실패(무시하고 진행):', String(e));
  }
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('pace.db');
      await db.execAsync(SCHEMA_SQL);
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}
