// File: components/AuthRefresh.tsx
'use client';

import { ReactNode } from 'react';
import { useJWTRefresh } from '@/lib/hooks/useJWTRefresh';

interface AuthRefreshProps {
  children: ReactNode;
}

/**
 * Componente cliente que envuelve el contenido protegido,
 * invocando useJWTRefresh para mantener el JWT fresco.
 */
export default function AuthRefresh({ children }: AuthRefreshProps) {
  // Hook que pide un nuevo JWT cada 14 minutos
  useJWTRefresh();
  return <>{children}</>;
}