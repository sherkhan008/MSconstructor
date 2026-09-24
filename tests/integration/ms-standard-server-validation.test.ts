import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import { POST as postOrder } from '@/app/api/orders/route';
import { clearMemoryOrders, countMemoryOrders } from '@/lib/orders/store';
import { uniformRow, type LooseSection, type UniformRowInput } from '../helpers/uniform-row';

/**
 * Proves the authoritative MS Standard matrix is enforced *server-side*,
 * independent of whatever the customer UI happens to offer — the whole
 * point of this task (frontend filtering alone is not enough). Every case
 * here is taken directly from the task's own supplied "valid" (§20) and
 * "invalid" (§19) example lists, run through the real
 * calculatePrice -> validateCompatibility chain and the real order
 * endpoint, against the real (mock) catalog.
 */

let sectionCounter = 0;
function section(width: number, overrides: Partial<ShelvingSection> = {}): LooseSection {
  sectionCounter += 1;
  return { id: `sec-${sectionCounter}`, width, rearWall: false, leftWall: false, rightWall: false, ...overrides };
}

function baseConfig(overrides: Partial<UniformRowInput>): ShelvingConfiguration {
  return uniformRow({
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 400,
    shelves: 5,
    sections: [section(1000)],
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
    ...overrides,
  });
}

describe('server-authoritative MS Standard compatibility', () => {
  let catalog: Catalog;

  beforeAll(async () => {
    resetCatalogCache();
    catalog = await getCatalog();
  });

  describe('valid configurations remain valid (task §20)', () => {
    const validCases = [
      { name: '700 × 1500 × 300, 6 shelves', height: 1500, depth: 300, shelves: 6, sections: [section(700)] },
      { name: '700 × 1800 × 800, 6 shelves', height: 1800, depth: 800, shelves: 6, sections: [section(700)] },
      { name: '700 × 2500 × 800, 8 shelves', height: 2500, depth: 800, shelves: 8, sections: [section(700)] },
      { name: '1000 × 1500 × 700, 6 shelves', height: 1500, depth: 700, shelves: 6, sections: [section(1000)] },
      { name: '1000 × 2000 × 800, 8 shelves', height: 2000, depth: 800, shelves: 8, sections: [section(1000)] },
      { name: '1000 × 3000 × 700, 8 shelves', height: 3000, depth: 700, shelves: 8, sections: [section(1000)] },
      { name: '1200 × 1500 × 600, 6 shelves', height: 1500, depth: 600, shelves: 6, sections: [section(1200)] },
      { name: '1200 × 2500 × 600, 8 shelves', height: 2500, depth: 600, shelves: 8, sections: [section(1200)] },
      { name: '1500 × 1800 × 600, 6 shelves', height: 1800, depth: 600, shelves: 6, sections: [section(1500)] },
      { name: '1500 × 3000 × 600, 8 shelves', height: 3000, depth: 600, shelves: 8, sections: [section(1500)] },
      // Height 1000 (ceiling 4) against the unchanged width/depth matrix.
      // These also prove the height is PRICEABLE, not merely compatible:
      // calculatePrice fails with MISSING_COMPONENT if no UPRIGHT exists.
      { name: '700 × 1000 × 300, 2 shelves', height: 1000, depth: 300, shelves: 2, sections: [section(700)] },
      { name: '700 × 1000 × 800, 4 shelves', height: 1000, depth: 800, shelves: 4, sections: [section(700)] },
      { name: '1000 × 1000 × 700, 4 shelves', height: 1000, depth: 700, shelves: 4, sections: [section(1000)] },
      { name: '1200 × 1000 × 600, 4 shelves', height: 1000, depth: 600, shelves: 4, sections: [section(1200)] },
      { name: '1500 × 1000 × 600, 4 shelves', height: 1000, depth: 600, shelves: 4, sections: [section(1500)] },
      { name: '1000+1200 × 1000 × 300, 3 shelves', height: 1000, depth: 300, shelves: 3, sections: [section(1000), section(1200)] },
    ];

    it.each(validCases)('$name prices successfully', ({ height, depth, shelves, sections }) => {
      const result = calculatePrice(baseConfig({ height, depth, shelves, sections }), catalog);
      expect(result.ok, result.ok ? '' : (result as { message: string }).message).toBe(true);
      if (!result.ok) return;
      expect(result.breakdown.total).toBeGreaterThan(0);
    });
  });

  describe('invalid width×depth combinations are rejected (task §19)', () => {
    const invalidCases = [
      { name: '700 width + 700 depth', sections: [section(700)], depth: 700 },
      { name: '1200 width + 700 depth', sections: [section(1200)], depth: 700 },
      { name: '1200 width + 800 depth', sections: [section(1200)], depth: 800 },
      { name: '1500 width + 700 depth', sections: [section(1500)], depth: 700 },
      { name: '1500 width + 800 depth', sections: [section(1500)], depth: 800 },
    ];

    it.each(invalidCases)('$name is rejected', ({ sections, depth }) => {
      const result = calculatePrice(baseConfig({ sections, depth, height: 2000, shelves: 4 }), catalog);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('INCOMPATIBLE_CONFIGURATION');
    });
  });

  describe('invalid height×shelf-count combinations are rejected (task §19)', () => {
    const invalidCases = [
      { name: '1500 height + 7 shelves', height: 1500, shelves: 7 },
      { name: '1500 height + 8 shelves', height: 1500, shelves: 8 },
      { name: '1800 height + 7 shelves', height: 1800, shelves: 7 },
      { name: '1800 height + 8 shelves', height: 1800, shelves: 8 },
      { name: '1000 height + 5 shelves', height: 1000, shelves: 5 },
      { name: '1000 height + 6 shelves', height: 1000, shelves: 6 },
      { name: '1000 height + 7 shelves', height: 1000, shelves: 7 },
      { name: '1000 height + 8 shelves', height: 1000, shelves: 8 },
    ];

    it.each(invalidCases)('$name is rejected', ({ height, shelves }) => {
      const result = calculatePrice(baseConfig({ height, shelves, depth: 400, sections: [section(1000)] }), catalog);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('INCOMPATIBLE_CONFIGURATION');
    });
  });

  describe('obsolete heights are rejected outright (task §19)', () => {
    it.each([500, 1200, 2300, 2400])('height=%dmm is rejected', (height) => {
      const result = calculatePrice(baseConfig({ height, depth: 400, shelves: 4, sections: [section(1000)] }), catalog);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('INCOMPATIBLE_CONFIGURATION');
    });
  });

  describe('height 1000 introduces no width/depth rule of its own (task §3)', () => {
    const stillInvalid = [
      { name: '700 width + 700 depth', sections: [section(700)], depth: 700 },
      { name: '1200 width + 800 depth', sections: [section(1200)], depth: 800 },
      { name: '1500 width + 700 depth', sections: [section(1500)], depth: 700 },
    ];

    it.each(stillInvalid)('$name is still rejected at height 1000 - for the width/depth reason, not the height', ({ sections, depth }) => {
      const result = calculatePrice(baseConfig({ height: 1000, depth, shelves: 4, sections }), catalog);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('INCOMPATIBLE_CONFIGURATION');
    });

    it('the multi-section depth intersection behaves identically at height 1000 and 2000', () => {
      // 700 + 1000 at depth 800 is in the intersection: valid at both heights.
      for (const height of [1000, 2000]) {
        const result = calculatePrice(
          baseConfig({ height, depth: 800, shelves: 3, sections: [section(700), section(1000)] }),
          catalog,
        );
        expect(result.ok, `depth 800 should stay valid at height ${height}`).toBe(true);
      }
      // 1000 + 1200 at depth 800 is outside it: rejected at both heights.
      for (const height of [1000, 2000]) {
        const result = calculatePrice(
          baseConfig({ height, depth: 800, shelves: 3, sections: [section(1000), section(1200)] }),
          catalog,
        );
        expect(result.ok, `depth 800 should stay invalid at height ${height}`).toBe(false);
      }
    });
  });

  describe('multi-section depth intersection is enforced (task §19)', () => {
    it('sections 1000 + 1200 at depth 800 is rejected (800 is not valid for 1200)', () => {
      const result = calculatePrice(
        baseConfig({ height: 2000, depth: 800, shelves: 4, sections: [section(1000), section(1200)] }),
        catalog,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('INCOMPATIBLE_CONFIGURATION');
    });

    it('sections 700 + 1000 at depth 700 is rejected (700mm depth is not valid for a 700mm section)', () => {
      const result = calculatePrice(
        baseConfig({ height: 2000, depth: 700, shelves: 4, sections: [section(700), section(1000)] }),
        catalog,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('INCOMPATIBLE_CONFIGURATION');
    });

    it('sections 700 + 1000 at depth 800 remains VALID (800 is in the intersection)', () => {
      const result = calculatePrice(
        baseConfig({ height: 2000, depth: 800, shelves: 4, sections: [section(700), section(1000)] }),
        catalog,
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('a client cannot bypass the matrix by submitting raw, never-offered values', () => {
    it('a totally invented depth (e.g. 650mm) is rejected, not silently coerced', () => {
      const result = calculatePrice(baseConfig({ depth: 650, sections: [section(1000)] }), catalog);
      expect(result.ok).toBe(false);
    });

    it('a totally invented width (e.g. 900mm) is rejected, not silently coerced', () => {
      const result = calculatePrice(baseConfig({ sections: [section(900)] }), catalog);
      expect(result.ok).toBe(false);
    });
  });
});

describe('invalid order submissions create zero Order rows (task §21)', () => {
  let ipCounter = 0;
  function postOrderRequest(body: unknown): Promise<Response> {
    ipCounter += 1;
    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.1.${ipCounter}` },
      body: JSON.stringify(body),
    });
    return postOrder(request);
  }

  function orderBodyWithConfig(configOverrides: Partial<UniformRowInput>) {
    return {
      fullName: 'Тест Тестов',
      phone: '+77001234567',
      email: 'test@example.com',
      city: 'Алматы',
      customerType: 'INDIVIDUAL',
      paymentPreference: 'BANK_TRANSFER',
      items: [{ configuration: baseConfig(configOverrides) }],
    };
  }

  beforeEach(() => {
    clearMemoryOrders();
  });

  it('a 700-width section at 700mm depth is rejected and creates NO order', async () => {
    const response = await postOrderRequest(orderBodyWithConfig({ depth: 700, sections: [section(700)] }));
    const json = await response.json();
    expect(response.status).toBe(422);
    expect(json.ok).toBe(false);
    expect(json.code).toBe('INCOMPATIBLE_CONFIGURATION');
    expect(countMemoryOrders()).toBe(0);
  });

  it('an obsolete height (2400mm) is rejected and creates NO order', async () => {
    const response = await postOrderRequest(orderBodyWithConfig({ height: 2400 }));
    expect(response.status).toBe(422);
    expect(countMemoryOrders()).toBe(0);
  });

  it('1500mm height with 8 shelves is rejected and creates NO order', async () => {
    const response = await postOrderRequest(orderBodyWithConfig({ height: 1500, shelves: 8 }));
    expect(response.status).toBe(422);
    expect(countMemoryOrders()).toBe(0);
  });

  it('1000mm height with 5 shelves is rejected and creates NO order', async () => {
    const response = await postOrderRequest(orderBodyWithConfig({ height: 1000, shelves: 5 }));
    expect(response.status).toBe(422);
    expect(countMemoryOrders()).toBe(0);
  });

  it('1000mm height with 4 shelves is accepted and creates exactly one order', async () => {
    const response = await postOrderRequest(orderBodyWithConfig({ height: 1000, shelves: 4 }));
    expect(response.status).toBe(201);
    expect(countMemoryOrders()).toBe(1);
  });

  it('a multi-section 1000+1200 row at depth 800 is rejected and creates NO order', async () => {
    const response = await postOrderRequest(
      orderBodyWithConfig({ depth: 800, sections: [section(1000), section(1200)] }),
    );
    expect(response.status).toBe(422);
    expect(countMemoryOrders()).toBe(0);
  });

  it('a genuinely valid configuration still creates exactly one order (control case)', async () => {
    const response = await postOrderRequest(orderBodyWithConfig({ height: 2000, depth: 400, sections: [section(1000)] }));
    expect(response.status).toBe(201);
    expect(countMemoryOrders()).toBe(1);
  });
});
