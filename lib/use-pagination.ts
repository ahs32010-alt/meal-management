'use client';

import { useEffect, useMemo, useState } from 'react';

export interface UsePaginationOptions {
  pageSize?: number;
  resetKey?: string | number;
}

export interface UsePaginationResult<T> {
  page: number;
  pageSize: number;
  pageCount: number;
  pageItems: T[];
  total: number;
  setPage: (p: number) => void;
  next: () => void;
  prev: () => void;
}

export function usePagination<T>(
  items: T[],
  { pageSize = 50, resetKey }: UsePaginationOptions = {}
): UsePaginationResult<T> {
  const [page, setPage] = useState(1);

  // Reset to first page when filter/search changes
  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const safePage = Math.min(Math.max(1, page), pageCount);
  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [safePage, page]);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  return {
    page: safePage,
    pageSize,
    pageCount,
    pageItems,
    total,
    setPage,
    next: () => setPage((p) => Math.min(pageCount, p + 1)),
    prev: () => setPage((p) => Math.max(1, p - 1)),
  };
}
