import { ValidationError } from "../../core/errors";
import type { PaginatedResponse, PaginationMetadata } from "./types";
import type { MetadataMap } from "../../contracts/dtos";

interface FetchPageRequest {
  page: number;
  pageSize: number;
}

export type PaginationStrategy = "auto" | "total_pages" | "until_empty";
export type PaginationMetadataValidation = "strategy_aware" | "strict" | "lossy";

export interface PaginationOptions {
  // Positive integer. Defaults to 100.
  pageSize?: number;
  // Positive integer. Defaults to 100.
  maxPages?: number;
  // Pagination termination mode. Defaults to "auto".
  // auto: uses metadata.totalPages when present, otherwise falls back to empty page detection.
  // total_pages: requires metadata.totalPages to be a positive integer.
  // until_empty: continues until an empty page is returned.
  strategy?: PaginationStrategy;
  // Metadata validation mode.
  // strategy_aware: strict when metadata is used for termination, lossy for until_empty.
  // strict: always validate metadata keys when present.
  // lossy: always normalize invalid metadata fields to undefined.
  metadataValidation?: PaginationMetadataValidation;
}

interface FetchPaginatedOptions<T extends MetadataMap> extends PaginationOptions {
  fetchPage: (request: FetchPageRequest) => Promise<PaginatedResponse<T>>;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 100;
type PaginationMetadataMode = "strict" | "lossy";
const VALID_PAGINATION_STRATEGIES: ReadonlySet<PaginationStrategy> = new Set([
  "auto",
  "total_pages",
  "until_empty",
]);

export function normalizePaginationMetadata(
  metadata?: Record<string, unknown> | PaginationMetadata,
  options?: { mode?: PaginationMetadataMode },
): PaginationMetadata {
  if (!metadata) {
    return {};
  }

  const mode = options?.mode ?? "strict";
  const snakeCaseMetadata = metadata as Record<string, unknown>;
  const pageRaw = metadata.page ?? snakeCaseMetadata.page;
  const pageSizeRaw = metadata.pageSize ?? snakeCaseMetadata.page_size;
  const totalPagesRaw = metadata.totalPages ?? snakeCaseMetadata.total_pages;
  const totalCountRaw = metadata.totalCount ?? snakeCaseMetadata.total_count;

  // Build passthrough excluding both camelCase and snake_case pagination keys.
  const PAGINATION_KEYS = new Set([
    "page", "pageSize", "totalPages", "totalCount",
    "page_size", "total_pages", "total_count",
  ]);
  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!PAGINATION_KEYS.has(key)) {
      passthrough[key] = value;
    }
  }

  const page = toPositiveInteger(pageRaw);
  const pageSize = toPositiveInteger(pageSizeRaw);
  const totalPages = toNonNegativeInteger(totalPagesRaw);
  const totalCount = toNonNegativeInteger(totalCountRaw);

  if (mode === "strict") {
    assertValidMetadataField("page", pageRaw, page);
    assertValidMetadataField("pageSize", pageSizeRaw, pageSize);
    assertValidMetadataField("totalPages", totalPagesRaw, totalPages);
    assertValidMetadataField("totalCount", totalCountRaw, totalCount);
  }

  return {
    ...passthrough,
    ...(page !== undefined ? { page } : {}),
    ...(pageSize !== undefined ? { pageSize } : {}),
    ...(totalPages !== undefined ? { totalPages } : {}),
    ...(totalCount !== undefined ? { totalCount } : {}),
  };
}

function assertValidMetadataField(
  field: string,
  rawValue: unknown,
  normalizedValue: number | undefined,
): void {
  if (rawValue === undefined) {
    return;
  }

  if (normalizedValue === undefined) {
    throw new ValidationError(
      `Invalid pagination metadata '${field}': expected an integer with valid bounds`,
    );
  }
}

export async function fetchPaginated<T extends MetadataMap>(options: FetchPaginatedOptions<T>): Promise<T[]> {
  const pageSize = resolvePositiveInteger("pageSize", options.pageSize, DEFAULT_PAGE_SIZE);
  const maxPages = resolvePositiveInteger("maxPages", options.maxPages, DEFAULT_MAX_PAGES);
  const strategy = resolvePaginationStrategy(options.strategy);
  const metadataValidation = options.metadataValidation ?? "strategy_aware";
  const allItems: T[] = [];
  let completed = false;

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await options.fetchPage({ page, pageSize });
    if (!Array.isArray(response.data)) {
      throw new ValidationError("Paginated response.data must be an array");
    }

    const items = response.data;
    allItems.push(...items);

    const metadata = normalizePaginationMetadata(response.metadata, {
      mode: resolveMetadataMode(strategy, metadataValidation),
    });
    const totalPages = metadata.totalPages;
    if (strategy === "total_pages") {
      if (typeof totalPages !== "number" || totalPages <= 0) {
        throw new ValidationError(
          "Pagination strategy 'total_pages' requires metadata.totalPages to be a positive number",
        );
      }

      if (page >= totalPages) {
        completed = true;
        break;
      }
      continue;
    }

    if (strategy === "until_empty" && items.length === 0) {
      completed = true;
      break;
    }

    if (strategy === "auto") {
      if (typeof totalPages === "number" && totalPages > 0) {
        if (page >= totalPages) {
          completed = true;
          break;
        }
        continue;
      }

      if (items.length === 0) {
        completed = true;
        break;
      }
    }
  }

  if (!completed) {
    throw new ValidationError(
      `Pagination stopped after maxPages=${maxPages} before reaching a terminal condition`,
    );
  }

  return allItems;
}

function resolveMetadataMode(
  strategy: PaginationStrategy,
  validation: PaginationMetadataValidation,
): PaginationMetadataMode {
  if (validation === "strict") {
    return "strict";
  }

  if (validation === "lossy") {
    return "lossy";
  }

  return strategy === "until_empty" ? "lossy" : "strict";
}

function resolvePositiveInteger(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${name} must be a positive integer`);
  }

  return value;
}

function resolvePaginationStrategy(value: string | undefined): PaginationStrategy {
  if (value === undefined) {
    return "auto";
  }

  if (VALID_PAGINATION_STRATEGIES.has(value as PaginationStrategy)) {
    return value as PaginationStrategy;
  }

  throw new ValidationError(
    `strategy must be one of: ${[...VALID_PAGINATION_STRATEGIES].join(", ")}`,
  );
}

function toInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function toPositiveInteger(value: unknown): number | undefined {
  const normalized = toInteger(value);
  if (normalized === undefined || normalized <= 0) {
    return undefined;
  }
  return normalized;
}

function toNonNegativeInteger(value: unknown): number | undefined {
  const normalized = toInteger(value);
  if (normalized === undefined || normalized < 0) {
    return undefined;
  }
  return normalized;
}
