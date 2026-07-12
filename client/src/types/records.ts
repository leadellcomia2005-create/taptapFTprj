import type { EntityId } from "./domain";

export type FirebaseRecord<T> = T & {
  id: EntityId;
};

export type FirebaseRecordMap<T> = Record<EntityId, T>;

export type FirebaseUpdateMap<T = unknown> = Record<string, T | null>;

export interface ApiErrorResponse {
  error: string;
  code?: string;
  status?: number;
  details?: unknown;
}

export type ApiResponse<T> = T | ApiErrorResponse;

export type ApiListResponse<TItem, TKey extends string = "items"> = {
  [key in TKey]: TItem[];
} & {
  total?: number;
  nextCursor?: string | null;
  previousCursor?: string | null;
};

export interface ApiMutationResponse<TRecord = unknown> {
  id?: EntityId;
  item?: TRecord;
  record?: TRecord;
}

export interface ApiSuccessResponse<TData = Record<string, unknown>> {
  ok?: true;
  data?: TData;
  message?: string;
}

export type RuntimeGuard<T> = (value: unknown) => value is T;
