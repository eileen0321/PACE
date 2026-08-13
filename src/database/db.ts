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

    // 🔴 2026-08-13 발견 5 — 여기가 **사다리의 유일한 칸**이고, 다음 칸을 올리는 걸 강제하는 수단이
    //   없다. schema.ts에 컬럼을 추가하면 신규 설치는 SCHEMA_SQL로 바로 생기지만, **기존 설치는
    //   위 `version >= CURRENT_DB_VERSION`에서 즉시 리턴**해 영영 안 생긴다 — 그리고 그 write는
    //   호출부의 .catch(()=>{})에 삼켜져 조용히 유실된다(2026-07-27에 실제로 겪은 그 사고).
    //   → **컬럼을 추가하면 반드시 ①SCHEMA_SQL ②여기 ensureColumn ③CURRENT_DB_VERSION 셋 다 고친다.**
    //   ⚠️ 아래 개발용 검증이 그 규칙을 지키게 돕는다: dev 빌드에서 스키마와 실제 테이블을 대조해
    //     빠진 컬럼이 있으면 경고한다(릴리즈에선 돌지 않는다 — 부팅 비용 0).
    await db.execAsync(`PRAGMA user_version = ${CURRENT_DB_VERSION}`);
  } catch (e) {
    if (__DEV__) console.warn('[db] 마이그레이션 실패(무시하고 진행):', String(e));
  }
}

/**
 * 2026-08-13 발견 5 — 마이그레이션 사다리를 안 올렸을 때 **개발 중에** 알아채게 하는 장치.
 *
 * SCHEMA_SQL이 선언한 컬럼과 실제 테이블의 컬럼을 대조해, 스키마엔 있는데 테이블엔 없는 게 있으면
 * 경고한다 — 그게 정확히 "컬럼을 추가하면서 CURRENT_DB_VERSION/ensureColumn을 안 고친" 상태다.
 * 기존 설치에서만 나는 증상이라 신규 설치로 개발하면 절대 안 보이고, 그래서 2026-07-27에 스토어에
 * 나간 뒤에야 발견됐다.
 *
 * dev 전용 — 릴리즈 부팅에는 영향이 없다. 실패해도 무시한다(진단용이 앱을 깨뜨리면 안 된다).
 */
async function warnIfSchemaDrifted(db: SQLite.SQLiteDatabase): Promise<void> {
  if (!__DEV__) return;
  try {
    // `CREATE TABLE IF NOT EXISTS <name> (` … `);` 블록에서 테이블명과 컬럼명을 뽑는다.
    const blocks = SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/g);
    for (const [, table, body] of blocks) {
      const declared = body
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('--') && !/^(UNIQUE|PRIMARY|FOREIGN|CHECK)\b/i.test(l))
        .map((l) => l.split(/\s+/)[0])
        .filter((c) => /^\w+$/.test(c));
      const actual = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
      const have = new Set(actual.map((c) => c.name));
      const missing = declared.filter((c) => !have.has(c));
      if (missing.length > 0) {
        console.warn(
          `[db] 🔴 스키마 드리프트 — ${table}에 ${missing.join(', ')} 컬럼이 없다.\n` +
            `      SCHEMA_SQL엔 있는데 이 기기의 테이블엔 없다 = 마이그레이션이 안 돌았다는 뜻이다.\n` +
            `      db.ts의 migrate()에 ensureColumn을 추가하고 CURRENT_DB_VERSION을 올릴 것.`
        );
      }
    }
  } catch {
    // 진단이 부팅을 막지 않는다.
  }
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('pace.db');
      await db.execAsync(SCHEMA_SQL);
      await migrate(db);
      await warnIfSchemaDrifted(db);
      return db;
    })();
  }
  return dbPromise;
}
