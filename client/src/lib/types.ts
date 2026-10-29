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
  passwordChangedAt?: string;
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
  step?: "otp";
  otpToken?: string;
  expiresAt?: string;
  devCode?: string;
  message?: string;
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
  chargeTypes: Record<string, string>;
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
  school?: { schoolName: string; address?: string; tel?: string; contractStatus?: string };
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
    chargeType?: "FREE" | "PAID";
    chargeTypeName?: string;
    costItems?: CostItem[];
    files?: FileInfo[];
  };
  attachments?: FileInfo[];
  evaluation?: { score: number; opinion?: string; evaluatedAt?: string };
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
  groups: { groupName: string; items: { itemName: string; tel?: string; note?: string; duties?: string[] }[] }[];
}
