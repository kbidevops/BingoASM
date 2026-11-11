#!/usr/bin/env python3
"""원클릭 AS 백엔드 통합 테스트. 서버(:8090, 새 H2)에 대해 로그인/OTP/QR, AS 워크플로, 게시판, 공간, 재물조사, 일괄등록, QR, 파일, 권한표를 검사한다."""
import base64, hashlib, hmac, io, json, struct, sys, time, urllib.request, urllib.error, urllib.parse, uuid

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


# ---------- 인증 앱(Google OTP) 흉내: TOTP RFC 6238, SHA1 · 30초 · 6자리 ----------
TOTP_SECRET, TOTP_LAST = {}, {}


def totp(secret, step):
    raw = secret.replace(" ", "")
    key = base64.b32decode(raw + "=" * (-len(raw) % 8))
    h = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    o = h[-1] & 15
    return "%06d" % ((struct.unpack(">I", h[o:o + 4])[0] & 0x7fffffff) % 1000000)


def app_code(uid):
    """휴대폰 앱이 지금 보여 줄 번호. 서버는 한 번 쓴 시간 칸을 다시 받지 않으므로, 같은 칸을 이미 썼으면 다음 칸(+30초, 서버가 ±1칸 허용)을 쓴다."""
    now = int(time.time()) // 30
    step = max(now, TOTP_LAST.get(uid, -1) + 1)
    while step > now + 1:  # 너무 앞서 가면 기다린다
        time.sleep(5)
        now = int(time.time()) // 30
    TOTP_LAST[uid] = step
    return totp(TOTP_SECRET[uid], step)


def login(uid, pw):
    for _ in range(4):  # 분당 로그인 제한(20회)에 걸리면 잠시 기다렸다 다시
        st, j, _ = call("POST", "/api/auth/login", {"loginId": uid, "password": pw})
        if st != 429:
            break
        time.sleep(20)
    assert st == 200, (uid, st, j)
    d = j["data"]
    if d.get("step") == "otp-setup":
        TOTP_SECRET[uid] = d["secret"]
    if d.get("step") in ("otp", "otp-setup"):
        st2, j2, _ = call("POST", "/api/auth/otp/verify", {"otpToken": d["otpToken"], "code": app_code(uid)})
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

# eduadmin: 2단계 인증 사용, 인증 앱은 아직 미등록 → 첫 로그인에서 등록(QR + 첫 번호)
st, j, _ = call("POST", "/api/auth/login", {"loginId": "eduadmin", "password": "user1234!"})
d = j["data"]
check("OTP: unregistered account → otp-setup with QR + secret, no echoed code",
      st == 200 and d.get("step") == "otp-setup" and d.get("qr", "").startswith("data:image/png;base64,") and len(d.get("secret", "").replace(" ", "")) == 32 and "devCode" not in d, {k: v for k, v in d.items() if k != "qr"})
TOTP_SECRET["eduadmin"] = d["secret"]
right = app_code("eduadmin")
st, j2, _ = call("POST", "/api/auth/otp/verify", {"otpToken": d["otpToken"], "code": "000000" if right != "000000" else "111111"})
check("OTP: wrong code rejected", st in (400, 401), j2)
st, j3, _ = call("POST", "/api/auth/otp/verify", {"otpToken": d["otpToken"], "code": right})
E = (j3.get("data") or {}).get("accessToken") if st == 200 else None
check("OTP: app code → token, app registered", st == 200 and E and j3["data"]["me"]["otpRegistered"] is True, j3)
st, j4, _ = call("POST", "/api/auth/otp/verify", {"otpToken": d["otpToken"], "code": right})
check("OTP: login attempt is single-use", st != 200, j4)
# 다음 로그인: 등록된 앱 번호 (step "otp", QR 없음). 같은 번호를 다시 쓰면 거절.
st, j, _ = call("POST", "/api/auth/login", {"loginId": "eduadmin", "password": "user1234!"}); d = j["data"]
check("OTP: registered account → otp step without QR", st == 200 and d.get("step") == "otp" and "qr" not in d and "secret" not in d, d)
st, j5, _ = call("POST", "/api/auth/otp/verify", {"otpToken": d["otpToken"], "code": right})
check("OTP: already-used app code rejected (replay)", st in (400, 401), j5)
st, j6, _ = call("POST", "/api/auth/otp/verify", {"otpToken": d["otpToken"], "code": app_code("eduadmin")})
check("OTP: next app code accepted", st == 200, j6)

# 마이페이지: 인증 앱 등록하고 켜기 → 로그인에 번호 필요 → 끄기 (school02)
st, j, _ = call("POST", "/api/auth/me/otp/setup", {}, token=S2); su = data((st, j, None)) or {}
check("my OTP setup: QR + secret", st == 200 and su.get("qr", "").startswith("data:image/png") and su.get("secret"), {k: v for k, v in su.items() if k != "qr"})
TOTP_SECRET["school02"] = su["secret"]
good = app_code("school02")
st, j, _ = call("POST", "/api/auth/me/otp/enable", {"otpToken": su["otpToken"], "code": "000000" if good != "000000" else "111111"}, token=S2)
check("my OTP enable: wrong code → 400", st == 400, j)
st, j, _ = call("POST", "/api/auth/me/otp/enable", {"otpToken": su["otpToken"], "code": good}, token=S2)
check("my OTP enable: app code → on + registered", st == 200 and data((st, j, None))["otpEnabled"] and data((st, j, None))["otpRegistered"], j)
st, j, _ = call("PUT", "/api/auth/me", {"otpEnabled": False}, token=S2)
check("my OTP: cannot switch off through profile save", st == 200 and data((st, j, None))["otpEnabled"] is True, j)
st, j, _ = call("POST", "/api/auth/login", {"loginId": "school02", "password": "user1234!"})
check("my OTP: login now asks for the app code", st == 200 and data((st, j, None)).get("step") == "otp", j)
S2 = login("school02", "user1234!")
check("my OTP: login with app code", bool(S2))
st, j, _ = call("POST", "/api/auth/me/otp/disable", {"code": "000000" if app_code("school02") != "000000" else "111111"}, token=S2)
check("my OTP disable: wrong code → 400", st == 400, j)
st, j, _ = call("POST", "/api/auth/me/otp/disable", {"code": app_code("school02")}, token=S2)
check("my OTP disable: app code → off, registration removed", st == 200 and not data((st, j, None))["otpEnabled"] and not data((st, j, None))["otpRegistered"], j)

# 관리자: 휴대폰 분실 → 인증 앱 등록 초기화 → 다음 로그인에서 다시 등록
st, j, _ = call("GET", "/api/users?keyword=eduadmin", token=A)
eid = next(u["userId"] for u in data((st, j, None))["content"] if u["loginId"] == "eduadmin")
st, j, _ = call("POST", f"/api/users/{eid}/otp-reset", {}, token=S); check("OTP reset: school user → 403", st == 403, j)
st, j, _ = call("POST", f"/api/users/{eid}/otp-reset", {}, token=A); ru = data((st, j, None)) or {}
check("OTP reset: registration cleared, 2단계 인증 still on", st == 200 and ru.get("otpEnabled") is True and ru.get("otpRegistered") is False, ru)
st, j, _ = call("POST", "/api/auth/login", {"loginId": "eduadmin", "password": "user1234!"})
check("OTP reset: next login registers again", st == 200 and data((st, j, None)).get("step") == "otp-setup", j)
E = login("eduadmin", "user1234!")
check("OTP reset: re-registered login works", bool(E))

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
st, j, _ = call("GET", "/api/as/regions", token=S); check("regions: 14 (충남 교육지원청)", st == 200 and len(data((st, j, None))) == 14, j)
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

# 스쿨넷장비관리: 같은 표, 다른 유형·회선 정보. 무선장비 목록·AS 신청과 섞이지 않는다.
st, j, _ = call("GET", f"/api/as/schoolnet-devices?schoolId={bh['schoolId']}", token=E); nd = data((st, j, None))
check("schoolnet devices of 봉황초: 3 seeded, all S", st == 200 and nd["totalElements"] == 3 and all(x["rceptTy"] == "S" for x in nd["content"]), j)
router = next(x for x in nd["content"] if x["deviceType"] == "ROUTER")
check("schoolnet router carries 회선", router["carrier"] == "KT" and router["circuitId"] == "KT-CN-0731001" and router["bandwidth"] == "500Mbps" and router["deviceTypeName"] == "라우터", router)
check("wireless list has no schoolnet devices", all(x["rceptTy"] == "M" for x in devs["content"]), [x["deviceCode"] for x in devs["content"]])
st, j, _ = call("POST", "/api/as/schoolnet-devices", {"schoolId": bh["schoolId"], "deviceName": "임시 라우터", "deviceType": "AP"}, token=E)
check("schoolnet create: wireless type AP → 400", st == 400, j)
st, j, _ = call("POST", "/api/as/schoolnet-devices", {"schoolId": bh["schoolId"], "deviceName": "임시 라우터"}, token=E)
check("schoolnet create: type required → 400", st == 400, j)
st, j, _ = call("POST", "/api/as/schoolnet-devices", {"schoolId": bh["schoolId"], "deviceName": "임시 라우터", "deviceType": "ROUTER", "carrier": "KT", "circuitId": "KT-TEST-1", "bandwidth": "1Gbps"}, token=E)
nr = data((st, j, None)) or {}
check("schoolnet create: admin ok, N- code", st == 200 and nr.get("deviceCode", "").startswith("N-") and nr.get("circuitId") == "KT-TEST-1", j)
st, j, _ = call("PUT", f"/api/as/wireless-devices/{nr.get('deviceId')}", {"deviceName": "x"}, token=E)
check("schoolnet device not editable through wireless API → 404", st == 404, j)
st, j, _ = call("PUT", f"/api/as/schoolnet-devices/{nr.get('deviceId')}", {"status": "FAULT", "bandwidth": "500Mbps"}, token=E)
check("schoolnet update", st == 200 and data((st, j, None))["status"] == "FAULT" and data((st, j, None))["bandwidth"] == "500Mbps", j)
st, j, _ = call("GET", f"/api/as/schoolnet-devices?keyword=KT-TEST", token=E); check("schoolnet search by 회선번호", st == 200 and data((st, j, None))["totalElements"] == 1, j)
st, j, _ = call("DELETE", f"/api/as/schoolnet-devices/{nr.get('deviceId')}", token=E); check("schoolnet delete", st == 200, j)
st, j, _ = call("GET", "/api/as/schoolnet-devices", token=S)
check("schoolnet: school user reads own school's devices (to pick one for 스쿨넷 AS)", st == 200 and all(x["schoolId"] == bh["schoolId"] for x in data((st, j, None))["content"]), j)
st, j, _ = call("GET", f"/api/as/schoolnet-devices?schoolId={oc['schoolId']}", token=S); check("schoolnet: school user, other school → 403", st == 403, j)
st, j, _ = call("POST", "/api/as/schoolnet-devices", {"schoolId": bh["schoolId"], "deviceName": "x", "deviceType": "ROUTER"}, token=S); check("schoolnet: school user cannot register", st == 403, j)

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
st, j, _ = call("GET", "/api/as/requests?rceptTy=M&searchType=region&keyword=천안", token=E); lst = data((st, j, None))
check("AS list: search by region name", st == 200 and lst["totalElements"] >= 1 and all("천안" in x["regionName"] for x in lst["content"]), j)
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
def eval_flag(tok):
    rows_ = data(call("GET", "/api/as/requests?size=500", token=tok))["content"]
    return next((x.get("canEvaluate") for x in rows_ if x["asvcSn"] == sn), "missing")
check("eval wait: school list flags the row (canEvaluate)", eval_flag(S) is True, eval_flag(S))
check("eval wait: engineer · admin list rows not flagged", eval_flag(N) is None and eval_flag(A) is None, (eval_flag(N), eval_flag(A)))
st, j, _ = call("POST", f"/api/as/requests/{sn}/evaluate", {"score": 5, "opinion": "빠른 처리 감사합니다."}, token=N)
check("AS evaluate by engineer → 409", st == 409, j)
st, j, _ = call("POST", f"/api/as/requests/{sn}/evaluate", {"score": 5, "opinion": "빠른 처리 감사합니다."}, token=S); r = data((st, j, None))
check("AS evaluate by school → evalScore 5, histories ≥ 5", st == 200 and r["evalScore"] == 5 and len(r["histories"]) >= 5, j)
st, j, _ = call("POST", f"/api/as/requests/{sn}/evaluate", {"score": 4}, token=S)
check("AS evaluate twice → 409", st == 409, j)
check("eval wait: flag gone after evaluation", eval_flag(S) is None, eval_flag(S))
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
check("contacts grouped: 도교육청 first + 14 교육지원청, 담당업무 포함", st == 200 and ct[0]["regionName"] == "도교육청" and len(ct) == 15 and ct[1]["groups"][0]["items"][0]["duties"], j)
st, j, _ = call("PUT", "/api/as/contacts", [{"groupName": "g", "itemName": "i", "tel": "1"}], token=S); check("contacts replace by school user → 403", st == 403, j)

# ---------- 7. 통계 ----------
st, j, _ = call("GET", "/api/as/stats/monthly?year=2026", token=E); stt = data((st, j, None))
check("stats monthly: total ≥ 9, 4 types, regions, vendors", st == 200 and stt["total"]["count"] >= 9 and len(stt["byType"]) == 4 and len(stt["byRegion"]) == 14 and len(stt["byVendor"]) >= 1, j)
st, j, _ = call("GET", "/api/as/stats/monthly?year=2026&rceptTy=M", token=V); sv = data((st, j, None))
check("stats monthly (vendor admin): only own vendor rows", st == 200 and all(v["vendorName"] == "한빛네트웍스" for v in sv["byVendor"]), j)
st, j, _ = call("GET", "/api/as/stats/satisfaction?year=2026", token=E); sat = data((st, j, None))
check("stats satisfaction: evaluated ≥ 5, distribution 1..5, byEngineer", st == 200 and sat["summary"]["evaluated"] >= 5 and len(sat["summary"]["distribution"]) == 5 and sat["byEngineer"], j)

# ---------- 8. 공간(도면) ----------
st, j, _ = call("GET", f"/api/as/spaces/buildings?schoolId={bh['schoolId']}", token=S); bl = data((st, j, None))
check("spaces buildings: 본관 3 floors, 2F has plan", st == 200 and len(bl) == 1 and len(bl[0]["floors"]) == 3 and any(f.get("planUrl") for f in bl[0]["floors"]), j)
fl2 = next(f for f in bl[0]["floors"] if f["floorNo"] == 2); fl3 = next(f for f in bl[0]["floors"] if f["floorNo"] == 3)

# 무선장비 위치(도면): 장비를 그 학교 층 도면 위 (x, y)%에 놓는다.
pos = lambda dev, body, tok=E: call("PUT", f"/api/as/wireless-devices/{dev['deviceId']}/position", body, token=tok)
st, j, _ = pos(apB2, {"floorId": fl2["floorId"], "x": 42.5, "y": 61.25}); pd = data((st, j, None)) or {}
check("device position: placed on 2F plan", st == 200 and pd.get("floorId") == fl2["floorId"] and pd.get("posX") == 42.5 and pd.get("posY") == 61.25 and pd.get("floorFullName") == "본관 2층", j)
st, j, _ = call("GET", f"/api/as/wireless-devices?schoolId={bh['schoolId']}&size=100", token=E)
check("device list carries position", any(d["deviceId"] == apB2["deviceId"] and d.get("posX") == 42.5 and d.get("floorFullName") == "본관 2층" for d in data((st, j, None))["content"]), j)
st, j, _ = pos(apB2, {"floorId": fl3["floorId"], "x": 10, "y": 10}); check("device position: floor without plan → 400", st == 400, j)
st, j, _ = pos(apB2, {"floorId": fl2["floorId"], "x": 120, "y": 10}); check("device position: x out of 0..100 → 400", st == 400, j)
st, j, _ = pos(apB2, {"floorId": fl2["floorId"], "x": "a", "y": 10}); check("device position: x not a number → 400", st == 400, j)
st, j, _ = call("GET", f"/api/as/wireless-devices?schoolId={oc['schoolId']}&size=100", token=E); ocd = data((st, j, None))["content"]
st, j, _ = pos(ocd[0], {"floorId": fl2["floorId"], "x": 5, "y": 5}); check("device position: other school's floor → 400", st == 400, j)
st, j, _ = pos(apB2, {"floorId": fl2["floorId"], "x": 5, "y": 5}, S); check("device position: school user (no WDEVICE_MANAGE) → 403", st == 403, j)
st, j, _ = pos(apB2, {"floorId": None}); check("device position: removed from plan", st == 200 and data((st, j, None)).get("floorId") is None and data((st, j, None)).get("posX") is None, j)
st, j, _ = pos(apB2, {"floorId": fl2["floorId"], "x": 30, "y": 40}); check("device position: placed again", st == 200, j)

# 다른 층으로 옮기면 설치위치 문구도 따라가고, AS 상세는 신청 당시 설치장소 + 장비 현재 위치를 함께 보인다.
PNG1 = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
st, j, _ = call("POST", f"/api/places/floors/{fl3['floorId']}/plan", files=[("file", ("3f.png", PNG1, "image/png"))], token=E); check("plan upload for 3F", st == 200, j)
st, j, _ = call("POST", "/api/as/requests", {"rceptTy": "M", "faultTypeCode": "P", "requestTypeCode": "2", "symptom": "AP 이동 전 신청(테스트)", "installPlace": "본관 2층 복도",
                                              "deviceId": apB2["deviceId"], "visitRequestAt": "2026-11-20T10:00", "contactTel": "010-2000-0001"}, token=S); mvr = data((st, j, None)) or {}
check("AS for device on 2F", st == 200 and "(본관 2층 복도)" in (mvr.get("deviceName") or ""), j)
st, j, _ = pos(apB2, {"floorId": fl3["floorId"], "x": 50, "y": 50}); check("device moved to 3F: 설치위치 '본관 2층 복도' → '본관 3층 복도'", st == 200 and data((st, j, None)).get("location") == "본관 3층 복도", j)
st, j, _ = call("GET", f"/api/as/requests/{mvr.get('asvcSn')}", token=S); mvd = data((st, j, None)) or {}
check("AS detail: installPlace/deviceName as requested, deviceCurrentPlace = now",
      st == 200 and mvd.get("installPlace") == "본관 2층 복도" and "(본관 2층 복도)" in (mvd.get("deviceName") or "") and mvd.get("deviceCurrentPlace") == "본관 3층 복도", mvd)
st, j, _ = call("GET", "/api/as/requests?size=5", token=S); check("AS list rows have no deviceCurrentPlace (detail only)", st == 200 and all("deviceCurrentPlace" not in x for x in data((st, j, None))["content"]), j)
st, j, _ = call("PUT", f"/api/as/wireless-devices/{apB2['deviceId']}", {"location": "교무실 천장"}, token=E); check("device location set by hand", st == 200, j)
st, j, _ = pos(apB2, {"floorId": fl2["floorId"], "x": 30, "y": 40}); check("device moved with hand-written 설치위치 → kept", st == 200 and data((st, j, None)).get("location") == "교무실 천장", j)
st, j, _ = call("GET", f"/api/as/requests/{mvr.get('asvcSn')}", token=S); check("AS detail: current place = 건물 층 (설치위치)", data((st, j, None)).get("deviceCurrentPlace") == "본관 2층 (교무실 천장)", j)
st, j, _ = call("PUT", f"/api/as/wireless-devices/{apB2['deviceId']}", {"location": "본관 2층 복도"}, token=E); check("device location restored", st == 200, j)
st, j, _ = call("GET", f"/api/as/requests/{mvr.get('asvcSn')}", token=S); check("AS detail: current place same as installPlace", data((st, j, None)).get("deviceCurrentPlace") == "본관 2층 복도", j)
st, j, _ = call("DELETE", f"/api/as/requests/{mvr.get('asvcSn')}", token=E); check("cleanup: AS deleted", st == 200, j)

# 설치위치 = 건물 · 층 · 상세 위치(실): 고르기 목록, 도면 층 고정, 다른 층으로 옮기기, 위치 변경 기록
D2 = f"/api/as/wireless-devices/{apB2['deviceId']}"
st, j, _ = call("GET", f"/api/as/wireless-devices/places?schoolId={bh['schoolId']}", token=E); pl = data((st, j, None)) or {}
check("places: 본관 3 floors (plan flags) + details used in the school",
      st == 200 and pl["buildings"][0]["buildingName"] == "본관" and len(pl["buildings"][0]["floors"]) == 3
      and any(f["hasPlan"] for f in pl["buildings"][0]["floors"]) and "복도" in pl["details"] and all(not d.startswith("본관 ") for d in pl["details"]), pl)
st, j, _ = call("GET", f"/api/as/wireless-devices/places?schoolId={bh['schoolId']}", token=S); check("places: school user (no WDEVICE_MANAGE) → 403", st == 403, j)
st, j, _ = call("GET", f"/api/as/schoolnet-devices/places?schoolId={bh['schoolId']}", token=E); check("places: schoolnet devices too", st == 200 and data((st, j, None))["buildings"], j)
st, j, _ = call("GET", D2 + "/history", token=E); hs = data((st, j, None)) or []
check("history: earlier moves recorded (도면에서 옮김 · 장비 수정)", st == 200 and {"PLAN", "EDIT"} <= {h["actionType"] for h in hs} and hs[0]["workerName"], hs)
n0 = len(hs)
st, j, _ = call("GET", D2 + "/history", token=S); check("history: school user → 403", st == 403, j)
st, j, _ = call("PUT", D2, {"location": "본관 3층 컴퓨터실"}, token=E)
check("on-plan device: 설치위치 floor follows the plan (typed 3층 → 2층)", st == 200 and data((st, j, None))["location"] == "본관 2층 컴퓨터실", j)
st, j, _ = call("GET", D2 + "/history", token=E); hs = data((st, j, None)) or []
check("history: EDIT 본관 2층 복도 → 본관 2층 컴퓨터실", len(hs) == n0 + 1 and hs[0]["actionType"] == "EDIT" and hs[0]["fromPlace"] == "본관 2층 복도" and hs[0]["toPlace"] == "본관 2층 컴퓨터실", hs[:1])
st, j, _ = call("PUT", D2, {"note": "메모만"}, token=E); st2, j2, _ = call("GET", D2 + "/history", token=E)
check("history: saving without a location change adds nothing", st == 200 and len(data((st2, j2, None))) == n0 + 1, j2)
st, j, _ = call("PUT", D2, {"unplace": True, "location": "본관 3층 음악실"}, token=E); mv = data((st, j, None)) or {}
check("다른 층으로 옮기기: off the plan + new 설치위치", st == 200 and mv.get("floorId") is None and mv.get("posX") is None and mv.get("location") == "본관 3층 음악실", j)
st, j, _ = call("GET", D2 + "/history", token=E); hs = data((st, j, None)) or []
check("history: FLOOR 본관 2층 컴퓨터실 → 본관 3층 음악실", hs[0]["actionType"] == "FLOOR" and hs[0]["actionName"] == "다른 층으로 옮김" and hs[0]["toPlace"] == "본관 3층 음악실", hs[:1])
st, j, _ = call("PUT", D2, {"unplace": True}, token=E); check("다른 층으로 옮기기: not on a plan → 400", st == 400, j)
st, j, _ = pos(apB2, {"floorId": fl3["floorId"], "x": 40, "y": 40}); st2, j2, _ = call("GET", D2 + "/history", token=E)
check("placed on the new floor: 설치위치 kept, no extra history", st == 200 and data((st, j, None))["location"] == "본관 3층 음악실" and len(data((st2, j2, None))) == len(hs), (j, j2))
st, j, _ = call("GET", f"/api/qr/devices/{apB2['deviceId']}", token=E); check("device scan (admin): recent history", st == 200 and data((st, j, None))["history"][0]["toPlace"] == "본관 3층 음악실", j)
st, j, _ = call("GET", f"/api/qr/devices/{apB2['deviceId']}", token=S); check("device scan (school): no history", st == 200 and "history" not in data((st, j, None)), j)
# 원래대로 (뒤 시험은 2층 복도를 본다)
pos(apB2, {"floorId": fl2["floorId"], "x": 30, "y": 40}); st, j, _ = call("PUT", D2, {"location": "본관 2층 복도"}, token=E)
check("restore AP-BH-002 to 본관 2층 복도", st == 200 and data((st, j, None))["location"] == "본관 2층 복도" and data((st, j, None))["floorId"] == fl2["floorId"], j)
# 도면에서 옮길 때 옮길 실(room)을 함께 보내면 설치위치 = "건물 층 실". 빈 실은 400.
st, j, _ = pos(apB2, {"floorId": fl2["floorId"], "x": 35, "y": 45, "room": "  "}); check("move on plan with blank room → 400", st == 400, j)
st, j, _ = pos(apB2, {"floorId": fl2["floorId"], "x": 35, "y": 45, "room": "과학실"}); mvp = data((st, j, None)) or {}
check("move on plan with room → 설치위치 본관 2층 과학실 + new spot", st == 200 and mvp.get("location") == "본관 2층 과학실" and mvp.get("posX") == 35, j)
st, j, _ = call("GET", D2 + "/history", token=E); check("history: PLAN 본관 2층 복도 → 본관 2층 과학실", data((st, j, None))[0]["actionType"] == "PLAN" and data((st, j, None))[0]["toPlace"] == "본관 2층 과학실", j)
pos(apB2, {"floorId": fl2["floorId"], "x": 30, "y": 40, "room": "복도"}); st, j, _ = call("GET", f"/api/as/wireless-devices?schoolId={bh['schoolId']}&size=100", token=E)
check("restore again: 본관 2층 복도", any(d["deviceId"] == apB2["deviceId"] and d["location"] == "본관 2층 복도" for d in data((st, j, None))["content"]), j)
st, j, _ = call("GET", f"/api/as/schoolnet-devices?schoolId={bh['schoolId']}", token=E); sn0 = data((st, j, None))["content"][0]
st, j, _ = call("PUT", f"/api/as/wireless-devices/{sn0['deviceId']}/position", {"floorId": fl2["floorId"], "x": 5, "y": 5}, token=E)
check("device position: schoolnet device via wireless API → 404", st == 404, j)

# 장비 라벨 QR: 라벨 인쇄 → /d/{id} → 장비 정보 (학교는 자기 학교 장비, 바로 AS 신청)
st, j, _ = call("POST", "/api/qr/device-labels", {"deviceIds": [apB2["deviceId"], sn0["deviceId"]]}, token=E); lb = data((st, j, None)) or []
check("device labels: wireless + schoolnet, /d/{id} QR", st == 200 and len(lb) == 2 and lb[0]["qrText"].endswith(f"/d/{apB2['deviceId']}") and lb[0]["code"] == "AP-BH-002" and "봉황초등학교" in lb[0]["sub"], lb)
st, j, _ = call("POST", "/api/qr/device-labels", {"deviceIds": [apB2["deviceId"]]}, token=S); check("device labels: school user → 403", st == 403, j)
st, _, h = call("GET", f"/d/{apB2['deviceId']}", raw=True, follow=False); check("public /d/{id} → 302 to device page", st == 302 and h.get("Location") == f"/device?id={apB2['deviceId']}", (st, h.get("Location")))
st, j, _ = call("POST", "/api/qr/resolve", {"text": lb[0]["qrText"]}, token=S); rz = data((st, j, None))
check("qr resolve device label → DEVICE", st == 200 and rz["type"] == "DEVICE" and rz["deviceId"] == apB2["deviceId"] and rz["found"] and rz["rceptTy"] == "M", rz)
st, j, _ = call("POST", "/api/qr/resolve", {"text": " ap-bh-002 "}, token=S); rz = data((st, j, None))
check("qr resolve typed device code (label damaged) → DEVICE", st == 200 and rz["type"] == "DEVICE" and rz["deviceId"] == apB2["deviceId"] and rz["found"], rz)
st, j, _ = call("POST", "/api/qr/resolve", {"text": "NO-SUCH-CODE"}, token=S); check("qr resolve unknown code → UNKNOWN", st == 200 and data((st, j, None))["type"] == "UNKNOWN", j)
st, j, _ = call("GET", f"/api/qr/devices/{apB2['deviceId']}", token=S); dv = data((st, j, None)) or {}
check("device scan (school): where 학교·건물·층, can request, cannot manage",
      st == 200 and dv["where"]["schoolName"] == "봉황초등학교" and dv["where"]["buildingName"] == "본관" and dv["where"]["floorName"] == "2층" and dv["where"]["onPlan"]
      and dv["canRequest"] is True and dv["canManage"] is False and dv.get("location"), dv)
st, j, _ = call("GET", f"/api/qr/devices/{apB2['deviceId']}", token=S2); check("device scan: other school → 404", st == 404, j)
st, j, _ = call("GET", f"/api/qr/devices/{apB2['deviceId']}", token=E); check("device scan (admin): can manage", st == 200 and data((st, j, None))["canManage"] is True, j)
st, j, _ = call("GET", f"/api/qr/devices/{sn0['deviceId']}", token=S); dsn = data((st, j, None)) or {}
check("device scan schoolnet (school): no plan → where has school only", st == 200 and dsn["rceptTy"] == "S" and dsn["where"]["schoolName"] == "봉황초등학교" and not dsn["where"]["onPlan"] and dsn["canRequest"], dsn)
# 스쿨넷 AS도 대상 장비를 고른다 (라벨에서 바로 신청)
st, j, _ = call("GET", "/api/as/requests/codes", token=S); sft = list(data((st, j, None))["faultTypes"]["S"].keys())[0]
sbody = {"rceptTy": "S", "faultTypeCode": sft, "symptom": "인터넷 끊김(장비 라벨에서 신청)", "visitRequestAt": "2026-11-20T10:00", "contactTel": "010-2000-0001"}
st, j, _ = call("POST", "/api/as/requests", {**sbody, "deviceId": apB2["deviceId"]}, token=S); check("스쿨넷 AS with a wireless device → 400", st == 400, j)
st, j, _ = call("POST", "/api/as/requests", {**sbody, "deviceId": sn0["deviceId"]}, token=S); sr = data((st, j, None)) or {}
check("스쿨넷 AS with its schoolnet device", st == 200 and sr.get("deviceId") == sn0["deviceId"] and sn0["deviceCode"] in (sr.get("deviceName") or ""), sr)
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
st, b, h = call("GET", f"/api/qr/asset/{a1['assetNo']}.png", raw=True); check("qr png needs auth", st == 401, st)
st, j, _ = call("POST", "/api/qr/resolve", {"text": f"{BASE}/a/{a1['assetNo']}"}, token=S); rz = data((st, j, None))
check("qr resolve asset label → REGISTERED", st == 200 and rz["type"] == "ASSET" and rz["state"] == "REGISTERED" and rz["assetId"] == a1["assetId"], j)
st, j, _ = call("POST", "/api/qr/resolve", {"text": a1["assetNo"].lower()}, token=S); check("qr resolve bare asset no (case-insensitive)", st == 200 and data((st, j, None))["state"] == "REGISTERED", j)

# 자산 QR → 어느 학교 · 건물 · 층 · 실인지
loc = rz.get("location") or {}
check("qr resolve asset: location 학교·건물·층·실", loc.get("schoolName") == "봉황초등학교" and loc.get("buildingName") == "본관" and loc.get("floorName") == "2층"
      and loc.get("roomName") == "컴퓨터실" and loc.get("complete") is True and loc.get("path", "").startswith("봉황초등학교 › 본관 › 2층 › 컴퓨터실"), loc)
st, j, _ = call("GET", f"/api/assets/{a1['assetId']}", token=S); check("asset detail: same location", st == 200 and data((st, j, None)).get("location", {}).get("path") == loc.get("path"), j)
st, j, _ = call("POST", "/api/qr/resolve", {"text": f"{BASE}/a/{a1['assetNo']}"}, token=S2); rz2 = data((st, j, None))
check("qr resolve: other school's asset → OUT_OF_SCOPE, no name or location", st == 200 and rz2["state"] == "OUT_OF_SCOPE" and rz2.get("location") is None and "assetName" not in rz2, rz2)
# 실을 바꾸면 건물·층도 그 실을 따라간다
st, j, _ = call("PUT", f"/api/assets/{a1['assetId']}", {"roomId": nr["roomId"]}, token=S)
st, j, _ = call("GET", f"/api/assets/{a1['assetId']}", token=S); ad = data((st, j, None)) or {}
check("asset room change syncs 건물·층", ad.get("roomId") == nr["roomId"] and ad.get("floorId") == fl3["floorId"] and ad.get("floorName") == "3층"
      and ad.get("location", {}).get("roomName") == "음악실" and ad["location"].get("floorName") == "3층", ad.get("location"))
st, j, _ = call("PUT", f"/api/assets/{a1['assetId']}", {"roomId": pcroom["roomId"]}, token=S); check("asset room change back", st == 200, j)
st, j, _ = call("POST", "/api/qr/resolve", {"text": f"{BASE}/r/{pcroom['roomId']}"}, token=S)
check("qr resolve: 교실 QR no longer used → UNKNOWN", st == 200 and data((st, j, None))["type"] == "UNKNOWN", j)
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
st, _, h = call("GET", f"/a/{a1['assetNo']}", raw=True, follow=False); check("public /a/{assetNo} → 302 to home (자산 화면 없음)", st == 302 and h.get("Location") == "/", (st, h.get("Location")))
st, _, h = call("GET", f"/r/{pcroom['roomId']}", raw=True, follow=False); check("public /r/{roomId} no longer redirects", st != 302, (st, h.get("Location")))

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

# ---------- 14. 교육지원청 담당자 (REGION_ADMIN, 천안) ----------
R = login("regionadmin", "user1234!")
st, j, _ = call("GET", "/api/auth/me", token=R); rme = data((st, j, None))
check("region admin: me has regionName 천안", st == 200 and rme["regionName"] == "천안" and "AS_MANAGE" in rme["permissions"] and "VENDOR_MANAGE" not in rme["permissions"], j)
st, j, _ = call("GET", "/api/as/schools", token=R); rs = data((st, j, None))
check("region admin: sees only 천안 schools (4)", st == 200 and len(rs) == 4 and all(x["regionName"] == "천안" for x in rs), j)
st, j, _ = call("GET", "/api/as/regions", token=R); check("region admin: regions = own only", st == 200 and [x["regionName"] for x in data((st, j, None))] == ["천안"], j)
st, j, _ = call("GET", "/api/as/requests?size=200", token=R); rl = data((st, j, None))
check("region admin: AS list only 천안 schools", st == 200 and rl["totalElements"] >= 1 and all(x["regionName"] == "천안" for x in rl["content"]), j)
st, j, _ = call("GET", "/api/as/requests?size=200", token=E); other = [x for x in data((st, j, None))["content"] if x["schoolName"] == "온천중학교"]
st, j, _ = call("GET", f"/api/as/requests/{other[0]['asvcSn']}", token=R); check("region admin: other district request → 404", st == 404, j)
st, j, _ = call("GET", f"/api/as/schools/{oc['schoolId']}", token=R); check("region admin: other district school → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/schools/{bh['schoolId']}", {"regionId": oc["regionId"]}, token=R); check("region admin: cannot move school to another district", st == 403, j)
st, j, _ = call("POST", "/api/as/regions", {"regionName": "가짜교육지원청"}, token=R); check("region admin: region CRUD → 403", st == 403, j)
st, j, _ = call("GET", f"/api/assets?schoolId={oc['schoolId']}&size=1", token=R); check("region admin: other district assets → 0", st == 200 and data((st, j, None))["totalElements"] == 0, j)
st, j, _ = call("GET", "/api/assets?size=500", token=R); ra = data((st, j, None))
check("region admin: assets only in district", st == 200 and ra["totalElements"] >= 1 and all(x["schoolId"] in {y["schoolId"] for y in rs} for x in ra["content"]), j)
st, j, _ = call("GET", f"/api/as/wireless-devices?size=200", token=R); check("region admin: devices only in district", st == 200 and all(x["regionName"] == "천안" for x in data((st, j, None))["content"]), j)
st, j, _ = call("GET", "/api/as/stats/monthly", token=R); check("region admin: no AS통계관리 → 403", st == 403, j)
check("region admin: /me has no AS_STATS", "AS_STATS" not in data(call("GET", "/api/auth/me", token=R))["permissions"])
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
check("school post ignores other regionId (stays 천안)", st == 200 and xp["regionId"] == bh["regionId"] and xp["regionName"] == "천안", j)
if st == 200: call("DELETE", f"/api/as/boards/DISPOSAL/{xp['postId']}", token=S)
st, j, _ = call("POST", "/api/as/boards/VENDOR", {"title": "지역 지정 글", "content": "x", "regionId": oc["regionId"]}, token=N); vp = data((st, j, None))
check("non-school post keeps chosen region", st == 200 and vp["regionId"] == oc["regionId"], j)
if st == 200: call("DELETE", f"/api/as/boards/VENDOR/{vp['postId']}", token=N)
st, j, _ = call("POST", "/api/as/boards/VENDOR", {"title": "x", "content": "x", "regionId": 999999}, token=N); check("unknown region on post → 400", st == 400, j)
st, j, _ = call("GET", "/api/auth/me", token=S); check("me: school user region derived from school", st == 200 and data((st, j, None))["regionName"] == "천안", j)
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


# ---------- 17. AS 처리 비용 (선택) ----------
print("\n== 17. AS 처리 비용 (선택)")
st, j, _ = call("GET", "/api/as/requests/codes", token=N); cd = data((st, j, None))
check("codes: costTypes, no chargeTypes", st == 200 and list(cd["costTypes"]) == ["PART", "LABOR", "TRAVEL", "ETC"] and "chargeTypes" not in cd, j)
rep = lambda body: call("POST", f"/api/as/requests/{sn}/report", {"processContent": "비용 항목 테스트", **body}, token=N)
st, j, _ = rep({"costItems": [{"costType": "PART", "itemName": "SSD 512GB", "quantity": 2, "unitPrice": 15000},
                                     {"costType": "LABOR", "itemName": "", "quantity": 1, "unitPrice": 30000}]})
st, j, _ = call("GET", f"/api/as/requests/{sn}", token=N); dt = data((st, j, None)) or {}; rp = dt.get("report", {})
check("report: amount = sum of lines (2×15,000 + 30,000)", st == 200 and rp.get("processAmount") == 60000 and len(rp.get("costItems", [])) == 2, rp)
check("report: line amount, default name", rp.get("costItems", [{}])[0].get("amount") == 30000 and rp["costItems"][1]["itemName"] == "공임", rp)
check("report: no 유상·무상 or 청구", "chargeType" not in rp and "bill" not in dt and not any(a.startswith("bill-") for a in dt.get("allowedActions", [])), dt.get("allowedActions"))
st, j, _ = call("POST", f"/api/as/requests/{sn}/bill-confirm", {}, token=E); check("bill actions gone → 404", st == 404, (st, j))
for name, body in [("unknown cost type", {"costItems": [{"costType": "X", "unitPrice": 1}]}),
                   ("negative unit price", {"costItems": [{"costType": "PART", "unitPrice": -1}]}),
                   ("quantity 0", {"costItems": [{"costType": "PART", "quantity": 0, "unitPrice": 1000}]}),
                   ("21 lines", {"costItems": [{"costType": "ETC", "unitPrice": 1}] * 21})]:
    st, j, _ = rep(body); check(f"report rejects {name} → 400", st == 400, j)
st, j, _ = call("GET", f"/api/as/requests/{sn}", token=N); check("rejected edits left lines unchanged", data((st, j, None))["report"]["processAmount"] == 60000, j)
st, j, _ = rep({"costItems": []}); st, j, _ = call("GET", f"/api/as/requests/{sn}", token=N); rp = data((st, j, None))["report"]
check("no cost is fine (optional)", rp["processAmount"] == 0 and rp.get("costItems") == [], rp)
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
st, j, _ = call("PUT", f"/api/users/{s2id}/menu-perms", {"granted": ["AS_MANAGE", "BOARD_QNA"], "denied": ["BOARD_QNA", "VENDOR_MANAGE"]}, token=A)
check("menu-perms: same perm shown and hidden → 400", st == 400, j)
st, j, _ = call("PUT", f"/api/users/{s2id}/menu-perms", {"granted": ["AS_STATS"]}, token=A); check("menu-perms: AS통계관리 to a school user → 400", st == 400 and "AS통계관리" in (msg((st, j, None)) or ""), j)
check("menu-perms: school user's AS통계관리 listed as blocked", "AS_STATS" in data(call("GET", f"/api/users/{s2id}/menu-perms", token=A)).get("blocked", []))
st, j, _ = call("PUT", f"/api/users/{s2id}/menu-perms", {"granted": ["AS_MANAGE", "BOARD_NOTICE"], "denied": ["BOARD_QNA", "VENDOR_MANAGE"]}, token=A); mp = data((st, j, None))
check("menu-perms: no-op overrides dropped", st == 200 and mp["granted"] == ["AS_MANAGE"] and mp["denied"] == ["BOARD_QNA"], j)
st, j, _ = call("GET", "/api/auth/me", token=S2); p2 = data((st, j, None))["permissions"]
check("menu-perms: /me reflects show/hide", "AS_MANAGE" in p2 and "BOARD_QNA" not in p2, p2)
st, j, _ = call("GET", "/api/as/boards/QNA", token=S2); check("menu-perms: hidden menu's API → 403", st == 403, j)
st, j, _ = call("GET", "/api/as/requests/summary", token=S2); check("menu-perms: shown menu's API → 200", st == 200, j)
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
def types_listed():
    st, j, _ = call("GET", "/api/as/requests?size=100", token=E)
    d = data((st, j, None))
    return st, d["totalElements"], {x["rceptTy"] for x in d["content"]}
st, total_off, tys = types_listed(); check("장애접수관리: unused services hidden", st == 200 and tys <= {"M", "S"} and total_off > 0, tys)
st, j, _ = call("GET", "/api/as/requests?rceptTy=C", token=E); check("장애접수관리: asking for an unused service returns nothing", st == 200 and data((st, j, None))["totalElements"] == 0, j)
st, j, _ = call("GET", "/api/as/requests/summary", token=E); sm = data((st, j, None)); check("summary: unused services count 0", st == 200 and sm["byType"]["C"]["total"] == 0 and sm["byType"]["T"]["total"] == 0, sm)
call("PUT", "/api/org/as-services", {"asTypes": ["C", "M", "S", "T"]}, token=A)
st, j, _ = call("POST", "/api/as/vendors", {"vendorName": "숨김테스트업체", "serviceTypes": ["C"], "allRegions": True}, token=A); hv = data((st, j, None))
st, j, _ = call("GET", f"/api/as/schools/{bh['schoolId']}", token=A)
bh_map = [{"rceptTy": v["rceptTy"], "vendorId": v["vendorId"], "engineerUserId": v.get("engineerUserId")} for v in data((st, j, None))["vendors"] if v.get("vendorId")]
st, j, _ = call("PUT", f"/api/as/schools/{bh['schoolId']}/vendors", bh_map + [{"rceptTy": "C", "vendorId": hv["vendorId"]}], token=A); check("장애접수관리: 정보기기 vendor assigned for the test", st == 200, j)
st, j, _ = call("POST", "/api/as/requests", {"rceptTy": "C", "faultTypeCode": "11", "symptom": "숨김 확인(테스트)", "installPlace": "본관", "visitRequestAt": "2026-10-30T10:00"}, token=S); check("장애접수관리: 정보기기 request while the service is on", st == 200, j)
st, total_on, tys_on = types_listed(); check("장애접수관리: 정보기기 listed while on", st == 200 and total_on == total_off + 1 and "C" in tys_on, tys_on)
call("PUT", "/api/org/as-services", {"asTypes": ["M", "S"]}, token=A)
st, total2, tys2 = types_listed(); check("장애접수관리: hidden again when off", st == 200 and total2 == total_off and "C" not in tys2, tys2)
call("PUT", "/api/org/as-services", {"asTypes": ["C", "M", "S", "T"]}, token=A)
st, total3, tys3 = types_listed(); check("장애접수관리: record comes back when on again", st == 200 and total3 == total_on and "C" in tys3, tys3)
call("PUT", f"/api/as/schools/{bh['schoolId']}/vendors", bh_map, token=A)
call("PUT", "/api/org/as-services", {"asTypes": ["M", "S"]}, token=A)
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
MGMT = ["AS_MANAGE", "WDEVICE_MANAGE", "SPACE_MANAGE", "ASSET_READ", "FLOOR_READ", "INVENTORY", "SCHOOL_MANAGE", "VENDOR_MANAGE"]
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
st, j, _ = call("PUT", f"/api/as/schools/{own2['schoolId']}", {"classCount": own2.get("classCount"), "regionId": own2["regionId"]}, token=S2)
check("school+SCHOOL_MANAGE: own basic info (region unchanged) → 200", st == 200, j)
check("school view has no 유지관리 계약", "contractStatus" not in own2 and "contractStatusName" not in own2, own2)
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
mine = next(g for g in before if g["regionName"] == "천안"); theirs = next(g for g in before if g["regionName"] == "공주")
rows = [{"groupName": "천안 정보지원팀", "itemName": "정보지원팀장", "tel": "000-0000-0000", "duties": ["원클릭 AS 총괄", "무선망"]},
        {"groupName": "유지보수 사업자", "itemName": "테스트네트웍스", "tel": "000-1111-2222"}]
st, j, _ = call("PUT", f"/api/as/contacts/sections/{mine['regionId']}", rows, token=R); after = data((st, j, None))
cj = next(g for g in after if g["regionName"] == "천안") if st == 200 else {}
check("contacts: region admin replaces own district", st == 200 and [x["groupName"] for x in cj["groups"]] == ["천안 정보지원팀", "유지보수 사업자"]
      and cj["groups"][0]["items"][0]["duties"] == ["원클릭 AS 총괄", "무선망"], j)
check("contacts: other sections untouched", st == 200 and next(g for g in after if g["regionName"] == "공주") == theirs and after[0] == before[0], j)
st, j, _ = call("PUT", f"/api/as/contacts/sections/{theirs['regionId']}", rows, token=R); check("contacts: region admin other district → 403", st == 403, j)
st, j, _ = call("PUT", "/api/as/contacts/sections/province", rows, token=R); check("contacts: region admin 도교육청 section → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/contacts/sections/{mine['regionId']}", rows, token=S); check("contacts: school user → 403", st == 403, j)
st, j, _ = call("PUT", "/api/as/contacts/sections/999999", rows, token=E); check("contacts: unknown district → 404", st == 404, j)
st, j, _ = call("PUT", "/api/as/contacts/sections/abc", rows, token=E); check("contacts: bad section → 400", st == 400, j)
def back(g):
    return [{"groupName": gr["groupName"], "itemName": it["itemName"], "tel": it.get("tel"), "note": it.get("note"), "duties": it.get("duties") or []} for gr in g["groups"] for it in gr["items"]]
st, j, _ = call("PUT", f"/api/as/contacts/sections/{mine['regionId']}", back(mine), token=E)
check("contacts: 도교육청 admin can edit any district (restored)", st == 200 and back(next(g for g in data((st, j, None)) if g["regionName"] == "천안")) == back(mine), j)

# ----- 업체 담당 지역 / 유지보수 사업자는 별개 -----
def vgroup(sections, name):
    sec = next(g for g in sections if g["regionName"] == name)
    return next((gr["items"] for gr in sec["groups"] if gr["groupName"] == "유지보수 사업자"), [])
st, j, _ = call("GET", "/api/as/contacts", token=E); ct0 = data((st, j, None))
counts = {"천안": 3, "공주": 3, "보령": 3, "아산": 3, "서산": 3, "논산계룡": 3, "금산": 3, "부여": 3, "서천": 3, "청양": 3, "홍성": 3, "예산": 3, "태안": 3, "당진": 3}
check("vendors: 유지보수 사업자 per region", {k: len(vgroup(ct0, k)) for k in counts} == counts, {k: len(vgroup(ct0, k)) for k in counts})
check("vendors: 유지보수 사업자 are text rows", all("contactId" in it for k in counts for it in vgroup(ct0, k)), j)
cj_id = mine["regionId"]; cu_id = theirs["regionId"]
st, j, _ = call("POST", "/api/as/vendors", {"vendorName": "멀티지역테스트", "tel": "000-1", "serviceTypes": ["M"], "allRegions": False, "regions": [{"regionId": cj_id}, {"regionId": cu_id}]}, token=A); mv = data((st, j, None))
check("vendors: multi-region create", st == 200 and sorted(r["regionId"] for r in mv["regions"]) == sorted([cj_id, cu_id]), j)
st, j, _ = call("GET", "/api/as/contacts", token=E); ct1 = data((st, j, None))
check("vendors: 업체관리 vendor does not appear on 문의처", ct1 == ct0, j)
st, j, _ = call("GET", f"/api/as/vendors?regionId={cu_id}", token=E); check("vendors: region filter finds multi-region vendor", st == 200 and any(v["vendorName"] == "멀티지역테스트" for v in data((st, j, None))), j)
other_id = next(g for g in ct1 if g["regionName"] == "보령")["regionId"]
st, j, _ = call("GET", f"/api/as/vendors?regionId={other_id}", token=E); check("vendors: region filter excludes other regions", st == 200 and not any(v["vendorName"] == "멀티지역테스트" for v in data((st, j, None))), j)
st, j, _ = call("PUT", f"/api/as/vendors/{mv['vendorId']}", {"allRegions": True}, token=A); check("vendors: 전체 지역 clears regions", st == 200 and data((st, j, None))["allRegions"] is True and data((st, j, None))["regions"] == [], j)
st, j, _ = call("GET", f"/api/as/vendors?regionId={other_id}", token=E); check("vendors: 전체 지역 vendor found in any region", st == 200 and any(v["vendorName"] == "멀티지역테스트" for v in data((st, j, None))), j)
st, j, _ = call("DELETE", f"/api/as/vendors/{mv['vendorId']}", token=A); check("vendors: delete test vendor", st == 200, j)
st, j, _ = call("GET", "/api/as/contacts", token=E); check("vendors: deleting a vendor leaves 문의처 alone", data((st, j, None)) == ct0, j)
st, j, _ = call("GET", "/api/as/vendors", token=E); before_v = len(data((st, j, None)))
cj_sec = next(g for g in ct0 if g["regionName"] == "천안")
st, j, _ = call("PUT", f"/api/as/contacts/sections/{cj_id}", back(cj_sec) + [{"groupName": "유지보수 사업자", "itemName": "문의처전용업체", "tel": "043-222", "note": "메모"}], token=R)
got = vgroup(data((st, j, None)), "천안") if st == 200 else []
check("vendors: region admin adds a 유지보수 사업자", st == 200 and got[-1]["itemName"] == "문의처전용업체" and got[-1]["note"] == "메모", j)
st, j, _ = call("GET", "/api/as/vendors", token=E); check("vendors: 유지보수 사업자 does not create a vendor", len(data((st, j, None))) == before_v and not any(v["vendorName"] == "문의처전용업체" for v in data((st, j, None))), j)
st, j, _ = call("PUT", f"/api/as/contacts/sections/{cj_id}", back(cj_sec), token=R); check("vendors: 유지보수 사업자 restored", st == 200 and back(next(g for g in data((st, j, None)) if g["regionName"] == "천안")) == back(cj_sec), j)

# ----- 사용자 관리: admin과 도교육청만 -----
import time as _t
_t.sleep(61)  # 로그인 시도 제한(분당 20회)을 비운다
for who, tok_ in (("학교", S), ("교육지원청", R), ("기사", N), ("업체 관리자", V)):
    st, j, _ = call("GET", "/api/users", token=tok_); check(f"users: {who} cannot list → 403", st == 403, j)
    st, j, _ = call("POST", "/api/users", {"loginId": "x1", "userName": "x", "password": "Delete!2026xy"}, token=tok_); check(f"users: {who} cannot create → 403", st == 403, j)
st, j, _ = call("GET", "/api/users?size=500", token=E); ul = data((st, j, None))["content"]; check("users: 도교육청 can list", st == 200 and any(x["loginId"] == "school01" for x in ul), j)
s01 = next(x for x in ul if x["loginId"] == "school01"); check("users: list shows type and affiliation", s01["memberType"] == "학교 담당자" and s01["affiliation"] == "봉황초등학교" and s01["locked"] is False, s01)
adm = next(x for x in ul if x["loginId"] == "admin"); edu = next(x for x in ul if x["loginId"] == "eduadmin")
st, j, _ = call("GET", "/api/users/processors", token=S); check("users: processors list has no phone numbers", st == 200 and not any("mobile" in x or "email" in x for x in data((st, j, None))), j)

base = {"userName": "관리시험", "password": "Delete!2026xy"}
st, j, _ = call("POST", "/api/users", {**base, "loginId": "umsys1", "roles": ["SYS_ADMIN"]}, token=E); check("users: 도교육청 cannot create SYS_ADMIN → 403", st == 403, j)
st, j, _ = call("POST", "/api/users", {**base, "loginId": "umsup1", "roles": ["SUPER_ADMIN"]}, token=E); check("users: 도교육청 cannot create SUPER_ADMIN → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/users/{edu['userId']}/roles", {"roles": ["EDU_ADMIN", "SYS_ADMIN"]}, token=E); check("users: 도교육청 cannot raise itself → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/users/{edu['userId']}", {"roles": ["EDU_ADMIN", "SUPER_ADMIN"]}, token=E); check("users: 도교육청 cannot raise itself via update → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/users/{adm['userId']}", {"password": "Taken!2026xyz"}, token=E); check("users: 도교육청 cannot reset admin password → 403", st == 403, j)
st, j, _ = call("DELETE", f"/api/users/{adm['userId']}", token=E); check("users: 도교육청 cannot delete admin → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/users/{adm['userId']}/menu-perms", {"denied": ["AS_MANAGE"]}, token=E); check("users: 도교육청 cannot change admin menus → 403", st == 403, j)
st, j, _ = call("POST", f"/api/users/{adm['userId']}/unlock", {}, token=E); check("users: 도교육청 cannot touch admin unlock → 403", st == 403, j)
st, j, _ = call("DELETE", f"/api/users/{adm['userId']}", token=A); check("users: cannot delete yourself", st == 400, j)
st, j, _ = call("PUT", f"/api/users/{adm['userId']}", {"status": "DISABLED"}, token=A); check("users: cannot disable yourself", st == 400, j)
st, j, _ = call("PUT", f"/api/users/{edu['userId']}", {"roles": ["SCHOOL_USER"], "schoolId": bh["schoolId"]}, token=E); check("users: cannot change your own role", st == 400, j)
st, j, _ = call("POST", "/api/users", {**base, "loginId": "umsys2", "roles": ["SYS_ADMIN"]}, token=A); sy = data((st, j, None)); check("users: admin can create SYS_ADMIN", st == 200, j)
st, j, _ = call("PUT", f"/api/users/{sy['userId']}", {"userName": "탈취"}, token=E); check("users: 도교육청 cannot edit another SYS_ADMIN → 403", st == 403, j)
st, j, _ = call("DELETE", f"/api/users/{sy['userId']}", token=A); check("users: admin can delete SYS_ADMIN", st == 200, j)

st, j, _ = call("POST", "/api/users", {**base, "loginId": "umcrud1", "roles": ["SCHOOL_USER"], "schoolId": bh["schoolId"], "email": "a@b.kr", "mobile": "010-1111-2222"}, token=E); um = data((st, j, None)); check("users: 도교육청 creates 학교 담당자", st == 200 and um["affiliation"] == "봉황초등학교", j)
st, j, _ = call("POST", "/api/users", {**base, "loginId": "umcrud1", "roles": ["SCHOOL_USER"], "schoolId": bh["schoolId"]}, token=E); check("users: duplicate id → 409", st == 409, j)
st, j, _ = call("POST", "/api/users", {"loginId": "umweak", "userName": "x", "password": "123", "roles": ["SCHOOL_USER"], "schoolId": bh["schoolId"]}, token=E); check("users: weak password refused", st == 400, j)
st, j, _ = call("POST", "/api/auth/login", {"loginId": "umcrud1", "password": "Delete!2026xy"}); check("users: new account logs in", st == 200, j)
st, j, _ = call("PUT", f"/api/users/{um['userId']}", {"roles": ["AS_ENGINEER"], "schoolId": None, "vendorId": hanbit["vendorId"], "positionName": "기사"}, token=E); um2 = data((st, j, None)); check("users: role and affiliation change together", st == 200 and um2["roles"] == ["AS_ENGINEER"] and um2["affiliation"] == "한빛네트웍스" and um2["schoolId"] is None if st == 200 and "schoolId" in um2 else st == 200 and um2["roles"] == ["AS_ENGINEER"] and um2["affiliation"] == "한빛네트웍스", j)
st, j, _ = call("PUT", f"/api/users/{um['userId']}", {"roles": ["AS_ENGINEER"], "vendorId": None}, token=E); check("users: engineer without vendor → 400", st == 400, j)
st, j, _ = call("PUT", f"/api/users/{um['userId']}", {"password": "Changed!2026xy"}, token=E); check("users: password change", st == 200, j)
st, j, _ = call("POST", "/api/auth/login", {"loginId": "umcrud1", "password": "Delete!2026xy"}); check("users: old password refused", st != 200, j)
st, j, _ = call("POST", "/api/auth/login", {"loginId": "umcrud1", "password": "Changed!2026xy"}); check("users: new password works", st == 200, j)
st, j, _ = call("PUT", f"/api/users/{um['userId']}", {"status": "LOCKED"}, token=E); st2, j2, _ = call("GET", "/api/users?keyword=umcrud1", token=E); check("users: locked shows", data((st2, j2, None))["content"][0]["locked"] is True, j2)
st, j, _ = call("POST", "/api/auth/login", {"loginId": "umcrud1", "password": "Changed!2026xy"}); check("users: locked cannot log in", st != 200, j)
st, j, _ = call("POST", f"/api/users/{um['userId']}/unlock", {}, token=E); check("users: unlock", st == 200 and data((st, j, None))["locked"] is False and data((st, j, None))["status"] == "ACTIVE", j)
st, j, _ = call("POST", "/api/auth/login", {"loginId": "umcrud1", "password": "Changed!2026xy"}); check("users: unlocked logs in", st == 200, j)
st, j, _ = call("GET", f"/api/as/schools/{bh['schoolId']}", token=A); um_map = [{"rceptTy": v["rceptTy"], "vendorId": v["vendorId"], "engineerUserId": v.get("engineerUserId")} for v in data((st, j, None))["vendors"] if v.get("vendorId")]
st, j, _ = call("PUT", f"/api/as/schools/{bh['schoolId']}/vendors", [{**m, "engineerUserId": um["userId"]} if m["rceptTy"] == "M" else m for m in um_map], token=A); check("users: assigned as school's engineer", st == 200, j)
st, j, _ = call("POST", "/api/as/requests", {"rceptTy": "M", "faultTypeCode": "P", "requestTypeCode": "2", "symptom": "사용자 삭제 시험", "installPlace": "본관", "visitRequestAt": "2026-10-30T10:00"}, token=S); ureq = data((st, j, None)); check("users: open AS for that engineer", st == 200, j)
st, j, _ = call("DELETE", f"/api/users/{um['userId']}", token=E); check("users: delete refused with open AS → 409", st == 409, j)
st, j, _ = call("POST", f"/api/as/requests/{ureq['asvcSn']}/cancel", {}, token=S); check("users: AS cancelled", st == 200, j)
st, j, _ = call("DELETE", f"/api/users/{um['userId']}", token=E); check("users: delete", st == 200, j)
st, j, _ = call("POST", "/api/auth/login", {"loginId": "umcrud1", "password": "Changed!2026xy"}); check("users: deleted cannot log in", st != 200, j)
st, j, _ = call("GET", "/api/users?keyword=umcrud1", token=E); check("users: deleted stays, marked DISABLED", data((st, j, None))["content"][0]["status"] == "DISABLED", j)
st, j, _ = call("GET", f"/api/as/schools/{bh['schoolId']}", token=A); check("users: removed as the school's engineer", not any(v.get("engineerUserId") == um["userId"] for v in data((st, j, None))["vendors"]), j)
st, j, _ = call("PUT", f"/api/users/{um['userId']}", {"status": "ACTIVE"}, token=E); check("users: can be restored", st == 200, j)
st, j, _ = call("POST", "/api/auth/login", {"loginId": "umcrud1", "password": "Changed!2026xy"}); check("users: restored logs in", st == 200, j)
call("DELETE", f"/api/users/{um['userId']}", token=E)
call("PUT", f"/api/as/schools/{bh['schoolId']}/vendors", um_map, token=A)

# ----- 업체 담당 지역과 학교 배정 -----
st, j, _ = call("GET", "/api/as/vendors", token=A); hb = next(v for v in data((st, j, None)) if v["vendorName"] == "한빛네트웍스"); check("cover: sample vendor is 전체 지역", hb["allRegions"] is True, hb)
st, j, _ = call("POST", "/api/as/vendors", {"vendorName": "지역시험업체", "serviceTypes": ["M"], "allRegions": False, "regions": [{"regionId": bh["regionId"]}]}, token=A); cv = data((st, j, None))
oc_map = lambda: [{"rceptTy": v["rceptTy"], "vendorId": v["vendorId"], "engineerUserId": v.get("engineerUserId")} for v in data(call("GET", f"/api/as/schools/{oc['schoolId']}", token=A))["vendors"] if v.get("vendorId")]
oc0 = oc_map()
st, j, _ = call("PUT", f"/api/as/schools/{oc['schoolId']}/vendors", [m for m in oc0 if m["rceptTy"] != "M"] + [{"rceptTy": "M", "vendorId": cv["vendorId"]}], token=A); check("cover: school outside the vendor's region → 400", st == 400 and "담당하지" in j.get("message", ""), j)
check("cover: refused save keeps assignments", oc_map() == oc0 or len(oc_map()) == len(oc0), oc_map())
call("PUT", f"/api/as/schools/{oc['schoolId']}/vendors", oc0, token=A)
st, j, _ = call("GET", f"/api/as/schools/{bh['schoolId']}", token=A); bh0 = [{"rceptTy": v["rceptTy"], "vendorId": v["vendorId"], "engineerUserId": v.get("engineerUserId")} for v in data((st, j, None))["vendors"] if v.get("vendorId")]
st, j, _ = call("PUT", f"/api/as/schools/{bh['schoolId']}/vendors", [m for m in bh0 if m["rceptTy"] != "M"] + [{"rceptTy": "M", "vendorId": cv["vendorId"]}], token=A); check("cover: school in the vendor's region → ok", st == 200, j)
st, j, _ = call("PUT", f"/api/as/vendors/{cv['vendorId']}", {"allRegions": False, "regions": [{"regionId": oc["regionId"]}]}, token=A); check("cover: region with assigned schools cannot be removed → 409", st == 409 and bh["schoolName"] in j.get("message", ""), j)
st, j, _ = call("PUT", f"/api/as/vendors/{cv['vendorId']}", {"allRegions": False, "regions": [{"regionId": bh["regionId"]}, {"regionId": oc["regionId"]}]}, token=A); check("cover: adding a region is fine", st == 200 and len(data((st, j, None))["regions"]) == 2, j)
st, j, _ = call("PUT", f"/api/as/vendors/{cv['vendorId']}", {"allRegions": True}, token=A); check("cover: 전체 지역 is fine", st == 200, j)
st, j, _ = call("PUT", f"/api/as/vendors/{cv['vendorId']}", {"allRegions": False, "regions": [{"regionId": oc["regionId"]}]}, token=A); check("cover: leaving 전체 지역 also protects assigned schools → 409", st == 409, j)
st, j, _ = call("PUT", f"/api/as/vendors/{cv['vendorId']}", {"allRegions": False, "regions": [{"regionId": bh["regionId"]}]}, token=A); check("cover: keeping the used region is fine", st == 200, j)
# A school that moves region is the way an assignment ends up outside: it stays saved and is flagged.
st, j, _ = call("PUT", f"/api/as/schools/{bh['schoolId']}", {"regionId": oc["regionId"]}, token=A); check("cover: school moved to another region", st == 200, j)
st, j, _ = call("GET", f"/api/as/contacts/providers?schoolId={bh['schoolId']}", token=E); pm = next(x for x in data((st, j, None))["items"] if x["rceptTy"] == "M"); check("cover: vendor outside the region shows as no vendor on 문의처", not pm.get("vendorName") and not pm.get("engineerName"), pm)
st, j, _ = call("GET", f"/api/as/contacts/providers?schoolId={bh['schoolId']}", token=E); ps = next(x for x in data((st, j, None))["items"] if x["rceptTy"] == "S"); check("cover: 전체 지역 vendor still shown", ps.get("vendorName") == "한빛네트웍스", ps)
st, j, _ = call("GET", f"/api/as/schools/{bh['schoolId']}", token=A); cur = [{"rceptTy": v["rceptTy"], "vendorId": v["vendorId"], "engineerUserId": v.get("engineerUserId")} for v in data((st, j, None))["vendors"] if v.get("vendorId")]
st, j, _ = call("PUT", f"/api/as/schools/{bh['schoolId']}/vendors", cur, token=A); check("cover: existing outside assignment can be saved unchanged", st == 200, j)
call("PUT", f"/api/as/schools/{bh['schoolId']}", {"regionId": cj_id}, token=A)
st, j, _ = call("PUT", f"/api/as/schools/{bh['schoolId']}/vendors", bh0, token=A); check("cover: assignments restored", st == 200, j)
st, j, _ = call("DELETE", f"/api/as/vendors/{cv['vendorId']}", token=A); check("cover: test vendor removed", st == 200, j)

# ----- 업체 삭제 -----
st, j, _ = call("POST", "/api/as/vendors", {"vendorName": "삭제기능시험업체", "tel": "043-1", "serviceTypes": ["M", "S"], "allRegions": False, "regions": [{"regionId": cj_id}]}, token=A); dx = data((st, j, None))
st, j, _ = call("GET", f"/api/as/schools/{bh['schoolId']}", token=A); dx_map = [{"rceptTy": v["rceptTy"], "vendorId": v["vendorId"], "engineerUserId": v.get("engineerUserId")} for v in data((st, j, None))["vendors"] if v.get("vendorId")]
st, j, _ = call("PUT", f"/api/as/schools/{bh['schoolId']}/vendors", [m for m in dx_map if m["rceptTy"] != "M"] + [{"rceptTy": "M", "vendorId": dx["vendorId"]}], token=A); check("vendor delete: school assigned", st == 200, j)
st, j, _ = call("POST", "/api/users", {"loginId": "delvendor01", "userName": "삭제시험기사", "password": "Delete!2026xy", "roles": ["AS_ENGINEER"], "vendorId": dx["vendorId"]}, token=A); check("vendor delete: engineer created", st == 200, j)
st, j, _ = call("POST", "/api/auth/login", {"loginId": "delvendor01", "password": "Delete!2026xy"}); check("vendor delete: engineer can log in before", st == 200, j)
st, j, _ = call("POST", "/api/as/requests", {"rceptTy": "M", "faultTypeCode": "P", "requestTypeCode": "2", "symptom": "업체 삭제 시험", "installPlace": "본관", "visitRequestAt": "2026-10-30T10:00"}, token=S); dreq = data((st, j, None)); check("vendor delete: open request", st == 200 and dreq.get("asvcSn"), j)
st, j, _ = call("GET", f"/api/as/vendors/{dx['vendorId']}/usage", token=A); u0 = data((st, j, None)); check("vendor delete: usage", st == 200 and u0["schools"] == 1 and u0["users"] == 1 and u0["openRequests"] == 1, u0)
st, j, _ = call("GET", f"/api/as/vendors/{dx['vendorId']}/usage", token=R); check("vendor delete: 교육지원청 usage → 403", st == 403, j)
st, j, _ = call("DELETE", f"/api/as/vendors/{dx['vendorId']}", token=R); check("vendor delete: 교육지원청 → 403", st == 403, j)
st, j, _ = call("DELETE", f"/api/as/vendors/{dx['vendorId']}", token=A); check("vendor delete: open AS → 409", st == 409, j)
st, j, _ = call("POST", f"/api/as/requests/{dreq['asvcSn']}/cancel", {}, token=S); check("vendor delete: request cancelled", st == 200, j)
st, j, _ = call("GET", f"/api/as/requests/{dreq['asvcSn']}", token=A)
keeps_status = data((st, j, None)).get("status") if st == 200 else None
st, j, _ = call("GET", f"/api/as/vendors/{dx['vendorId']}/usage", token=A); u1 = data((st, j, None)); check("vendor delete: nothing open after cancel", st == 200 and u1["openRequests"] == 0, (keeps_status, u1))
st, j, _ = call("GET", "/api/as/contacts", token=E); ct_before = data((st, j, None))
st, j, _ = call("DELETE", f"/api/as/vendors/{dx['vendorId']}", token=A); check("vendor delete: succeeds", st == 200, j)
st, j, _ = call("GET", "/api/as/vendors", token=E); check("vendor delete: gone from list", not any(v["vendorId"] == dx["vendorId"] for v in data((st, j, None))), j)
st, j, _ = call("GET", f"/api/as/schools/{bh['schoolId']}", token=A); check("vendor delete: school assignment removed", not any(v.get("vendorId") == dx["vendorId"] for v in data((st, j, None))["vendors"]), j)
st, j, _ = call("POST", "/api/auth/login", {"loginId": "delvendor01", "password": "Delete!2026xy"}); check("vendor delete: engineer account disabled", st != 200, j)
st, j, _ = call("GET", "/api/as/contacts", token=E); check("vendor delete: 문의처 unchanged", data((st, j, None)) == ct_before, j)
st, j, _ = call("GET", f"/api/as/vendors/{dx['vendorId']}/usage", token=A); check("vendor delete: deleted vendor → 404", st == 404, j)
st, j, _ = call("DELETE", f"/api/as/vendors/{dx['vendorId']}", token=A); check("vendor delete: twice → 404", st == 404, j)
st, j, _ = call("PUT", f"/api/as/schools/{bh['schoolId']}/vendors", dx_map, token=A); check("vendor delete: school mapping restored", st == 200, j)

# ----- 지역(교육지원청) 관리: admin과 도교육청만 -----
for who, tok_ in (("admin", A), ("도교육청", E)):
    st, j, _ = call("POST", "/api/as/regions", {"regionName": f"시험지역{who}"}, token=tok_); rg = data((st, j, None)); check(f"regions: {who} can add", st == 200, j)
    st, j, _ = call("PUT", f"/api/as/regions/{rg['regionId']}", {"regionName": f"시험지역{who}2"}, token=tok_); check(f"regions: {who} can rename", st == 200 and data((st, j, None))["regionName"] == f"시험지역{who}2", j)
    for other, tok2 in (("교육지원청", R), ("학교", S), ("기사", N)):
        st, j, _ = call("PUT", f"/api/as/regions/{rg['regionId']}", {"regionName": "탈취"}, token=tok2); check(f"regions: {other} cannot rename → 403", st == 403, j)
        st, j, _ = call("DELETE", f"/api/as/regions/{rg['regionId']}", token=tok2); check(f"regions: {other} cannot delete → 403", st == 403, j)
    st, j, _ = call("DELETE", f"/api/as/regions/{rg['regionId']}", token=tok_); check(f"regions: {who} can delete", st == 200, j)
st, j, _ = call("DELETE", f"/api/as/regions/{mine['regionId']}", token=E); check("regions: region with schools cannot be deleted → 409", st == 409, j)
st, j, _ = call("POST", "/api/as/regions", {"regionName": "천안"}, token=E); check("regions: duplicate name → 409", st == 409, j)
st, j, _ = call("GET", "/api/as/regions/usage", token=E); us = data((st, j, None)); ucj = next(x for x in us if x["regionName"] == "천안")
check("regions: usage counts", st == 200 and ucj["schools"] >= 1 and ucj["users"] >= 1 and "contacts" not in ucj, ucj)
for other, tok2 in (("교육지원청", R), ("학교", S), ("기사", N)):
    st, j, _ = call("GET", "/api/as/regions/usage", token=tok2); check(f"regions: {other} cannot read usage → 403", st == 403, j)
    st, j, _ = call("PUT", "/api/as/regions/order", [x["regionId"] for x in us], token=tok2); check(f"regions: {other} cannot reorder → 403", st == 403, j)
st, j, _ = call("GET", "/api/auth/me", token=A); check("regions: admin has REGION_MANAGE", "REGION_MANAGE" in data((st, j, None))["permissions"], j)
st, j, _ = call("GET", "/api/auth/me", token=E); check("regions: 도교육청 has REGION_MANAGE", "REGION_MANAGE" in data((st, j, None))["permissions"], j)
st, j, _ = call("GET", "/api/auth/me", token=R); check("regions: 교육지원청 lacks REGION_MANAGE", "REGION_MANAGE" not in data((st, j, None))["permissions"], j)
order0 = [x["regionId"] for x in us]
st, j, _ = call("PUT", "/api/as/regions/order", order0[1:], token=E); check("regions: incomplete order → 400", st == 400, j)
st, j, _ = call("PUT", "/api/as/regions/order", list(reversed(order0)), token=E); check("regions: reorder", st == 200 and [x["regionId"] for x in data((st, j, None))] == list(reversed(order0)), j)
st, j, _ = call("GET", "/api/as/contacts", token=E); check("regions: 문의처 follows the order", [g["regionId"] for g in data((st, j, None)) if g.get("regionId")] == list(reversed(order0)), j)
st, j, _ = call("PUT", "/api/as/regions/order", order0, token=E); check("regions: order restored", st == 200, j)
st, j, _ = call("POST", "/api/as/regions", {"regionName": "삭제시험교육지원청"}, token=E); dr = data((st, j, None)); check("regions: new region goes last", st == 200 and dr["sortOrder"] == max(x.get("sortOrder") or 0 for x in us) + 1, j)
st, j, _ = call("POST", "/api/as/vendors", {"vendorName": "삭제시험업체", "serviceTypes": ["M"], "allRegions": False, "regions": [{"regionId": dr["regionId"]}, {"regionId": cj_id}]}, token=A); dv = data((st, j, None))
st, j, _ = call("PUT", f"/api/as/contacts/sections/{dr['regionId']}", [{"groupName": "유지보수 사업자", "itemName": "삭제시험문의처", "tel": "1"}], token=E)
st, j, _ = call("GET", "/api/as/regions/usage", token=E); ud = next(x for x in data((st, j, None)) if x["regionId"] == dr["regionId"]); check("regions: usage sees vendor", ud["vendors"] == 1 and ud["schools"] == 0, ud)
st, j, _ = call("GET", "/api/as/contacts", token=E); ct_keep = [g for g in data((st, j, None)) if g.get("regionId") != dr["regionId"]]
st, j, _ = call("DELETE", f"/api/as/regions/{dr['regionId']}", token=E); check("regions: region with 문의처 rows can be deleted", st == 200, j)
st, j, _ = call("GET", "/api/as/vendors", token=E); dv2 = next(v for v in data((st, j, None)) if v["vendorId"] == dv["vendorId"]); check("regions: vendor kept, region link removed", [r["regionId"] for r in dv2["regions"]] == [cj_id], dv2)
st, j, _ = call("GET", "/api/as/contacts", token=E); ct_after = data((st, j, None))
gone = next((g for g in ct_after if g.get("regionId") == dr["regionId"]), None)
check("regions: deleted region stays on 문의처, marked", gone is not None and gone["deleted"] is True and gone["groups"][0]["items"][0]["itemName"] == "삭제시험문의처", gone)
check("regions: other 문의처 untouched", [g for g in ct_after if g.get("regionId") != dr["regionId"]] == ct_keep, j)
st, j, _ = call("GET", "/api/as/regions", token=E); check("regions: deleted region not in the region list", not any(x["regionId"] == dr["regionId"] for x in data((st, j, None))), j)
st, j, _ = call("PUT", f"/api/as/regions/{dr['regionId']}", {"regionName": "수정시도"}, token=E); check("regions: deleted region cannot be renamed → 404", st == 404, j)
st, j, _ = call("DELETE", f"/api/as/regions/{dr['regionId']}", token=E); check("regions: deleted twice → 404", st == 404, j)
st, j, _ = call("POST", "/api/users", {"loginId": "delregion01", "userName": "x", "password": "Delete!2026xy", "roles": ["REGION_ADMIN"], "regionId": dr["regionId"]}, token=A); check("regions: deleted region cannot get a 담당자 → 400", st == 400, j)
st, j, _ = call("PUT", f"/api/as/contacts/sections/{dr['regionId']}", [{"groupName": "유지보수 사업자", "itemName": "삭제후수정", "tel": "2"}], token=R); check("regions: 교육지원청 cannot edit a deleted region → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/contacts/sections/{dr['regionId']}", [{"groupName": "유지보수 사업자", "itemName": "삭제후수정", "tel": "2"}], token=E); check("regions: 도교육청 can still edit it on 문의처", st == 200 and next(g for g in data((st, j, None)) if g.get("regionId") == dr["regionId"])["groups"][0]["items"][0]["itemName"] == "삭제후수정", j)
st, j, _ = call("POST", "/api/as/regions", {"regionName": "삭제시험교육지원청"}, token=E); check("regions: same name revives it", st == 200 and data((st, j, None))["regionId"] == dr["regionId"], j)
st, j, _ = call("GET", "/api/as/contacts", token=E); rv = next(g for g in data((st, j, None)) if g.get("regionId") == dr["regionId"]); check("regions: revived region keeps its 문의처", rv["deleted"] is False and rv["groups"][0]["items"][0]["itemName"] == "삭제후수정", rv)
st, j, _ = call("DELETE", f"/api/as/regions/{dr['regionId']}", token=E); check("regions: delete again", st == 200, j)
st, j, _ = call("PUT", f"/api/as/contacts/sections/{dr['regionId']}", [], token=E); check("regions: removed from 문의처", st == 200 and not any(g.get("regionId") == dr["regionId"] for g in data((st, j, None))), j)
st, j, _ = call("GET", "/api/as/regions/usage", token=E); check("regions: deleted region gone", not any(x["regionId"] == dr["regionId"] for x in data((st, j, None))), j)
call("DELETE", f"/api/as/vendors/{dv['vendorId']}", token=A)

# ---------- 역할 권한 관리 (/api/org/role-perms, V8) ----------
def perms_of(tok):
    return set(data(call("GET", "/api/auth/me", token=tok))["permissions"])
for who, tok in (("교육청", E), ("학교", S), ("기사", N)):
    st, j, _ = call("GET", "/api/org/role-perms", token=tok); check(f"role-perms: {who} → 403", st == 403, j)
st, j, _ = call("GET", "/api/org/role-perms", token=A); rp = data((st, j, None))
rp_roles = {r["role"]: r for r in rp["roles"]}
check("role-perms: six roles in order", st == 200 and [r["role"] for r in rp["roles"]] == ["SCHOOL_USER", "AS_ENGINEER", "VENDOR_ADMIN", "EDU_ADMIN", "REGION_ADMIN", "SYS_ADMIN"], j)
check("role-perms: starts at defaults", all(not r["granted"] and not r["denied"] for r in rp["roles"]), j)
check("role-perms: engineer's vendor-typed menus listed", "AS_M_REQUEST" in rp_roles["AS_ENGINEER"]["vendorTyped"] and "AS_C_VIEW" not in rp_roles["AS_ENGINEER"]["vendorTyped"], rp_roles["AS_ENGINEER"])
check("role-perms: user counts", rp_roles["SCHOOL_USER"]["userCount"] >= 2 and rp_roles["EDU_ADMIN"]["userCount"] >= 1, rp_roles)
check("role-perms: school limits explained", "SCHOOL_MANAGE" in rp_roles["SCHOOL_USER"]["limits"], rp_roles["SCHOOL_USER"]["limits"])
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"SUPER_ADMIN": {"granted": []}}}, token=A); check("role-perms: unmanaged role → 400", st == 400, j)
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"SCHOOL_USER": {"granted": ["USER_WRITE"]}}}, token=A); check("role-perms: non-adjustable perm → 400", st == 400, j)
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"SCHOOL_USER": {"granted": ["AS_STATS"], "denied": ["AS_STATS"]}}}, token=A); check("role-perms: on and off together → 400", st == 400, j)
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {}}, token=A); check("role-perms: empty → 400", st == 400, j)
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"SCHOOL_USER": {"granted": ["AS_STATS"]}}}, token=E); check("role-perms: 교육청 cannot save → 403", st == 403, j)

sch1 = data(call("GET", "/api/auth/me", token=S))["schoolId"]
st, j, _ = call("GET", f"/api/as/wireless-devices/places?schoolId={sch1}", token=S); check("role-perms: school has no 무선장비관리 by default → 403", st == 403, j)
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"SCHOOL_USER": {"granted": ["WDEVICE_MANAGE", "BOARD_NOTICE", "AS_DELETE"], "denied": ["BOARD_QNA", "AS_STATS"]}}}, token=A)
r1 = {r["role"]: r for r in data((st, j, None))["roles"]}["SCHOOL_USER"]
check("role-perms: saved, no-ops and action grants dropped", st == 200 and r1["granted"] == ["WDEVICE_MANAGE"] and r1["denied"] == ["BOARD_QNA"], r1)
p = perms_of(S); p2 = perms_of(S2)
check("role-perms: every school user gets the change", all("WDEVICE_MANAGE" in x and "BOARD_QNA" not in x and "AS_DELETE" not in x for x in (p, p2)), (p, p2))
st, j, _ = call("GET", f"/api/as/wireless-devices/places?schoolId={sch1}", token=S); check("role-perms: turned-on menu's API → 200", st == 200, j)
st, j, _ = call("GET", "/api/as/boards/QNA", token=S); check("role-perms: turned-off menu's API → 403", st == 403, j)
st, j, _ = call("GET", "/api/as/boards/QNA", token=R); check("role-perms: other roles untouched", st == 200, j)
s1id = uid("school01")
mp = data(call("GET", f"/api/users/{s1id}/menu-perms", token=A))
check("role-perms: user page base follows the role", "WDEVICE_MANAGE" in mp["base"] and "BOARD_QNA" not in mp["base"], mp["base"])
call("PUT", f"/api/users/{s1id}/menu-perms", {"granted": ["BOARD_QNA"]}, token=A)
check("role-perms: per-user override still applies on top", "BOARD_QNA" in perms_of(S) and "BOARD_QNA" not in perms_of(S2))
call("PUT", f"/api/users/{s1id}/menu-perms", {}, token=A)

pn = perms_of(N)
check("role-perms: engineer has vendor menus before", "AS_M_REQUEST" in pn and "AS_RECEIVE" in pn, pn)
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"AS_ENGINEER": {"granted": ["BOARD_NOTICE"], "denied": ["AS_M_REQUEST", "AS_RECEIVE"]}}}, token=A)
check("role-perms: engineer saved", st == 200, j)
pn = perms_of(N); pv = perms_of(V)
check("role-perms: engineer loses vendor menu and 접수, gets 공지", "AS_M_REQUEST" not in pn and "AS_M_VIEW" in pn and "AS_RECEIVE" not in pn and "BOARD_NOTICE" in pn, pn)
check("role-perms: 업체 관리자 (own role) unchanged", "AS_M_REQUEST" in pv and "AS_RECEIVE" in pv, pv)
check("role-perms: saving one role keeps the others", "WDEVICE_MANAGE" in perms_of(S))
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"SCHOOL_USER": {}, "AS_ENGINEER": {}}}, token=A)
check("role-perms: back to defaults", st == 200 and all(not r["granted"] and not r["denied"] for r in data((st, j, None))["roles"]), j)
pn = perms_of(N); p = perms_of(S)
check("role-perms: defaults restored", "AS_M_REQUEST" in pn and "AS_RECEIVE" in pn and "BOARD_NOTICE" not in pn and "BOARD_QNA" in p and "WDEVICE_MANAGE" not in p, (pn, p))

# ---------- 문의처 편집 권한 (CONTACT_EDIT) ----------
check("contact-edit: 교육청 · 교육지원청 · 관리자 have it", all("CONTACT_EDIT" in perms_of(x) for x in (E, R, A)))
check("contact-edit: 학교 · 기사 don't", all("CONTACT_EDIT" not in perms_of(x) for x in (S, N)))
r_me = data(call("GET", "/api/auth/me", token=R)); rid_c = r_me["regionId"]
cur = next(g for g in data(call("GET", "/api/as/contacts", token=R)) if g.get("regionId") == rid_c)
rows_c = [{"groupName": g["groupName"], **{k: it.get(k) for k in ("itemName", "tel", "note", "duties")}} for g in cur["groups"] for it in g["items"]]
st, j, _ = call("PUT", f"/api/as/contacts/sections/{rid_c}", rows_c, token=R); check("contact-edit: 교육지원청 edits own section", st == 200, j)
st, j, _ = call("PUT", "/api/as/contacts", [], token=R); check("contact-edit: 교육지원청 cannot replace all → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/contacts/sections/{rid_c}", rows_c, token=S); check("contact-edit: 학교 → 403", st == 403, j)
mp = data(call("GET", f"/api/users/{uid('regionadmin')}/menu-perms", token=A))
check("contact-edit: listed on 사용자 메뉴 권한", mp.get("editPerms") == ["CONTACT_EDIT"] and "CONTACT_EDIT" in mp["base"], mp)
st, j, _ = call("PUT", f"/api/users/{uid('regionadmin')}/menu-perms", {"denied": ["CONTACT_EDIT"]}, token=A); check("contact-edit: turned off for one user", st == 200 and data((st, j, None))["denied"] == ["CONTACT_EDIT"], j)
st, j, _ = call("PUT", f"/api/as/contacts/sections/{rid_c}", rows_c, token=R); check("contact-edit: off → 403", st == 403, j)
st, j, _ = call("GET", "/api/as/contacts", token=R); check("contact-edit: off still reads 문의처", st == 200, j)
call("PUT", f"/api/users/{uid('regionadmin')}/menu-perms", {}, token=A)
st, j, _ = call("PUT", f"/api/as/contacts/sections/{rid_c}", rows_c, token=R); check("contact-edit: back on", st == 200, j)
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"EDU_ADMIN": {"denied": ["CONTACT_EDIT"]}, "SCHOOL_USER": {"granted": ["CONTACT_EDIT"]}}}, token=A)
r_e = {r["role"]: r for r in data((st, j, None))["roles"]}
check("contact-edit: role page turns it off, cannot grant", st == 200 and r_e["EDU_ADMIN"]["denied"] == ["CONTACT_EDIT"] and not r_e["SCHOOL_USER"]["granted"], j)
st, j, _ = call("PUT", "/api/as/contacts/sections/province", [], token=E); check("contact-edit: 교육청 role off → 403", st == 403, j)
call("PUT", "/api/org/role-perms", {"roles": {"EDU_ADMIN": {}, "SCHOOL_USER": {}}}, token=A)
check("contact-edit: 교육청 role restored", "CONTACT_EDIT" in perms_of(E))

# ---------- 교육지원청 담당자는 관할 지역만 (regionadmin = 천안, 관외 = 솔빛고등학교 6 · 보령 3) ----------
_sl = data(call("GET", "/api/as/schools?size=500", token=E))
out_s = next(x for x in (_sl.get("content", _sl) if isinstance(_sl, dict) else _sl) if x["schoolName"] == "솔빛고등학교")
OS, OR = out_s["schoolId"], out_s["regionId"]
ob = data(call("POST", "/api/as/spaces/buildings", {"schoolId": OS, "buildingName": "관외본관", "floorCount": 1}, token=E))
ofl = ob["floors"][0]
owd = data(call("POST", "/api/as/wireless-devices", {"schoolId": OS, "deviceCode": "AP-OUT-001", "deviceName": "관외 AP"}, token=E))
osd = data(call("POST", "/api/as/schoolnet-devices", {"schoolId": OS, "deviceName": "관외 라우터", "deviceType": "ROUTER"}, token=E))
ocat = [c for c in data(call("GET", "/api/assets/categories", token=E)) if not c.get("children")][-1]
oa = data(call("POST", "/api/assets", {"assetType": "HW", "categoryId": ocat["categoryId"], "assetName": "관외 PC", "schoolId": OS, "acquiredAt": "2020-03-01"}, token=E))
oa = oa if isinstance(oa, dict) else data(call("GET", f"/api/assets/{oa}", token=E))
ov = data(call("POST", "/api/as/vendors", {"vendorName": "관외전용업체", "serviceTypes": ["M"], "allRegions": False, "regions": [{"regionId": OR}]}, token=E))
call("POST", "/api/users", {"loginId": "outschool1", "userName": "관외담당", "password": "Outside!2026xy", "roles": ["SCHOOL_USER"], "schoolId": OS}, token=E)
OSU = login("outschool1", "Outside!2026xy")
op = data(call("POST", "/api/as/boards/CONSULT", {"title": "관외 컨설팅 신청", "content": "본문"}, token=OSU))
J = lambda x: json.dumps(x, ensure_ascii=False, default=str)
# 이미 막혀 있던 것 (회귀 방지)
for label, path in (("school", f"/api/as/schools/{OS}"), ("wireless list", f"/api/as/wireless-devices?schoolId={OS}"),
                    ("wireless history", f"/api/as/wireless-devices/{owd['deviceId']}/history"), ("schoolnet list", f"/api/as/schoolnet-devices?schoolId={OS}"),
                    ("spaces", f"/api/as/spaces/buildings?schoolId={OS}"), ("floor", f"/api/places/floors/{ofl['floorId']}"),
                    ("asset", f"/api/assets/{oa['assetId']}"), ("inventory", f"/api/as/inventory?schoolId={OS}"), ("providers", f"/api/as/contacts/providers?schoolId={OS}")):
    st, j, _ = call("GET", path, token=R); check(f"region scope: {label} of another district → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/wireless-devices/{owd['deviceId']}", {"deviceName": "x"}, token=R); check("region scope: edit another district's device → 403", st == 403, j)
st, j, _ = call("POST", "/api/as/wireless-devices", {"schoolId": OS, "deviceCode": "AP-OUT-009", "deviceName": "x"}, token=R); check("region scope: register device in another district → 403", st == 403, j)
st, j, _ = call("POST", "/api/as/schools", {"schoolName": "관외신설학교", "regionId": OR, "schoolType": "ELEM"}, token=R); check("region scope: create school in another district → 403", st == 403, j)
st2, j2, _ = call("GET", f"/api/as/stats/monthly?regionId={OR}", token=R)
check("region scope: no stats at all for 교육지원청 → 403", st2 == 403, j2)
# 이번에 막은 것
st, j, _ = call("GET", "/api/places/buildings", token=R); check("region scope: legacy building list hides other districts", st == 200 and "관외본관" not in J(j), j)
st, j, _ = call("GET", "/api/places/buildings", token=E); check("region scope: 도교육청 still sees every building", "관외본관" in J(j), j)
st, j, _ = call("POST", "/api/places/floors", {"buildingId": ob["buildingId"], "floorNo": 9}, token=R); check("region scope: legacy floor in another district → 403", st == 403, j)
st, j, _ = call("POST", "/api/places/buildings", {"buildingName": "공용건물"}, token=R); check("region scope: legacy org-wide building → 403", st == 403, j)
st, j, _ = call("GET", f"/api/assets/by-no/{oa['assetNo']}", token=R); d = data((st, j, None))
check("region scope: asset label of another district → OUT_OF_SCOPE, no name", st == 200 and d["state"] == "OUT_OF_SCOPE" and "assetName" not in d and "assetId" not in d, d)
st, j, _ = call("POST", "/api/qr/resolve", {"text": oa["assetNo"]}, token=S); check("region scope: school scanning another school's label → OUT_OF_SCOPE", data((st, j, None))["state"] == "OUT_OF_SCOPE", j)
st, j, _ = call("GET", f"/api/assets/by-no/{oa['assetNo']}", token=E); check("region scope: 도교육청 resolves it", data((st, j, None))["state"] == "REGISTERED", j)
st, j, _ = call("POST", "/api/qr/labels", {"assetIds": [oa["assetId"]]}, token=R); check("region scope: labels for another district's asset → 400", st == 400, j)
st, j, _ = call("GET", "/api/as/vendors", token=R); check("region scope: 업체 list hides other districts' 업체", st == 200 and "관외전용업체" not in J(j) and len(data((st, j, None))) >= 1, j)
st, j, _ = call("GET", f"/api/as/vendors?regionId={OR}", token=R); check("region scope: asking for another district's 업체 → empty", st == 200 and data((st, j, None)) == [], j)
st, j, _ = call("GET", f"/api/as/vendors/{ov['vendorId']}/engineers", token=R); check("region scope: engineers of another district's 업체 → 403", st == 403, j)
st, j, _ = call("GET", "/api/as/vendors/1/engineers", token=R); check("region scope: engineers of an all-region 업체 → 200", st == 200, j)
st, j, _ = call("GET", "/api/as/vendors", token=E); check("region scope: 도교육청 sees every 업체", "관외전용업체" in J(j), j)
st, j, _ = call("GET", "/api/as/boards/CONSULT?size=100", token=R); check("region scope: 컨설팅 신청 hides other districts", st == 200 and "관외 컨설팅 신청" not in J(j), j)
st, j, _ = call("GET", f"/api/as/boards/CONSULT/{op['postId']}", token=R); check("region scope: another district's 컨설팅 post → 404", st == 404, j)
st, j, _ = call("GET", "/api/as/boards/CONSULT?size=100", token=E); check("region scope: 도교육청 sees every 컨설팅 post", "관외 컨설팅 신청" in J(j), j)
st, j, _ = call("GET", f"/api/as/boards/CONSULT/{op['postId']}", token=OSU); check("region scope: the writer still sees own post", st == 200, j)
call("DELETE", f"/api/as/boards/CONSULT/{op['postId']}", token=E)
call("DELETE", f"/api/as/vendors/{ov['vendorId']}", token=A)
call("DELETE", f"/api/as/wireless-devices/{owd['deviceId']}", token=E); call("DELETE", f"/api/as/schoolnet-devices/{osd['deviceId']}", token=E)

# ---------- 학교 담당자에게 통합관리(장애접수관리 · AS통계관리)를 줘도 자기 학교만, 계약 · 예산은 안 보인다 ----------
s2u = uid("school02")
st, j, _ = call("PUT", f"/api/users/{s2u}/menu-perms", {"granted": ["AS_MANAGE", "AS_STATS"]}, token=A); check("school+통합관리: AS통계관리 refused → 400", st == 400, j)
st, j, _ = call("PUT", f"/api/users/{s2u}/menu-perms", {"granted": ["AS_MANAGE"]}, token=A); check("school+통합관리: 장애접수관리 granted", st == 200, j)
lim = data(call("GET", f"/api/users/{s2u}/menu-perms", token=A))["limits"]
check("school+통합관리: limits explained", "AS_MANAGE" in lim and "AS_STATS" not in lim, lim)
s2school = data(call("GET", "/api/auth/me", token=S2))["schoolId"]
st, rows = all_rows("/api/as/requests?size=500", S2)
check("school+AS_MANAGE: AS list = own school only", st == 200 and rows and all(x["schoolId"] == s2school for x in rows), st)
st, rows_all = all_rows("/api/as/requests?size=500", E)
other_req = next(x for x in rows_all if x["schoolId"] != s2school and x["status"] != "C")
st, j, _ = call("GET", f"/api/as/requests/{other_req['asvcSn']}", token=S2); check("school+AS_MANAGE: other school's AS → 404", st == 404, j)
own_req = rows[0]
acts = data(call("GET", f"/api/as/requests/{own_req['asvcSn']}", token=S2))["allowedActions"]
check("school+AS_MANAGE: no 배정 · 삭제 · 접수 buttons", not ({"assign", "delete", "receive", "return", "transfer"} & set(acts)), acts)
st, j, _ = call("DELETE", f"/api/as/requests/{own_req['asvcSn']}", token=S2); check("school+AS_MANAGE: delete → refused", st in (403, 409), j)
se = data(call("GET", "/api/as/stats/monthly", token=E))
check("stats: 도교육청 sees contract cost", se["total"]["contractCost"] > 0 and se.get("budget") is not None, se["total"])
st, j, _ = call("GET", "/api/as/stats/monthly", token=S2); check("stats: school with 장애접수관리 still has no 통계 → 403", st == 403, j)
st, j, _ = call("GET", "/api/as/stats/monthly", token=V); check("stats: 업체 관리자 keeps 통계", st == 200, j)

# AS통계관리는 학교 · 교육지원청에 줄 수 없다 — 역할 권한 관리 · 예전 조정
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"REGION_ADMIN": {"granted": ["AS_STATS"]}}}, token=A); check("stats block: role page refuses 교육지원청 → 400", st == 400 and "AS통계관리" in (msg((st, j, None)) or ""), j)
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"SCHOOL_USER": {"granted": ["AS_STATS"]}}}, token=A); check("stats block: role page refuses 학교 → 400", st == 400, j)
rr = {r["role"]: r for r in data(call("GET", "/api/org/role-perms", token=A))["roles"]}
check("stats block: role page marks it blocked", rr["SCHOOL_USER"]["blocked"] == ["AS_STATS"] and rr["REGION_ADMIN"]["blocked"] == ["AS_STATS"] and not rr["EDU_ADMIN"]["blocked"], rr)
check("stats block: 교육지원청 default no longer has it", "AS_STATS" not in rr["REGION_ADMIN"]["defaults"], rr["REGION_ADMIN"]["defaults"])
st, j, _ = call("GET", "/api/as/stats/monthly", token=R); check("stats block: 교육지원청 → 403", st == 403, j)
call("PUT", f"/api/users/{s2u}/menu-perms", {}, token=A)

# ---------- 사용자 일괄 등록 (/api/users/bulk) ----------
import zipfile
from xml.sax.saxutils import escape as _x
def make_xlsx(rows):
    """Smallest valid .xlsx (inline strings) — no openpyxl needed."""
    def col(i):
        s = ""
        i += 1
        while i:
            i, r = divmod(i - 1, 26); s = chr(65 + r) + s
        return s
    sheet = "".join(f'<row r="{ri+1}">' + "".join(f'<c r="{col(ci)}{ri+1}" t="inlineStr"><is><t xml:space="preserve">{_x(str(v))}</t></is></c>' for ci, v in enumerate(r) if v != "") + "</row>" for ri, r in enumerate(rows))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="users" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet1.xml", f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{sheet}</sheetData></worksheet>')
    return buf.getvalue()
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
def up(path, rows, tok, extra=""):
    return call("POST", path + extra, files=[("file", ("users.xlsx", make_xlsx(rows), XLSX))], token=tok)
UH = ["아이디", "이름", "회원유형", "소속", "직위", "휴대폰", "이메일", "초기 비밀번호"]
for who, tok in (("교육지원청", R), ("학교", S)):
    st, j, _ = call("GET", "/api/users/bulk/template", token=tok, raw=True); check(f"user bulk: {who} cannot get template → 403", st == 403, j)
st, tpl, h = call("GET", "/api/users/bulk/template", token=E, raw=True)
check("user bulk: template xlsx", st == 200 and tpl[:2] == b"PK" and "filename*=UTF-8''" in h.get("Content-Disposition", ""), st)
st, j, _ = call("POST", "/api/users/bulk/validate", files=[("file", ("양식.xlsx", tpl, XLSX))], token=E); tv = data((st, j, None))
check("user bulk: template sample rows validate", st == 200 and tv["total"] == 2 and tv["ok"] == 2, j)
st, j, _ = up("/api/users/bulk/validate", [["아이디", "이름"], ["x"]], E); check("user bulk: wrong header → 400", st == 400 and "양식" in msg((st, j, None)), j)
st, j, _ = up("/api/users/bulk/validate", [UH, ["bk_s1", "일괄학교", "학교 담당자", "봉황초등학교", "", "", "", ""]], R); check("user bulk: 교육지원청 cannot validate → 403", st == 403, j)
rows = [UH,
        ["bk_s1", "일괄학교", "학교 담당자", "봉황 초등학교", "정보부장", "1012345678", "bk1@example.go.kr", ""],
        ["bk_e1", "일괄기사", "기사", "한빛네트웍스", "", "", "", "Bulk!Pass2026"],
        ["bk_r1", "일괄지원청", "교육지원청 담당자", "천안교육지원청", "", "", "", ""],
        ["bk_d1", "일괄교육청", "교육청 관리자", "아무곳", "", "", "", ""],
        ["school01", "중복", "학교 담당자", "봉황초등학교", "", "", "", ""],
        ["bk_s1", "파일중복", "학교 담당자", "봉황초등학교", "", "", "", ""],
        ["bk_x1", "", "시스템 관리자", "", "", "02-12", "nope", "short"],
        ["bk_x2", "학교없음", "학교 담당자", "없는학교", "", "", "", ""],
        ["bk_x3", "약한비번", "AS 기사", "한빛네트웍스", "", "", "", "bk_x3Pass!!"],
        ["=cmd", "수식", "학교 담당자", "봉황초등학교", "", "", "", ""]]
st, j, _ = up("/api/users/bulk/validate", rows, E); uv = data((st, j, None)); byrow = {r["rowNo"]: r for r in uv["rows"]} if st == 200 else {}
check("user bulk: 4 ok, 6 errors", st == 200 and uv["ok"] == 4 and uv["error"] == 6, uv)
check("user bulk: passwords never echoed", st == 200 and all(r["cells"][7] in ("(자동 생성)", "●●●●●●") for r in uv["rows"]) and "Bulk!Pass2026" not in json.dumps(j, ensure_ascii=False), j)
check("user bulk: 교육청 관리자 소속 ignored with warning", byrow.get(5, {}).get("ok") and byrow[5]["warning"], byrow.get(5))
check("user bulk: existing id rejected", byrow.get(6) and not byrow[6]["ok"] and any("사용 중" in e for e in byrow[6]["errors"]), byrow.get(6))
check("user bulk: duplicate in file rejected", byrow.get(7) and not byrow[7]["ok"] and any("2행" in e for e in byrow[7]["errors"]), byrow.get(7))
check("user bulk: name/type/phone/email errors", byrow.get(8) and not byrow[8]["ok"] and len(byrow[8]["errors"]) >= 4, byrow.get(8))
check("user bulk: unknown school", byrow.get(9) and not byrow[9]["ok"] and any("없는학교" in e for e in byrow[9]["errors"]), byrow.get(9))
check("user bulk: password policy from the user form", byrow.get(10) and not byrow[10]["ok"] and any("아이디" in e for e in byrow[10]["errors"]), byrow.get(10))
check("user bulk: formula rejected", byrow.get(11) and not byrow[11]["ok"], byrow.get(11))
st, j, _ = up("/api/users/bulk/commit", rows, E); check("user bulk: commit with errors, no skip → 400", st == 400, j)
st, j, _ = call("GET", "/api/users?keyword=bk_", token=E); check("user bulk: nothing created by refused commit", not data((st, j, None))["content"], j)
st, j, _ = up("/api/users/bulk/commit", rows, E, "?skipErrors=true"); uc = data((st, j, None)); cu = {u["loginId"]: u for u in uc["users"]} if st == 200 else {}
check("user bulk: 4 created, 6 skipped", st == 200 and uc["created"] == 4 and uc["skipped"] == 6, j)
if st == 200:
    check("user bulk: temp passwords only for blank rows", cu["bk_s1"]["tempPassword"] and cu["bk_e1"].get("tempPassword") is None and cu["bk_r1"]["tempPassword"], cu)
    tp = cu["bk_s1"]["tempPassword"]
    check("user bulk: temp password follows policy", 9 <= len(tp) <= 20 and tp[0].isalpha() and any(c.isdigit() for c in tp) and any(not c.isalnum() for c in tp), tp)
    BK = login("bk_s1", tp); me_bk = data(call("GET", "/api/auth/me", token=BK))
    check("user bulk: school user logs in with temp password, right school", me_bk["roles"] == ["SCHOOL_USER"] and me_bk["schoolName"] == "봉황초등학교", me_bk)
    BE = login("bk_e1", "Bulk!Pass2026"); me_be = data(call("GET", "/api/auth/me", token=BE)); check("user bulk: engineer logs in with given password", me_be["roles"] == ["AS_ENGINEER"], me_be)
    ul = {u["loginId"]: u for u in data(call("GET", "/api/users?keyword=bk_", token=E))["content"]}
    check("user bulk: mobile normalised, region set, 교육청 has no 소속", ul["bk_s1"]["mobile"] == "010-1234-5678" and ul["bk_r1"].get("regionId") and ul["bk_d1"].get("schoolId") is None and ul["bk_d1"]["roles"] == ["EDU_ADMIN"], ul)
    for u in ul.values(): call("DELETE", f"/api/users/{u['userId']}", token=E)

# ---------- 학교 담당자에게 장비관리: 자기 학교 장비만 · 처리 중인 AS가 있는 장비는 삭제 불가 ----------
s1u = uid("school01")
st, j, _ = call("PUT", f"/api/users/{s1u}/menu-perms", {"granted": ["WDEVICE_MANAGE", "SDEVICE_MANAGE"]}, token=A); check("school+장비관리: granted", st == 200, j)
lim = data(call("GET", f"/api/users/{s1u}/menu-perms", token=A))["limits"]
check("school+장비관리: limits explained", "WDEVICE_MANAGE" in lim and "SDEVICE_MANAGE" in lim, lim)
rl = {r["role"]: r for r in data(call("GET", "/api/org/role-perms", token=A))["roles"]}
check("role page: 학교 column explains 장비관리 limit", "WDEVICE_MANAGE" in rl["SCHOOL_USER"]["limits"], rl["SCHOOL_USER"]["limits"])
s1school = data(call("GET", "/api/auth/me", token=S))["schoolId"]
other_school = next(x for x in (lambda d: d.get("content", d) if isinstance(d, dict) else d)(data(call("GET", "/api/as/schools?size=500", token=E))) if x["schoolId"] != s1school)
st, j, _ = call("POST", "/api/as/wireless-devices", {"schoolId": s1school, "deviceCode": "AP-SCH-901", "deviceName": "학교 등록 AP"}, token=S); sd = data((st, j, None))
check("school+WDEVICE_MANAGE: register in own school", st == 200 and sd["schoolId"] == s1school, j)
st, j, _ = call("POST", "/api/as/wireless-devices", {"schoolId": other_school["schoolId"], "deviceCode": "AP-SCH-902", "deviceName": "x"}, token=S); check("school+WDEVICE_MANAGE: other school → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/wireless-devices/{sd['deviceId']}", {"schoolId": other_school["schoolId"]}, token=S); check("school+WDEVICE_MANAGE: move to other school → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/wireless-devices/{sd['deviceId']}", {"deviceName": "학교 등록 AP(수정)"}, token=S); check("school+WDEVICE_MANAGE: edit own", st == 200, j)
st, j, _ = call("POST", "/api/as/requests", {"rceptTy": "M", "faultTypeCode": "P", "requestTypeCode": "2", "symptom": "삭제 막기 시험", "installPlace": "본관",
                                              "deviceId": sd["deviceId"], "visitRequestAt": "2026-12-01T10:00", "contactTel": "010-2000-0001"}, token=S); dr_ = data((st, j, None)) or {}
check("device delete guard: AS on the device", st == 200, j)
st, j, _ = call("DELETE", f"/api/as/wireless-devices/{sd['deviceId']}", token=S); check("device delete guard: school blocked while AS open → 409", st == 409 and f"#{dr_.get('asvcSn')}" in (msg((st, j, None)) or ""), j)
st, j, _ = call("DELETE", f"/api/as/wireless-devices/{sd['deviceId']}", token=E); check("device delete guard: 교육청 blocked too → 409", st == 409, j)
call("POST", f"/api/as/requests/{dr_.get('asvcSn')}/cancel", {}, token=S)
st, j, _ = call("DELETE", f"/api/as/wireless-devices/{sd['deviceId']}", token=S); check("device delete guard: after cancel, school deletes own", st == 200, j)
st, j, _ = call("POST", "/api/as/schoolnet-devices", {"schoolId": s1school, "deviceName": "학교 라우터", "deviceType": "ROUTER"}, token=S); sn_ = data((st, j, None))
check("school+SDEVICE_MANAGE: register schoolnet device", st == 200, j)
st, j, _ = call("DELETE", f"/api/as/schoolnet-devices/{sn_['deviceId']}", token=S); check("school+SDEVICE_MANAGE: delete (no open AS)", st == 200, j)
call("PUT", f"/api/users/{s1u}/menu-perms", {}, token=A)
st, j, _ = call("POST", "/api/as/wireless-devices", {"schoolId": s1school, "deviceCode": "AP-SCH-903", "deviceName": "x"}, token=S); check("school: without 장비관리 → 403 again", st == 403, j)

# ---------- 메뉴 안의 기능 권한 (Roles.FEATURES) · 업체 배정 (AS_ASSIGN) ----------
rpd = data(call("GET", "/api/org/role-perms", token=A))
fcodes = {f["code"]: f["parent"] for f in rpd.get("features", [])}
check("features: listed with parent menu", fcodes.get("WDEVICE_CREATE") == "WDEVICE_MANAGE" and fcodes.get("USER_BULK") == "USER_WRITE" and len(fcodes) >= 20, rpd.get("features"))
check("features: 업체 배정 is an AS 처리 기능", "AS_ASSIGN" in rpd["actionPerms"], rpd["actionPerms"])
rrd = {r["role"]: r for r in rpd["roles"]}
check("features: 교육청 · 교육지원청 · 관리자 have 업체 배정, 학교 doesn't", all("AS_ASSIGN" in rrd[x]["defaults"] for x in ("EDU_ADMIN", "REGION_ADMIN", "SYS_ADMIN")) and "AS_ASSIGN" not in rrd["SCHOOL_USER"]["defaults"], rrd)
pe = perms_of(E); pr = perms_of(R); ps = perms_of(S)
check("features: follow the menu (교육청 has device · user features)", {"WDEVICE_CREATE", "WDEVICE_DELETE", "SDEVICE_LABEL", "USER_BULK", "SCHOOL_VENDOR"} <= pe, pe)
check("features: no menu → no feature (학교 has no device features)", not ({"WDEVICE_CREATE", "WDEVICE_EDIT"} & ps) and {"SPACE_BUILDING_CREATE", "SPACE_BUILDING_DELETE", "SPACE_FLOOR_CREATE", "SPACE_FLOOR_DELETE"} <= ps and "SPACE_BUILDING" not in ps, ps)

# 역할에서 기능 끄기: 교육지원청의 무선장비 등록 · 삭제 · 담당업체 지정
rsch = (lambda d: d.get("content", d) if isinstance(d, dict) else d)(data(call("GET", "/api/as/schools?size=500", token=R)))
rsid = rsch[0]["schoolId"]
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"REGION_ADMIN": {"denied": ["WDEVICE_CREATE", "WDEVICE_DELETE", "SCHOOL_VENDOR"]}, "SCHOOL_USER": {"granted": ["WDEVICE_CREATE"]}}}, token=A)
rr2 = {r["role"]: r for r in data((st, j, None))["roles"]} if st == 200 else {}
check("features: role page saves feature off, ignores feature on", st == 200 and set(rr2["REGION_ADMIN"]["denied"]) == {"WDEVICE_CREATE", "WDEVICE_DELETE", "SCHOOL_VENDOR"} and not rr2["SCHOOL_USER"]["granted"], j)
pr2 = perms_of(R)
check("features: 교육지원청 loses only those", "WDEVICE_MANAGE" in pr2 and "WDEVICE_EDIT" in pr2 and not ({"WDEVICE_CREATE", "WDEVICE_DELETE", "SCHOOL_VENDOR"} & pr2), pr2)
check("features: school still has none (grant ignored)", "WDEVICE_CREATE" not in perms_of(S))
st, j, _ = call("POST", "/api/as/wireless-devices", {"schoolId": rsid, "deviceCode": "AP-FT-001", "deviceName": "기능시험 AP"}, token=R); check("features: 등록 off → 403", st == 403, j)
rdev = data(call("POST", "/api/as/wireless-devices", {"schoolId": rsid, "deviceCode": "AP-FT-002", "deviceName": "기능시험 AP"}, token=E))
st, j, _ = call("PUT", f"/api/as/wireless-devices/{rdev['deviceId']}", {"deviceName": "기능시험 AP(수정)"}, token=R); check("features: 수정 still on → 200", st == 200, j)
st, j, _ = call("DELETE", f"/api/as/wireless-devices/{rdev['deviceId']}", token=R); check("features: 삭제 off → 403", st == 403, j)
st, j, _ = call("PUT", f"/api/as/schools/{rsid}/vendors", [], token=R); check("features: 담당업체 지정 off → 403", st == 403, j)
st, j, _ = call("GET", "/api/org/role-perms", token=A)
check("features: role page shows the adjustment count", len({r["role"]: r for r in data((st, j, None))["roles"]}["REGION_ADMIN"]["denied"]) == 3, j)
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"REGION_ADMIN": {"denied": ["WDEVICE_MANAGE"]}}}, token=A)
check("features: menu off → its features go too", not ({"WDEVICE_MANAGE", "WDEVICE_EDIT", "WDEVICE_PLACE"} & perms_of(R)))
call("PUT", "/api/org/role-perms", {"roles": {"REGION_ADMIN": {}, "SCHOOL_USER": {}}}, token=A)
check("features: 교육지원청 restored", {"WDEVICE_CREATE", "WDEVICE_DELETE", "SCHOOL_VENDOR"} <= perms_of(R))
st, j, _ = call("DELETE", f"/api/as/wireless-devices/{rdev['deviceId']}", token=R); check("features: 삭제 back on → 200", st == 200, j)

# 사용자별로 기능 끄기: 교육청 관리자의 일괄 등록 · 잠금 해제
eu = uid("eduadmin")
st, j, _ = call("PUT", f"/api/users/{eu}/menu-perms", {"denied": ["USER_BULK", "USER_UNLOCK"], "granted": ["USER_CREATE"]}, token=A); em = data((st, j, None))
check("features: user page saves feature off, ignores feature on", st == 200 and set(em["denied"]) == {"USER_BULK", "USER_UNLOCK"} and not em["granted"] and "USER_BULK" in em["base"], j)
st, j, _ = call("GET", "/api/users/bulk/template", token=E, raw=True); check("features: 일괄 등록 off → 403", st == 403, j)
st, j, _ = call("POST", f"/api/users/{uid('school02')}/unlock", {}, token=E); check("features: 잠금 해제 off → 403", st == 403, j)
st, j, _ = call("GET", "/api/users?size=5", token=E); check("features: user list still works", st == 200, j)
call("PUT", f"/api/users/{eu}/menu-perms", {}, token=A)
st, j, _ = call("GET", "/api/users/bulk/template", token=E, raw=True); check("features: 일괄 등록 back → 200", st == 200, j)

# 사용자에게 메뉴를 켜 준 경우에도 그 메뉴의 기능은 따로 끌 수 있다
s1u_ = uid("school01")
st, j, _ = call("PUT", f"/api/users/{s1u_}/menu-perms", {"granted": ["WDEVICE_MANAGE"], "denied": ["WDEVICE_DELETE"]}, token=A); sm_ = data((st, j, None))
psx = perms_of(S)
check("features: granted menu brings features, minus the one turned off", st == 200 and "WDEVICE_CREATE" in psx and "WDEVICE_DELETE" not in psx and sm_["denied"] == ["WDEVICE_DELETE"], (psx, j))
call("PUT", f"/api/users/{s1u_}/menu-perms", {}, token=A)

# 업체 배정 끄기 (교육청 역할)
st, rows_e = all_rows("/api/as/requests?size=500", E)
open_req = next(x for x in rows_e if x["status"] in ("A", "R"))
acts_e = data(call("GET", f"/api/as/requests/{open_req['asvcSn']}", token=E))["allowedActions"]
check("features: 교육청 sees 배정 button", "assign" in acts_e, acts_e)
call("PUT", "/api/org/role-perms", {"roles": {"EDU_ADMIN": {"denied": ["AS_ASSIGN"]}}}, token=A)
acts_e2 = data(call("GET", f"/api/as/requests/{open_req['asvcSn']}", token=E))["allowedActions"]
st, j, _ = call("POST", f"/api/as/requests/{open_req['asvcSn']}/assign", {"vendorId": 1}, token=E)
check("features: 업체 배정 off → no button, action refused", "assign" not in acts_e2 and st in (403, 409), (acts_e2, j))
call("PUT", "/api/org/role-perms", {"roles": {"EDU_ADMIN": {}}}, token=A)
check("features: 업체 배정 restored", "assign" in data(call("GET", f"/api/as/requests/{open_req['asvcSn']}", token=E))["allowedActions"])

# ---------- 장애접수관리 기능: 엑셀 다운로드 · 방문일 변경 · 처리 보고서 · 업체 배정 ----------
pe = perms_of(E); pn = perms_of(N); pr = perms_of(R); ps = perms_of(S)
check("as-manage: 교육청 has excel · visit · report · assign", {"AS_EXCEL", "AS_VISIT", "AS_REPORT", "AS_ASSIGN"} <= pe, pe)
check("as-manage: 기사 has visit · report, no excel", {"AS_VISIT", "AS_REPORT"} <= pn and "AS_EXCEL" not in pn, pn)
check("as-manage: 교육지원청 has excel · assign, no visit · report", {"AS_EXCEL", "AS_ASSIGN"} <= pr and not ({"AS_VISIT", "AS_REPORT"} & pr), pr)
check("as-manage: 학교 has none of them", not ({"AS_EXCEL", "AS_VISIT", "AS_REPORT", "AS_ASSIGN"} & ps), ps)
st, j, _ = call("GET", "/api/as/requests/excel", token=E, raw=True); check("as-manage: 교육청 excel → 200", st == 200, st)
call("PUT", "/api/org/role-perms", {"roles": {"EDU_ADMIN": {"denied": ["AS_EXCEL"]}}}, token=A)
st, j, _ = call("GET", "/api/as/requests/excel", token=E, raw=True); check("as-manage: 엑셀 다운로드 off → 403", st == 403, st)
st, j, _ = call("GET", "/api/as/requests?size=5", token=E); check("as-manage: list still works", st == 200, j)
st, j, _ = call("GET", "/api/as/requests/excel", token=S, raw=True); check("as-manage: school (결과조회) excel unaffected → 200", st == 200, st)
call("PUT", "/api/org/role-perms", {"roles": {"EDU_ADMIN": {}}}, token=A)

# 처리 보고서 끄기 (기사 역할)
st, rows_n = all_rows("/api/as/requests?size=500", N)
recv = next((x for x in rows_n if x["status"] == "R"), None)
if recv is None:
    a_ = next(x for x in rows_n if x["status"] == "A")
    call("POST", f"/api/as/requests/{a_['asvcSn']}/receive", {"visitPlannedAt": "2026-12-02T10:00"}, token=N)
    recv = a_
acts_n = data(call("GET", f"/api/as/requests/{recv['asvcSn']}", token=N))["allowedActions"]
check("as-manage: 기사 sees 방문일 변경 · 처리 보고서", {"visit", "report"} <= set(acts_n), acts_n)
call("PUT", "/api/org/role-perms", {"roles": {"AS_ENGINEER": {"denied": ["AS_REPORT"]}}}, token=A)
acts_n2 = data(call("GET", f"/api/as/requests/{recv['asvcSn']}", token=N))["allowedActions"]
st, j, _ = call("POST", f"/api/as/requests/{recv['asvcSn']}/report", {"processContent": "보고서 끔 시험"}, token=N)
check("as-manage: 처리 보고서 off → no button, refused", "report" not in acts_n2 and "visit" in acts_n2 and st == 409, (acts_n2, j))
check("as-manage: 업체 관리자 (own role) keeps 처리 보고서", "AS_REPORT" in perms_of(V))
call("PUT", "/api/org/role-perms", {"roles": {"AS_ENGINEER": {}}}, token=A)

# 업체 배정
st, rows_e = all_rows("/api/as/requests?size=500", E)
tgt = next(x for x in rows_e if x["status"] in ("A", "R") and x["rceptTy"] in ("M", "S"))
vlist = data(call("GET", f"/api/as/vendors?rceptTy={tgt['rceptTy']}", token=E))
v0 = vlist[0]; engs = data(call("GET", f"/api/as/vendors/{v0['vendorId']}/engineers", token=E))
body = {"vendorId": v0["vendorId"], "engineerUserId": engs[0]["userId"] if engs else None}
st, j, _ = call("POST", f"/api/as/requests/{tgt['asvcSn']}/assign", body, token=E); check("as-manage: 업체 배정 → 200", st == 200, j)
dd = data(call("GET", f"/api/as/requests/{tgt['asvcSn']}", token=E))
check("as-manage: 배정 saved with history", dd["vendorId"] == v0["vendorId"] and any(h["action"] == "ASSIGN" for h in dd["histories"]), dd.get("histories"))
st, j, _ = call("POST", f"/api/as/requests/{tgt['asvcSn']}/assign", {"vendorId": v0["vendorId"]}, token=S); check("as-manage: school cannot assign", st in (403, 404, 409), j)

# ---------- 임시 비밀번호 (V9 must_change_password) ----------
check("temp-pw: seeded accounts are not temporary", data(call("GET", "/api/auth/me", token=S)).get("mustChangePassword") is False)
st, j, _ = call("POST", "/api/users", {"loginId": "tmppw01", "userName": "임시비번", "password": "Temp!Pass2026", "roles": ["SCHOOL_USER"], "schoolId": 1}, token=E)
tu = data((st, j, None)); check("temp-pw: admin-created user flagged", st == 200 and tu.get("mustChangePassword") is True, j)
TP = login("tmppw01", "Temp!Pass2026")
check("temp-pw: /me tells the client to ask", data(call("GET", "/api/auth/me", token=TP))["mustChangePassword"] is True)
st, j, _ = call("PUT", "/api/auth/password", {"currentPassword": "Temp!Pass2026", "newPassword": "Mine!Pass2026x"}, token=TP)
check("temp-pw: own change clears it", st == 200 and data(call("GET", "/api/auth/me", token=TP))["mustChangePassword"] is False, j)
ul2 = {u["loginId"]: u for u in data(call("GET", "/api/users?keyword=tmppw01", token=E))["content"]}
check("temp-pw: user list shows it cleared", ul2["tmppw01"].get("mustChangePassword") is False, ul2)
st, j, _ = call("PUT", f"/api/users/{tu['userId']}", {"password": "Reset!Pass2026"}, token=E)
check("temp-pw: admin reset flags again", st == 200 and data((st, j, None)).get("mustChangePassword") is True, j)
st, j, _ = call("PUT", f"/api/users/{tu['userId']}", {"positionName": "교사"}, token=E)
check("temp-pw: edit without password keeps flag", data((st, j, None)).get("mustChangePassword") is True, j)
eid_ = uid("eduadmin")
st, j, _ = call("PUT", f"/api/users/{eid_}", {"password": "user1234!"}, token=E)
check("temp-pw: admin changing own password is not temporary", st == 200 and data((st, j, None)).get("mustChangePassword") is False, j)
call("DELETE", f"/api/users/{tu['userId']}", token=E)

# ---------- 층 삭제 (DELETE /api/as/spaces/floors/{id}) ----------
fb = data(call("POST", "/api/as/spaces/buildings", {"schoolId": 1, "buildingName": "층삭제시험동", "floorCount": 2}, token=E))
f1, f2 = fb["floors"][0], fb["floors"][1]
st, j, _ = call("POST", f"/api/places/floors/{f1['floorId']}/plan", files=[("file", ("f1.png", PNG1, "image/png"))], token=E); check("floor delete: plan uploaded", st == 200, j)
fd = data(call("POST", "/api/as/wireless-devices", {"schoolId": 1, "deviceCode": "AP-FD-001", "deviceName": "층삭제 AP"}, token=E))
st, j, _ = call("PUT", f"/api/as/wireless-devices/{fd['deviceId']}/position", {"floorId": f1["floorId"], "x": 0.5, "y": 0.5}, token=E); check("floor delete: device placed", st == 200, j)
bl = {x["buildingId"]: x for x in data(call("GET", "/api/as/spaces/buildings?schoolId=1", token=E))}
fv = next(x for x in bl[fb["buildingId"]]["floors"] if x["floorId"] == f1["floorId"])
check("floor delete: floor shows placed device count", fv.get("deviceCount") == 1, fv)
st, j, _ = call("DELETE", f"/api/as/spaces/floors/{f1['floorId']}", token=S); check("floor delete: 학교 deletes a floor of own school", st == 200, j)
bl = {x["buildingId"]: x for x in data(call("GET", "/api/as/spaces/buildings?schoolId=1", token=E))}
check("floor delete: floor gone, other floor kept", [x["floorId"] for x in bl[fb["buildingId"]]["floors"]] == [f2["floorId"]], bl[fb["buildingId"]])
dv = next(x for x in data(call("GET", "/api/as/wireless-devices?schoolId=1&size=500", token=E))["content"] if x["deviceId"] == fd["deviceId"])
check("floor delete: device kept, off the plan", dv.get("floorId") is None, dv)
st, j, _ = call("DELETE", f"/api/as/spaces/floors/{f2['floorId']}", token=R); check("floor delete: 교육지원청 deletes in district", st == 200, j)
OSID = next(x["schoolId"] for x in (lambda d: d.get("content", d) if isinstance(d, dict) else d)(data(call("GET", "/api/as/schools?size=500", token=E))) if x["schoolName"] == "솔빛고등학교")
ob2 = data(call("POST", "/api/as/spaces/buildings", {"schoolId": OSID, "buildingName": "관외층시험", "floorCount": 1}, token=E))
st, j, _ = call("DELETE", f"/api/as/spaces/floors/{ob2['floors'][0]['floorId']}", token=R); check("floor delete: other district → 403", st == 403, j)
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"EDU_ADMIN": {"denied": ["SPACE_BUILDING"]}}}, token=A); check("space features: old combined code rejected", st == 400, j)
call("PUT", "/api/org/role-perms", {"roles": {"EDU_ADMIN": {"denied": ["SPACE_FLOOR_DELETE"]}}}, token=A)
st, j, _ = call("DELETE", f"/api/as/spaces/floors/{ob2['floors'][0]['floorId']}", token=E); check("space features: 층 삭제 off → 403", st == 403, j)
st, j, _ = call("POST", f"/api/as/spaces/buildings/{ob2['buildingId']}/floors", {"floorNo": 2}, token=E); check("space features: 층 추가 still on", st == 200, j)
call("PUT", "/api/org/role-perms", {"roles": {"EDU_ADMIN": {"denied": ["SPACE_BUILDING_CREATE", "SPACE_FLOOR_CREATE"]}}}, token=A)
st, j, _ = call("POST", "/api/as/spaces/buildings", {"schoolId": OSID, "buildingName": "x", "floorCount": 1}, token=E); check("space features: 건물 추가 off → 403", st == 403, j)
st, j, _ = call("POST", f"/api/as/spaces/buildings/{ob2['buildingId']}/floors", {"floorNo": 3}, token=E); check("space features: 층 추가 off → 403", st == 403, j)
st, j, _ = call("POST", "/api/places/floors", {"buildingId": ob2["buildingId"], "floorNo": 4}, token=E); check("space features: legacy 층 추가 also off → 403", st == 403, j)
pe2 = perms_of(E); check("space features: delete switches untouched", {"SPACE_BUILDING_DELETE", "SPACE_FLOOR_DELETE"} <= pe2, pe2)
call("PUT", "/api/org/role-perms", {"roles": {"EDU_ADMIN": {}}}, token=A)
st, j, _ = call("DELETE", "/api/as/spaces/floors/999999", token=E); check("floor delete: unknown floor → 404", st == 404, j)
call("DELETE", f"/api/as/spaces/buildings/{fb['buildingId']}", token=E); call("DELETE", f"/api/as/spaces/buildings/{ob2['buildingId']}", token=E)
call("DELETE", f"/api/as/wireless-devices/{fd['deviceId']}", token=E)

# ---------- 스쿨넷 SLA (/api/as/sla, V10 sla_targets) ----------
import datetime as _dt
st, j, _ = call("GET", "/api/as/sla", token=N); check("sla: 기사 (no SLA board) → 403", st == 403, j)
st, j, _ = call("GET", "/api/as/sla", token=E); sd = data((st, j, None))
check("sla: 교육청 sees dashboard with default targets", st == 200 and sd["targets"]["receiveMin"] == 30 and sd["targets"].get("isDefault") is True and sd["canEdit"] is True, j)
check("sla: 12-month trend", st == 200 and len(sd["trend"]) == 12, sd.get("trend"))
st, j, _ = call("GET", "/api/as/sla?year=2026&month=13", token=E); check("sla: bad month → 400", st == 400, j)
for who, tok in (("교육지원청", R), ("학교", S)):
    st, j, _ = call("PUT", "/api/as/sla/targets", {"receiveMin": 60, "visitMin": 240, "recoverFullMin": 480, "recoverPartialMin": 1440, "availabilityPct": 99.5}, token=tok)
    check(f"sla: {who} cannot set targets → 403", st == 403, j)
st, j, _ = call("PUT", "/api/as/sla/targets", {"receiveMin": 0, "visitMin": 240, "recoverFullMin": 480, "recoverPartialMin": 1440, "availabilityPct": 99.5}, token=E)
check("sla: target 0분 → 400", st == 400, j)
st, j, _ = call("PUT", "/api/as/sla/targets", {"receiveMin": 30, "visitMin": 240, "recoverFullMin": 480, "recoverPartialMin": 1440, "availabilityPct": 80}, token=E)
check("sla: availability 80% → 400", st == 400, j)
st, j, _ = call("PUT", "/api/as/sla/targets", {"receiveMin": 45, "visitMin": 180, "recoverFullMin": 360, "recoverPartialMin": 1440, "availabilityPct": 99.8}, token=E)
check("sla: 교육청 saves targets", st == 200 and data((st, j, None))["receiveMin"] == 45 and not data((st, j, None)).get("isDefault"), j)
check("sla: targets visible to schools", data(call("GET", "/api/as/sla", token=S))["targets"]["visitMin"] == 180)

# 오래 열린 스쿨넷 신청(시드)은 위반으로 잡힌다
old = [x for x in data(call("GET", "/api/as/requests?rceptTy=S&size=200", token=E))["content"] if x["status"] in ("A", "R")]
if old:
    o = min(old, key=lambda x: x["requestAt"]); oy, om = int(o["requestAt"][:4]), int(o["requestAt"][5:7])
    so = data(call("GET", f"/api/as/sla?year={oy}&month={om}", token=E))
    check("sla: long-open request counted as a violation", any(v["asvcSn"] == o["asvcSn"] and "접수" in v["missed"] for v in so["violations"]), so["violations"])
    check("sla: open steps not in averages", so["summary"].get("avgReceiveMin") is None or so["summary"]["avgReceiveMin"] < 20000, so["summary"])

# 장비(회선)를 골라 신청 → 바로 접수 · 처리 → 충족, 회선별에 잡힌다
snd = next(x for x in data(call("GET", "/api/as/schoolnet-devices?size=200", token=S))["content"])
st, j, _ = call("POST", "/api/as/requests", {"rceptTy": "S", "faultTypeCode": "71", "symptom": "SLA 시험 전체 장애", "installPlace": "본관",
                                              "deviceId": snd["deviceId"], "visitRequestAt": "2026-12-01T10:00", "contactTel": "010-2000-0001"}, token=S)
sr_ = data((st, j, None)) or {}
check("sla: schoolnet AS with line", st == 200, j)
call("POST", f"/api/as/requests/{sr_.get('asvcSn')}/receive", {"visitPlannedAt": "2026-12-01T10:00"}, token=N)
st, j, _ = call("POST", f"/api/as/requests/{sr_.get('asvcSn')}/report", {"processContent": "회선 복구 (SLA 시험)"}, token=N); check("sla: completed", st == 200, j)
now_ = _dt.date.today()
sn_ = data(call("GET", f"/api/as/sla?year={now_.year}&month={now_.month}", token=E))
check("sla: this month counts it as met", sn_["summary"]["total"] >= 1 and sn_["summary"]["met"] >= 1 and not any(v["asvcSn"] == sr_.get("asvcSn") for v in sn_["violations"]), sn_["summary"])
ln = next((l for l in sn_["lines"] if l["deviceId"] == snd["deviceId"]), None)
check("sla: the line shows up with failures and availability", ln is not None and ln["failures"] >= 1 and 0 < ln["availability"] <= 100, sn_["lines"])
check("sla: by-vendor row", any(v["total"] >= 1 for v in sn_["byVendor"]), sn_["byVendor"])
ss_ = data(call("GET", f"/api/as/sla?year={now_.year}&month={now_.month}", token=S))
check("sla: school sees only its own school", all(l["schoolName"] == "봉황초등학교" for l in ss_["lines"]) and ss_["canEdit"] is False, ss_["lines"])
OR_ = next(x["regionId"] for x in (lambda d: d.get("content", d) if isinstance(d, dict) else d)(data(call("GET", "/api/as/schools?size=500", token=E))) if x["schoolName"] == "솔빛고등학교")
sr2 = data(call("GET", f"/api/as/sla?year={now_.year}&month={now_.month}&regionId={OR_}", token=R))
check("sla: 교육지원청 asking another district gets nothing", sr2["summary"]["total"] == 0 and not sr2["lines"], sr2["summary"])
st, xb, h = call("GET", f"/api/as/sla/excel?year={now_.year}&month={now_.month}", token=E, raw=True)
check("sla: monthly Excel report", st == 200 and xb[:2] == b"PK" and "filename*=UTF-8''" in h.get("Content-Disposition", ""), st)
call("PUT", "/api/as/sla/targets", {"receiveMin": 30, "visitMin": 240, "recoverFullMin": 480, "recoverPartialMin": 1440, "availabilityPct": 99.5}, token=E)

# ---------- 기관자산관리 (ASSET_READ): 메뉴 밖 화면도 권한으로 끈다 ----------
check("asset-read: school has it by default", "ASSET_READ" in perms_of(S) and "ASSET_WRITE" in perms_of(S))
st, j, _ = call("PUT", "/api/org/role-perms", {"roles": {"SCHOOL_USER": {"denied": ["ASSET_READ"]}}}, token=A); check("asset-read: role turns it off", st == 200, j)
pa_ = perms_of(S)
check("asset-read: off also drops register · bulk · inventory", not ({"ASSET_READ", "ASSET_WRITE", "ASSET_BULK", "INVENTORY"} & pa_), pa_)
st, j, _ = call("GET", "/api/assets", token=S); check("asset-read: list → 403", st == 403, j)
st, j, _ = call("POST", "/api/assets", {"assetType": "HW", "assetName": "x", "schoolId": sch1}, token=S); check("asset-read: create → 403", st == 403, j)
st, j, _ = call("POST", "/api/qr/resolve", {"text": "HW-2020-00001"}, token=S)
check("asset-read: QR resolve hides asset", st == 200 and data((st, j, None)).get("state") == "FORBIDDEN" and "assetId" not in data((st, j, None)), j)
call("PUT", "/api/org/role-perms", {"roles": {"SCHOOL_USER": {}}}, token=A)
check("asset-read: back on", {"ASSET_READ", "ASSET_WRITE"} <= perms_of(S))

fails = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
if fails:
    print("FAILED:", *fails, sep="\n  ")
sys.exit(1 if fails else 0)
