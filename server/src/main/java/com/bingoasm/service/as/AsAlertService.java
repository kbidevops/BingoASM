package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.auth.PermissionService;
import com.bingoasm.common.ApiException;
import com.bingoasm.common.Json;
import com.bingoasm.common.Params;
import com.bingoasm.common.Times;
import com.bingoasm.domain.Org;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.OrgRepository;
import com.bingoasm.repo.as.AsAlertRuleRepository;
import com.bingoasm.repo.as.AsHistoryRepository;
import com.bingoasm.repo.as.AsRequestRepository;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * AS 지연 알림 (에스컬레이션). 몇 분마다 처리 중인 AS를 보고, 교육청 · 유형별 기준을 넘긴 건을 알린다:
 * <ol>
 *   <li>접수 지연 — 신청 후 receiveMin 안에 접수되지 않으면 담당 업체(업체 관리자 + 배정된 기사). 업체가 없으면 교육지원청.</li>
 *   <li>에스컬레이션 — escalateMin까지도 접수되지 않으면 그 유형을 맡은 관할 교육지원청 담당자 (+ 업체).</li>
 *   <li>방문 지연 — 방문예정일시 + visitGraceMin이 지나도 처리 보고서가 없으면 업체 + 교육지원청.</li>
 * </ol>
 * 한 건에 단계마다 한 번만 보낸다 (AsRequest.receiveAlertLevel · visitAlertFor). 시간은 기준마다 근무 시간(근무 요일 · 시간대, 휴일 제외 —
 * WorkCalendar) 또는 24시간 달력 시간으로 센다.
 */
@Service
public class AsAlertService {
    private static final Logger log = LoggerFactory.getLogger(AsAlertService.class);

    /** 기본 기준 (분): 접수 지연 · 에스컬레이션 · 방문 지연 여유 · 근무 시간 기준(1) / 24시간(0). 스쿨넷은 회선 관제라 24시간. */
    static final Map<String, int[]> DEFAULTS = Map.of(
            "C", new int[]{480, 1440, 120, 1},
            "M", new int[]{240, 480, 60, 1},
            "S", new int[]{30, 60, 30, 0},
            "T", new int[]{480, 1440, 120, 1});

    /** 기본 근무 시간: 월~금 09:00~18:00 */
    static final String DEFAULT_DAYS = "1,2,3,4,5", DEFAULT_START = "09:00", DEFAULT_END = "18:00";

    public record Rule(String rceptTy, int receiveMin, int escalateMin, int visitGraceMin, boolean enabled, boolean isDefault, boolean businessHours) {}

    private final AsAlertRuleRepository rules;
    private final AsRequestRepository requests;
    private final AsHistoryRepository histories;
    private final OrgRepository orgs;
    private final NotificationService notices;
    private final SchoolService schoolService;
    private final PermissionService permissions;
    private final com.bingoasm.repo.as.WorkCalendarRepository calendars;
    private final com.bingoasm.repo.as.HolidayRepository holidays;
    private final TransactionTemplate tx;

    public AsAlertService(AsAlertRuleRepository rules, AsRequestRepository requests, AsHistoryRepository histories, OrgRepository orgs,
                          NotificationService notices, SchoolService schoolService, PermissionService permissions, PlatformTransactionManager tm,
                          com.bingoasm.repo.as.WorkCalendarRepository calendars, com.bingoasm.repo.as.HolidayRepository holidays) {
        this.calendars = calendars; this.holidays = holidays;
        this.rules = rules; this.requests = requests; this.histories = histories; this.orgs = orgs;
        this.notices = notices; this.schoolService = schoolService; this.permissions = permissions;
        this.tx = new TransactionTemplate(tm);
    }

    // ---------- 기준 ----------

    public Map<String, Rule> rules(Long orgId) {
        Map<String, Rule> m = new LinkedHashMap<>();
        Map<String, AsAlertRule> saved = new HashMap<>();
        for (AsAlertRule r : rules.findByOrgId(orgId)) saved.put(r.rceptTy, r);
        for (String ty : AsCodes.RCEPT_TYPES) {
            AsAlertRule r = saved.get(ty);
            int[] d = DEFAULTS.get(ty);
            m.put(ty, r == null ? new Rule(ty, d[0], d[1], d[2], true, true, d[3] == 1)
                    : new Rule(ty, r.receiveMin, r.escalateMin, r.visitGraceMin, Boolean.TRUE.equals(r.enabled), false, !Boolean.FALSE.equals(r.businessHours)));
        }
        return m;
    }

    public Json view(Long orgId) {
        List<String> inUse = permissions.asTypes(orgId);
        return Json.obj().with("rules", rules(orgId).values().stream().map(r -> Json.obj()
                .with("rceptTy", r.rceptTy()).with("name", AsCodes.RCEPT_TY_NAME.get(r.rceptTy())).with("inUse", inUse.contains(r.rceptTy()))
                .with("receiveMin", r.receiveMin()).with("escalateMin", r.escalateMin()).with("visitGraceMin", r.visitGraceMin())
                .with("enabled", r.enabled()).with("isDefault", r.isDefault()).with("businessHours", r.businessHours())).toList())
                .with("calendar", calendarView(orgId));
    }

    /** body: { rules: [{rceptTy, receiveMin, escalateMin, visitGraceMin, enabled}] } — 보낸 유형만 바꾼다. */
    public Json save(CurrentUser me, Map<String, Object> b) {
        if (!(b.get("rules") instanceof List<?> l)) throw ApiException.badRequest("rules 목록이 필요합니다.");
        return tx.execute(s -> {
            Map<String, AsAlertRule> saved = new HashMap<>();
            for (AsAlertRule r : rules.findByOrgId(me.orgId())) saved.put(r.rceptTy, r);
            for (Object o : l) {
                if (!(o instanceof Map<?, ?> raw)) throw ApiException.badRequest("기준이 올바르지 않습니다.");
                @SuppressWarnings("unchecked") Map<String, Object> m = (Map<String, Object>) raw;
                String ty = Params.str(m, "rceptTy");
                if (ty == null || !AsCodes.RCEPT_TYPES.contains(ty)) throw ApiException.badRequest("알 수 없는 AS 유형입니다.");
                String name = AsCodes.RCEPT_TY_NAME.get(ty);
                int receive = minutes(m, "receiveMin", name + " 접수 지연"), escalate = minutes(m, "escalateMin", name + " 에스컬레이션");
                int grace = minutes(m, "visitGraceMin", name + " 방문 지연 여유");
                if (escalate < receive) throw ApiException.badRequest(name + ": 에스컬레이션은 접수 지연 시간보다 같거나 길어야 합니다.");
                AsAlertRule r = saved.computeIfAbsent(ty, k -> { AsAlertRule x = new AsAlertRule(); x.orgId = me.orgId(); x.rceptTy = k; return x; });
                r.receiveMin = receive; r.escalateMin = escalate; r.visitGraceMin = grace;
                r.enabled = !Boolean.FALSE.equals(m.get("enabled")) && !"false".equals(String.valueOf(m.get("enabled")));
                // 근무 시간 기준: 보내지 않으면 유형 기본값 (스쿨넷 24시간, 나머지 근무 시간)
                r.businessHours = m.containsKey("businessHours") ? !Boolean.FALSE.equals(m.get("businessHours")) && !"false".equals(String.valueOf(m.get("businessHours")))
                        : r.businessHours != null && r.ruleId != null ? r.businessHours : DEFAULTS.get(ty)[3] == 1;
                r.updatedAt = Times.now(); r.updatedBy = me.userId();
                rules.save(r);
            }
            return view(me.orgId());
        });
    }

    private static int minutes(Map<String, Object> b, String key, String label) {
        Integer v = Params.integer(b, key);
        if (v == null || v < 1 || v > 30 * 1440) throw ApiException.badRequest(label + " 시간을 1분 ~ 30일 사이로 입력해 주세요.");
        return v;
    }

    // ---------- 근무 시간 달력 ----------

    /** 이 교육청의 근무 시간 달력 (없으면 월~금 09:00~18:00, 휴일 없음). */
    public WorkCalendar calendar(Long orgId) {
        WorkCalendarSetting c = calendars.findById(orgId).orElse(null);
        Set<java.time.DayOfWeek> days = EnumSet.noneOf(java.time.DayOfWeek.class);
        for (String x : (c == null ? DEFAULT_DAYS : c.workDays).split(",")) if (!x.isBlank()) days.add(java.time.DayOfWeek.of(Integer.parseInt(x.trim())));
        Set<java.time.LocalDate> off = new HashSet<>();
        for (Holiday h : holidays.findByOrgIdOrderByHolidayDateAsc(orgId)) off.add(h.holidayDate);
        return new WorkCalendar(days, java.time.LocalTime.parse(c == null ? DEFAULT_START : c.startTime), java.time.LocalTime.parse(c == null ? DEFAULT_END : c.endTime), off);
    }

    public Json calendarView(Long orgId) {
        WorkCalendarSetting c = calendars.findById(orgId).orElse(null);
        List<Integer> days = Arrays.stream((c == null ? DEFAULT_DAYS : c.workDays).split(",")).filter(x -> !x.isBlank()).map(x -> Integer.parseInt(x.trim())).toList();
        return Json.obj().with("workDays", days).with("startTime", c == null ? DEFAULT_START : c.startTime).with("endTime", c == null ? DEFAULT_END : c.endTime)
                .with("isDefault", c == null)
                .with("holidays", holidays.findByOrgIdOrderByHolidayDateAsc(orgId).stream().map(h -> Json.obj().with("date", h.holidayDate).with("name", h.name)).toList())
                .with("workingNow", calendar(orgId).isWorkingAt(Times.now()));
    }

    /** body: { workDays:[1..7], startTime:"09:00", endTime:"18:00", holidays:[{date:"2026-12-25", name}] } — 휴일은 통째로 바꾼다. */
    public Json saveCalendar(CurrentUser me, Map<String, Object> b) {
        if (!(b.get("workDays") instanceof List<?> dl)) throw ApiException.badRequest("근무 요일을 선택해 주세요.");
        TreeSet<Integer> days = new TreeSet<>();
        for (Object o : dl) {
            Integer d = Params.toLong(o) == null ? null : Params.toLong(o).intValue();
            if (d == null || d < 1 || d > 7) throw ApiException.badRequest("근무 요일이 올바르지 않습니다.");
            days.add(d);
        }
        if (days.isEmpty()) throw ApiException.badRequest("근무 요일을 하루 이상 선택해 주세요.");
        java.time.LocalTime start = time(b, "startTime", "근무 시작 시각"), end = time(b, "endTime", "근무 종료 시각");
        if (!end.isAfter(start)) throw ApiException.badRequest("근무 종료 시각은 시작 시각보다 늦어야 합니다.");
        Map<java.time.LocalDate, String> hs = new TreeMap<>();
        if (b.get("holidays") instanceof List<?> hl) {
            if (hl.size() > 400) throw ApiException.badRequest("휴일은 400일까지 등록할 수 있습니다.");
            for (Object o : hl) {
                if (!(o instanceof Map<?, ?> raw)) throw ApiException.badRequest("휴일이 올바르지 않습니다.");
                @SuppressWarnings("unchecked") Map<String, Object> m = (Map<String, Object>) raw;
                java.time.LocalDate d = Params.date(m, "date");
                if (d == null) throw ApiException.badRequest("휴일 날짜가 올바르지 않습니다.");
                String name = Params.str(m, "name");
                if (name != null && name.length() > 50) throw ApiException.badRequest("휴일 이름은 50자 이내로 입력해 주세요.");
                hs.put(d, name);
            }
        }
        return tx.execute(s -> {
            WorkCalendarSetting c = calendars.findById(me.orgId()).orElseGet(() -> { WorkCalendarSetting x = new WorkCalendarSetting(); x.orgId = me.orgId(); return x; });
            c.workDays = days.stream().map(String::valueOf).collect(java.util.stream.Collectors.joining(","));
            c.startTime = start.toString(); c.endTime = end.toString();
            c.updatedAt = Times.now(); c.updatedBy = me.userId();
            calendars.save(c);
            List<Holiday> old = holidays.findByOrgIdOrderByHolidayDateAsc(me.orgId());
            Map<java.time.LocalDate, Holiday> byDate = new HashMap<>();
            for (Holiday h : old) byDate.put(h.holidayDate, h);
            for (Holiday h : old) if (!hs.containsKey(h.holidayDate)) holidays.delete(h);
            holidays.flush();
            for (var e : hs.entrySet()) {
                Holiday h = byDate.getOrDefault(e.getKey(), new Holiday());
                h.orgId = me.orgId(); h.holidayDate = e.getKey(); h.name = e.getValue();
                holidays.save(h);
            }
            return calendarView(me.orgId());
        });
    }

    private static java.time.LocalTime time(Map<String, Object> b, String key, String label) {
        String v = Params.str(b, key);
        try { return java.time.LocalTime.parse(v == null ? "" : v.trim().length() == 4 ? "0" + v.trim() : v.trim()); }
        catch (java.time.format.DateTimeParseException e) { throw ApiException.badRequest(label + "을(를) HH:MM 형식으로 입력해 주세요."); }
    }

    /** 기준에 맞춰 흐른 시간(분): 근무 시간 기준이면 달력의 근무 시간만, 아니면 달력 시간. */
    static long elapsed(Rule rule, WorkCalendar cal, LocalDateTime from, LocalDateTime to) {
        if (from == null || to == null || !to.isAfter(from)) return 0;
        return rule.businessHours() && cal != null ? cal.minutes(from, to) : Duration.between(from, to).toMinutes();
    }

    // ---------- 판정 ----------

    /** 처리 보고서가 아직 없는가. */
    static boolean noReport(AsRequest r) { return r.visitAt == null && r.processContent == null; }

    /**
     * 지금 이 건의 지연: ESCALATED(에스컬레이션 기준도 넘긴 미접수) · RECEIVE(접수 지연) · VISIT(방문 지연) · null.
     * 목록 · 할 일에서 쓴다. 알림을 보냈는지와 상관없이 지금 시각으로 판정한다.
     */
    public static String lateOf(AsRequest r, Rule rule, WorkCalendar cal, LocalDateTime now) {
        if (rule == null || !rule.enabled() || !"Y".equals(r.useYn)) return null;
        if ("A".equals(r.status) && r.requestAt != null) {
            long age = elapsed(rule, cal, r.requestAt, now);
            if (age >= rule.escalateMin()) return "ESCALATED";
            if (age >= rule.receiveMin()) return "RECEIVE";
        }
        if ("R".equals(r.status) && r.visitPlannedAt != null && noReport(r) && visitLate(rule, cal, r.visitPlannedAt, now)) return "VISIT";
        return null;
    }

    /** 방문예정일시가 지났고, 그 뒤로 여유 시간(기준에 맞춰 센)이 흘렀는가. */
    private static boolean visitLate(Rule rule, WorkCalendar cal, LocalDateTime planned, LocalDateTime now) {
        return !now.isBefore(planned) && elapsed(rule, cal, planned, now) >= rule.visitGraceMin();
    }

    /** "근무 시간 4시간" / "4시간" */
    private static String span(Rule rule, long min) { return (rule.businessHours() ? "근무 시간 " : "") + dur(min); }

    // ---------- 확인 · 알림 ----------

    /** 5분마다 (bingoasm.alerts.interval-ms). 서버가 뜬 뒤 1분부터. */
    @Scheduled(fixedDelayString = "${bingoasm.alerts.interval-ms:300000}", initialDelayString = "${bingoasm.alerts.initial-delay-ms:60000}")
    public void scheduled() {
        try {
            for (Org o : orgs.findAll()) run(o.orgId);
        } catch (RuntimeException e) {
            log.warn("AS 지연 알림 확인 실패: {}", e.toString());
        }
    }

    /** 한 교육청을 지금 확인한다. 같은 건에 두 번 보내지 않도록 한 번에 하나만 돈다. 보낸 알림 수를 돌려준다. */
    public synchronized Json run(Long orgId) {
        return tx.execute(s -> check(orgId));
    }

    private Json check(Long orgId) {
        LocalDateTime now = Times.now();
        Map<String, Rule> rs = rules(orgId);
        WorkCalendar cal = calendar(orgId);
        List<String> inUse = permissions.asTypes(orgId);
        Map<Long, School> schools = schoolService.schoolMap(orgId);
        int receive = 0, escalated = 0, visit = 0;
        for (AsRequest r : requests.findByOrgIdAndUseYnAndStatusIn(orgId, "Y", List.of("A", "R"))) {
            Rule rule = rs.get(r.rceptTy);
            if (rule == null || !rule.enabled() || !inUse.contains(r.rceptTy)) continue;
            School sc = r.schoolId == null ? null : schools.get(r.schoolId);
            String school = sc == null ? "" : sc.schoolName;
            Set<Long> vendor = notices.vendorSide(r);
            Set<Long> region = notices.regionSide(r, sc == null ? null : sc.regionId);
            int level = r.receiveAlertLevel == null ? 0 : r.receiveAlertLevel;
            if ("A".equals(r.status) && r.requestAt != null) {
                long age = elapsed(rule, cal, r.requestAt, now);
                if (age >= rule.receiveMin() && level < 1) {
                    // 업체가 정해지지 않은 건은 배정할 교육지원청에 바로 알린다.
                    Set<Long> to = vendor.isEmpty() ? region : vendor;
                    notices.notify(to, null, r, "AS_LATE_RECEIVE", label(r) + " 접수 지연",
                            school + " · 신청 후 " + span(rule, age) + " 지났습니다 (기준 " + span(rule, rule.receiveMin()) + ")" + (vendor.isEmpty() ? " · 업체 미배정" : ""));
                    history(r, "ALERT", "접수 지연 알림 (기준 " + span(rule, rule.receiveMin()) + ")");
                    r.receiveAlertLevel = level = 1; receive++;
                }
                if (age >= rule.escalateMin() && level < 2) {
                    Set<Long> to = new LinkedHashSet<>(region); to.addAll(vendor);
                    // 교육지원청 · 교육청이 처리 담당인 건은 한 단계 위(교육청)로
                    if ("REGION".equals(r.handlerType) || "PROVINCE".equals(r.handlerType)) to.addAll(notices.provinceSide(orgId));
                    notices.notify(to, null, r, "AS_ESCALATED", label(r) + " 미접수 에스컬레이션",
                            school + " · 신청 후 " + span(rule, age) + "째 접수되지 않았습니다 (기준 " + span(rule, rule.escalateMin()) + "). 업체 확인이 필요합니다.");
                    history(r, "ESCALATE", "에스컬레이션: 교육지원청 알림 (기준 " + span(rule, rule.escalateMin()) + ")");
                    r.receiveAlertLevel = 2; escalated++;
                }
            }
            if ("R".equals(r.status) && r.visitPlannedAt != null && noReport(r)
                    && visitLate(rule, cal, r.visitPlannedAt, now) && !r.visitPlannedAt.equals(r.visitAlertFor)) {
                Set<Long> to = new LinkedHashSet<>(vendor); to.addAll(region);
                notices.notify(to, null, r, "AS_LATE_VISIT", label(r) + " 방문 지연",
                        school + " · 방문예정 " + when(r.visitPlannedAt) + "이 지났지만 처리 보고서가 없습니다.");
                history(r, "ALERT", "방문 지연 알림 (방문예정 " + when(r.visitPlannedAt) + ")");
                r.visitAlertFor = r.visitPlannedAt; visit++;
            }
        }
        return Json.obj().with("receive", receive).with("escalated", escalated).with("visit", visit).with("checkedAt", now);
    }

    private void history(AsRequest r, String action, String content) {
        AsHistory h = new AsHistory();
        h.asvcSn = r.asvcSn; h.prevStatus = r.status; h.status = r.status; h.action = action; h.content = content; h.workerId = null; h.createdAt = Times.now();
        histories.save(h);
    }

    private static String label(AsRequest r) { return "[" + AsCodes.RCEPT_TY_NAME.get(r.rceptTy) + "] AS-" + r.asvcSn; }

    private static String when(LocalDateTime t) { return t == null ? "" : t.toString().replace('T', ' ').substring(0, 16); }

    /** 90 → "1시간 30분", 1500 → "1일 1시간" */
    static String dur(long min) {
        long d = min / 1440, h = (min % 1440) / 60, m = min % 60;
        StringBuilder sb = new StringBuilder();
        if (d > 0) sb.append(d).append("일 ");
        if (h > 0) sb.append(h).append("시간 ");
        if (m > 0 && d == 0) sb.append(m).append("분");
        String s = sb.toString().trim();
        return s.isEmpty() ? "0분" : s;
    }
}
