import type { Key, ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface TableColumn<T> {
  /** Unieke sleutel van de kolom. */
  key: string;
  header: ReactNode;
  /** Celinhoud; `null`, `undefined` en `""` tonen als `-`. */
  cell: (row: T) => ReactNode;
  className?: string;
}

export interface TableProps<T> {
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => Key;
  /** Tekst als er geen rijen zijn (standaard "Geen gegevens."). */
  empty?: ReactNode;
  /** Toegankelijke naam van de tabel (visueel verborgen). */
  caption?: ReactNode;
  /** Begrens de hoogte en scroll binnen de tabel (`.twrap`, 42vh). */
  scroll?: boolean;
  className?: string;
}

function display(value: ReactNode): ReactNode {
  return value === null || value === undefined || value === "" ? "-" : value;
}

/**
 * Compacte datatabel (`.tbl`): kleine grijze koppen, dunne lijnen, hover per rij. Breed
 * materiaal scrollt horizontaal binnen de tabel, nooit de hele pagina.
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
  scroll = false,
  className,
}: TableProps<T>) {
  const { t } = useI18n();
  return (
    <div className={cn("overflow-x-auto", scroll && "max-h-[42vh] overflow-y-auto", className)}>
      <table className="mt-1.5 w-full border-collapse text-[12.5px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  "border-b border-white/10 px-1.5 py-[5px] text-left text-[11.5px] font-normal text-muted",
                  scroll && "sticky top-0 bg-[#141414]",
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)} className="hover:bg-white/4">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "border-b border-white/5 px-1.5 py-[5px] align-top break-words",
                    col.className,
                  )}
                >
                  {display(col.cell(row))}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-1.5 py-2.5 text-muted">
                {empty ?? t("common.tableEmpty")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
