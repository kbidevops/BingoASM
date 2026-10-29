package com.bingoasm.domain.as;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 원클릭 AS 코드값. */
public final class AsCodes {
    private AsCodes() {}

    public static final List<String> RCEPT_TYPES = List.of("C", "M", "S", "T");
    public static final Map<String, String> RCEPT_TY_NAME = Map.of("C", "정보기기", "M", "무선망", "S", "스쿨넷", "T", "스마트기기");
    public static final Map<String, String> STATUS_NAME = Map.of("A", "신청완료", "R", "접수완료", "C", "처리완료", "X", "반려");

    public static final Map<String, Map<String, String>> FAULT_TYPES = new LinkedHashMap<>();
    static {
        Map<String, String> c = new LinkedHashMap<>();
        c.put("11", "부팅·전원 불량"); c.put("12", "화면·모니터 불량"); c.put("13", "프린터·주변기기"); c.put("14", "소프트웨어 오류");
        c.put("15", "바이러스·보안"); c.put("16", "네트워크 연결"); c.put("17", "기타");
        Map<String, String> m = new LinkedHashMap<>();
        m.put("S", "속도느림"); m.put("P", "접속불량"); m.put("W", "직접입력");
        Map<String, String> s = new LinkedHashMap<>();
        s.put("71", "전체"); s.put("72", "일부"); s.put("73", "기타");
        Map<String, String> t = new LinkedHashMap<>();
        t.put("81", "기기 불량"); t.put("82", "파손"); t.put("83", "충전·배터리"); t.put("84", "앱·설정"); t.put("85", "기타");
        FAULT_TYPES.put("C", c); FAULT_TYPES.put("M", m); FAULT_TYPES.put("S", s); FAULT_TYPES.put("T", t);
    }

    public static final Map<String, String> REQUEST_TYPE_NAME = Map.of("1", "무선 AP 원격 재부팅 요청", "2", "방문요청", "3", "기타");

    public static final Map<String, String> PROCESS_TYPE_NAME = new LinkedHashMap<>();
    static {
        PROCESS_TYPE_NAME.put("1", "장비불량"); PROCESS_TYPE_NAME.put("2", "장비행업"); PROCESS_TYPE_NAME.put("3", "설정오류");
        PROCESS_TYPE_NAME.put("4", "케이블불량"); PROCESS_TYPE_NAME.put("5", "포트연결불량"); PROCESS_TYPE_NAME.put("6", "부속품불량");
        PROCESS_TYPE_NAME.put("7", "사용미숙"); PROCESS_TYPE_NAME.put("8", "기타");
    }

    /** 게시판 설정: 읽기 권한, 글쓰기 권한(null = 읽기 권한자 모두), 진행상태 사용 여부. */
    public record Board(String code, String name, String readPerm, String writePerm, boolean hasStatus, List<String> categories, boolean hasField, boolean hasRegion, boolean allowSecret) {}
    /** 처리 보고서 비용 항목 구분. */
    public static final Map<String, String> COST_TYPE_NAME = new LinkedHashMap<>();
    static {
        COST_TYPE_NAME.put("PART", "부품"); COST_TYPE_NAME.put("LABOR", "공임"); COST_TYPE_NAME.put("TRAVEL", "출장"); COST_TYPE_NAME.put("ETC", "기타");
    }
    public static final Map<String, String> CHARGE_TYPE_NAME = Map.of("FREE", "무상(계약 포함)", "PAID", "유상(별도 청구)");

    public static final Map<String, Board> BOARDS = new LinkedHashMap<>();
    static {
        BOARDS.put("NOTICE", new Board("NOTICE", "공지 및 자료실", "BOARD_NOTICE", "BOARD_ADMIN", false, List.of("일반", "긴급", "자료"), false, false, false));
        BOARDS.put("QNA", new Board("QNA", "질문 및 건의하기", "BOARD_QNA", null, false, List.of("질문", "건의"), true, false, true));
        BOARDS.put("CONSULT", new Board("CONSULT", "컨설팅 신청", "BOARD_CONSULT", null, true, List.of(), false, true, true));
        BOARDS.put("DISPOSAL", new Board("DISPOSAL", "불용PC수거신청", "BOARD_DISPOSAL", null, true, List.of(), false, true, true));
        BOARDS.put("VENDOR", new Board("VENDOR", "유지관리업체(정보공유)", "BOARD_VENDOR", null, false, List.of("의견사항", "업무질의"), false, true, false));
        BOARDS.put("SLA", new Board("SLA", "스쿨넷 SLA 공유", "BOARD_SLA", "BOARD_ADMIN", false, List.of(), false, false, false));
    }
    public static final Map<String, String> POST_STATUS_NAME = Map.of("WAIT", "대기", "RECEIVED", "접수", "DONE", "완료");
    public static final Map<String, String> FIELD_NAME = Map.of("WIRELESS", "무선", "DEVICE", "정보기기", "SCHOOLNET", "스쿨넷", "ETC", "기타");
    public static final Map<String, String> SCHOOL_TYPE_NAME = Map.of("ELEM", "초등학교", "MID", "중학교", "HIGH", "고등학교", "SPECIAL", "특수학교", "ETC", "기타");
}
