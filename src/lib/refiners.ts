export interface Department {
  id: number;
  code: string;
  name: string;
}

export interface Refiner {
  id: number;
  fullName: string;
  department: Department;
  title: string;
  extension: string;
  bio: string;
  profileUrl: string | null;
  badge: { url: string; width: number; height: number } | null;
  version: number;
  updatedAt: string;
}

export interface RefinerPage {
  content: Refiner[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}

/** Solo se aceptan imágenes https: nada del exterior se interpreta. */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
