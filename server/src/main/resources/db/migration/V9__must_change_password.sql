-- V9: 임시 비밀번호 표시. 관리자가 정한 비밀번호(사용자 등록 · 일괄 등록 · 사용자 수정)면 true, 본인이 바꾸면 false.
-- true인 사용자는 로그인하면 비밀번호 변경 창이 뜬다. 기존 계정은 모두 false.
alter table users add column must_change_password boolean default false not null;
