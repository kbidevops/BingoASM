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

  // 무선망·스쿨넷: the chosen school's devices of that kind.
  const pickDevice = ty === "M" || ty === "S";
  // 학교 담당자는 증상만 신고한다 — 대상 장비는 교육지원청이 지정 (장비 라벨 QR로 신청할 때만 그 장비가 붙는다).
  const listDevices = pickDevice && !school;
  useEffect(() => {
    if (!listDevices || !f.schoolId) return setDevices([]);
    api.get<Page<WirelessDevice> | WirelessDevice[]>(ty === "M" ? "/api/as/wireless-devices" : "/api/as/schoolnet-devices", { schoolId: f.schoolId, size: 200 })
      .then((d) => setDevices(rows(d)))
      .catch(() => setDevices([]));
  }, [ty, listDevices, f.schoolId]);

  // 마이페이지 '다시 신청' (?copy=123): 예전 신청의 학교 · 고장유형 · 요청내용 · 증상 · 장소 · 장비를 채워 둔다.
  useEffect(() => {
    const sn = Number(new URLSearchParams(window.location.search).get("copy")) || null;
    if (!sn) return;
    api.get<{ rceptTy: string; schoolId?: number; faultTypeCode?: string; requestTypeCode?: string; symptom?: string; installPlace?: string; deviceId?: number }>(`/api/as/requests/${sn}`).then((d) => {
      if (d.rceptTy !== ty) return;
      setF((p) => ({
        ...p, schoolId: p.schoolId || (d.schoolId ? String(d.schoolId) : ""), faultTypeCode: d.faultTypeCode ?? p.faultTypeCode,
        requestTypeCode: d.requestTypeCode ?? p.requestTypeCode, symptom: `[AS-${sn} 재신청] ${d.symptom ?? ""}`.trim(),
        installPlace: d.installPlace ?? p.installPlace, deviceId: pickDevice && d.deviceId ? String(d.deviceId) : p.deviceId,
      }));
      toast(`AS-${sn}의 내용을 채워 두었습니다. 확인 후 신청하세요.`);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 장비 라벨 QR → "이 장비로 AS 신청" (?device=123): 학교·대상장비·설치장소를 채워 둔다.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("device")) || null;
    if (!id || !pickDevice) return;
    api.get<{ deviceId: number; rceptTy?: string; schoolId: number; location?: string; deviceCode: string; deviceName: string }>(`/api/qr/devices/${id}`).then((d) => {
      if (d.rceptTy && d.rceptTy !== ty) return;
      setF((p) => ({ ...p, schoolId: p.schoolId || String(d.schoolId), deviceId: String(d.deviceId), installPlace: p.installPlace || d.location || "" }));
      toast(`${d.deviceCode} ${d.deviceName} 장비로 신청합니다.`);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadErr) return <ErrorBox message={loadErr} onRetry={load} />;
  if (!codes) return <Loading />;

  const faults = codes.faultTypes[ty] ?? {};
  // 설치장소: 정보기기만 직접 입력(필수). 무선망 · 스쿨넷은 대상 장비의 설치위치를 따른다.
  const placeRequired = ty === "C";
  const placeFromDevice = pickDevice;
  const chosenDevice = devices.find((d) => String(d.deviceId) === f.deviceId);
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
        installPlace: placeFromDevice ? undefined : f.installPlace.trim() || undefined,
        visitRequestAt: f.visitRequestAt,
        contactTel: f.contactTel,
        deviceId: pickDevice && f.deviceId ? Number(f.deviceId) : undefined,
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
      <NoticeBox>
        <p>■ 장애가 발생한 경우 아래 내용을 입력해 접수해 주세요.</p>
        <p>■ 접수 후 업체 담당자가 확인해 연락드립니다.</p>
      </NoticeBox>
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
            {placeFromDevice ? (
              <FormRow label="설치장소">
                {f.deviceId ? <b>{chosenDevice?.location ?? f.installPlace ?? "-"}</b> : null}
                <small className="hint">{f.deviceId ? " 대상 장비의 설치위치입니다." : school ? "대상 장비를 지정하면 그 장비의 설치위치로 정해집니다. 장애 위치는 신청내용에 적어 주세요." : "대상 장비를 고르면 그 장비의 설치위치로 정해집니다."}</small>
              </FormRow>
            ) : (
              <FormRow label="설치장소" required={placeRequired} error={errors.installPlace}>
                <input aria-label="설치장소" value={f.installPlace} onChange={(e) => set("installPlace", e.target.value)} /> <small>설치 장소를 입력해 주세요. (예: 본관 2층 교무실)</small>
              </FormRow>
            )}
            <FormRow label="연락처" required error={errors.contactTel}>
              <TelInput value={f.contactTel} onChange={(v) => set("contactTel", v)} />
            </FormRow>
            {pickDevice && school && f.deviceId && (
              <FormRow label="대상장비"><span className="hint">장비 라벨(QR)로 신청한 장비가 함께 접수됩니다.</span></FormRow>
            )}
            {listDevices && (
              <FormRow label="대상장비">
                <select aria-label="대상장비" value={f.deviceId} onChange={(e) => set("deviceId", e.target.value)} disabled={!f.schoolId}>
                  <option value="">{f.schoolId ? (devices.length ? "-- 선택 안 함 --" : `등록된 ${ty === "M" ? "무선장비" : "스쿨넷 장비"}가 없습니다`) : "기관을 먼저 선택하세요"}</option>
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
