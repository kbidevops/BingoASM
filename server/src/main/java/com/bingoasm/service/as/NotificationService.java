package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.AppUser;
import com.bingoasm.domain.as.AppNotification;
import com.bingoasm.domain.as.AsRequest;
import com.bingoasm.repo.UserRepository;
import com.bingoasm.repo.as.AppNotificationRepository;
import java.util.*;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 시스템 안 알림. 받는 사람은 AS의 관계자(신청 학교·담당 업체)이며, 처리한 본인은 받지 않는다.
 * 사용자는 자기 알림만 보고 읽음 처리한다. 180일이 지난 알림은 지운다.
 */
@Service
@Transactional
public class NotificationService {
    private static final int KEEP_DAYS = 180;
    private final AppNotificationRepository notifications;
    private final UserRepository users;

    public NotificationService(AppNotificationRepository notifications, UserRepository users) {
        this.notifications = notifications; this.users = users;
    }

    // ---------- recipients ----------

    /** 신청 학교 쪽: 신청자 + 그 학교 담당자 계정. */
    public Set<Long> schoolSide(AsRequest r) {
        Set<Long> out = new LinkedHashSet<>();
        if (r.applicantUserId != null) out.add(r.applicantUserId);
        if (r.schoolId != null) for (AppUser u : users.findByOrgIdOrderByUserIdAsc(r.orgId))
            if (r.schoolId.equals(u.schoolId) && u.roles.contains("SCHOOL_USER")) out.add(u.userId);
        return out;
    }

    /** 담당 업체 쪽: 지정된 기사 + 업체 관리자. 기사가 없으면 그 업체의 기사 모두. */
    public Set<Long> vendorSide(AsRequest r) {
        Set<Long> out = new LinkedHashSet<>();
        if (r.vendorId == null) return out;
        for (AppUser u : users.findByOrgIdOrderByUserIdAsc(r.orgId)) {
            if (!r.vendorId.equals(u.vendorId)) continue;
            boolean admin = u.roles.contains("VENDOR_ADMIN");
            boolean engineer = r.engineerUserId == null ? u.roles.contains("AS_ENGINEER") : u.userId.equals(r.engineerUserId);
            if (admin || engineer) out.add(u.userId);
        }
        return out;
    }

    // ---------- create ----------

    /** AS 한 건에 대한 알림을 받는 사람마다 남긴다. 처리한 본인(actor)과 사용 중이 아닌 계정은 뺀다. */
    public void notify(Collection<Long> to, Long actor, AsRequest r, String type, String title, String body) {
        Set<Long> ids = new LinkedHashSet<>(to);
        ids.remove(actor);
        ids.remove(null);
        if (ids.isEmpty()) return;
        var now = Times.now();
        for (AppUser u : users.findAllById(ids)) {
            if (!"ACTIVE".equals(u.status) || !Objects.equals(u.orgId, r.orgId)) continue;
            AppNotification n = new AppNotification();
            n.orgId = r.orgId; n.userId = u.userId; n.type = type;
            n.title = cut(title, 200); n.body = cut(body, 500);
            n.asvcSn = r.asvcSn; n.rceptTy = r.rceptTy; n.createdAt = now;
            notifications.save(n);
        }
    }

    private static String cut(String s, int max) { return s == null || s.length() <= max ? s : s.substring(0, max - 1) + "…"; }

    // ---------- read ----------

    public Json view(AppNotification n) {
        return Json.obj().with("notificationId", n.notificationId).with("type", n.type).with("title", n.title).with("body", n.body)
                .with("asvcSn", n.asvcSn).with("rceptTy", n.rceptTy).with("read", n.readAt != null).with("createdAt", n.createdAt);
    }

    @Transactional(readOnly = true)
    public Json list(CurrentUser me, boolean unreadOnly, Integer page, Integer size) {
        int p = PageResult.page(page), s = Math.min(PageResult.size(size), 50);
        PageRequest pr = PageRequest.of(p - 1, s);
        Page<AppNotification> res = unreadOnly
                ? notifications.findByUserIdAndReadAtIsNullOrderByCreatedAtDescNotificationIdDesc(me.userId(), pr)
                : notifications.findByUserIdOrderByCreatedAtDescNotificationIdDesc(me.userId(), pr);
        PageResult<Json> pageResult = new PageResult<>(res.getContent().stream().map(this::view).toList(), res.getTotalElements(), p, s, res.getTotalPages());
        return Json.obj().with("list", pageResult).with("unreadCount", notifications.countByUserIdAndReadAtIsNull(me.userId()));
    }

    @Transactional(readOnly = true)
    public long unreadCount(CurrentUser me) { return notifications.countByUserIdAndReadAtIsNull(me.userId()); }

    public void read(CurrentUser me, Long id) {
        AppNotification n = notifications.findById(id).filter(x -> me.userId().equals(x.userId)).orElseThrow(() -> ApiException.notFound("알림을 찾을 수 없습니다."));
        if (n.readAt == null) n.readAt = Times.now();
    }

    /** 내 안 읽은 알림을 모두 읽음으로. 오래된 알림 정리도 여기서 한다(별도 스케줄러 없이). */
    public long readAll(CurrentUser me) {
        var now = Times.now();
        List<AppNotification> l = notifications.findByUserIdAndReadAtIsNull(me.userId());
        for (AppNotification n : l) n.readAt = now;
        notifications.deleteOlderThan(now.minusDays(KEEP_DAYS));
        return l.size();
    }
}
