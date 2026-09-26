// Kimono BI — Utility functions v2

/**
 * Format currency with Romanian locale (thousands separator: .)
 * formatCurrency(2381605, 'RON') => "2.381.605 RON"
 * formatCurrency(49.99, 'USD') => "$49.99"
 */
export function formatCurrency(
  value: number | null | undefined,
  currency: string = 'RON',
  options: { compact?: boolean; decimals?: number } = {}
): string {
  if (value == null || isNaN(value)) return '-';

  const { compact = false, decimals } = options;

  if (compact) {
    if (Math.abs(value) >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M ${currency}`;
    }
    if (Math.abs(value) >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K ${currency}`;
    }
  }

  const fractionDigits = decimals ?? (currency === 'RON' ? 0 : 2);

  if (currency === 'USD' || currency === 'EUR') {
    const symbol = currency === 'USD' ? '$' : '\u20AC';
    return `${symbol}${value.toLocaleString('en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })}`;
  }

  return `${value.toLocaleString('ro-RO', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} ${currency}`;
}

/**
 * Format number with locale thousands separator
 * formatNumber(12345) => "12.345"
 */
export function formatNumber(
  value: number | null | undefined,
  options: { compact?: boolean; decimals?: number } = {}
): string {
  if (value == null || isNaN(value)) return '-';

  const { compact = false, decimals = 0 } = options;

  if (compact) {
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString('ro-RO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format percent
 * formatPercent(0.1234) => "+12.3%"
 * formatPercent(-0.05, { sign: false }) => "5.0%"
 */
export function formatPercent(
  value: number | null | undefined,
  options: { sign?: boolean; decimals?: number } = {}
): string {
  if (value == null || isNaN(value)) return '-';

  const { sign = true, decimals = 1 } = options;
  const pct = value * 100;
  const formatted = Math.abs(pct).toFixed(decimals) + '%';

  if (!sign) return formatted;
  if (pct > 0) return `+${formatted}`;
  if (pct < 0) return `-${formatted}`;
  return formatted;
}

/**
 * Format date in Romanian format
 * formatDate(new Date()) => "25 apr. 2026"
 * formatDate(new Date(), 'short') => "25/04/2026"
 */
export function formatDate(
  value: Date | string | null | undefined,
  style: 'medium' | 'short' | 'long' | 'relative' = 'medium'
): string {
  if (!value) return '-';

  const date = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(date.getTime())) return '-';

  if (style === 'relative') {
    const now = Date.now();
    const diff = now - date.getTime();
    const minutes = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days = Math.floor(diff / 86_400_000);

    if (minutes < 1) return 'acum';
    if (minutes < 60) return `acum ${minutes} min`;
    if (hours < 24) return `acum ${hours}h`;
    if (days === 1) return 'ieri';
    if (days < 7) return `acum ${days} zile`;
  }

  if (style === 'short') {
    return date.toLocaleDateString('ro-RO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  if (style === 'long') {
    return date.toLocaleDateString('ro-RO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  return date.toLocaleDateString('ro-RO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Combine class names (like clsx, no external dependency)
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Slugify a string
 * slugify("Kimono Group SRL") => "kimono-group-srl"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Get initials from full name
 * getInitials("Andrei Francisc") => "AF"
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Get avatar color class based on hash of string
 */
const AVATAR_COLORS = ['orange', 'green', 'blue', 'purple', 'pink', 'gray'] as const;

export function getAvatarColor(id: string): typeof AVATAR_COLORS[number] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Calculate percent change between two values
 * percentChange(100, 120) => 0.2 (20%)
 */
export function percentChange(
  current: number,
  previous: number
): number | null {
  if (!previous || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/**
 * Truncate string
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
