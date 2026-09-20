/* TEMPORARY audit scratch script — delete after use. Not part of the app. */
import { getCatalog } from '@/lib/data/repository';
import { calculatePrice, toPublicPriceResult } from '@/lib/pricing';
import type { ShelvingConfiguration } from '@/lib/types/domain';

function cfg(depth: number): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    height: 2000,
    depth,
    shelves: 4,
    sections: [{ id: 's1', width: 1000, rearWall: false, leftWall: false, rightWall: false }],
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
  } as ShelvingConfiguration;
}

async function main() {
  const catalog = await getCatalog();
  console.log('models:', catalog.models.map((m) => `${m.slug}:${m.active}`).join(' '));
  for (const depth of [300, 400, 600]) {
    const c = cfg(depth);
    const outcome = calculatePrice(c, catalog);
    if (outcome.ok === false) {
      console.log(`2000x1000x${depth} FAILED:`, JSON.stringify(outcome));
      continue;
    }
    const pub = toPublicPriceResult(outcome);
    console.log(
      `2000x1000x${depth} shelves=4  total=${outcome.breakdown.total} unitTotal=${outcome.breakdown.unitTotal} net=${outcome.breakdown.net} vat=${outcome.breakdown.vat}`,
    );
    console.log('   publicJSON:', JSON.stringify(pub));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e);
    process.exit(1);
  });
