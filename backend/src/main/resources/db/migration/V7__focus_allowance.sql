-- 🔴 2026-08-10 사장님 지적("앱 지웠다 설치하면 계속 포커스 10분에 광고 보고 15분을 쓸 수 있는 거
--   아냐? 앱 지웠다 설치하면 이전 기록 확인해서 포커스 시간 주지 말고")
--
-- 무료 사용자의 Focus Session 규칙(무료 10분 → 시간 다 되면 광고/크레딧으로 +5분, 광고는 하루 3회)의
-- 상태가 지금까지 **전부 기기 로컬**에만 있었다:
--   Android — SharedPreferences(ad_extend_date/ad_extend_count, focus_session_timed_out_pending)
--   iOS     — AsyncStorage(pace_focus_extend_ad_count, pace_focus_session)
-- 둘 다 앱을 지우면 통째로 사라진다. 그래서 삭제 후 재설치만 하면 "무료 10분 + 광고 5분"을 무한히
-- 반복할 수 있었다 — 보상광고 수익이 새는 경로이자 앱의 취지(한도) 자체가 무너지는 구멍.
--
-- 이 테이블이 그 상태의 **서버측 진실원천**이다. 로컬은 오프라인/즉시성 때문에 계속 쓰되(네이티브
-- 워처가 JS 없이도 돌아야 하므로 로컬을 없앨 수는 없다), 부팅 시 서버 값과 합쳐 **더 많이 쓴 쪽**을
-- 채택한다(카운트는 max, timed_out은 OR). 로컬을 지워도 서버가 기억한다.
--
-- ⚠️ 게스트(비로그인)도 user_account 행을 갖는다 — /auth/guest가 device_id로 계정을 만든다
--   (V1__init.sql의 uq_user_account_device_id). 그래서 로그인하지 않은 사용자도 이 테이블로 보호된다.
--   단 그 device_id가 재설치를 견뎌야 의미가 있어서, 클라이언트 쪽에서 Android는 SSAID 기반으로
--   바꿨다(services/auth/deviceId.ts). iOS(Keychain/DeviceCheck)와 공장초기화까지 견디는
--   Play Integrity device recall은 후속 작업.
--
-- 날짜 단위 리셋: 클라이언트의 todayKey()(로컬 자정 기준)와 맞추기 위해 날짜는 **클라이언트가
-- 보낸 값**을 쓴다. 서버 타임존으로 계산하면 해외/자정 경계에서 사용자가 손해를 본다.
CREATE TABLE focus_allowance (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id          BIGINT   NOT NULL,
    -- 클라이언트 로컬 날짜(YYYY-MM-DD). 하루 3회 한도의 리셋 단위.
    allowance_date   DATE     NOT NULL,
    -- 오늘 보상광고로 Focus를 연장한 횟수(한도 3). 보상을 실제로 받은 순간에만 올린다.
    ad_extend_count  INT      NOT NULL DEFAULT 0,
    -- 무료 세션이 "시간이 다 돼서" 꺼진 상태인지(사용자가 직접 끈 것과 구분). 광고 게이트의 근거라
    -- 이걸 잃으면 재설치 한 번에 광고 없이 무료 세션이 다시 나간다.
    timed_out        BOOLEAN  NOT NULL DEFAULT FALSE,
    -- 현재 세션 마감시각(UTC). 재설치·기기 교체 후에도 남은 시간을 이어받게 한다. 지나갔으면 timed_out.
    session_ends_at  DATETIME NULL,
    updated_at       DATETIME NOT NULL,
    CONSTRAINT fk_focus_allowance_user FOREIGN KEY (user_id) REFERENCES user_account (id) ON DELETE CASCADE,
    CONSTRAINT uq_focus_allowance_user_date UNIQUE (user_id, allowance_date)
);
