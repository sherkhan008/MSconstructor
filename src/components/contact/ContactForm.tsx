'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { contactRequestSchema, type ContactRequestInput } from '@/lib/contact-schema';
import { Button } from '@/components/ui/Button';

export function ContactForm() {
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactRequestInput>({ resolver: zodResolver(contactRequestSchema) });

  async function onSubmit(data: ContactRequestInput) {
    setStatus('idle');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          Имя
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
          Телефон
        </label>
        <input
          id="contact-phone"
          {...register('phone')}
          placeholder="+7 700 000 00 00"
          className="mono h-11 w-full border border-line bg-surface px-3 text-sm outline-none focus:border-blueprint"
          autoComplete="tel"
        />
        {errors.phone && <p className="mt-1 text-xs text-danger">{errors.phone.message}</p>}
      </div>

      <div>
        <label htmlFor="contact-message" className="tech-label mb-1 block">
          Сообщение
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
        {isSubmitting ? 'Отправка…' : 'Отправить'}
      </Button>

      {status === 'success' && <p className="text-sm text-success">Спасибо! Мы свяжемся с вами в ближайшее время.</p>}
      {status === 'error' && <p className="text-sm text-danger">Не удалось отправить. Попробуйте позже или напишите в WhatsApp.</p>}
    </form>
  );
}
