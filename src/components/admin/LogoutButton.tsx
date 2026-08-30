'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

export function LogoutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onClick() {
    setIsSubmitting(true);
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } finally {
      router.push('/admin/login');
      router.refresh();
    }
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick} disabled={isSubmitting}>
      Выйти
    </Button>
  );
}
