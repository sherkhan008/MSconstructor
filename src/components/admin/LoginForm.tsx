'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!result.ok) {
        setError(result.message ?? 'Не удалось войти');
        setIsSubmitting(false);
        return;
      }
      router.push('/admin/orders');
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1">
        <span className="tech-label">Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
          autoComplete="username"
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="tech-label">Пароль</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
          autoComplete="current-password"
          required
        />
      </label>

      {error && <p className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}

      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? 'Входим…' : 'Войти'}
      </Button>
    </form>
  );
}
