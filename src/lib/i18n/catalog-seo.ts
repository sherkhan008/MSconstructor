import type { ProductModel } from '@/lib/types/domain';
import type { Locale } from './locales';
import { pick, type Entry } from './format';
import { SE } from './strings';

/**
 * ProductModel.seo (seoTitle / seoDescription columns) is Russian-only: the
 * database has no Kazakh SEO columns. The owner-reviewed Kazakh SEO text for
 * public models lives in the CSV (SE-012, SE-013) and is keyed here by model
 * slug.
 */
const KAZAKH_MODEL_SEO: Record<string, { title: Entry; description: Entry }> = {
  'ms-standard': { title: SE['SE-012'], description: SE['SE-013'] },
};

/**
 * Title + meta description of a model page in `locale`.
 *   ru → the model's own SEO columns (unchanged behaviour);
 *   kk → the owner-reviewed Kazakh SEO text for that slug; a model without one
 *        (not public today) falls back to its Kazakh name + short description
 *        from the *Kk catalog columns — never to the Russian SEO text.
 */
export function modelSeo(
  model: Pick<ProductModel, 'slug' | 'seo' | 'name' | 'shortDescription'>,
  locale: Locale,
): { title: string; description: string } {
  if (locale === 'ru') return model.seo;
  const kk = KAZAKH_MODEL_SEO[model.slug];
  if (kk) return { title: kk.title.kk, description: kk.description.kk };
  return { title: pick(model.name, locale), description: pick(model.shortDescription, locale) };
}
