import { useEffect, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "./ui/table";
import { Button } from "./ui/button";
export function DataTable<T>({
  data,
  columns,
  label = "数据列表",
}: {
  data: T[];
  columns: ColumnDef<T, any>[];
  label?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      setSorting(updater);
      table.setPageIndex(0);
    },
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });
  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;
  useEffect(() => {
    if (pageIndex >= pageCount) table.setPageIndex(Math.max(0, pageCount - 1));
  }, [pageCount, pageIndex, table]);
  return (
    <div className="admin-table-panel">
      <Table aria-label={label}>
        <TableHeader>
          {table.getHeaderGroups().map((g) => (
            <TableRow key={g.id}>
              {g.headers.map((h) => (
                <TableHead key={h.id}>
                  {h.isPlaceholder ? null : h.column.getCanSort() ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={h.column.getToggleSortingHandler()}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === "asc"
                        ? " ↑"
                        : h.column.getIsSorted() === "desc"
                          ? " ↓"
                          : " ↕"}
                    </Button>
                  ) : (
                    flexRender(h.column.columnDef.header, h.getContext())
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                没有匹配的记录
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="admin-table-footer">
        <span>
          共 {data.length} 条 · 第 {table.getState().pagination.pageIndex + 1} /{" "}
          {Math.max(1, table.getPageCount())} 页
        </span>
        <div>
          <label>
            每页{" "}
            <select
              aria-label={`${label}每页条数`}
              value={table.getState().pagination.pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}
