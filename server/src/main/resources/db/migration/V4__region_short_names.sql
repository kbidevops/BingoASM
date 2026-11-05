-- V4: 지역명은 지역만 적는다 ("천안교육지원청" → "천안"). 뒤에 붙은 "교육지원청"(5자)만 떼고, 떼면 빈 이름이 되는 경우는 그대로 둔다.
update as_regions
   set region_name = left(region_name, length(region_name) - 5)
 where region_name like '%교육지원청'
   and length(region_name) > 5;
