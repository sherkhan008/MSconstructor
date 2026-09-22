'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { contactRequestSchemaFor, type ContactRequestInput } from '@/lib/contact-schema';
import { Button } from '@/components/ui/Button';
import { t } from '@/lib/i18n/format';
import { apiHeaders } from '@/lib/i18n/request';
import { CK, CN } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

export function ContactForm() {
  const locale = useLocale();
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactRequestInput>({ resolver: zodResolver(contactRequestSchemaFor(locale)) });

  async function onSubmit(data: ContactRequestInput) {
    setStatus('idle');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: apiHeaders(locale),
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (result.ok) {
        setStatus('success');
        reset();
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3" noValidate>
      <div>
        <label htmlFor="contact-name" className="tech-label mb-1 block">
          {t(CN['CN-006'], locale)}
        </label>
        <input
          id="contact-name"
          {...register('name')}
          className="h-11 w-full border border-line bg-surface px-3 text-sm outline-none focus:border-blueprint"
          autoComplete="name"
        />
        {errors.name && <p className="mt-1 text-xs text-danger">{errors.name.message}</p>}
      </div>

      <div>
        <label htmlFor="contact-phone" className="tech-label mb-1 block">
          {t(CN['CN-007'], locale)}
        </label>
        <input
          id="contact-phone"
          {...register('phone')}
          placeholder={t(CK['CK-008'], locale)}
          className="mono h-11 w-full border border-line bg-surface px-3 text-sm outline-none focus:border-blueprint"
          autoComplete="tel"
        />
        {errors.phone && <p className="mt-1 text-xs text-danger">{errors.phone.message}</p>}
      </div>

      <div>
        <label htmlFor="contact-message" className="tech-label mb-1 block">
          {t(CN['CN-008'], locale)}
        </label>
        <textarea
          id="contact-message"
          {...register('message')}
          rows={4}
          className="w-full resize-none border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-blueprint"
        />
        {errors.message && <p className="mt-1 text-xs text-danger">{errors.message.message}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t(CN['CN-009'], locale) : t(CN['CN-010'], locale)}
      </Button>

      {status === 'success' && <p className="text-sm text-success">{t(CN['CN-011'], locale)}</p>}
      {status === 'error' && <p className="text-sm text-danger">{t(CN['CN-012'], locale)}</p>}
    </form>
  );
}
