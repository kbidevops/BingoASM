-- V24: 지연 · 에스컬레이션 · SLA 임박 알림은 없어졌다 (V21 · V22) — 이미 남아 있던 알림과 처리 이력의 자동 기록도 지운다.
-- AS_LATE_RECEIVE 접수 지연 · AS_ESCALATED 미접수 에스컬레이션 · AS_LATE_VISIT 방문 지연 · AS_SLA_WARN SLA 기한 임박
delete from notifications where type in ('AS_LATE_RECEIVE', 'AS_ESCALATED', 'AS_LATE_VISIT', 'AS_SLA_WARN');
-- 처리 이력의 '지연 알림' 자동 기록 (AsAlertService가 남기던 것)
delete from as_histories where action in ('ALERT', 'ESCALATE');
