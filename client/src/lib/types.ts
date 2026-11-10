// Response shapes of the endpoints this client uses (see docs/API_REFERENCE.md).

export type { Page } from "./api";

export interface Me {
  userId: number;
  loginId: string;
  userName: string;
  orgName?: string;
  deptName?: string;
  positionName?: string;
  email?: string;
  mobile?: string;
  schoolId?: number;
  schoolName?: string;
  vendorId?: number;
  vendorName?: string;
  /** 교육지원청 담당자(REGION_ADMIN)의 관할 교육지원청 */
  regionId?: number;
  regionName?: string;
  memberType?: string;
  otpEnabled: boolean;
  /** 인증 앱이 등록돼 있는지 (켜져 있는데 미등록이면 다음 로그인 때 등록) */
  otpRegistered?: boolean;
  passwordChangedAt?: string;
  /** 관리자가 정한 임시 비밀번호로 로그인함 — 바꿀 때까지 변경 창을 띄운다 */
  mustChangePassword?: boolean;
  createdAt?: string;
  lastLoginAt?: string;
  roles: string[];
  permissions: string[];
  /** AS 서비스 this user's 교육청 uses (C 정보기기 · M 무선망 · S 스쿨넷 · T 스마트기기). */
  asTypes?: RceptTy[];
}

/** GET /api/site: what the signed-out site shows. */
export interface SiteInfo {
  orgName?: string;
  asTypes: RceptTy[];
  /** Menu permissions of the services not in use; their menus are hidden even before sign-in. */
  disabledPerms: string[];
  /** 문의처 안내 still holds sample data, not the 교육청's real contacts. */
  contactsSample?: boolean;
}

/** GET /api/as/contacts/providers: the school's 담당업체 per AS service. */
export interface Providers {
  schoolId: number;
  schoolName: string;
  items: { rceptTy: RceptTy; rceptTyName: string; vendorName?: string; vendorTel?: string; engineerName?: string; engineerTel?: string }[];
}

export interface LoginResult {
  accessToken?: string;
  refreshToken?: string;
  me?: Me;
  /** otp: 인증 앱 번호 입력 · otp-setup: 인증 앱을 처음 등록 (QR·비밀값을 보여 주고 첫 번호로 확인) */
  step?: "otp" | "otp-setup";
  otpToken?: string;
  expiresAt?: string;
  message?: string;
}

/** 인증 앱(Google OTP 등) 등록 정보: QR(data URL), 직접 입력용 비밀값, 앱에 보이는 이름. */
export interface OtpSetup {
  otpToken: string;
  expiresAt?: string;
  qr: string;
  secret: string;
  account: string;
  issuer: string;
  /** 이미 등록된 앱이 있어 바뀌는 경우 */
  replaces?: boolean;
}

export type RceptTy = "C" | "M" | "S" | "T";
export type AsStatus = "A" | "R" | "C" | "X";

export interface AsCodes {
  rceptTypes: Record<RceptTy, string>;
  statuses: Record<AsStatus, string>;
  faultTypes: Record<RceptTy, Record<string, string>>;
  requestTypes: Record<string, string>;
  processTypes: Record<string, string>;
  costTypes: Record<string, string>;
}

/** 처리 보고서 비용 항목 (부품·공임·출장·기타). */
export interface CostItem {
  costType: string;
  costTypeName?: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  amount?: number;
}

export interface FileInfo {
  fileId: number;
  name: string;
  size: number;
  url: string;
}

export interface AsRow {
  asvcSn: number;
  /** 학교의 지역 · 배정된 업체 · 기사 (업체 배정 화면) */
  regionId?: number;
  vendorId?: number;
  engineerUserId?: number;
  rceptTy: RceptTy;
  rceptTyName: string;
  schoolId?: number;
  schoolName?: string;
  regionName?: string;
  applicantName?: string;
  contactTel?: string;
  faultTypeCode?: string;
  faultTypeName?: string;
  requestTypeName?: string;
  symptom?: string;
  installPlace?: string;
  /** 상세에서만: 대상장비의 지금 위치 (신청 뒤 옮겨졌을 수 있음) */
  deviceCurrentPlace?: string | null;
  deviceId?: number | null;
  deviceName?: string;
  equipmentName?: string;
  modelName?: string;
  quantity?: number;
  visitRequestAt?: string;
  status: AsStatus;
  statusName: string;
  requestAt?: string;
  vendorName?: string;
  engineerName?: string;
  engineerTel?: string;
  receivedAt?: string;
  visitPlannedAt?: string;
  completedAt?: string;
  returnReason?: string;
  transferFromTy?: string;
  transferContent?: string;
  hasReport?: boolean;
  processTypeName?: string;
  processAmount?: number;
  evalScore?: number;
}


export interface AsDetail extends AsRow {
  school?: { schoolName: string; address?: string; tel?: string };
  vendor?: { vendorName: string; tel?: string };
  report?: {
    engineerName?: string;
    visitAt?: string;
    visitEndAt?: string;
    troubleSymptom?: string;
    inspectContent?: string;
    processTypeCode?: string;
    processTypeName?: string;
    processContent?: string;
    processAmount?: number;
    costItems?: CostItem[];
    files?: FileInfo[];
  };
  attachments?: FileInfo[];
  evaluation?:{ score: number; opinion?: string; evaluatedAt?: string };
  histories?: { historyId: number; statusName?: string; action: string; content?: string; workerName?: string; createdAt: string }[];
  allowedActions: string[];
}

export interface AsSummary {
  /** Per type: count per status code plus total. */
  byType: Record<string, Record<string, number>>;
  requested: number;
  received: number;
  completed: number;
  returned: number;
  todayRequested: number;
  waitingEval: number;
}

export interface BoardInfo {
  code: string;
  name: string;
  canWrite: boolean;
  hasStatus: boolean;
  categories: string[];
  hasField: boolean;
  hasRegion: boolean;
  allowSecret: boolean;
}

export interface PostRow {
  postId: number;
  boardCode: string;
  title: string;
  authorUserId: number;
  authorName: string;
  createdAt: string;
  viewCount: number;
  categoryCode?: string;
  fieldCode?: string;
  fieldName?: string;
  regionId?: number;
  regionName?: string;
  schoolName?: string;
  status?: string;
  statusName?: string;
  visitDate?: string;
  secret: boolean;
  commentCount: number;
  isNew: boolean;
  hasAttach: boolean;
}

export interface PostDetail extends PostRow {
  content: string;
  updatedAt?: string;
  attachments: FileInfo[];
  comments: { commentId: number; content: string; authorName: string; createdAt: string; canDelete: boolean }[];
  canEdit: boolean;
  canComment: boolean;
  canSetStatus: boolean;
}

export interface Region {
  regionId: number;
  regionName: string;
}

export interface School {
  schoolId: number;
  schoolName: string;
  regionName?: string;
}

export interface WirelessDevice {
  deviceId: number;
  deviceCode: string;
  deviceName: string;
  location?: string;
}

export interface Scrap {
  scrapId: number;
  menuKey: string;
  groupName?: string;
  title?: string;
}

export interface LoginLog {
  loginAt: string;
  ip?: string;
  method: "PASSWORD" | "OTP" | "QR";
  success: boolean;
  userAgent?: string;
}

export interface ContactGroup {
  /** null for 도교육청 */
  regionId?: number | null;
  regionName: string;
  /** Deleted in 지역 관리; stays here until its rows are removed. */
  deleted?: boolean;
  groups: { groupName: string; items: { itemName: string; tel?: string; note?: string; duties?: string[] }[] }[];
}
