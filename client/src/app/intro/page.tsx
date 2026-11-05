"use client";

import Link from "next/link";
import SubPage from "@/components/SubPage";
import { Icon, type IconName } from "@/components/ui";
import { AS_NAME, AS_REQUEST_HREF, useAsTypes } from "@/lib/as";
import { useAuth } from "@/lib/auth";
import type { RceptTy } from "@/lib/types";

const STEPS: [string, string, string, IconName, string][] = [
  ["STEP1", "학교", "AS 신청", "school", "a"],
  ["STEP2", "AS 기사", "AS 접수", "inbox", "b"],
  ["STEP3", "AS 기사", "AS 처리결과 등록", "report", "a"],
  ["STEP4", "학교", "만족도 평가", "pen", "b"],
];

/** Who uses the system and for what (matches the role permissions in the server's Roles). */
const ROLES: [string, string][] = [
  ["학교 담당자", "AS 신청 · 처리 결과 확인 · 만족도 평가 · 학교 자산·공간 관리"],
  ["AS 기사 (유지보수 업체)", "배정된 AS 접수 · 방문 일정 · 처리 보고서(처리 비용·첨부) 등록"],
  ["교육지원청 담당자", "관내 학교의 AS 현황 관리 · 업체 배정 · 학교 정보 관리 · 관내 통계"],
  ["도교육청 담당자", "전체 AS 관리 · 업체·지역·사용자 관리 · AS 통계"],
];

/** What each AS 서비스 covers. Only the services the 교육청 uses (AS 서비스 설정) are shown. */
const SERVICE: Record<RceptTy, { what: string; detail: string }> = {
  M: { what: "교실 무선망", detail: "무선 AP 접속 불량·속도 저하 신고, AP 원격 재부팅 요청" },
  S: { what: "학교 인터넷 회선(스쿨넷)", detail: "회선 전체·일부 장애 신고 (통신사 SLA에 따라 처리)" },
  C: { what: "정보기기(PC와 주변기기)", detail: "PC·모니터·프린터 등 장애 신고 및 점검 요청" },
  T: { what: "스마트기기", detail: "학생용 스마트기기 고장·파손·충전 장애 신고" },
};

export default function IntroPage() {
  const { site, me } = useAuth();
  const types = useAsTypes();
  const org = site?.orgName ?? me?.orgName ?? "";
  const covered = types.map((t) => SERVICE[t].what).join(", ");

  return (
    <SubPage>
      <section className="sec">
        <h3>원클릭AS시스템 안내</h3>
        <ul className="dash">
          <li>
            {org ? `${org} 원클릭AS시스템은 ` : "원클릭AS시스템은 "}
            {covered ? `학교의 ${covered}에 장애가 생겼을 때 ` : "학교 정보화 장애가 생겼을 때 "}
            신청부터 접수·처리·결과 확인·만족도 평가까지 한 곳에서 처리하는 시스템입니다.
          </li>
          <li>학교는 전화나 공문 없이 온라인으로 신청하고, 담당 업체가 접수해 처리한 결과를 바로 확인할 수 있어 학교 정보화 업무가 간소화됩니다.</li>
        </ul>
      </section>
      <section className="sec">
        <h3>추진배경</h3>
        <ul className="dash">
          <li>전화·공문으로 하던 장애 신고를 온라인 한 곳으로 모아, 학교와 담당 업체가 연락하고 처리하는 시간을 줄입니다.</li>
          <li>신청부터 처리 보고서·비용·만족도까지 기록이 남아, 교육청이 유지보수 업체의 처리 실적을 자료로 관리합니다.</li>
          <li>학교 자산·공간(실) 정보와 연결해 장비별 수리 이력을 쌓고 교체 시기를 판단합니다.</li>
        </ul>
      </section>
      <section className="sec">
        <h3>이용방법</h3>
        <ul className="dash">
          <li>계정은 교육청에서 발급합니다. 학교 담당자·AS 기사·교육지원청 담당자는 교육청 담당자에게 계정을 요청하세요.</li>
          <li>웹사이트에서 아이디·비밀번호로 로그인하거나, 이미 로그인한 휴대폰으로 화면의 QR을 찍어 로그인합니다.</li>
          <li>2단계 인증을 켠 계정은 비밀번호 확인 후 소통메신저로 받은 6자리 인증번호를 한 번 더 입력합니다.</li>
          <li>비밀번호를 5회 연속 틀리면 30분 동안 잠깁니다. 아이디·비밀번호 분실은 <Link href="/contact">문의처 안내</Link>의 담당자에게 문의하세요.</li>
        </ul>
        <div className="tw intro-roles">
          <table className="cards">
            <caption className="sr">사용자별 주요 기능</caption>
            <thead><tr><th scope="col">사용자</th><th scope="col">주요 기능</th></tr></thead>
            <tbody>
              {ROLES.map(([who, what]) => (
                <tr key={who}><td data-label="사용자"><b>{who}</b></td><td data-label="주요 기능" className="tl">{what}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="sec">
        <h3>지원업무 영역</h3>
        <ul className="dash intro-svc">
          {types.map((t) => (
            <li key={t}>
              <b><Link href={AS_REQUEST_HREF[t]}>{AS_NAME[t]}</Link></b>
              <span>{SERVICE[t].detail}</span>
            </li>
          ))}
          <li>
            <b>정보 공유</b>
            <span>학교 정보화 업무 추진 관련 정보 제공, 질문 및 건의</span>
          </li>
        </ul>
      </section>
      <section className="sec">
        <h3>AS 처리절차</h3>
        <ol className="steps2">
          {STEPS.map(([tg, who, act, icon, c]) => (
            <li key={tg} className={"sc " + c}>
              <b className="tg">{tg}</b>
              <div className="ic2" aria-hidden="true"><Icon name={icon} /></div>
              <div className="who">{who}</div>
              <div className="act">{act}</div>
            </li>
          ))}
        </ol>
      </section>
    </SubPage>
  );
}
