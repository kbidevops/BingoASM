"use client";

import SubPage from "@/components/SubPage";
import { Icon, type IconName } from "@/components/ui";

const STEPS: [string, string, string, IconName, string][] = [
  ["STEP1", "학교", "AS 신청", "school", "a"],
  ["STEP2", "AS 기사", "AS 접수", "inbox", "b"],
  ["STEP3", "AS 기사", "AS 처리결과 등록", "report", "a"],
  ["STEP4", "학교", "만족도 평가", "pen", "b"],
];

export default function IntroPage() {
  return (
    <SubPage>
      <section className="sec">
        <h3>원클릭AS시스템 안내</h3>
        <ul className="dash"><li>각급학교 전교실 무선 인프라 구축으로 원활한 교육환경 제공 및 각종 정보화기기 활용에 따른 장애신고의 신청-접수-처리-결과를 원스톱으로 시스템화하여 학교 정보화 업무의 간소화를 위한 시스템입니다.</li></ul>
      </section>
      <section className="sec">
        <h3>추진배경</h3>
        <ul className="dash"><li>학교 정보화업무의 효율적인 지원체계 구축으로 현장 지원 강화</li></ul>
      </section>
      <section className="sec">
        <h3>이용방법</h3>
        <ul className="dash">
          <li>소통메신저를 통해 개인정보 수집·이용·제공 동의 절차를 거쳐 NEIS ID 등록 후 사용 가능</li>
          <li>소통메신저를 통한 시스템 접근은 자동 로그인되나, 웹사이트는 ID로그인 후 사용가능</li>
        </ul>
      </section>
      <section className="sec">
        <h3>지원업무 영역</h3>
        <ul className="dash">
          <li>학교 정보화기기(PC와 주변기기) 장애신고 및 점검요청</li>
          <li>학교 정보화 업무 추진 관련 정보제공 및 궁금한 사항 묻고답하기</li>
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
