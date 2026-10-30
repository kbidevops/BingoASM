#!/usr/bin/env python3
"""원클릭 AS 백엔드 통합 테스트. 서버(:8090, 새 H2)에 대해 로그인/OTP/QR, AS 워크플로, 게시판, 공간, 재물조사, 일괄등록, QR, 파일, 권한표를 검사한다."""
import io, json, sys, time, urllib.request, urllib.error, urllib.parse, uuid

import os
BASE = os.environ.get("BINGOASM_URL", "http://localhost:8080")
results = []


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def call(method, path, body=None, token=None, raw=False, files=None, follow=True):
    url = BASE + urllib.parse.quote(path, safe="/?=&%._-")
    data = None
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if files is not None:
        boundary = "----bingo" + uuid.uuid4().hex
        buf = io.BytesIO()
        for name, (fname, content, mime) in files:
            buf.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{fname}"\r\nContent-Type: {mime}\r\n\r\n'.encode())
            buf.write(content)
            buf.write(b"\r\n")
        for k, v in (body or {}).items():
            buf.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        buf.write(f"--{boundary}--\r\n".encode())
        data = buf.getvalue()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body, ensure_ascii=False).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=60) as r:
            b = r.read()
            if raw:
                return r.status, b, dict(r.headers)
            return r.status, (json.loads(b) if b else None), dict(r.headers)
    except urllib.error.HTTPError as e:
        b = e.read()
        try:
            j = json.loads(b)
        except Exception:
            j = b
        return e.code, j, dict(e.headers)


def check(name, cond, info=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else "  -> " + str(info)[:400]))


def data(res):
    return res[1]["data"] if isinstance(res[1], dict) and "data" in res[1] else res[1]


def msg(res):
    return res[1].get("message") if isinstance(res[1], dict) else res[1]


# ---------- wait ----------
for i in range(120):
    try:
        st, _, _ = call("GET", "/api/as/requests/codes")
        if st in (200, 401):
            break
    except Exception:
        pass
    time.sleep(1)
else:
    print("server not up"); sys.exit(1)
print("server up after", i, "s")
# 시더가 끝날 때까지(school01 생성) 기다린다 — 2초 간격, 최대 10회(분당 로그인 제한 20회 이내)
for k in range(10):
    st, j, _ = call("POST", "/api/auth/login", {"loginId": "school01", "password": "user1234!"})
    if st == 200:
        break
    time.sleep(2)
print("seed ready after", k, "retries")


def login(uid, pw):
    for _ in range(4):  # 분당 로그인 제한(20회)에 걸리면 잠시 기다렸다 다시
        st, j, _ = call("POST", "/api/auth/login", {"loginId": uid, "password": pw})
        if st != 429:
            break
        time.sleep(20)
    assert st == 200, (uid, st, j)
    d = j["data"]
    if d.get("step") == "otp":
        st2, j2, _ = call("POST", "/api/auth/otp/verify", {"otpToken": d["otpToken"], "code": d["devCode"]})
        assert st2 == 200, (uid, st2, j2)
        d = j2["data"]
    return d.get("accessToken") or d.get("token")


# ---------- 1. 로그인 · OTP · 잠금 정책 ----------
S = login("school01", "user1234!")
S2 = login("school02", "user1234!")
N = login("netengineer", "user1234!")
V = login("vendoradmin", "user1234!")
A = login("admin", "admin1234!")
check("login: 5 accounts", all([S, S2, N, V, A]))
# 권한표 검사는 네 서비스(정보기기·무선망·스쿨넷·스마트기기)를 모두 쓰는 교육청 기준. 끄고 켜기는 맨 끝에서 따로 본다.
st, j, _ = call("PUT", "/api/org/as-services", {"asTypes": ["C", "M", "S", "T"]}, token=A)
check("as-services: all four on for the permission-table checks", st == 200 and data((st, j, None))["asTypes"] == ["C", "M", "S", "T"], j)

st, j, _ = call("POST", "/api/auth/login", {"loginId": "eduadmin", "password": "user1234!"})
d = j["data"]
check("OTP: eduadmin login returns otp step + devCode", st == 200 and d.get("step") == "otp" and d.get("devCode"), j)
st, j2, _ = call("POST", "/api/auth/otp/verify", {"otpToken": d["otpToken"], "code": "000000" if d["devCode"] != "000000" else "111111"})
check("OTP: wrong code rejected", st in (400, 401), j2)
st, j3, _ = call("POST", "/api/auth/otp/verify", {"otpToken": d["otpToken"], "code": d["devCode"]})
E = (j3.get("data") or {}).get("accessToken") if st == 200 else None
check("OTP: right code → token", st == 200 and E, j3)
st, j4, _ = call("POST", "/api/auth/otp/verify", {"otpToken": d["otpToken"], "code": d["devCode"]})
check("OTP: code is single-use", st != 200, j4)

st, j, _ = call("POST", "/api/auth/login", {"loginId": "school02", "password": "wrong"})
check("login: wrong password → 401 with counter", st == 401 and "(1/" in (msg((st, j, None)) or ""), j)
st, j, _ = call("PUT", "/api/auth/password", {"currentPassword": "user1234!", "newPassword": "short"}, token=S2)
check("password policy: weak password rejected", st == 400, j)
st, j, _ = call("PUT", "/api/auth/password", {"currentPassword": "user1234!", "newPassword": "school02pw!"}, token=S2)
check("password policy: contains loginId rejected", st == 400, j)
st, j, _ = call("GET", "/api/auth/me", token=S)
me = data((st, j, None))
check("me: school01 has AS_M_REQUEST, AS_C_REQUEST, SMART_REQUEST, schoolId", st == 200 and all(p in me["permissions"] for p in ["AS_M_REQUEST", "AS_C_REQUEST", "AS_S_REQUEST", "SMART_REQUEST"]) and me.get("schoolId"), j)
st, j, _ = call("GET", "/api/auth/me", token=N)
men = data((st, j, None))
check("me: netengineer perms per 접근권한표 (M/S request+view, C view only, AS_PROCESS, no NOTICE/SMART/C_REQUEST/SLA)",
      st == 200 and {"AS_PROCESS", "AS_M_REQUEST", "AS_M_VIEW", "AS_S_REQUEST", "AS_S_VIEW", "AS_C_VIEW"} <= set(men["permissions"])
      and not ({"BOARD_NOTICE", "SMART_REQUEST", "AS_C_REQUEST", "BOARD_SLA", "INVENTORY", "ASSET_BULK"} & set(men["permissions"])), men.get("permissions"))
st, j, _ = call("GET", "/api/auth/me/logins", token=S)
check("me: login history masked ip", st == 200 and len(data((st, j, None))) >= 1 and "*" in str(data((st, j, None))[0].get("ip", "*")), j)
st, j, _ = call("POST", "/api/auth/me/scraps", {"menuKey": "as.m.request", "groupName": "무선망", "title": "무선망 AS신청"}, token=S)
st2, j2, _ = call("GET", "/api/auth/me/scraps", token=S)
check("me: menu scraps add/list", st == 200 and st2 == 200 and any(x["menuKey"] == "as.m.request" for x in data((st2, j2, None))), (j, j2))

# ---------- 2. QR 로그인 ----------
st, j, _ = call("POST", "/api/auth/qr/start")
q = data((st, j, None))
check("qr-login: start gives token/num/qrText", st == 200 and q.get("token") and q.get("num") and "/qr?t=" in q.get("qrText", ""), j)
st, j, _ = call("GET", f"/api/auth/qr/{q['token']}")
check("qr-login: poll PENDING", st == 200 and data((st, j, None))["status"] == "PENDING", j)
st, j, _ = call("GET", f"/api/auth/qr/{q['token']}/info")
check("qr-login: info requires login", st == 401, j)
st, j, _ = call("GET", f"/api/auth/qr/{q['token']}/info", token=S)
check("qr-login: phone sees num", st == 200 and data((st, j, None))["num"] == q["num"], j)
st, j, _ = call("POST", f"/api/auth/qr/{q['token']}/approve", {"num": "00" if q["num"] != "00" else "01"}, token=S)
check("qr-login: wrong num rejected", st == 400, j)
st, j, _ = call("POST", f"/api/auth/qr/{q['token']}/approve", {"num": q["num"]}, token=S)
check("qr-login: approve", st == 200, j)
st, j, _ = call("GET", f"/api/auth/qr/{q['token']}")
qd = data((st, j, None))
check("qr-login: poll APPROVED returns tokens once", st == 200 and qd["status"] == "APPROVED" and qd.get("accessToken"), j)
st, j, _ = call("GET", f"/api/auth/qr/{q['token']}")
check("qr-login: session CONSUMED afterwards", st == 200 and data((st, j, None))["status"] == "CONSUMED" and not data((st, j, None)).get("accessToken"), j)
st, _, h = call("GET", f"/qr?t={q['token']}", raw=True, follow=False)
check("qr-login: public /qr?t= redirects to approve page", st == 302 and "/login/qr-approve?t=" in h.get("Location", ""), (st, h.get("Location")))

# ---------- 3. 접근권한표 ----------
st, j, _ = call("GET", "/api/as/boards/NOTICE", token=N); check("권한표: 기사 공지및자료실 없음", st == 403, j)
st, j, _ = call("GET", "/api/as/boards/QNA", token=N); check("권한표: 기사 질문및건의 있음", st == 200, j)
st, j, _ = call("GET", "/api/as/boards/CONSULT", token=N); check("권한표: 기사 컨설팅신청 있음", st == 200, j)
st, j, _ = call("GET", "/api/as/contacts", token=N); check("권한표: 기사 문의처안내 있음", st == 200, j)
st, j, _ = call("GET", "/api/as/boards/DISPOSAL", token=N); check("권한표: 기사 불용PC수거 있음", st == 200, j)
st, j, _ = call("GET", "/api/as/boards/VENDOR", token=N); check("권한표: 기사 유지관리업체 있음", st == 200, j)
st, j, _ = call("GET", "/api/as/boards/SLA", token=N); check("권한표: 기사 스쿨넷 SLA 없음", st == 403, j)
st, j, _ = call("GET", "/api/as/stats/monthly", token=N); check("권한표: 기사 통합관리(통계) 없음", st == 403, j)
st, j, _ = call("POST", "/api/as/schools", {"schoolName": "x"}, token=N); check("권한표: 기사 학교관리 없음", st == 403, j)
st, j, _ = call("POST", "/api/as/requests", {"rceptTy": "C", "symptom": "x"}, token=N); check("권한표: 기사 정보기기 AS신청 없음", st == 403, j)
st, j, _ = call("POST", "/api/as/requests", {"rceptTy": "T", "symptom": "x"}, token=N); check("권한표: 기사 스마트기기지원신청 없음", st == 403, j)
st, j, _ = call("GET", "/api/as/requests?rceptTy=C", token=N); check("권한표: 기사 정보기기 AS결과조회 있음", st == 200, j)
st, j, _ = call("GET", "/api/as/requests?rceptTy=M", token=N); check("권한표: 기사 무선망 AS결과조회 있음", st == 200, j)
st, j, _ = call("GET", "/api/as/boards", token=N)
codes = [b["code"] for b in data((st, j, None))]
check("권한표: 기사 게시판 메뉴 = QNA/CONSULT/DISPOSAL/VENDOR", sorted(codes) == sorted(["QNA", "CONSULT", "DISPOSAL", "VENDOR"]), codes)
st, j, _ = call("GET", "/api/as/stats/monthly", token=S); check("권한표: 학교 통계 없음", st == 403, j)
st, j, _ = call("GET", "/api/as/stats/monthly", token=V); check("권한표: 업체관리자 통계 있음(자기 업체)", st == 200, j)
st, j, _ = call("POST", "/api/as/inventory", {"schoolId": 1}, token=N); check("권한표: 기사 재물조사 없음", st == 403, j)

# ---------- 4. 기준정보 ----------
st, j, _ = call("GET", "/api/as/requests/codes", token=S)
c = data((st, j, None))
check("codes: 4 types, 4 statuses, process types 1~8", st == 200 and len(c["rceptTypes"]) == 4 and len(c["statuses"]) == 4 and len(c["processTypes"]) == 8, j)
st, j, _ = call("GET", "/api/as/regions", token=S); check("regions: 10 (충북 교육지원청)", st == 200 and len(data((st, j, None))) == 10, j)
st, j, _ = call("GET", "/api/as/schools", token=E); schools = data((st, j, None))
check("schools: admin sees 8", st == 200 and len(schools) == 8, len(schools) if st == 200 else j)
bh = next(s for s in schools if s["schoolName"] == "봉황초등학교")
oc = next(s for s in schools if s["schoolName"] == "온천중학교")
st, j, _ = call("GET", f"/api/as/schools/{bh['schoolId']}", token=E); sd = data((st, j, None))
check("school detail: vendor mapping M/S", st == 200 and len(sd.get("vendors", [])) == 2, j)
st, j, _ = call("GET", "/api/as/vendors?rceptTy=M", token=S); vs = data((st, j, None))
check("vendors filter by type M → 한빛네트웍스 only", st == 200 and [v["vendorName"] for v in vs] == ["한빛네트웍스"], vs)
hanbit = vs[0]
st, j, _ = call("GET", f"/api/as/vendors/{hanbit['vendorId']}/engineers", token=E); engs = data((st, j, None))
check("vendor engineers lists netengineer + vendoradmin", st == 200 and {e.get("userName") for e in engs} >= {"강민재", "서정우"}, j)
st, j, _ = call("POST", "/api/as/schools", {"schoolName": "임시초등학교", "regionId": 1, "schoolType": "ELEM"}, token=E); ns = data((st, j, None))
st2, j2, _ = call("DELETE", f"/api/as/schools/{ns['schoolId']}", token=E) if st == 200 else (0, None, None)
check("school create/delete (admin)", st == 200 and st2 == 200, (j, j2))
st, j, _ = call("GET", f"/api/as/wireless-devices?schoolId={bh['schoolId']}", token=S); devs = data((st, j, None))
check("wireless devices of 봉황초: ≥5", st == 200 and devs["totalElements"] >= 5, j)
apB2 = next(d for d in devs["content"] if d["deviceCode"] == "AP-BH-002")
st, j, _ = call("GET", f"/api/as/wireless-devices?schoolId={oc['schoolId']}", token=S)
check("wireless devices: school user cannot read other school", st == 403, j)
st, j, _ = call("POST", "/api/as/wireless-devices", {"schoolId": bh["schoolId"], "deviceCode": "AP-BH-099", "deviceName": "임시 AP"}, token=S)
check("wireless device create: school user forbidden", st == 403, j)
st, j, _ = call("POST", "/api/as/wireless-devices", {"schoolId": bh["schoolId"], "deviceCode": "AP-BH-099", "deviceName": "임시 AP", "deviceType": "AP"}, token=E)
check("wireless device create: admin ok", st == 200 and data((st, j, None))["deviceCode"] == "AP-BH-099", j)

# ---------- 5. AS 워크플로 (무선망: 학교 → 업체 기사 → 학교 평가) ----------
body = {"rceptTy": "M", "faultTypeCode": "P", "requestTypeCode": "2", "symptom": "2층 복도 AP 접속 불가(테스트)", "installPlace": "본관 2층 복도",
        "deviceId": apB2["deviceId"], "visitRequestAt": "2026-10-29T10:00", "contactTel": "010-2000-0001"}
st, j, _ = call("POST", "/api/as/requests", body, token=S); r = data((st, j, None))
check("AS create (M): status A, vendor/engineer auto-assigned, applicant from account",
      st == 200 and r["status"] == "A" and r["vendorName"] == "한빛네트웍스" and r["engineerName"] == "강민재" and r["applicantName"] == "한보람" and apB2["deviceCode"] in r["deviceName"], j)
sn = r["asvcSn"]
check("AS create: allowed actions for owner = update/cancel", set(r["allowedActions"]) == {"update", "cancel"}, r.get("allowedActions"))
st, j, _ = call("POST", f"/api/as/requests/{sn}/receive", {"visitPlannedAt": "2026-10-29T10:00"}, token=S)
check("AS receive by school user → 409", st == 409, j)
st, j, _ = call("GET", "/api/as/requests?rceptTy=M&status=A", token=N); lst = data((st, j, None))
check("AS list (engineer, M, A) contains new request", st == 200 and any(x["asvcSn"] == sn for x in lst["content"]), j)
st, j, _ = call("GET", "/api/as/requests?rceptTy=M&searchType=school&keyword=봉황", token=N); lst = data((st, j, None))
check("AS list: search by school name", st == 200 and lst["totalElements"] >= 1 and all("봉황" in x["schoolName"] for x in lst["content"]), j)
st, j, _ = call("GET", "/api/as/requests?rceptTy=M&searchType=region&keyword=청주", token=E); lst = data((st, j, None))
check("AS list: search by region name", st == 200 and lst["totalElements"] >= 1 and all("청주" in x["regionName"] for x in lst["content"]), j)
st, j, _ = call("GET", "/api/as/requests?rceptTy=M&fromDate=2026-10-01&toDate=2026-10-31", token=E); lst = data((st, j, None))
check("AS list: date range filter", st == 200 and all(x["requestAt"].startswith("2026-10") for x in lst["content"]), j)
st, j, _ = call("POST", f"/api/as/requests/{sn}/receive", {}, token=N)
check("AS receive without visitPlannedAt → 400 '방문예정일시'", st == 400 and "방문예정" in msg((st, j, None)), j)
st, j, _ = call("POST", f"/api/as/requests/{sn}/receive", {"visitPlannedAt": "2026-10-29T10:00"}, token=N); r = data((st, j, None))
check("AS receive → R, receivedAt set, actions visit/report/transfer", st == 200 and r["status"] == "R" and r["receivedAt"] and {"visit", "report", "transfer"} <= set(r["allowedActions"]), j)
st, j, _ = call("POST", f"/api/as/requests/{sn}/visit", {"visitPlannedAt": "2026-10-30T14:00"}, token=N); r = data((st, j, None))
check("AS visit (reschedule)", st == 200 and r["visitPlannedAt"].startswith("2026-10-30T14:00"), j)
st, j, _ = call("POST", f"/api/as/requests/{sn}/report", {"troubleSymptom": "AP 행업", "inspectContent": "재부팅"}, token=N)
check("AS report without processContent → 400", st == 400, j)
st, j, _ = call("POST", f"/api/as/requests/{sn}/report", {"visitAt": "2026-10-30T14:00", "visitEndAt": "2026-10-30T15:00", "troubleSymptom": "AP 행업", "inspectContent": "AP 재부팅 및 펌웨어 업데이트", "processTypeCode": "2", "processContent": "장비행업 — 재부팅 후 정상", "processAmount": 0}, token=N)
r = data((st, j, None))
check("AS report → C with completedAt and processTypeName", st == 200 and r["status"] == "C" and r["completedAt"] and r["processTypeName"] == "장비행업", j)
st, j, _ = call("POST", f"/api/as/requests/{sn}/evaluate", {"score": 5, "opinion": "빠른 처리 감사합니다."}, token=N)
check("AS evaluate by engineer → 409", st == 409, j)
st, j, _ = call("POST", f"/api/as/requests/{sn}/evaluate", {"score": 5, "opinion": "빠른 처리 감사합니다."}, token=S); r = data((st, j, None))
check("AS evaluate by school → evalScore 5, histories ≥ 5", st == 200 and r["evalScore"] == 5 and len(r["histories"]) >= 5, j)
st, j, _ = call("POST", f"/api/as/requests/{sn}/evaluate", {"score": 4}, token=S)
check("AS evaluate twice → 409", st == 409, j)
st, b, h = call("GET", "/api/as/requests/excel?rceptTy=M", token=N, raw=True)
check("AS excel download", st == 200 and b[:2] == b"PK" and "spreadsheetml" in h.get("Content-Type", ""), (st, h.get("Content-Type")))
st, j, _ = call("GET", "/api/as/requests/summary", token=N); sm = data((st, j, None))
check("AS summary (engineer)", st == 200 and isinstance(sm, dict) and sm, j)

# return / return-cancel / cancel
st, j, _ = call("POST", "/api/as/requests", {"rceptTy": "S", "faultTypeCode": "72", "symptom": "별관 인터넷 불가(테스트)", "installPlace": "별관", "visitRequestAt": "2026-10-30T10:00"}, token=S)
sn3 = data((st, j, None))["asvcSn"]
st, j, _ = call("POST", f"/api/as/requests/{sn3}/return", {}, token=N)
check("AS return without reason → 400", st == 400, j)
st, j, _ = call("POST", f"/api/as/requests/{sn3}/return", {"reason": "중복 신청"}, token=N); r = data((st, j, None))
check("AS return → X with reason", st == 200 and r["status"] == "X" and r["returnReason"] == "중복 신청", j)
st, j, _ = call("POST", f"/api/as/requests/{sn3}/return-cancel", {}, token=N); r = data((st, j, None))
check("AS return-cancel → A", st == 200 and r["status"] == "A", j)
st, j, _ = call("PUT", f"/api/as/requests/{sn3}", {"symptom": "별관 인터넷 불가(수정)"}, token=S); r = data((st, j, None))
check("AS update by owner while A", st == 200 and r["symptom"] == "별관 인터넷 불가(수정)", j)
st, j, _ = call("POST", f"/api/as/requests/{sn3}/cancel", {}, token=S)
st2, j2, _ = call("GET", f"/api/as/requests/{sn3}", token=S)
check("AS cancel → gone (404)", st == 200 and st2 == 404, (j, j2))
# admin assign
st, j, _ = call("POST", "/api/as/requests", {"rceptTy": "S", "faultTypeCode": "72", "symptom": "본관 인터넷 불가(테스트)", "installPlace": "본관", "visitRequestAt": "2026-10-30T10:00"}, token=S)
sn4 = data((st, j, None))["asvcSn"]
st, j, _ = call("POST", f"/api/as/requests/{sn4}/assign", {"vendorId": hanbit["vendorId"]}, token=E); r = data((st, j, None))
check("AS assign by admin", st == 200 and r["vendorName"] == hanbit["vendorName"], j)
st, j, _ = call("DELETE", f"/api/as/requests/{sn4}", token=S); check("AS delete: school user forbidden", st == 403, j)
st, j, _ = call("DELETE", f"/api/as/requests/{sn4}", token=E); check("AS delete: admin ok", st == 200, j)
st, j, _ = call("GET", "/api/as/requests?rceptTy=M", token=S2)
check("AS list: school02 cannot see 봉황초 M requests", st == 200 and all(x["schoolName"] == "온천중학교" for x in data((st, j, None))["content"]), j)

# ---------- 6. 게시판 ----------
st, j, _ = call("GET", "/api/as/boards", token=S)
check("boards: school user sees all 6", st == 200 and len(data((st, j, None))) == 6, j)
st, j, _ = call("GET", "/api/as/boards/NOTICE", token=S); nl = data((st, j, None))
check("NOTICE list ≥ 3, newest first", st == 200 and nl["totalElements"] >= 3 and nl["content"][0]["postId"] > nl["content"][-1]["postId"], j)
st, j, _ = call("POST", "/api/as/boards/NOTICE", {"title": "x", "content": "y"}, token=S); check("NOTICE write by school user → 403", st == 403, j)
st, j, _ = call("POST", "/api/as/boards/NOTICE", {"title": "테스트 공지", "content": "본문", "categoryCode": "일반"}, token=E); check("NOTICE write by admin", st == 200, j)
st, j, _ = call("POST", "/api/as/boards/QNA", {"title": "비밀 질문", "content": "AP 교체 일정 문의", "categoryCode": "질문", "fieldCode": "WIRELESS", "secret": True}, token=S)
qp = data((st, j, None)); check("QNA write (secret)", st == 200 and qp["secret"] is True, j)
st, j, _ = call("GET", f"/api/as/boards/QNA/{qp['postId']}", token=S2); check("QNA secret: other school → 403", st == 403, j)
st, j, _ = call("GET", f"/api/as/boards/QNA/{qp['postId']}", token=E); check("QNA secret: admin can read", st == 200, j)
st, j, _ = call("POST", f"/api/as/boards/QNA/{qp['postId']}/comments", {"content": "x"}, token=N); check("QNA secret: engineer cannot answer secret post", st == 403, j)
st, j, _ = call("POST", f"/api/as/boards/QNA/{qp['postId']}/comments", {"content": "다음 주 방문 예정입니다."}, token=E); qd = data((st, j, None))
check("QNA answer by admin", st == 200 and len(qd["comments"]) == 1, j)
st, j, _ = call("POST", "/api/as/boards/QNA", {"title": "공개 질문", "content": "AP 펌웨어 버전 문의", "categoryCode": "질문", "fieldCode": "WIRELESS"}, token=S); qp2 = data((st, j, None))
st, j, _ = call("POST", f"/api/as/boards/QNA/{qp2['postId']}/comments", {"content": "8.10.0.9 입니다."}, token=N); qd2 = data((st, j, None))
check("QNA answer by engineer (AS_PROCESS) on public post", st == 200 and len(qd2["comments"]) == 1 and qd2["comments"][0]["authorName"] == "강민재", j)
st, j, _ = call("POST", f"/api/as/boards/QNA/{qp['postId']}/comments", {"content": "x"}, token=S2); check("QNA comment by unrelated user → 403", st == 403, j)
st, j, _ = call("GET", "/api/as/boards/QNA?mine=true", token=S); check("QNA mine filter", st == 200 and all(x["authorName"] == "한보람" for x in data((st, j, None))["content"]), j)
st, j, _ = call("GET", "/api/as/boards/CONSULT", token=S); cl = data((st, j, None)); cs = cl["content"][0]
st, j, _ = call("PATCH", f"/api/as/boards/CONSULT/{cs['postId']}/status", {"status": "RECEIVED"}, token=S); check("CONSULT status by school user → 403", st == 403, j)
st, j, _ = call("PATCH", f"/api/as/boards/CONSULT/{cs['postId']}/status", {"status": "RECEIVED", "visitDate": "2026-11-10"}, token=E); cd = data((st, j, None))
check("CONSULT status by admin → RECEIVED + visitDate", st == 200 and cd["status"] == "RECEIVED" and cd["visitDate"] == "2026-11-10", j)
st, j, _ = call("POST", "/api/as/boards/DISPOSAL", {"title": "불용 모니터 5대", "content": "수거 요청"}, token=S); dp = data((st, j, None))
check("DISPOSAL write: status WAIT, school/region auto", st == 200 and dp["status"] == "WAIT" and dp["schoolName"] == "봉황초등학교", j)
st, j, _ = call("DELETE", f"/api/as/boards/DISPOSAL/{dp['postId']}", token=S2); check("DISPOSAL delete by other → 403", st == 403, j)
st, j, _ = call("DELETE", f"/api/as/boards/DISPOSAL/{dp['postId']}", token=S); check("DISPOSAL delete by author", st == 200, j)
st, j, _ = call("GET", "/api/as/boards/VENDOR?searchType=title&keyword=점검", token=V); check("VENDOR search", st == 200 and data((st, j, None))["totalElements"] >= 1, j)
st, j, _ = call("GET", "/api/as/contacts", token=S); ct = data((st, j, None))
check("contacts grouped: 도교육청 first + 10 교육지원청, 담당업무 포함", st == 200 and ct[0]["regionName"] == "도교육청" and len(ct) == 11 and ct[1]["groups"][0]["items"][0]["duties"], j)
st, j, _ = call("PUT", "/api/as/contacts", [{"groupName": "g", "itemName": "i", "tel": "1"}], token=S); check("contacts replace by school user → 403", st == 403, j)

# ---------- 7. 통계 ----------
st, j, _ = call("GET", "/api/as/stats/monthly?year=2026", token=E); stt = data((st, j, None))
check("stats monthly: total ≥ 9, 4 types, regions, vendors", st == 200 and stt["total"]["count"] >= 9 and len(stt["byType"]) == 4 and len(stt["byRegion"]) == 10 and len(stt["byVendor"]) >= 1, j)
st, j, _ = call("GET", "/api/as/stats/monthly?year=2026&rceptTy=M", token=V); sv = data((st, j, None))
check("stats monthly (vendor admin): only own vendor rows", st == 200 and all(v["vendorName"] == "한빛네트웍스" for v in sv["byVendor"]), j)
st, j, _ = call("GET", "/api/as/stats/satisfaction?year=2026", token=E); sat = data((st, j, None))
check("stats satisfaction: evaluated ≥ 5, distribution 1..5, byEngineer", st == 200 and sat["summary"]["evaluated"] >= 5 and len(sat["summary"]["distribution"]) == 5 and sat["byEngineer"], j)

# ---------- 8. 공간(도면) ----------
st, j, _ = call("GET", f"/api/as/spaces/buildings?schoolId={bh['schoolId']}", token=S); bl = data((st, j, None))
check("spaces buildings: 본관 3 floors, 2F has plan", st == 200 and len(bl) == 1 and len(bl[0]["floors"]) == 3 and any(f.get("planUrl") for f in bl[0]["floors"]), j)
fl2 = next(f for f in bl[0]["floors"] if f["floorNo"] == 2); fl3 = next(f for f in bl[0]["floors"] if f["floorNo"] == 3)
st, j, _ = call("GET", f"/api/as/spaces/rooms?schoolId={bh['schoolId']}", token=S); rl = data((st, j, None))
check("spaces rooms: 8 rooms with asset counts", st == 200 and len(rl) == 8 and sum(r.get("assetCount", 0) for r in rl) >= 10, j)
pcroom = next(r for r in rl if r["roomName"] == "컴퓨터실"); r11 = next(r for r in rl if r["roomName"] == "1-1 교실")
check("spaces rooms: rect on plan for 컴퓨터실", pcroom.get("rect") and pcroom["rect"]["w"] > 0, pcroom)
st, j, _ = call("GET", f"/api/as/spaces/rooms?schoolId={bh['schoolId']}&floorId={fl2['floorId']}", token=S)
check("spaces rooms by floor: 3 on 2F", st == 200 and len(data((st, j, None))) == 3, j)
st, j, _ = call("GET", f"/api/as/spaces/rooms/{pcroom['roomId']}", token=S); rd = data((st, j, None))
check("room detail: assets listed (≥5), one REPAIR", st == 200 and len(rd["assets"]) >= 5 and any(a["status"] == "REPAIR" for a in rd["assets"]), j)
st, j, _ = call("GET", f"/api/as/spaces/rooms?schoolId={bh['schoolId']}", token=S2); check("spaces: other school forbidden", st == 403, j)
st, j, _ = call("POST", "/api/as/spaces/rooms", {"schoolId": bh["schoolId"], "floorId": fl3["floorId"], "roomNo": "303", "roomName": "음악실", "roomType": "CLASS"}, token=S); nr = data((st, j, None))
check("room create", st == 200 and nr["roomName"] == "음악실" and nr["floorId"] == fl3["floorId"], j)
st, j, _ = call("PUT", f"/api/as/spaces/rooms/{nr['roomId']}", {"rect": {"x": 10, "y": 50, "w": 20, "h": 25}}, token=S); nr2 = data((st, j, None))
check("room placeAt (rect)", st == 200 and nr2["rect"]["x"] == 10 and nr2["rect"]["h"] == 25, j)
st, j, _ = call("GET", "/api/assets?keyword=미배치", token=S); unp = data((st, j, None))["content"]
check("assets: unplaced asset visible to school user", len(unp) == 1, unp)
st, j, _ = call("POST", "/api/as/spaces/rooms/move-assets", {"roomId": nr["roomId"], "assetIds": [unp[0]["assetId"]], "how": "테스트 배정"}, token=S); mv = data((st, j, None))
check("assignRoom: move asset into room", st == 200 and mv["moved"] == 1, j)
st, j, _ = call("GET", f"/api/as/spaces/rooms/{nr['roomId']}", token=S)
check("room detail after move shows asset", st == 200 and len(data((st, j, None))["assets"]) == 1, j)
st, j, _ = call("POST", "/api/as/spaces/buildings", {"schoolId": bh["schoolId"], "buildingName": "별관", "floorCount": 2}, token=S); nb = data((st, j, None))
check("building create with floors", st == 200 and len(nb["floors"]) == 2, j)
st, j, _ = call("DELETE", f"/api/as/spaces/buildings/{nb['buildingId']}", token=S); check("building delete", st == 200, j)

# ---------- 9. QR ----------
a1 = rd["assets"][0]
st, b, h = call("GET", f"/api/qr/asset/{a1['assetNo']}.png", token=S, raw=True)
check("qr asset png", st == 200 and b[:8] == b"\x89PNG\r\n\x1a\n" and h.get("Content-Type", "").startswith("image/png"), (st, h.get("Content-Type")))
st, b, h = call("GET", f"/api/qr/room/{pcroom['roomId']}.png", token=S, raw=True); check("qr room png", st == 200 and b[:4] == b"\x89PNG", st)
st, b, h = call("GET", f"/api/qr/asset/{a1['assetNo']}.png", raw=True); check("qr png needs auth", st == 401, st)
st, j, _ = call("POST", "/api/qr/resolve", {"text": f"{BASE}/a/{a1['assetNo']}"}, token=S); rz = data((st, j, None))
check("qr resolve asset label → REGISTERED", st == 200 and rz["type"] == "ASSET" and rz["state"] == "REGISTERED" and rz["assetId"] == a1["assetId"], j)
st, j, _ = call("POST", "/api/qr/resolve", {"text": a1["assetNo"].lower()}, token=S); check("qr resolve bare asset no (case-insensitive)", st == 200 and data((st, j, None))["state"] == "REGISTERED", j)
st, j, _ = call("POST", "/api/qr/resolve", {"text": f"{BASE}/r/{pcroom['roomId']}"}, token=S); rz = data((st, j, None))
check("qr resolve room → ROOM found", st == 200 and rz["type"] == "ROOM" and rz["found"] and rz["roomName"] == "컴퓨터실", j)
st, j, _ = call("POST", "/api/qr/resolve", {"text": "https://example.com/other"}, token=S); check("qr resolve unknown", st == 200 and data((st, j, None))["type"] == "UNKNOWN", j)
st, j, _ = call("POST", "/api/qr/resolve", {"text": f"{BASE}/qr?t=abc123"}, token=S); check("qr resolve login QR", st == 200 and data((st, j, None))["type"] == "LOGIN" and data((st, j, None))["token"] == "abc123", j)
st, j, _ = call("GET", f"/api/assets/by-no/{a1['assetNo']}", token=S); check("asset by-no", st == 200 and data((st, j, None))["assetId"] == a1["assetId"], j)
st, j, _ = call("POST", "/api/qr/labels", {"assetIds": [a["assetId"] for a in rd["assets"][:3]]}, token=S); lb = data((st, j, None))
check("qr labels: 3 items with qrText and sub (학교 · 실)", st == 200 and len(lb) == 3 and all("/a/" in x["qrText"] for x in lb) and "봉황초등학교 · 컴퓨터실" == lb[0]["sub"], j)
st, j, _ = call("POST", "/api/qr/reserve", {"count": 2, "schoolId": bh["schoolId"]}, token=S); rv = data((st, j, None))
check("qr reserve 2 blank labels CB-2026-5xxxx", st == 200 and len(rv) == 2 and all(x["assetNo"].startswith("CB-2026-5") and x["blank"] for x in rv), j)
st, j, _ = call("POST", "/api/qr/resolve", {"text": rv[0]["qrText"]}, token=S); check("qr resolve reserved → RESERVED", st == 200 and data((st, j, None))["state"] == "RESERVED", j)
st, j, _ = call("GET", "/api/assets/categories", token=S); cats = data((st, j, None)); cdesk = next(c for c in cats if c["categoryName"] == "데스크톱")
check("categories carry lifeYears", cdesk.get("lifeYears") == 5, cdesk)
st, j, _ = call("POST", "/api/assets", {"assetType": "HW", "categoryId": cdesk["categoryId"], "assetName": "QR 라벨로 등록한 PC", "assetNo": rv[0]["assetNo"], "schoolId": bh["schoolId"], "roomId": pcroom["roomId"], "acquiredAt": "2020-03-01"}, token=S)
newId = data((st, j, None))
st2, j2, _ = call("POST", "/api/qr/resolve", {"text": rv[0]["qrText"]}, token=S)
check("asset registered with reserved number → REGISTERED", st == 200 and st2 == 200 and data((st2, j2, None))["state"] == "REGISTERED", (j, j2))
st, j, _ = call("GET", f"/api/assets/{newId}", token=S); ad = data((st, j, None))
check("asset detail: lifeYears from category, lifeExceeded true for 2020 desktop", st == 200 and ad.get("lifeYears") == 5 and ad.get("lifeExceeded") is True, j)
st, j, _ = call("POST", "/api/qr/resolve", {"text": f"{BASE}/a/CB-1999-99999"}, token=S); check("qr resolve unknown number → NOT_FOUND", st == 200 and data((st, j, None))["state"] == "NOT_FOUND", j)
st, _, h = call("GET", f"/a/{a1['assetNo']}", raw=True, follow=False); check("public /a/{assetNo} → 302 to asset route", st == 302 and h.get("Location") == f"/admin/assets?no={a1['assetNo']}", (st, h.get("Location")))
st, _, h = call("GET", f"/r/{pcroom['roomId']}", raw=True, follow=False); check("public /r/{roomId} → 302 to room route", st == 302 and h.get("Location") == f"/admin/floorplan?room={pcroom['roomId']}", (st, h.get("Location")))

# ---------- 10. 재물조사 ----------
st, j, _ = call("POST", "/api/as/inventory", {"schoolId": bh["schoolId"]}, token=S); inv = data((st, j, None)); sid = inv["sessionId"]
check("inventory start", st == 200 and inv["status"] == "OPEN", j)
st, j, _ = call("POST", f"/api/as/inventory/{sid}/scans", {"roomId": pcroom["roomId"], "text": f"{BASE}/a/{a1['assetNo']}"}, token=S)
check("inventory scan FOUND", st == 200 and data((st, j, None))["result"] == "FOUND", j)
st, j, _ = call("POST", f"/api/as/inventory/{sid}/scans", {"roomId": pcroom["roomId"], "assetNo": a1["assetNo"]}, token=S)
check("inventory scan DUPLICATE", st == 200 and data((st, j, None))["result"] == "DUPLICATE", j)
st, j, _ = call("GET", f"/api/as/spaces/rooms/{r11['roomId']}", token=S); board = next(a for a in data((st, j, None))["assets"] if "전자칠판" in a["assetName"])
st, j, _ = call("POST", f"/api/as/inventory/{sid}/scans", {"roomId": pcroom["roomId"], "assetNo": board["assetNo"]}, token=S); mvd = data((st, j, None))
check("inventory scan MOVED (asset of 1-1 교실 found in 컴퓨터실)", st == 200 and mvd["result"] == "MOVED" and mvd["fromRoomId"] == r11["roomId"], j)
st, j, _ = call("POST", f"/api/as/inventory/{sid}/scans", {"roomId": pcroom["roomId"], "assetNo": "CB-1999-99999"}, token=S)
check("inventory scan UNKNOWN", st == 200 and data((st, j, None))["result"] == "UNKNOWN", j)
st, j, _ = call("POST", f"/api/as/inventory/{sid}/scans", {"roomId": pcroom["roomId"], "text": "not a qr"}, token=S); check("inventory scan non-asset QR → 400", st == 400, j)
st, j, _ = call("PUT", f"/api/as/inventory/{sid}/rooms/{pcroom['roomId']}", {"done": True}, token=S); check("inventory room done", st == 200 and pcroom["roomId"] in data((st, j, None))["doneRoomIds"], j)
st, j, _ = call("GET", f"/api/as/inventory/{sid}", token=S); rep = data((st, j, None))
row = next(r for r in rep["rooms"] if r["roomId"] == pcroom["roomId"])
check("inventory report: totals found=1 moved=1 unknown=1, 컴퓨터실 missing = registered-1",
      st == 200 and rep["totals"]["found"] == 1 and rep["totals"]["moved"] == 1 and rep["totals"]["unknown"] == 1 and row["missing"] == row["registered"] - 1 and row["status"] == "완료", (rep.get("totals"), row))
st, j, _ = call("POST", f"/api/as/inventory/{sid}/apply-moves", {}, token=S); check("inventory apply moves", st == 200 and data((st, j, None))["moved"] == 1, j)
st, j, _ = call("GET", f"/api/as/spaces/rooms/{pcroom['roomId']}", token=S)
check("after apply: 전자칠판 now in 컴퓨터실", st == 200 and any(a["assetId"] == board["assetId"] for a in data((st, j, None))["assets"]), j)
st, j, _ = call("GET", f"/api/assets/{board['assetId']}/histories", token=S); check("asset history records the move", st == 200 and any("재물조사" in (x.get("content") or "") for x in data((st, j, None))), j)
st, j, _ = call("POST", f"/api/as/inventory/{sid}/close", token=S); check("inventory close", st == 200 and data((st, j, None))["status"] == "CLOSED", j)
st, j, _ = call("POST", f"/api/as/inventory/{sid}/scans", {"roomId": pcroom["roomId"], "assetNo": a1["assetNo"]}, token=S); check("inventory scan after close → 409", st == 409, j)
st, j, _ = call("GET", f"/api/as/inventory?schoolId={bh['schoolId']}", token=S2); check("inventory other school → 403", st == 403, j)

# ---------- 11. 자산 일괄 등록 ----------
st, tpl, h = call("GET", "/api/assets/bulk/template", token=S, raw=True)
check("bulk template xlsx", st == 200 and tpl[:2] == b"PK" and "filename*=UTF-8''" in h.get("Content-Disposition", ""), (st, h.get("Content-Disposition")))
st, j, _ = call("POST", "/api/assets/bulk/validate", files=[("file", ("양식.xlsx", tpl, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))], token=S); bv = data((st, j, None))
check("bulk validate template sample rows: 2 ok", st == 200 and bv["total"] == 2 and bv["ok"] == 2, j)
HEAD = ["기관명", "분류", "품명·규격", "취득일(YYYY-MM-DD)", "내용연수(년)", "위치", "상태"]
st, j, _ = call("POST", "/api/assets/bulk/validate", {"rows": [["기관", "분류"], ["x"]]}, token=S); check("bulk validate: header mismatch → 400", st == 400 and "양식" in msg((st, j, None)), j)
rows = [HEAD,
        ["봉황초등학교", "데스크톱", "교사용 PC(일괄1)", "2024-03-11", "5", "컴퓨터실", "사용"],
        ["봉황초등학교", "노트북", "교사용 노트북(일괄2)", "2023.05.02", "", "없는실", ""],
        ["온천중학교", "데스크톱", "다른 학교", "2024-01-01", "5", "", "사용"],
        ["봉황초등학교", "없는분류", "=SUM(A1)", "2030-01-01", "20", "", "폐기"]]
st, j, _ = call("POST", "/api/assets/bulk/validate", {"rows": rows}, token=S); bv = data((st, j, None))
r2, r3, r4 = bv["rows"][1], bv["rows"][2], bv["rows"][3]
check("bulk validate: ok rows 2, error rows 2", st == 200 and bv["ok"] == 2 and bv["error"] == 2, bv)
check("bulk validate: row2 ok with date normalised, default lifeYears 5, location warning", r2["ok"] and r2["asset"]["acquiredAt"] == "2023-05-02" and r2["asset"]["lifeYears"] == 5 and r2["warning"], r2)
check("bulk validate: other school rejected for school user", not r3["ok"] and "권한" in r3["errors"][0], r3)
check("bulk validate: category/formula/future date/life/status errors", not r4["ok"] and len(r4["errors"]) >= 5, r4)
st, j, _ = call("POST", "/api/assets/bulk/commit", {"rows": rows}, token=S); check("bulk commit with errors (no skip) → 400", st == 400, j)
st, j, _ = call("POST", "/api/assets/bulk/commit", {"rows": rows, "skipErrors": True}, token=S); bc = data((st, j, None))
check("bulk commit skipErrors: created 2, assetNo CB-2024-/CB-2023-", st == 200 and bc["created"] == 2 and bc["assets"][0]["assetNo"].startswith("CB-2024-") and bc["assets"][1]["assetNo"].startswith("CB-2023-"), j)
st, j, _ = call("GET", f"/api/assets/{bc['assets'][0]['assetId']}", token=S); ad = data((st, j, None))
check("bulk asset: placed in 컴퓨터실 with floor/building", st == 200 and ad["roomId"] == pcroom["roomId"] and ad["floorId"] == fl2["floorId"], j)
st, j, _ = call("GET", "/api/assets/bulk/template", token=N, raw=True); check("bulk: engineer forbidden", st == 403, st)
st, j, _ = call("POST", "/api/assets/bulk/validate", {"rows": [HEAD] + [["봉황초등학교", "데스크톱", f"PC {i}", "2024-01-01", "5", "", "사용"] for i in range(2001)]}, token=S)
check("bulk: > 2000 rows → 400", st == 400, j)

# ---------- 12. 파일 첨부 ----------
st, j, _ = call("POST", "/api/files", files=[("files", ("증상.txt", "화면 사진 대신 텍스트".encode(), "text/plain"))], token=S); up = data((st, j, None))
check("file upload", st == 200 and len(up) == 1 and up[0]["url"].startswith("/files/"), j)
st, b, h = call("GET", up[0]["url"], raw=True)
check("file download: attachment + nosniff + original name", st == 200 and b.decode() == "화면 사진 대신 텍스트" and "attachment" in h.get("Content-Disposition", "") and h.get("X-Content-Type-Options") == "nosniff", (st, h))
st, j, _ = call("POST", "/api/files", files=[("files", ("evil.exe", b"MZ", "application/octet-stream"))], token=S); check("file upload: exe blocked", st == 400, j)
st, j, _ = call("POST", "/api/files", files=[("files", ("x.txt", b"x", "text/plain"))]); check("file upload needs auth", st == 401, j)
st, j, _ = call("POST", "/api/as/boards/QNA", {"title": "첨부 질문", "content": "첨부 참조", "categoryCode": "질문", "fieldCode": "DEVICE", "attachFileIds": [up[0]["fileId"]]}, token=S); ap = data((st, j, None))
check("post with attachment", st == 200 and len(ap["attachments"]) == 1 and ap["attachments"][0]["name"] == "증상.txt", j)
st, j, _ = call("POST", f"/api/as/requests/{sn}/report", {"processContent": "보고서 수정 + 첨부", "fileIds": [up[0]["fileId"]]}, token=N); rr = data((st, j, None))
check("report update with attachment", st == 200 and len(rr.get("reportFiles", [])) == 1, j)

# ---------- 13. 기존 BingoASM 기능 회귀 ----------
st, j, _ = call("GET", "/api/assets/summary", token=A); check("legacy: asset summary (admin)", st == 200, j)
st, j, _ = call("GET", "/api/services", token=A); check("legacy: service requests list", st == 200 and data((st, j, None))["totalElements"] >= 6, j)
st, j, _ = call("GET", "/api/places/buildings", token=A); check("legacy: places buildings", st == 200 and len(data((st, j, None))) >= 3, j)
st, j, _ = call("GET", "/api/as/requests?rceptTy=M", token=A); check("sys admin sees AS requests", st == 200 and data((st, j, None))["totalElements"] >= 5, j)

# ---------- 14. 교육지원청 담당자 (REGION_ADMIN, 청주교육지원청) ----------
R = login("regionadmin", "user1234!")
st, j, _ = call("GET", "/api/auth/me", token=R); rme = data((st, j, None))
check("region admin: me has regionName 청주교육지원청", st == 200 and rme["regionName"] == "청주교육지원청" and "AS_MANAGE" in rme["permissions"] and "VENDOR_MANAGE" not in rme["permissions"], j)
st, j, _ = call("GET", "/api/as/schools", token=R); rs = data((st, j, None))
check("region admin: sees only 청주 schools (4)", st == 200 and len(rs) == 4 and all(x["regionName"] == "청주교육지원청" for x in rs), j)
st, j, _ = call("GET", "/api/as/regions", token=R); check("region admin: regions = own only", st == 200 and [x["regionName"] for x in data((st, j, None))] == ["청주교육지원청"], j)
st, j, _ = call("GET", "/api/as/requests?size=200", token=R); rl = data((st, j, None))
check("region admin: AS list only 청주 schools", st == 200 and rl["totalElements"] >= 1 and all(x["regionName"] == "청주교육지원청" for x in rl["content"]), j)
st, j, _ = call("GET", "/api/as/requests?size=200", token=E); other = [x for x in data((st, j, None))["content"] if x["schoolName"] == "온천중학교"]
st, j, _ = call("GET", f"/api/as/requests/{other[0]['asvcSn']}", token=R); check("region admin: other district request → 404", st == 404, j)
st, j, _ = call("GET", f"/api/as/schools/{oc['schoolId']}", token=R); check("region admin: other district school → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/schools/{bh['schoolId']}", {"regionId": oc["regionId"]}, token=R); check("region admin: cannot move school to another district", st == 403, j)
st, j, _ = call("POST", "/api/as/regions", {"regionName": "가짜교육지원청"}, token=R); check("region admin: region CRUD → 403", st == 403, j)
st, j, _ = call("GET", f"/api/assets?schoolId={oc['schoolId']}&size=1", token=R); check("region admin: other district assets → 0", st == 200 and data((st, j, None))["totalElements"] == 0, j)
st, j, _ = call("GET", "/api/assets?size=500", token=R); ra = data((st, j, None))
check("region admin: assets only in district", st == 200 and ra["totalElements"] >= 1 and all(x["schoolId"] in {y["schoolId"] for y in rs} for x in ra["content"]), j)
st, j, _ = call("GET", f"/api/as/wireless-devices?size=200", token=R); check("region admin: devices only in district", st == 200 and all(x["regionName"] == "청주교육지원청" for x in data((st, j, None))["content"]), j)
st, j, _ = call("GET", "/api/as/stats/monthly", token=R); ms = data((st, j, None))
check("region admin: stats count only district", st == 200 and 0 < ms["total"]["count"] <= rl["totalElements"], j)
st, j, _ = call("GET", "/api/as/vendors", token=R); check("region admin: can read vendors (for school mapping)", st == 200, j)
st, j, _ = call("POST", "/api/as/vendors", {"vendorName": "x", "serviceTypes": "C"}, token=R); check("region admin: vendor create → 403", st == 403, j)
own = rl["content"][0]
st, j, _ = call("GET", f"/api/as/requests/{own['asvcSn']}", token=R); acts = data((st, j, None))["allowedActions"] if st == 200 else []
check("region admin: may assign/cancel, not delete", st == 200 and "delete" not in acts and ("assign" in acts or own["status"] == "C"), j)
st, j, _ = call("GET", "/api/assets?size=1", token=S2); sa = data((st, j, None))
st2, j2, _ = call("GET", f"/api/assets/{ad['assetId']}", token=S2); check("school user: other school's asset by id → 403/404", st2 in (403, 404), j2)

# ---------- 15. 지역 ↔ 기관 일관성 ----------
print("\n== 15. 지역 ↔ 기관 일관성")
st, j, _ = call("POST", "/api/as/schools", {"schoolName": "지역없는학교", "schoolType": "ELEM"}, token=A); check("school without region → 400", st == 400, j)
st, j, _ = call("PUT", f"/api/as/schools/{bh['schoolId']}", {"regionId": None}, token=A); check("school region cleared → 400", st == 400, j)
st, j, _ = call("POST", "/api/as/boards/DISPOSAL", {"title": "지역 바꿔 올리기", "content": "x", "regionId": oc["regionId"]}, token=S); xp = data((st, j, None))
check("school post ignores other regionId (stays 청주)", st == 200 and xp["regionId"] == bh["regionId"] and xp["regionName"] == "청주교육지원청", j)
if st == 200: call("DELETE", f"/api/as/boards/DISPOSAL/{xp['postId']}", token=S)
st, j, _ = call("POST", "/api/as/boards/VENDOR", {"title": "지역 지정 글", "content": "x", "regionId": oc["regionId"]}, token=N); vp = data((st, j, None))
check("non-school post keeps chosen region", st == 200 and vp["regionId"] == oc["regionId"], j)
if st == 200: call("DELETE", f"/api/as/boards/VENDOR/{vp['postId']}", token=N)
st, j, _ = call("POST", "/api/as/boards/VENDOR", {"title": "x", "content": "x", "regionId": 999999}, token=N); check("unknown region on post → 400", st == 400, j)
st, j, _ = call("GET", "/api/auth/me", token=S); check("me: school user region derived from school", st == 200 and data((st, j, None))["regionName"] == "청주교육지원청", j)
st, j, _ = call("POST", "/api/users", {"loginId": "affil01", "userName": "소속테스트", "password": "Affil!2026xy", "schoolId": bh["schoolId"], "regionId": oc["regionId"]}, token=A); au = data((st, j, None))
check("user with school: stored regionId cleared", st == 200 and au["schoolId"] == bh["schoolId"] and au.get("regionId") is None, j)
st, j, _ = call("PUT", f"/api/users/{au['userId']}/roles", {"roles": ["REGION_ADMIN"]}, token=A); check("REGION_ADMIN on a school account → 400", st == 400, j)
st, j, _ = call("PUT", f"/api/users/{au['userId']}", {"schoolId": None}, token=A)
st, j, _ = call("PUT", f"/api/users/{au['userId']}/roles", {"roles": ["REGION_ADMIN"]}, token=A); check("REGION_ADMIN without region → 400", st == 400, j)
st, j, _ = call("PUT", f"/api/users/{au['userId']}", {"regionId": oc["regionId"]}, token=A)
st, j, _ = call("PUT", f"/api/users/{au['userId']}/roles", {"roles": ["REGION_ADMIN"]}, token=A); check("REGION_ADMIN with region → ok", st == 200, j)
st, j, _ = call("PUT", f"/api/users/{au['userId']}", {"schoolId": bh["schoolId"]}, token=A); check("region admin cannot be linked to a school → 400", st == 400, j)
st, j, _ = call("PUT", f"/api/users/{au['userId']}", {"regionId": 999999}, token=A); check("unknown region on user → 400", st == 400, j)


# ---------- 16. 역할 × 범위 매트릭스 ----------
print("\n== 16. 역할 × 범위 매트릭스")
def all_rows(path, token):
    st, j, _ = call("GET", path, token=token)
    return st, (data((st, j, None)) or {}).get("content", []) if st == 200 else []

st, rows = all_rows("/api/as/requests?size=500", S)
check("matrix school01: AS only own school", st == 200 and rows and all(x["schoolName"] == "봉황초등학교" for x in rows), st)
st, rows = all_rows("/api/as/requests?size=500", S2)
check("matrix school02: AS only own school", st == 200 and all(x["schoolName"] == "온천중학교" for x in rows), st)
st, rows = all_rows("/api/assets?size=500", S)
check("matrix school01: assets only own school", st == 200 and rows and all(x.get("schoolId") == bh["schoolId"] for x in rows), st)
st, rows = all_rows("/api/as/wireless-devices?size=500", S)
check("matrix school01: devices only own school", st in (200, 403) and all(x.get("schoolName") == "봉황초등학교" for x in rows), st)
st, j, _ = call("GET", "/api/as/schools", token=S); sl = data((st, j, None)) if st == 200 else []
check("matrix school01: school list only own school (or no access)", st == 403 or (st == 200 and all(x["schoolId"] == bh["schoolId"] for x in sl)), st)
st, rows = all_rows("/api/as/requests?size=500", N)
check("matrix netengineer: AS only own vendor", st == 200 and rows and all(x.get("vendorName") == "한빛네트웍스" for x in rows), st)
st, j, _ = call("GET", "/api/assets?size=1", token=N); check("matrix netengineer: assets → 403", st == 403, j)
VA = login("vendoradmin", "user1234!")
st, rows = all_rows("/api/as/requests?size=500", VA)
check("matrix vendoradmin: AS only own vendor", st == 200 and rows and all(x.get("vendorName") == "한빛네트웍스" for x in rows), st)
st, j, _ = call("GET", "/api/as/stats/monthly", token=VA); vs = data((st, j, None)) if st == 200 else None
check("matrix vendoradmin: stats only own vendor", st == 200 and 0 < vs["total"]["count"] <= len(rows), j)
st, rows = all_rows("/api/as/requests?size=500", E)
check("matrix eduadmin: AS across districts", st == 200 and len({x.get("regionName") for x in rows}) >= 2, st)
st, j, _ = call("GET", "/api/assets?size=1", token=A); total_assets = data((st, j, None))["totalElements"] if st == 200 else -1
U1 = login("user01", "user1234!")
st, j, _ = call("GET", "/api/assets?size=1", token=U1)
check("matrix legacy user01: assets org-wide (legacy module)", st == 200 and data((st, j, None))["totalElements"] == total_assets, j)
st, rows = all_rows("/api/as/requests?size=500", U1)
check("matrix legacy user01: AS only own requests", st in (200, 403) and all(x.get("applicantName") == "최요청" for x in rows), st)

# 역할 ↔ 소속 규칙
def mk(login_id, body):
    b = {"loginId": login_id, "userName": "매트릭스", "password": "Matrix!2026xy", **body}
    return call("POST", "/api/users", b, token=A)
st, j, _ = mk("mx01", {"roles": ["AS_ENGINEER"]}); check("rule: engineer without vendor → 400", st == 400, j)
st, j, _ = mk("mx02", {"roles": ["SCHOOL_USER"]}); check("rule: school user without school → 400", st == 400, j)
st, j, _ = mk("mx03", {"roles": ["SCHOOL_USER", "AS_ENGINEER"], "schoolId": bh["schoolId"]}); check("rule: school + vendor roles → 400", st == 400, j)
st, j, _ = mk("mx04", {"roles": ["SCHOOL_USER", "REQUESTER"], "schoolId": bh["schoolId"]}); check("rule: AS role + legacy role → 400", st == 400, j)
st, j, _ = mk("mx05", {"schoolId": bh["schoolId"], "vendorId": 1}); check("rule: school and vendor together → 400", st == 400, j)
st, j, _ = mk("mx06", {"roles": ["SCHOOL_USER"], "schoolId": oc["schoolId"]}); mx = data((st, j, None))
check("rule: school user created with roles in one call", st == 200 and mx["roles"] == ["SCHOOL_USER"], j)
MX = login("mx06", "Matrix!2026xy")
st, rows = all_rows("/api/as/requests?size=500", MX)
check("matrix new school user: AS only own school", st == 200 and all(x["schoolName"] == "온천중학교" for x in rows), st)
st, j, _ = call("PUT", f"/api/users/{mx['userId']}/roles", {"roles": ["SCHOOL_USER", "REQUESTER"]}, token=A); check("rule: adding legacy role later → 400", st == 400, j)


# ---------- 17. AS 비용 항목 · 유상/무상 ----------
print("\n== 17. AS 비용 항목 · 유상/무상")
st, j, _ = call("GET", "/api/as/requests/codes", token=N); cd = data((st, j, None))
check("codes: costTypes + chargeTypes", st == 200 and list(cd["costTypes"]) == ["PART", "LABOR", "TRAVEL", "ETC"] and set(cd["chargeTypes"]) == {"FREE", "PAID"}, j)
rep = lambda body: call("POST", f"/api/as/requests/{sn}/report", {"processContent": "비용 항목 테스트", **body}, token=N)
st, j, _ = rep({"chargeType": "PAID", "costItems": [{"costType": "PART", "itemName": "SSD 512GB", "quantity": 2, "unitPrice": 15000},
                                                   {"costType": "LABOR", "itemName": "", "quantity": 1, "unitPrice": 30000}]})
st, j, _ = call("GET", f"/api/as/requests/{sn}", token=N); rp = (data((st, j, None)) or {}).get("report", {})
check("report: amount = sum of lines (2×15,000 + 30,000)", st == 200 and rp.get("processAmount") == 60000 and len(rp.get("costItems", [])) == 2, rp)
check("report: line amount, default name, PAID", rp.get("costItems", [{}])[0].get("amount") == 30000 and rp["costItems"][1]["itemName"] == "공임" and rp.get("chargeType") == "PAID" and rp.get("chargeTypeName") == "유상(별도 청구)", rp)
for name, body in [("unknown cost type", {"costItems": [{"costType": "X", "unitPrice": 1}]}),
                   ("negative unit price", {"costItems": [{"costType": "PART", "unitPrice": -1}]}),
                   ("quantity 0", {"costItems": [{"costType": "PART", "quantity": 0, "unitPrice": 1000}]}),
                   ("21 lines", {"costItems": [{"costType": "ETC", "unitPrice": 1}] * 21}),
                   ("unknown charge type", {"chargeType": "MAYBE"})]:
    st, j, _ = rep(body); check(f"report rejects {name} → 400", st == 400, j)
st, j, _ = call("GET", f"/api/as/requests/{sn}", token=N); check("rejected edits left lines unchanged", data((st, j, None))["report"]["processAmount"] == 60000, j)
st, j, _ = call("GET", "/api/as/stats/monthly", token=E); ms = data((st, j, None)); tot = ms["total"]
part = next((x for x in ms["byCostType"] if x["costType"] == "PART"), {})
check("stats: cost = 유상 + 무상", st == 200 and tot["cost"] == tot["paidCost"] + tot["freeCost"] and tot["paidCount"] >= 1 and tot["freeCount"] >= 1, tot)
check("stats: byCostType includes the new 부품 line (paid)", part.get("amount", 0) >= 30000 and part.get("paidAmount", 0) >= 30000, ms["byCostType"])
check("stats: months/byVendor carry paidCost", all("paidCost" in x for x in ms["months"]) and all("paidCost" in x for x in ms["byVendor"]), j)
st, j, _ = rep({"costItems": []}); st, j, _ = call("GET", f"/api/as/requests/{sn}", token=N); rp = data((st, j, None))["report"]
check("empty lines clear the cost", rp["processAmount"] == 0 and rp.get("costItems") == [], rp)
st, j, _ = rep({"processAmount": 5000}); st, j, _ = call("GET", f"/api/as/requests/{sn}", token=N)
check("single amount without lines still accepted", data((st, j, None))["report"]["processAmount"] == 5000, j)

# ---------- 사용자 메뉴 권한 (보이기·숨기기) ----------
print("\n== 사용자 메뉴 권한")
st, j, _ = call("GET", "/api/users?keyword=school02", token=A)
s2id = next(u["userId"] for u in data((st, j, None))["content"] if u["loginId"] == "school02")
st, j, _ = call("GET", f"/api/users/{s2id}/menu-perms", token=S); check("menu-perms: school user → 403", st == 403, j)
st, j, _ = call("GET", f"/api/users/{s2id}/menu-perms", token=A); mp = data((st, j, None))
check("menu-perms: base has BOARD_QNA, no overrides", st == 200 and "BOARD_QNA" in mp["base"] and not mp["granted"] and not mp["denied"], j)
st, j, _ = call("PUT", f"/api/users/{s2id}/menu-perms", {"granted": ["USER_WRITE"]}, token=A); check("menu-perms: non-menu perm → 400", st == 400, j)
st, j, _ = call("PUT", f"/api/users/{s2id}/menu-perms", {"granted": ["AS_STATS", "BOARD_QNA"], "denied": ["BOARD_QNA", "VENDOR_MANAGE"]}, token=A)
check("menu-perms: same perm shown and hidden → 400", st == 400, j)
st, j, _ = call("PUT", f"/api/users/{s2id}/menu-perms", {"granted": ["AS_STATS", "BOARD_NOTICE"], "denied": ["BOARD_QNA", "VENDOR_MANAGE"]}, token=A); mp = data((st, j, None))
check("menu-perms: no-op overrides dropped", st == 200 and mp["granted"] == ["AS_STATS"] and mp["denied"] == ["BOARD_QNA"], j)
st, j, _ = call("GET", "/api/auth/me", token=S2); p2 = data((st, j, None))["permissions"]
check("menu-perms: /me reflects show/hide", "AS_STATS" in p2 and "BOARD_QNA" not in p2, p2)
st, j, _ = call("GET", "/api/as/boards/QNA", token=S2); check("menu-perms: hidden menu's API → 403", st == 403, j)
st, j, _ = call("GET", "/api/as/stats/monthly", token=S2); check("menu-perms: shown menu's API → 200", st == 200, j)
st, j, _ = call("PUT", f"/api/users/{s2id}/menu-perms", {"granted": [], "denied": []}, token=A)
st2, j2, _ = call("GET", "/api/as/boards/QNA", token=S2); check("menu-perms: reset restores role default", st == 200 and st2 == 200, (j, j2))

# AS 처리 기능 (접수·반려·이관·신청 취소·삭제) 사용자별 끄기
def uid(login):
    st, j, _ = call("GET", f"/api/users?keyword={login}", token=A)
    return next(u["userId"] for u in data((st, j, None))["content"] if u["loginId"] == login)
s1id, nid = uid("school01"), uid("netengineer")
st, j, _ = call("POST", "/api/as/requests", {"rceptTy": "S", "faultTypeCode": "72", "symptom": "처리 기능 권한(테스트)", "installPlace": "본관", "visitRequestAt": "2026-10-30T10:00"}, token=S)
sn5 = data((st, j, None))["asvcSn"]
st, j, _ = call("PUT", f"/api/users/{nid}/menu-perms", {"denied": ["AS_RECEIVE", "AS_TRANSFER"]}, token=A)
check("action-perms: engineer receive/transfer turned off", st == 200 and set(data((st, j, None))["denied"]) == {"AS_RECEIVE", "AS_TRANSFER"}, j)
st, j, _ = call("GET", f"/api/as/requests/{sn5}", token=N); acts = data((st, j, None))["allowedActions"]
check("action-perms: buttons hidden (return kept)", "receive" not in acts and "transfer" not in acts and "return" in acts, acts)
st, j, _ = call("POST", f"/api/as/requests/{sn5}/receive", {"visitPlannedAt": "2026-10-30T10:00"}, token=N); check("action-perms: receive blocked → 409", st == 409, j)
st, j, _ = call("PUT", f"/api/users/{s1id}/menu-perms", {"denied": ["AS_CANCEL"]}, token=A)
st, j, _ = call("POST", f"/api/as/requests/{sn5}/cancel", {}, token=S); check("action-perms: cancel blocked → 409", st == 409, j)
st, j, _ = call("PUT", f"/api/users/{s1id}/menu-perms", {"granted": ["AS_DELETE"]}, token=A)
st, j, _ = call("GET", f"/api/as/requests/{sn5}", token=S); check("action-perms: granting beyond role does not widen scope", "delete" not in data((st, j, None))["allowedActions"], j)
call("PUT", f"/api/users/{s1id}/menu-perms", {}, token=A); call("PUT", f"/api/users/{nid}/menu-perms", {}, token=A)
st, j, _ = call("POST", f"/api/as/requests/{sn5}/cancel", {}, token=S); check("action-perms: reset → cancel works again", st == 200, j)

# ---------- 교육청별 AS 서비스 ----------
print("\n== 교육청별 AS 서비스")
st, j, _ = call("PUT", "/api/org/as-services", {"asTypes": ["M", "S"]}, token=A); check("as-services: 무선망·스쿨넷 only", st == 200, j)
st, j, _ = call("GET", "/api/site"); site = data((st, j, None))
check("site: public, services M·S", st == 200 and site["asTypes"] == ["M", "S"], j)
check("site: unused services' menus listed off", {"AS_C_REQUEST", "BOARD_DISPOSAL", "SMART_REQUEST"} <= set(site["disabledPerms"]) and "AS_M_REQUEST" not in site["disabledPerms"], site)
st, j, _ = call("GET", "/api/auth/me", token=A); me_a = data((st, j, None))
check("me: asTypes + unused menus removed even for SYS_ADMIN", me_a["asTypes"] == ["M", "S"] and "AS_C_REQUEST" not in me_a["permissions"] and "AS_S_REQUEST" in me_a["permissions"], me_a)
st, j, _ = call("GET", "/api/org/as-services", token=E); check("as-services: EDU_ADMIN cannot read → 403", st == 403, j)
st, j, _ = call("PUT", "/api/org/as-services", {"asTypes": ["M"]}, token=E); check("as-services: EDU_ADMIN cannot change → 403", st == 403, j)
st, j, _ = call("PUT", "/api/org/as-services", {"asTypes": []}, token=A); check("as-services: none selected → 400", st == 400, j)
st, j, _ = call("PUT", "/api/org/as-services", {"asTypes": ["M", "X"]}, token=A); check("as-services: unknown type → 400", st == 400, j)
st, j, _ = call("POST", "/api/as/requests", {"rceptTy": "C", "faultTypeCode": "11", "symptom": "x", "installPlace": "본관", "visitRequestAt": "2026-10-30T10:00"}, token=A)
check("as-services: request for unused service → 400", st == 400, j)
st, j, _ = call("PUT", "/api/org/as-services", {"asTypes": ["S", "M"]}, token=A)
check("as-services: order normalised", st == 200 and data((st, j, None))["asTypes"] == ["M", "S"], j)
st, j, _ = call("PUT", "/api/org/as-services", {"asTypes": ["M"]}, token=A)
check("as-services: 스쿨넷 off", st == 200 and data((st, j, None))["asTypes"] == ["M"], j)
st, j, _ = call("PUT", f"/api/users/{s1id}/menu-perms", {"granted": ["BOARD_SLA"]}, token=A)
st, j, _ = call("GET", "/api/auth/me", token=S); p1 = data((st, j, None))["permissions"]
check("as-services: 스쿨넷 menus gone, per-user grant can't reopen", "AS_S_REQUEST" not in p1 and "BOARD_SLA" not in p1 and "AS_M_REQUEST" in p1, p1)
st, j, _ = call("GET", f"/api/users/{s1id}/menu-perms", token=A); check("menu-perms: lists disabled menus", "AS_S_REQUEST" in data((st, j, None))["disabled"], j)
st, j, _ = call("POST", "/api/as/requests", {"rceptTy": "S", "faultTypeCode": "72", "symptom": "꺼진 서비스(테스트)", "installPlace": "본관", "visitRequestAt": "2026-10-30T10:00"}, token=S)
check("as-services: 스쿨넷 request blocked", st in (400, 403), j)
st, j, _ = call("GET", "/api/site"); check("site: reflects the change", data((st, j, None))["asTypes"] == ["M"], j)
call("PUT", f"/api/users/{s1id}/menu-perms", {}, token=A)
st, j, _ = call("PUT", "/api/org/as-services", {"asTypes": ["M", "S"]}, token=A)
st2, j2, _ = call("GET", "/api/auth/me", token=S); check("as-services: turning 스쿨넷 back on restores menus", st == 200 and "AS_S_REQUEST" in data((st2, j2, None))["permissions"], j2)

# ---------- 통합관리 메뉴를 학교·기사·교육지원청에 줘도 범위가 넓어지지 않는다 ----------
print("\n== 통합관리 메뉴 범위")
MGMT = ["AS_MANAGE", "AS_STATS", "WDEVICE_MANAGE", "SPACE_MANAGE", "ASSET_READ", "FLOOR_READ", "INVENTORY", "SCHOOL_MANAGE", "VENDOR_MANAGE"]
s2id_, nid_, rid_ = uid("school02"), uid("netengineer"), uid("regionadmin")
st, j, _ = call("GET", "/api/as/schools", token=A); all_sc = data((st, j, None))
st, j, _ = call("GET", "/api/as/vendors", token=A); hanbit = next(v for v in data((st, j, None)) if v["vendorName"] == "한빛네트웍스")
assigned = {x["schoolId"] for x in all_sc if any(v.get("vendorId") == hanbit["vendorId"] for v in x.get("vendors") or [])}
# 데모 학교는 모두 한빛 담당이라, 담당 업체가 없는 학교를 하나 만든다.
other = next((x for x in all_sc if x["schoolId"] not in assigned), None)
if other is None:
    st, j, _ = call("POST", "/api/as/schools", {"schoolName": "범위검사학교", "regionId": all_sc[0]["regionId"]}, token=A)
    other = data((st, j, None)); check("scope: unassigned school created", st == 200, j)
own2 = next(x for x in all_sc if x["schoolName"] == "온천중학교")
for u in (s2id_, nid_):
    st, j, _ = call("PUT", f"/api/users/{u}/menu-perms", {"granted": MGMT}, token=A)
    check(f"scope: 통합관리 menus granted (user {u})", st == 200, j)
st, j, _ = call("PUT", f"/api/users/{rid_}/menu-perms", {"granted": ["VENDOR_MANAGE"]}, token=A); check("scope: 업체관리 granted to regionadmin", st == 200, j)

# 학교: 자기 학교 기본정보만
st, j, _ = call("POST", "/api/as/schools", {"schoolName": "가짜학교", "regionId": own2["regionId"]}, token=S2); check("school+SCHOOL_MANAGE: register school → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/schools/{own2['schoolId']}", {"contractStatus": "CONTRACTED" if own2["contractStatus"] != "CONTRACTED" else "NONE"}, token=S2)
check("school+SCHOOL_MANAGE: change own contract → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/schools/{own2['schoolId']}", {"classCount": own2.get("classCount"), "contractStatus": own2["contractStatus"], "regionId": own2["regionId"]}, token=S2)
check("school+SCHOOL_MANAGE: own basic info (contract unchanged) → 200", st == 200, j)
st, j, _ = call("PUT", f"/api/as/schools/{other['schoolId']}", {"classCount": 1}, token=S2); check("school+SCHOOL_MANAGE: other school → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/schools/{own2['schoolId']}/vendors", [], token=S2); check("school+SCHOOL_MANAGE: set own 담당업체 → 403", st == 403, j)
st, j, _ = call("DELETE", f"/api/as/schools/{own2['schoolId']}", token=S2); check("school+SCHOOL_MANAGE: delete own school → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/vendors/{hanbit['vendorId']}", {"vendorName": "탈취"}, token=S2); check("school+VENDOR_MANAGE: edit vendor → 403", st == 403, j)
st, j, _ = call("GET", "/api/as/vendors", token=S2); check("school+VENDOR_MANAGE: vendor list readable", st == 200, j)

# 기사: 배정된 학교만, 학교·업체 변경 불가
st, j, _ = call("GET", "/api/as/schools", token=N); nsc = {x["schoolId"] for x in data((st, j, None))} if st == 200 else None
check("engineer+SCHOOL_MANAGE: school list = assigned schools only", st == 200 and nsc == assigned and assigned, (nsc, assigned))
st, j, _ = call("GET", f"/api/as/schools/{other['schoolId']}", token=N); check("engineer: unassigned school → 403", st == 403, j)
st, rows = all_rows("/api/assets?size=500", N)
check("engineer+ASSET_READ: assets of assigned schools only", st == 200 and all(x.get("schoolId") in assigned for x in rows), st)
st, j, _ = call("GET", f"/api/assets?size=500&schoolId={other['schoolId']}", token=N)
check("engineer+ASSET_READ: other school's assets empty", st in (200, 403) and (st == 403 or not data((st, j, None))["content"]), j)
st, rows = all_rows("/api/as/wireless-devices?size=500", N)
check("engineer+WDEVICE_MANAGE: devices of assigned schools only", st == 200 and all(x.get("schoolId") in assigned for x in rows), st)
st, j, _ = call("POST", "/api/as/wireless-devices", {"schoolId": other["schoolId"], "deviceName": "남의 학교 AP", "deviceType": "AP"}, token=N)
check("engineer+WDEVICE_MANAGE: add device at unassigned school → 403", st == 403, j)
st, j, _ = call("GET", f"/api/as/spaces/buildings?schoolId={other['schoolId']}", token=N); check("engineer+SPACE_MANAGE: unassigned school's buildings → 403", st == 403, j)
a_sid = next(iter(assigned))
st, j, _ = call("PUT", f"/api/as/schools/{a_sid}", {"classCount": 1}, token=N); check("engineer+SCHOOL_MANAGE: edit assigned school → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/schools/{other['schoolId']}/vendors", [{"rceptTy": "M", "vendorId": hanbit["vendorId"]}], token=N)
check("engineer+SCHOOL_MANAGE: assign own company to a school → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/vendors/{hanbit['vendorId']}", {"serviceTypes": ["C", "M", "S", "T"]}, token=N)
check("engineer+VENDOR_MANAGE: widen own company's service types → 403", st == 403, j)
st, rows = all_rows("/api/as/requests?size=500", N)
check("engineer: AS list still = own company's requests", st == 200 and rows and all(x.get("vendorName") == "한빛네트웍스" for x in rows), st)
st, j, _ = call("GET", f"/api/users/{nid_}/menu-perms", token=A); lim = data((st, j, None)).get("limits", {})
check("menu-perms: engineer's limited menus explained", "SCHOOL_MANAGE" in lim and "ASSET_READ" in lim, lim)

# 교육지원청: 업체는 조회만
st, j, _ = call("PUT", f"/api/as/vendors/{hanbit['vendorId']}", {"vendorName": "탈취"}, token=R); check("region+VENDOR_MANAGE: edit vendor → 403", st == 403, j)
st, j, _ = call("POST", "/api/as/vendors", {"vendorName": "지원청업체", "serviceTypes": ["M"]}, token=R); check("region+VENDOR_MANAGE: register vendor → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/vendors/{hanbit['vendorId']}", {"tel": hanbit.get("tel")}, token=A); check("eduadmin/admin: edit vendor still works", st == 200, j)

for u in (s2id_, nid_, rid_):
    call("PUT", f"/api/users/{u}/menu-perms", {}, token=A)

# ---------- 문의처: 우리 학교 담당업체 · 구역별 편집 · 예시 데이터 표시 ----------
print("\n== 문의처 안내")
st, j, _ = call("GET", "/api/site"); check("site: contacts marked as sample data", data((st, j, None)).get("contactsSample") is True, j)
st, j, _ = call("GET", "/api/as/contacts/providers", token=S); pv = data((st, j, None))
check("providers: school user gets own school, one row per service in use", st == 200 and pv["schoolName"] == "봉황초등학교" and [x["rceptTy"] for x in pv["items"]] == ["M", "S"], j)
check("providers: 무선망 vendor + engineer phone", pv["items"][0].get("vendorName") == "한빛네트웍스" and pv["items"][0].get("engineerTel"), pv)
st, j, _ = call("GET", f"/api/as/contacts/providers?schoolId={own2['schoolId']}", token=S)
check("providers: school user can't look up another school (own school returned)", st == 200 and data((st, j, None))["schoolName"] == "봉황초등학교", j)
st, j, _ = call("GET", "/api/as/contacts/providers", token=E); check("providers: admin without schoolId → 400", st == 400, j)
st, j, _ = call("GET", f"/api/as/contacts/providers?schoolId={own2['schoolId']}", token=E); check("providers: admin picks a school", st == 200 and data((st, j, None))["schoolName"] == "온천중학교", j)
st, j, _ = call("GET", f"/api/as/contacts/providers?schoolId={other['schoolId']}", token=E)
check("providers: school without 담당업체 → rows without vendor", st == 200 and all(not x.get("vendorName") for x in data((st, j, None))["items"]), j)

st, j, _ = call("GET", "/api/as/contacts", token=R); before = data((st, j, None))
mine = next(g for g in before if g["regionName"] == "청주교육지원청"); theirs = next(g for g in before if g["regionName"] == "충주교육지원청")
rows = [{"groupName": "청주교육지원청 정보지원팀", "itemName": "정보지원팀장", "tel": "000-0000-0000", "duties": ["원클릭 AS 총괄", "무선망"]},
        {"groupName": "유지보수 사업자", "itemName": "테스트네트웍스", "tel": "000-1111-2222"}]
st, j, _ = call("PUT", f"/api/as/contacts/sections/{mine['regionId']}", rows, token=R); after = data((st, j, None))
cj = next(g for g in after if g["regionName"] == "청주교육지원청") if st == 200 else {}
check("contacts: region admin replaces own district", st == 200 and [x["groupName"] for x in cj["groups"]] == ["청주교육지원청 정보지원팀", "유지보수 사업자"]
      and cj["groups"][0]["items"][0]["duties"] == ["원클릭 AS 총괄", "무선망"], j)
check("contacts: other sections untouched", st == 200 and next(g for g in after if g["regionName"] == "충주교육지원청") == theirs and after[0] == before[0], j)
st, j, _ = call("PUT", f"/api/as/contacts/sections/{theirs['regionId']}", rows, token=R); check("contacts: region admin other district → 403", st == 403, j)
st, j, _ = call("PUT", "/api/as/contacts/sections/province", rows, token=R); check("contacts: region admin 도교육청 section → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/contacts/sections/{mine['regionId']}", rows, token=S); check("contacts: school user → 403", st == 403, j)
st, j, _ = call("PUT", "/api/as/contacts/sections/999999", rows, token=E); check("contacts: unknown district → 404", st == 404, j)
st, j, _ = call("PUT", "/api/as/contacts/sections/abc", rows, token=E); check("contacts: bad section → 400", st == 400, j)
def back(g):
    return [{"groupName": gr["groupName"], "itemName": it["itemName"], "tel": it.get("tel"), "note": it.get("note"), "duties": it.get("duties") or []} for gr in g["groups"] for it in gr["items"]]
st, j, _ = call("PUT", f"/api/as/contacts/sections/{mine['regionId']}", back(mine), token=E)
check("contacts: 도교육청 admin can edit any district (restored)", st == 200 and back(next(g for g in data((st, j, None)) if g["regionName"] == "청주교육지원청")) == back(mine), j)

fails = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
if fails:
    print("FAILED:", *fails, sep="\n  ")
sys.exit(1 if fails else 0)
