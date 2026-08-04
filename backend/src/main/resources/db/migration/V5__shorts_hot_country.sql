-- 2026-08-04 사장님 결정 — 쇼츠 HOT을 국가별로 나눈다(KR/JP/US 화이트리스트).
--
-- 배경: regionCode=KR, relevanceLanguage=ko가 코드에 박혀 있어 어느 나라 사용자가 열어도 한국
-- 인기 쇼츠가 나왔다. 국가를 늘리면 YouTube API 쿼터가 국가 수에 비례해 늘어나므로(search.list
-- 100 units/회), 아무 국가나 동적으로 만들지 않고 **지원 국가 화이트리스트**만 유지한다.
-- 그 외 국가는 서비스 계층에서 US(영어)로 폴백한다 — 목록이 비어 보이는 것보다 낫다.
--
-- 저장 방식: JSON 통짜 저장도 검토했으나(행 폭증 방지) 3국 × 6카테고리 × 25 = 450행 규모라
-- 그 이점이 생기지 않는다. 운영 중인 DB의 기존 데이터를 옮기는 위험을 피해 컬럼 추가로 간다.
--
-- 기존 행은 전부 한국 목록이므로 'KR'로 채운다(데이터 유실 없음).
ALTER TABLE shorts_hot_video ADD COLUMN country VARCHAR(2) NOT NULL DEFAULT 'KR';

-- 유니크 제약을 (category, rank_no) → (country, category, rank_no)로 바꾼다.
-- 안 바꾸면 국가가 둘 이상일 때 같은 순위끼리 충돌해 저장이 실패한다.
-- ⚠️ 제약 이름은 V2__shorts_hot.sql에 정의된 실제 이름을 그대로 써야 한다(uq_shorts_hot_video_category_rank).
ALTER TABLE shorts_hot_video DROP INDEX uq_shorts_hot_video_category_rank;
ALTER TABLE shorts_hot_video ADD CONSTRAINT uq_shorts_hot_video_country_category_rank UNIQUE (country, category, rank_no);

-- 조회는 항상 (country, category)로 들어온다. 기존 (category) 인덱스는 이 복합 인덱스가 대체한다.
CREATE INDEX idx_shorts_hot_video_country_category ON shorts_hot_video (country, category);
DROP INDEX idx_shorts_hot_video_category ON shorts_hot_video;
