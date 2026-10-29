"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, rows, uploadFiles } from "@/lib/api";
import { AS_LIST_HREF, AS_NAME, loadCodes } from "@/lib/as";
import { isSchoolUser, useAuth } from "@/lib/auth";
import { todayIso } from "@/lib/format";
import type { AsCodes, Page, RceptTy, School, WirelessDevice } from "@/lib/types";
import { DateTimeInput, ErrorBox, FilePicker, FormMsg, FormRow, Loading, NoticeBox, SubmitBar, TelInput, telValid, useToast } from "./ui";

/** Tomorrow 10:00 as the default visit request. */
function defaultVisit() {
  const d = new Date(Date.now() + 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T10:00`;
}

interface Form {
  schoolId: string;
  applicantName: string;
  faultTypeCode: string;
  faultTypeName: string;
  requestTypeCode: string;
  symptom: string;
  installPlace: string;
  visitRequestAt: string;
  contactTel: string;
  deviceId: string;
  equipmentName: string;
  modelName: string;
  quantity: string;
}

/** AS 신청 (POST /api/as/requests). Fields follow cbe.go.kr per type; see API_REFERENCE §3. */
export default function AsRequestForm({ ty }: { ty: RceptTy }) {
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const school = isSchoolUser(me);
  const [codes, setCodes] = useState<AsCodes | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [schools, setSchools] = useState<School[]>([]);
  const [devices, setDevices] = useState<WirelessDevice[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [msg, setMsg] = useState<{ kind?: "ok" | "bad"; text: string }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Form>({
    schoolId: me?.schoolId ? String(me.schoolId) : "",
    applicantName: me?.userName ?? "",
    faultTypeCode: "",
    faultTypeName: "",
    requestTypeCode: "",
    symptom: "",
    installPlace: "",
    visitRequestAt: defaultVisit(),
    contactTel: me?.mobile ?? "010--",
    deviceId: "",
    equipmentName: "",
    modelName: "",
    quantity: "1",
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const load = () => {
    setLoadErr("");
    loadCodes().then(setCodes).catch((e) => setLoadErr(e.message));
    if (!school) api.get<Page<School> | School[]>("/api/as/schools").then((d) => setSchools(rows(d))).catch(() => setSchools([]));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  // 무선망: wireless devices of the chosen school.
  useEffect(() => {
    if (ty !== "M" || !f.schoolId) return setDevices([]);
    api.get<Page<WirelessDevice> | WirelessDevice[]>("/api/as/wireless-devices", { schoolId: f.schoolId, size: 200 })
      .then((d) => setDevices(rows(d)))
      .catch(() => setDevices([]));
  }, [ty, f.schoolId]);

  if (loadErr) return <ErrorBox message={loadErr} onRetry={load} />;
  if (!codes) return <Loading />;

  const faults = codes.faultTypes[ty] ?? {};
  const placeRequired = ty === "C" || ty === "M";
  const name = AS_NAME[ty];

  const validate = () => {
    const e: Partial<Record<keyof Form, string>> = {};
    if (!f.schoolId) e.schoolId = "기관명을 선택해 주세요.";
    if (!f.applicantName.trim()) e.applicantName = "신청자를 입력해 주세요.";
    if (!f.faultTypeCode) e.faultTypeCode = "장애유형을 선택해 주세요.";
    else if (f.faultTypeCode === "W" && !f.faultTypeName.trim()) e.faultTypeName = "장애유형을 직접 입력해 주세요.";
    if (ty === "M" && !f.requestTypeCode) e.requestTypeCode = "요청내용을 선택해 주세요.";
    if (!f.symptom.trim()) e.symptom = (ty === "S" ? "신청내용" : "장애증상") + "을 입력해 주세요.";
    if (placeRequired && !f.installPlace.trim()) e.installPlace = "설치장소를 입력해 주세요.";
    if (!f.visitRequestAt.split("T")[0]) e.visitRequestAt = "방문요청일시를 입력해 주세요.";
    else if (f.visitRequestAt.split("T")[0] < todayIso()) e.visitRequestAt = "방문요청일은 오늘 이후로 선택해 주세요.";
    if (!telValid(f.contactTel)) e.contactTel = "연락처 형식을 확인해 주세요. (예: 010-1234-5678)";
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    const n = Object.values(e).filter(Boolean).length;
    if (n) {
      setMsg({ kind: "bad", text: `입력하지 않았거나 잘못 입력한 항목이 ${n}개 있습니다.` });
      return;
    }
    setBusy(true);
    setMsg({ text: "" });
    try {
      const attachFileIds = await uploadFiles(files);
      await api.post("/api/as/requests", {
        rceptTy: ty,
        schoolId: school ? undefined : Number(f.schoolId),
        applicantName: f.applicantName.trim(),
        faultTypeCode: f.faultTypeCode,
        faultTypeName: f.faultTypeCode === "W" ? f.faultTypeName.trim() : undefined,
        requestTypeCode: ty === "M" ? f.requestTypeCode : undefined,
        symptom: f.symptom.trim(),
        installPlace: f.installPlace.trim() || undefined,
        visitRequestAt: f.visitRequestAt,
        contactTel: f.contactTel,
        deviceId: ty === "M" && f.deviceId ? Number(f.deviceId) : undefined,
        equipmentName: (ty === "C" || ty === "T") && f.equipmentName.trim() ? f.equipmentName.trim() : undefined,
        modelName: (ty === "C" || ty === "T") && f.modelName.trim() ? f.modelName.trim() : undefined,
        quantity: (ty === "C" || ty === "T") && f.quantity ? Number(f.quantity) : undefined,
        attachFileIds,
      });
      toast(`${name} AS를 신청했습니다. 담당 업체가 확인 후 연락드립니다.`);
      router.push(AS_LIST_HREF[ty]);
    } catch (err) {
      setMsg({ kind: "bad", text: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <>
      {ty === "S" ? (
        <div className="nbox" style={{ borderColor: "var(--brand2)" }}>📢 접수 시 비용이 발생할 수 있습니다. 관리자에게 문의해 주세요.</div>
      ) : ty === "C" ? (
        <NoticeBox>
          <p>■ 2026학년도 학교 정보화기기 유지관리 표준 계약 체결 학교만 사용이 가능합니다.</p>
          <p>※ 표준계약 미체결 학교는 계약 정보 미등록으로 AS신청 및 문자전송 불가</p>
        </NoticeBox>
      ) : (
        <NoticeBox>
          <p>■ 장애가 발생한 경우 아래 내용을 입력해 접수해 주세요.</p>
          <p>■ 접수 후 업체 담당자가 확인해 연락드립니다.</p>
        </NoticeBox>
      )}
      <form className="ft2" noValidate onSubmit={submit}>
        <table className="ftab">
          <tbody>
            <FormRow label="기관명" required error={errors.schoolId}>
              {school ? (
                <input className="instt-in" readOnly value={me?.schoolName ?? ""} aria-label="기관명" />
              ) : (
                <select aria-label="기관명" value={f.schoolId} onChange={(e) => set("schoolId", e.target.value)}>
                  <option value="">-- 선택 --</option>
                  {schools.map((s) => <option key={s.schoolId} value={s.schoolId}>{s.schoolName}{s.regionName ? ` (${s.regionName})` : ""}</option>)}
                </select>
              )}
            </FormRow>
            <FormRow label="신청자" required error={errors.applicantName}>
              <input aria-label="신청자" value={f.applicantName} onChange={(e) => set("applicantName", e.target.value)} />
            </FormRow>
            <FormRow label="장애유형" required error={errors.faultTypeCode ?? errors.faultTypeName}>
              <select aria-label="장애유형" value={f.faultTypeCode} onChange={(e) => set("faultTypeCode", e.target.value)}>
                <option value="">-- 선택 --</option>
                {Object.entries(faults).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {f.faultTypeCode === "W" && (
                <> <input aria-label="장애유형 직접입력" placeholder="장애유형 입력" value={f.faultTypeName} onChange={(e) => set("faultTypeName", e.target.value)} /></>
              )}
            </FormRow>
            {ty === "M" && (
              <FormRow label="요청내용" required error={errors.requestTypeCode}>
                {Object.entries(codes.requestTypes).map(([k, v]) => (
                  <label key={k} style={{ marginRight: 12 }}>
                    <input type="radio" name="rq" checked={f.requestTypeCode === k} onChange={() => set("requestTypeCode", k)} /> {v}
                  </label>
                ))}
              </FormRow>
            )}
            <FormRow label={ty === "S" ? "신청내용" : "장애증상"} required error={errors.symptom}>
              <textarea className="ta" aria-label={ty === "S" ? "신청내용" : "장애증상"} value={f.symptom} maxLength={2000} onChange={(e) => set("symptom", e.target.value)} />
            </FormRow>
            <FormRow label="방문요청일시" required error={errors.visitRequestAt}>
              <DateTimeInput label="방문요청일시" value={f.visitRequestAt} onChange={(v) => set("visitRequestAt", v)} />
            </FormRow>
            <FormRow label="설치장소" required={placeRequired} error={errors.installPlace}>
              <input aria-label="설치장소" value={f.installPlace} onChange={(e) => set("installPlace", e.target.value)} /> <small>설치 장소를 입력해 주세요. (예: 본관 2층 교무실)</small>
            </FormRow>
            <FormRow label="연락처" required error={errors.contactTel}>
              <TelInput value={f.contactTel} onChange={(v) => set("contactTel", v)} />
            </FormRow>
            {ty === "M" && (
              <FormRow label="대상장비">
                <select aria-label="대상장비" value={f.deviceId} onChange={(e) => set("deviceId", e.target.value)} disabled={!f.schoolId}>
                  <option value="">{f.schoolId ? (devices.length ? "-- 선택 안 함 --" : "등록된 무선장비가 없습니다") : "기관을 먼저 선택하세요"}</option>
                  {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.deviceCode} {d.deviceName}{d.location ? ` (${d.location})` : ""}</option>)}
                </select>
              </FormRow>
            )}
            {(ty === "C" || ty === "T") && (
              <FormRow label="대상장비">
                <input aria-label="장비명" placeholder="장비명 (예: 데스크톱 PC)" value={f.equipmentName} onChange={(e) => set("equipmentName", e.target.value)} />{" "}
                <input aria-label="모델명" placeholder="모델명" value={f.modelName} onChange={(e) => set("modelName", e.target.value)} />{" "}
                <input aria-label="수량" type="number" min={1} max={999} style={{ width: 70 }} value={f.quantity} onChange={(e) => set("quantity", e.target.value)} /> 대
              </FormRow>
            )}
            <FormRow label="첨부파일(선택사항)">
              <FilePicker files={files} onChange={setFiles} />
            </FormRow>
          </tbody>
        </table>
        <FormMsg kind={msg.kind} text={msg.text} />
        <SubmitBar label={`${name} AS신청하기`} busy={busy}>
          <Link className="btn sm sec" href={AS_LIST_HREF[ty]} style={{ padding: "0 32px", minHeight: 42 }}>결과조회</Link>
        </SubmitBar>
      </form>
    </>
  );
}
