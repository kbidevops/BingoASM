package com.bingoasm.service;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.Json;
import com.bingoasm.common.Params;
import com.bingoasm.common.Times;
import com.bingoasm.domain.*;
import com.bingoasm.repo.*;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.IsoFields;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Service statistics with the same response shape as the reference system:
 * series[{periodKey, requestCnt, receivedCnt, completedCnt, openCnt, rejectedCnt, avgLeadHours?, avgScore?}], ...
 */
@Service
@Transactional(readOnly = true)
public class StatsService {
    private final ServiceRequestRepository services;
    private final SatisfactionRepository satisfactions;
    private final AssetRepository assets;
    private final RefData refData;

    public StatsService(ServiceRequestRepository services, SatisfactionRepository satisfactions, AssetRepository assets, RefData refData) {
        this.services = services; this.satisfactions = satisfactions; this.assets = assets; this.refData = refData;
    }

    public Json compute(CurrentUser me, String periodParam, LocalDate fromParam, LocalDate toParam, String requestType) {
        String period = List.of("DAY", "WEEK", "MONTH", "YEAR").contains(periodParam) ? periodParam : "DAY";
        LocalDate to = toParam != null ? toParam : Times.today();
        LocalDate from = fromParam != null ? fromParam : switch (period) {
            case "WEEK" -> to.minusDays(84);
            case "MONTH" -> to.minusYears(1);
            case "YEAR" -> to.minusYears(5);
            default -> to.minusDays(30);
        };

        List<ServiceRequest> list = services.findByOrgIdAndRequestAtGreaterThanEqualAndRequestAtLessThan(
                me.orgId(), from.atStartOfDay(), to.plusDays(1).atStartOfDay());
        if (!Params.blank(requestType)) list = list.stream().filter(s -> requestType.equals(s.requestType)).toList();

        Map<Long, Satisfaction> sats = satisfactions.findByRequestIdIn(list.stream().map(s -> s.requestId).toList()).stream()
                .collect(Collectors.toMap(x -> x.requestId, Function.identity()));
        RefData.Ref ref = refData.forOrg(me.orgId());

        // Series by period key (request date).
        Map<String, List<ServiceRequest>> byKey = new TreeMap<>();
        for (ServiceRequest s : list) byKey.computeIfAbsent(periodKey(period, s.requestAt), k -> new ArrayList<>()).add(s);
        List<Json> series = new ArrayList<>();
        byKey.forEach((key, items) -> series.add(Json.obj()
                .with("periodKey", key)
                .with("requestCnt", (long) items.size())
                .with("receivedCnt", items.stream().filter(s -> s.receivedAt != null).count())
                .with("completedCnt", items.stream().filter(StatsService::done).count())
                .with("openCnt", items.stream().filter(s -> !done(s) && !"REJECTED".equals(s.status)).count())
                .with("rejectedCnt", items.stream().filter(s -> "REJECTED".equals(s.status)).count())
                .with("avgLeadHours", avg(items.stream().filter(StatsService::done).map(s -> hours(s.requestAt, s.completedAt)).toList(), 1))
                .with("avgScore", avgScore(items, sats))));

        // By request type.
        List<Json> byRequestType = group(list, s -> s.requestType).entrySet().stream()
                .map(e -> Json.obj().with("requestType", e.getKey()).with("totalCnt", (long) e.getValue().size())
                        .with("completedCnt", e.getValue().stream().filter(StatsService::done).count())
                        .with("avgLeadHours", avg(e.getValue().stream().filter(StatsService::done).map(s -> hours(s.requestAt, s.completedAt)).toList(), 1)))
                .sorted(byTotalDesc()).toList();

        // By processor; lead time measured from start of work to completion. Unassigned grouped as "미배정".
        List<Json> byProcessor = group(list, s -> s.processorId == null ? 0L : s.processorId).entrySet().stream()
                .map(e -> {
                    Long pid = e.getKey();
                    List<ServiceRequest> items = e.getValue();
                    return Json.obj().with("processorId", pid == 0L ? null : pid)
                            .with("processorName", pid == 0L ? "미배정" : ref.userName(pid))
                            .with("totalCnt", (long) items.size())
                            .with("completedCnt", items.stream().filter(s -> Codes.DONE.contains(s.status)).count())
                            .with("avgLeadHours", avg(items.stream().filter(s -> done(s) && s.startedAt != null)
                                    .map(s -> hours(s.startedAt, s.completedAt)).toList(), 1))
                            .with("avgScore", avgScore(items, sats));
                })
                .sorted(byTotalDesc()).toList();

        // By building / floor.
        List<Json> byLocation = group(list.stream().filter(s -> s.floorId != null).toList(), s -> s.buildingId + "-" + s.floorId).values().stream()
                .map(items -> Json.obj().with("buildingName", ref.buildingName(items.get(0).buildingId))
                        .with("floorName", ref.floorName(items.get(0).floorId)).with("totalCnt", (long) items.size()))
                .sorted(byTotalDesc()).toList();

        // Satisfaction summary.
        List<Satisfaction> surveys = list.stream().map(s -> sats.get(s.requestId)).filter(Objects::nonNull).toList();
        Json satisfaction = Json.obj()
                .with("completedCnt", list.stream().filter(s -> Codes.DONE.contains(s.status)).count())
                .with("surveyCnt", (long) surveys.size())
                .with("avgOverall", avg(surveys.stream().map(x -> (double) x.overallScore).toList(), 2))
                .with("avgKindness", avg(surveys.stream().map(x -> (double) x.kindnessScore).toList(), 2))
                .with("avgSpeed", avg(surveys.stream().map(x -> (double) x.speedScore).toList(), 2))
                .with("avgExpertise", avg(surveys.stream().map(x -> (double) x.expertiseScore).toList(), 2));

        // Top 10 assets by request count.
        Map<Long, List<ServiceRequest>> byAsset = group(list.stream().filter(s -> s.assetId != null).toList(), s -> s.assetId);
        Map<Long, Asset> assetMap = assets.findAllById(byAsset.keySet()).stream().collect(Collectors.toMap(a -> a.assetId, Function.identity()));
        List<Json> topAssets = byAsset.entrySet().stream()
                .map(e -> {
                    Asset a = assetMap.get(e.getKey());
                    return Json.obj().with("assetId", e.getKey()).with("assetNo", a == null ? null : a.assetNo)
                            .with("assetName", a == null ? null : a.assetName).with("manufacturer", a == null ? null : a.manufacturer)
                            .with("modelName", a == null ? null : a.modelName).with("totalCnt", (long) e.getValue().size());
                })
                .sorted(byTotalDesc()).limit(10).toList();

        return Json.obj().with("period", period).with("fromDate", from).with("toDate", to).with("series", series)
                .with("byRequestType", byRequestType).with("byProcessor", byProcessor).with("byLocation", byLocation)
                .with("satisfaction", satisfaction).with("topAssets", topAssets);
    }

    private static boolean done(ServiceRequest s) {
        return Codes.DONE.contains(s.status) && s.completedAt != null;
    }

    static String periodKey(String period, LocalDateTime at) {
        LocalDate d = at.toLocalDate();
        return switch (period) {
            case "WEEK" -> String.format("%d-W%02d", d.get(IsoFields.WEEK_BASED_YEAR), d.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR));
            case "MONTH" -> d.toString().substring(0, 7);
            case "YEAR" -> String.valueOf(d.getYear());
            default -> d.toString();
        };
    }

    private static double hours(LocalDateTime from, LocalDateTime to) {
        return Duration.between(from, to).toMillis() / 3_600_000.0;
    }

    private static Double avg(List<Double> nums, int digits) {
        if (nums.isEmpty()) return null;
        double v = nums.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double f = Math.pow(10, digits);
        return Math.round(v * f) / f;
    }

    private static Double avgScore(List<ServiceRequest> items, Map<Long, Satisfaction> sats) {
        return avg(items.stream().map(s -> sats.get(s.requestId)).filter(Objects::nonNull).map(x -> (double) x.overallScore).toList(), 2);
    }

    private static <K> Map<K, List<ServiceRequest>> group(List<ServiceRequest> list, Function<ServiceRequest, K> key) {
        Map<K, List<ServiceRequest>> m = new LinkedHashMap<>();
        for (ServiceRequest s : list) m.computeIfAbsent(key.apply(s), k -> new ArrayList<>()).add(s);
        return m;
    }

    private static Comparator<Json> byTotalDesc() {
        return (a, b) -> Long.compare((Long) b.get("totalCnt"), (Long) a.get("totalCnt"));
    }
}
