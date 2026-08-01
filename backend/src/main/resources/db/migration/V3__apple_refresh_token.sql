-- Sign in with Apple 계정삭제 시 Apple 토큰 revoke(5.1.1v/TN3194)용 refresh_token 저장 컬럼.
-- Apple 로그인 최초 authorizationCode 교환으로 채워짐. 미설정 자격증명이면 NULL(폐기 skip).
ALTER TABLE user_account ADD COLUMN apple_refresh_token VARCHAR(512);
