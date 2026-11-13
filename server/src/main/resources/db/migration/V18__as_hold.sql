-- V18: AS 보류 (부품 대기 · 통신사 공사 · 학교 출입 불가 등). 상태(신청완료 · 접수완료)는 그대로 두고 보류 표시만 한다.
-- 보류 중에는 지연 알림 · SLA 기한이 멈추고, 풀면 보류한 시간만큼 기한이 늦춰진다.
alter table as_requests add column hold_at timestamp(6);              -- 지금 보류 중이면 보류한 시각
alter table as_requests add column hold_until date;                   -- 재개 예정일 (선택)
alter table as_requests add column hold_reason varchar(500);
alter table as_requests add column first_hold_at timestamp(6);        -- 처음 보류한 시각 (그 뒤에 끝난 단계만 늦춘다)
alter table as_requests add column hold_minutes integer default 0 not null;      -- 끝난 보류들의 합 (달력 분)
alter table as_requests add column hold_biz_minutes integer default 0 not null;  -- 같은 기간의 근무 시간 (분, 근무 시간 기준 알림용)
