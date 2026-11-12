-- V12: 교육지원청 담당자별 담당 AS 유형 (여러 개, 쉼표로: 예 "M,S"). 비어 있으면 모든 유형을 맡는다.
-- 그 유형의 신청 · 이관 · 취소 · 반려 · 처리 완료 알림을 받고, AS 목록에서 '내 담당 유형만'으로 거를 수 있다.
alter table users add column as_types varchar(40);
