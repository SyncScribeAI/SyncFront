/**
 * Короткие имена для сгенерированных типов OpenAPI (src/api/openapi.d.ts).
 * Сюда же вынесены проверки, что словарь домена совпадает с контрактом бэкенда:
 * если enum на сервере изменится, перегенерация типов сломает сборку здесь,
 * а не молча в рантайме.
 */
import type { DocumentStatus } from '@/domain/document/status';
import type { DocumentBlockType } from '@/domain/editor/block';
import type { FlagStatus } from '@/domain/editor/flag';
import type { ChangeType, SuggestionOrigin, SuggestionStatus } from '@/domain/editor/suggestion';

import type { components, paths } from './openapi.d.ts';

export type { paths };
export type Schemas = components['schemas'];

export type UserResponse = Schemas['UserResponse'];
export type TokenResponse = Schemas['TokenResponse'];
export type UserLoginRequest = Schemas['UserLoginRequest'];
export type UserRegisterRequest = Schemas['UserRegisterRequest'];

export type CapabilitiesResponse = Schemas['CapabilitiesResponse'];

export type ProjectResponse = Schemas['ProjectResponse'];
export type ProjectCreateRequest = Schemas['ProjectCreateRequest'];
export type ProjectUpdateRequest = Schemas['ProjectUpdateRequest'];
export type ProjectPage = Schemas['Page_ProjectResponse_'];

export type DocumentResponse = Schemas['DocumentResponse'];
export type DocumentListItem = Schemas['DocumentListItem'];
export type DocumentListPage = Schemas['DocumentListPage'];
export type AnalysisState = Schemas['AnalysisStateResponse'];
export type DocumentContent = Schemas['DocumentContentResponse'];

export type SourceResponse = Schemas['SourceResponse'];
export type SourcePage = Schemas['Page_SourceResponse_'];

export type AnalysisJobResponse = Schemas['AnalysisJobResponse'];
export type BulkAnalysisJobsResponse = Schemas['BulkAnalysisJobsResponse'];

export type SuggestionSourceResponse = Schemas['SuggestionSourceResponse'];
export type EvidenceResponse = Schemas['EvidenceResponse'];
export type SourceSnapshotContent = Schemas['SourceSnapshotContentResponse'];
export type SuggestionResponse = Schemas['SuggestionResponse'];
export type SuggestionGroupResponse = Schemas['SuggestionGroupResponse'];
export type EditorAggregateResponse = Schemas['EditorAggregateResponse'];
export type ReviewSaveRequest = Schemas['ReviewSaveRequest'];
export type ReviewSaveResponse = Schemas['ReviewSaveResponse'];
export type PatchSuggestionsResponse = Schemas['PatchSuggestionsResponse'];
export type ResetResponse = Schemas['ResetResponse'];
export type EditorContent = Schemas['EditorContent'];
export type EditorBlockResponse = Schemas['EditorBlockResponse'];
export type EditorCounters = Schemas['EditorCounters'];

export type AnalysisFlagResponse = Schemas['AnalysisFlagResponse'];
export type FlagQuoteResponse = Schemas['FlagQuoteResponse'];
export type PatchFlagRequest = Schemas['PatchFlagRequest'];

export type AnalysisHealthResponse = Schemas['AnalysisHealthResponse'];

export type DashboardResponse = Schemas['DashboardResponse'];
export type AttentionDocumentItem = Schemas['AttentionDocumentItem'];
export type RecentDocumentItem = Schemas['RecentDocumentItem'];

export interface PageParams {
  limit?: number;
  offset?: number;
}

/** Роль в OpenAPI — просто string; сужаем до известных значений. */
export type UserRole = 'admin' | 'user';

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Статусная модель домена обязана совпадать с DocumentStatusVO бэкенда.
export const documentStatusContractMatches: Equal<Schemas['DocumentStatusVO'], DocumentStatus> =
  true;

// Типы и статусы правок домена редактора — тот же контракт для SuggestionResponse.
export const changeTypeContractMatches: Equal<SuggestionResponse['change_type'], ChangeType> = true;
export const suggestionStatusContractMatches: Equal<
  SuggestionResponse['status'],
  SuggestionStatus
> = true;
export const suggestionOriginContractMatches: Equal<
  SuggestionResponse['origin'],
  SuggestionOrigin
> = true;

// Блоки документа и статусы флагов «проверьте вручную».
export const blockTypeContractMatches: Equal<Schemas['DocumentBlockType'], DocumentBlockType> =
  true;
export const flagStatusContractMatches: Equal<AnalysisFlagResponse['status'], FlagStatus> = true;
export const patchFlagStatusContractMatches: Equal<PatchFlagRequest['status'], FlagStatus> = true;
