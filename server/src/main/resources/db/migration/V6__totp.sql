-- V6: 2단계 인증을 인증 앱(Google OTP 등, TOTP)으로. 비밀값은 DATA_KEY로 암호화해 저장한다 (CryptoConverter).
-- totp_last_step: 마지막으로 받은 번호의 시간 칸 — 같은 번호를 두 번 쓰지 못하게.
alter table users add column totp_secret varchar(255);
alter table users add column totp_last_step bigint;
-- 등록 중(QR을 보여 주고 첫 번호를 기다리는 동안)의 새 비밀값.
alter table otp_challenges add column setup_secret varchar(255);
