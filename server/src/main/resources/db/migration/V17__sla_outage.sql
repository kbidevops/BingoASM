-- V17: 스쿨넷 SLA 정확도
-- 실제 장애 시각 (NMS 등으로 확인한 발생 · 복구 시각). 비어 있으면 신청 · 처리완료 시각으로 계산한다.
alter table as_requests add column outage_start_at timestamp(6);
alter table as_requests add column outage_end_at timestamp(6);
-- SLA 기한 임박 알림을 보낸 단계 (쉼표로: RECEIVE,VISIT,RECOVER) — 단계마다 한 번만
alter table as_requests add column sla_warned varchar(30);
