import * as SQLite from 'expo-sqlite';
import { SCHEMA_SQL } from './schema';

// ⚠️ 실기기 테스트로 발견한 버그: dbInstance만 캐싱하면 openDatabaseAsync가 아직 resolve되기 전에
// 여러 곳(예: Start Shorts를 빠르게 여러 번 탭)에서 getDb()를 동시에 호출할 경우 dbInstance가 계속
// null로 보여 각자 별도 커넥션을 열고 동시에 execAsync(SCHEMA_SQL)을 실행 — SQLite 네이티브 브릿지에서
// NullPointerException(NativeDatabase.prepareAsync rejected)을 유발했다. in-flight Promise 자체를
// 캐싱해 동시 호출도 같은 초기화를 기다리게 한다.
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('pace.db');
      await db.execAsync(SCHEMA_SQL);
      return db;
    })();
  }
  return dbPromise;
}
