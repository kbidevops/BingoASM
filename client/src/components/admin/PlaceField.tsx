"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { DevicePlaces } from "@/lib/admin";

/** What the 설치위치 field hands back to the form. */
export interface PlaceValue {
  /** 저장할 설치위치 문구: "건물 층 상세 위치" */
  location: string;
  /** 다른 층으로 옮기기: 도면에서 빼고 저장 (PUT body unplace:true) */
  unplace: boolean;
  /** 저장한 뒤 새 층 도면에 바로 놓기 */
  placeAfter: { buildingId: number; floorId: number } | null;
  /** 저장 전에 고칠 것 (예: 다른 층으로 옮기는데 실이 비었음) */
  error?: string;
}

/** 설치위치 문구에서 앞의 "건물 층"을 찾는다 (가장 긴 것). */
export function splitPlace(location: string | undefined, places: DevicePlaces | null) {
  const loc = (location ?? "").trim();
  let best: { buildingId: number; floorId: number; text: string } | null = null;
  for (const b of places?.buildings ?? [])
    for (const f of b.floors) {
      const t = `${b.buildingName} ${f.floorName}`;
      if ((loc === t || loc.startsWith(t + " ")) && (!best || t.length > best.text.length)) best = { buildingId: b.buildingId, floorId: f.floorId, text: t };
    }
  return best ? { buildingId: best.buildingId, floorId: best.floorId, detail: loc.slice(best.text.length).trim() } : { buildingId: null, floorId: null, detail: loc };
}

/**
 * 장비 등록·수정의 설치위치: 건물 · 층은 고르고(건물·층 관리 기준), 상세 위치(실)만 적는다.
 * 상세 위치는 이 학교에서 이미 쓴 이름을 추천해 같은 실을 같은 이름으로 적게 한다. 저장하는 값은 예전처럼 한 줄 문구라
 * AS 신청 · 보고서 · 라벨은 그대로 쓴다. 도면에 놓인 무선장비는 건물 · 층이 도면 층으로 고정되고,
 * ‘다른 층으로 옮기기’로만 바꾼다 (도면에서 빠지고, 원하면 저장 뒤 새 층 도면에 바로 놓는다).
 */
export default function PlaceField({ apiBase, schoolId, initial, planFloorId, onChange }: {
  apiBase: string;
  schoolId: string;
  initial: string;
  /** 도면에 놓인 장비면 그 층 (무선장비만) */
  planFloorId?: number | null;
  onChange: (v: PlaceValue) => void;
}) {
  const [places, setPlaces] = useState<DevicePlaces | null>(null);
  const [failed, setFailed] = useState(false);
  const [bld, setBld] = useState("");
  const [flr, setFlr] = useState("");
  const [detail, setDetail] = useState(initial);
  const [moving, setMoving] = useState(false);
  const [placeNow, setPlaceNow] = useState(true);
  const firstSchool = useRef(schoolId);
  const done = useRef<string | null>(null);

  useEffect(() => {
    setPlaces(null);
    setFailed(false);
    if (!schoolId) return;
    api.get<DevicePlaces>(`${apiBase}/places`, { schoolId }).then(setPlaces).catch(() => setFailed(true));
  }, [apiBase, schoolId]);

  // 학교의 건물·층을 받으면 지금 설치위치를 건물 · 층 · 상세 위치로 나눈다 (학교마다 한 번).
  useEffect(() => {
    if (!places || done.current === schoolId) return;
    const sameSchool = schoolId === firstSchool.current;
    const text = done.current === null ? initial : [names(places, bld, flr), detail].filter(Boolean).join(" ");
    done.current = schoolId;
    const plan = sameSchool && planFloorId ? places.buildings.find((b) => b.floors.some((f) => f.floorId === planFloorId)) : undefined;
    const sp = splitPlace(text, places);
    if (!sameSchool) {
      // 다른 학교로 바꾸면 건물·층은 다시 고른다 (상세 위치는 남긴다).
      setBld(""); setFlr(""); setDetail(sp.detail);
    } else if (plan) {
      setBld(String(plan.buildingId)); setFlr(String(planFloorId)); setDetail(sp.floorId === planFloorId || sp.buildingId ? sp.detail : text);
    } else {
      setBld(sp.buildingId ? String(sp.buildingId) : ""); setFlr(sp.floorId ? String(sp.floorId) : ""); setDetail(sp.detail);
    }
    setMoving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, schoolId]);

  const onPlan = !!planFloorId && schoolId === firstSchool.current && !!places?.buildings.some((b) => b.floors.some((f) => f.floorId === planFloorId));
  const locked = onPlan && !moving;
  const b = places?.buildings.find((x) => String(x.buildingId) === bld);
  const f = b?.floors.find((x) => String(x.floorId) === flr);
  const structured = !!places && places.buildings.length > 0;
  const location = structured ? [names(places, bld, flr), detail.trim()].filter(Boolean).join(" ") : detail.trim();
  const unplace = onPlan && moving && !!f && f.floorId !== planFloorId;

  useEffect(() => {
    onChange({ location, unplace, placeAfter: unplace && placeNow && f?.hasPlan && b ? { buildingId: b.buildingId, floorId: f.floorId } : null,
      error: unplace && !detail.trim() ? "옮길 실(상세 위치)을 입력해 주세요." : undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, unplace, placeNow, f?.floorId, b?.buildingId, detail]);

  const listId = "plf-details";
  const onPlanNow = !!planFloorId && schoolId === firstSchool.current;
  const suggest = useMemo(() => places?.details ?? [], [places]);
  const detailInput = (
    <>
      <input aria-label={structured ? "상세 위치(실)" : "설치위치"} className={"plf-detail" + (moving && onPlanNow && !detail.trim() ? " need" : "")} list={listId}
        placeholder={moving && onPlanNow ? "옮길 실 (필수)" : structured ? "상세 위치(실) 예: 교무실 천장" : "예: 본관 2층 교무실"} aria-required={moving && onPlanNow ? true : undefined}
        value={detail} onChange={(e) => setDetail(e.target.value)} />
      <datalist id={listId}>{suggest.map((d) => <option key={d} value={d} />)}</datalist>
    </>
  );

  if (!schoolId) return <span className="hint">학교를 먼저 선택하세요.</span>;
  if (!places && !failed) return <input aria-label="설치위치" disabled value={initial} />;
  if (!structured) return (
    <>
      {detailInput}
      <small className="hint plf-note">{failed ? "건물·층 목록을 불러오지 못해 직접 적습니다." : "건물·층 관리에 이 학교 건물을 등록하면 건물 · 층을 골라 적을 수 있습니다."}</small>
    </>
  );

  return (
    <div className="plf">
      <div className="plf-row">
        {locked ? (
          <span className="plf-lock">
            <b>{names(places, bld, flr)}</b> <small>도면 기준</small>
          </span>
        ) : (
          <>
            <select aria-label="건물" value={bld} onChange={(e) => { setBld(e.target.value); setFlr(""); }}>
              <option value="">건물 선택</option>
              {places!.buildings.map((x) => <option key={x.buildingId} value={x.buildingId}>{x.buildingName}</option>)}
            </select>
            <select aria-label="층" value={flr} disabled={!b} onChange={(e) => setFlr(e.target.value)}>
              <option value="">층 선택</option>
              {b?.floors.map((x) => <option key={x.floorId} value={x.floorId}>{x.floorName}{onPlan && x.floorId === planFloorId ? " (지금)" : ""}</option>)}
            </select>
          </>
        )}
        {detailInput}
      </div>
      {locked && (
        <p className="plf-note">
          <small className="hint">도면에 놓인 장비라 건물 · 층은 도면 층을 따릅니다. 같은 층의 다른 실이면 상세 위치만 바꾸세요.</small>{" "}
          <button type="button" className="btn sm sec" onClick={() => { setMoving(true); setDetail(""); }}>다른 층으로 옮기기</button>
        </p>
      )}
      {onPlan && moving && (
        <div className="plf-move" role="group" aria-label="다른 층으로 옮기기">
          {unplace ? (
            <>
              <p className="hint">옮길 <b>실</b>(상세 위치)을 꼭 입력하세요.</p>
              <p><b>{names(places, String(planFloorId && places!.buildings.find((x) => x.floors.some((y) => y.floorId === planFloorId))?.buildingId), String(planFloorId))}</b> 도면에서 빠지고 <b>{names(places, bld, flr)}</b>(으)로 옮깁니다.</p>
              <label className={f?.hasPlan ? "" : "off"}>
                <input type="checkbox" checked={placeNow && !!f?.hasPlan} disabled={!f?.hasPlan} onChange={(e) => setPlaceNow(e.target.checked)} /> 저장한 뒤 새 층 도면에 바로 놓기
                {!f?.hasPlan && <small className="hint"> (이 층은 도면이 없습니다)</small>}
              </label>
            </>
          ) : <p className="hint">옮길 건물 · 층을 고르세요.</p>}
          <button type="button" className="btn sm sec" onClick={() => { setMoving(false); setDetail(splitPlace(initial, places).detail); const p = places!.buildings.find((x) => x.floors.some((y) => y.floorId === planFloorId)); setBld(String(p?.buildingId ?? "")); setFlr(String(planFloorId)); }}>옮기지 않기</button>
        </div>
      )}
      <small className="hint plf-preview">저장될 설치위치: <b>{location || "(없음)"}</b></small>
    </div>
  );
}

function names(places: DevicePlaces | null, bld: string, flr: string) {
  const b = places?.buildings.find((x) => String(x.buildingId) === bld);
  const f = b?.floors.find((x) => String(x.floorId) === flr);
  return [b?.buildingName, f?.floorName].filter(Boolean).join(" ");
}
