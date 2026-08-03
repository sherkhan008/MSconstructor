'use client';

import { useState } from 'react';
import { formatKg, formatPrice } from '@/lib/money';
import type { BomLine } from '@/lib/types/domain';

const TYPE_LABEL: Record<string, string> = {
  UPRIGHT: 'Стойки',
  SHELF: 'Полки',
  BEAM_LONGITUDINAL: 'Балки продольные',
  BEAM_DEPTH: 'Балки поперечные',
  TIE: 'Стяжки',
  CROSS_BRACE: 'Раскосы',
  FASTENER: 'Крепёж',
  FOOT: 'Опоры',
  CONNECTOR: 'Соединители',
  REAR_WALL: 'Задние стенки',
  SIDE_WALL: 'Боковые стенки',
  ACCESSORY: 'Аксессуары',
};

export function BomTable({ lines, totalWeightKg }: { lines: Omit<BomLine, 'unitCost'>[]; totalWeightKg: number }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between bg-surface-muted px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="font-display text-lg">Комплектация (спецификация)</span>
        <span className="tech-label">{open ? 'Скрыть' : `Показать · ${lines.length} поз.`}</span>
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="tech-label border-b border-line text-left">
                <th className="px-4 py-2 font-normal">Компонент</th>
                <th className="px-2 py-2 font-normal">Артикул</th>
                <th className="px-2 py-2 text-right font-normal">Кол-во</th>
                <th className="px-2 py-2 text-right font-normal">Цена</th>
                <th className="px-4 py-2 text-right font-normal">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={`${line.componentId}-${i}`} className="border-b border-line/60 last:border-b-0">
                  <td className="px-4 py-2">
                    <div>{line.name}</div>
                    <div className="tech-label">{TYPE_LABEL[line.type] ?? line.type}</div>
                  </td>
                  <td className="mono px-2 py-2 text-xs text-steel">{line.sku}</td>
                  <td className="mono px-2 py-2 text-right">{line.quantity}</td>
                  <td className="mono px-2 py-2 text-right">{formatPrice(line.unitPrice)}</td>
                  <td className="mono px-4 py-2 text-right font-medium">{formatPrice(line.totalPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="tech-label border-t border-line px-4 py-2 text-right">
            Общий вес: {formatKg(totalWeightKg)}
          </div>
        </div>
      )}
    </div>
  );
}
