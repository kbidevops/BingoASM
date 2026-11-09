-- V5: 무선장비 위치(도면). 장비가 놓인 층과 그 층 도면 위 좌표(도면 크기 대비 %, 0~100).
alter table wireless_devices add column floor_id bigint;
alter table wireless_devices add column posx float(53);
alter table wireless_devices add column posy float(53);

create index idx_wireless_devices_floor on wireless_devices (floor_id);
