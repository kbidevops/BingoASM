package com.bingoasm.auth;

import com.bingoasm.domain.AppUser;

/**
 * 사용자가 다루는 데이터 범위. 권한(무엇을 여는가)과 별개로 "누구의 데이터인가"를 정한다.
 * 역할이 여러 개면 여기서 한 번만 정하는 우선순위를 따른다: 도교육청 > 교육지원청 > 학교 > 업체.
 * 학교 범위의 실제 학교 목록은 SchoolService.scopeSchoolIds가 계산한다.
 */
public record Scope(Kind kind, Long regionId, Long schoolId, Long vendorId) {

    public enum Kind {
        /** 도교육청·시스템 관리자: 기관 전체. */
        PROVINCE,
        /** 교육지원청 담당자: 관할 교육지원청(regionId) 관내 학교. */
        REGION,
        /** 학교 담당자: 자기 학교(schoolId). */
        SCHOOL,
        /** AS 기사·업체 관리자: 자기 업체(vendorId)에 배정된 AS. */
        VENDOR,
        /** 원클릭 AS 소속이 없는 계정 (기존 자산관리 요청·접수·처리자). */
        NONE
    }

    public static Scope of(AppUser u) {
        if (u.roles.contains("EDU_ADMIN") || u.roles.contains("SYS_ADMIN")) return new Scope(Kind.PROVINCE, null, null, null);
        if (u.roles.contains("REGION_ADMIN")) return new Scope(Kind.REGION, u.regionId, null, null);
        if (u.roles.contains("SCHOOL_USER")) return new Scope(Kind.SCHOOL, null, u.schoolId, null);
        if (u.roles.contains("AS_ENGINEER") || u.roles.contains("VENDOR_ADMIN")) return new Scope(Kind.VENDOR, null, null, u.vendorId);
        return new Scope(Kind.NONE, null, null, null);
    }

    public boolean province() { return kind == Kind.PROVINCE; }
    public boolean region() { return kind == Kind.REGION; }
    public boolean school() { return kind == Kind.SCHOOL; }
    public boolean vendor() { return kind == Kind.VENDOR; }
    /** 학교 단위로 범위가 정해지는가 (학교·교육지원청). 이런 사용자는 학교 없는 데이터를 다룰 수 없다. */
    public boolean schoolBound() { return kind == Kind.SCHOOL || kind == Kind.REGION; }
}
