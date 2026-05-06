# Sharp Design → Chart.js Token Mapping

> **Document Purpose**: Provides a definitive mapping from Sharp Design CSS custom properties (defined in `styles.scss`) to Chart.js-safe hex/RGBA values.  
> **Target Audience**: Frontend developers configuring Chart.js datasets, scales, tooltips, and legends.  
> **Last Updated**: 2026-05-06

---

## 1. Mapping Philosophy

Chart.js does **not** natively resolve CSS custom properties (`var(--color-*)`) inside its canvas rendering context. All colors must be supplied as **static hex strings** or **RGBA strings**.

This document provides:
1. **Direct hex/RGBA equivalents** for every design token
2. **Dark theme** (default) and **light theme** values
3. **Recommended alpha multipliers** for fills vs borders vs hover states
4. **Code comment conventions** to keep chart configs maintainable

---

## 2. Complete Token Mapping Table

### 2.1 Background Colors

| CSS Custom Property | Dark Theme Hex | Dark Theme RGBA | Light Theme Hex | Light Theme RGBA | Chart.js Usage |
|:---|:---|:---|:---|:---|:---|
| `--color-bg-primary` | `#0c1220` | `rgba(12, 18, 32, 1)` | `#f8fafc` | `rgba(248, 250, 252, 1)` | Canvas background, tooltip bg |
| `--color-bg-secondary` | `#162032` | `rgba(22, 32, 50, 1)` | `#ffffff` | `rgba(255, 255, 255, 1)` | Tooltip background, card bg |
| `--color-bg-tertiary` | `#1e293b` | `rgba(30, 41, 59, 1)` | `#f1f5f9` | `rgba(241, 245, 249, 1)` | Hover states, subtle fills |

**Chart.js Code Convention:**
```typescript
// ═══════════════════════════════════════════════════
// Token: --color-bg-secondary
// Theme: Dark (default)
// Usage: Tooltip background
// ═══════════════════════════════════════════════════
backgroundColor: 'rgba(22, 32, 50, 0.9)',  // 90% opacity for overlay effect
```

---

### 2.2 Border Colors

| CSS Custom Property | Dark Theme Hex | Dark Theme RGBA | Light Theme Hex | Light Theme RGBA | Chart.js Usage |
|:---|:---|:---|:---|:---|:---|
| `--color-border` | `#2a3a50` | `rgba(42, 58, 80, 1)` | `#e2e8f0` | `rgba(226, 232, 240, 1)` | Grid lines, axis borders, tooltip borders |
| `--color-border-light` | `#2a3a504d` | `rgba(42, 58, 80, 0.3)` | `#e2e8f080` | `rgba(226, 232, 240, 0.5)` | Subtle grid lines, divider lines |

**Chart.js Code Convention:**
```typescript
// ═══════════════════════════════════════════════════
// Token: --color-border
// Theme: Dark
// Alpha: 0.2 for grid lines (subtle)
// Usage: X/Y axis grid
// ═══════════════════════════════════════════════════
scales: {
  x: {
    grid: { color: 'rgba(42, 58, 80, 0.2)' },  // 20% opacity for subtle grid
  },
  y: {
    grid: { color: 'rgba(42, 58, 80, 0.2)' },
  },
}
```

---

### 2.3 Primary & Accent Colors

| CSS Custom Property | Hex Value | RGBA Value | Chart.js Usage | Notes |
|:---|:---|:---|:---|:---|
| `--color-primary` | `#00c6ff` | `rgba(0, 198, 255, 1)` | Primary dataset border, point bg | Main brand color |
| `--color-primary-start` | `#00c6ff` | `rgba(0, 198, 255, 1)` | Gradient start | Same as primary |
| `--color-primary-end` | `#0072ff` | `rgba(0, 114, 255, 1)` | Gradient end | Darker blue for gradients |
| `--color-primary-solid` | `#00c6ff` | `rgba(0, 198, 255, 1)` | Solid fills | Same as primary |
| `--color-accent-blue` | `#00c6ff` | `rgba(0, 198, 255, 1)` | Dataset color, bar fills | Same as primary |
| `--color-accent-blue-dark` | `#0072ff` | `rgba(0, 114, 255, 1)` | Hover states, emphasis | Darker variant |
| `--color-accent-green` | `#2ecc71` | `rgba(46, 204, 113, 1)` | Success datasets, positive trends | Emerald green |
| `--color-accent-red` | `#e74c3c` | `rgba(231, 76, 60, 1)` | Danger datasets, negative trends | Alert red |
| `--color-accent-yellow` | `#f39c12` | `rgba(243, 156, 18, 1)` | Warning datasets, pending states | Amber |
| `--color-accent-purple` | `#9b59b6` | `rgba(155, 89, 182, 1)` | Secondary datasets | Amethyst |
| `--color-accent-teal` | `#1abc9c` | `rgba(26, 188, 156, 1)` | Tertiary datasets | Turquoise |
| `--color-accent-orange` | `#e67e22` | `rgba(230, 126, 34, 1)` | Highlight datasets | Pumpkin |

**Chart.js Code Convention — Line Chart with Gradient Fill:**
```typescript
// ═══════════════════════════════════════════════════
// Token: --color-accent-blue (--color-primary)
// Usage: Line chart with gradient fill
// Technique: Canvas gradient in backgroundColor callback
// ═══════════════════════════════════════════════════
{
  label: 'Bookings',
  data: [12, 19, 15, 17, 22, 24, 20],
  // Border: solid primary color
  borderColor: '#00c6ff',                    // --color-accent-blue
  // Fill: vertical gradient using primary alpha variants
  backgroundColor: (context: any) => {
    const { chart } = context;
    const { ctx, chartArea } = chart;
    if (!chartArea) return 'rgba(0, 198, 255, 0.1)';  // Fallback: 10% primary
    const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    gradient.addColorStop(0, 'rgba(0, 198, 255, 0.05)');   // 5% primary (bottom)
    gradient.addColorStop(1, 'rgba(0, 198, 255, 0.35)');   // 35% primary (top)
    return gradient;
  },
  fill: true,
  tension: 0.4,
  borderWidth: 2,
  pointRadius: 3,
  pointHoverRadius: 5,
  pointBackgroundColor: '#00c6ff',           // --color-accent-blue
  pointBorderColor: '#ffffff',               // White for contrast
  pointBorderWidth: 2,
}
```

**Chart.js Code Convention — Doughnut/Pie Chart Palette:**
```typescript
// ═══════════════════════════════════════════════════
// Token: Multi-accent palette
// Usage: Doughnut chart segments
// Order: Primary → Purple → Green → Yellow → Red
// ═══════════════════════════════════════════════════
{
  data: [35, 25, 20, 15, 5],
  backgroundColor: [
    '#00c6ff',    // --color-accent-blue    (primary)
    '#9b59b6',    // --color-accent-purple  (secondary)
    '#2ecc71',    // --color-accent-green   (tertiary)
    '#f39c12',    // --color-accent-yellow  (quaternary)
    '#e74c3c',    // --color-accent-red     (quinary)
  ],
  borderWidth: 0,       // Clean look for doughnuts
  hoverOffset: 4,       // Pop effect on hover
}
```

**Chart.js Code Convention — Bar Chart:**
```typescript
// ═══════════════════════════════════════════════════
// Token: --color-accent-blue
// Usage: Bar chart with solid + border
// Alpha: 70% fill, 100% border
// ═══════════════════════════════════════════════════
{
  label: 'Bookings',
  data: [8, 12, 15, 10, 7, 11, 9, 5],
  backgroundColor: 'rgba(0, 198, 255, 0.7)',   // 70% opacity fill
  borderColor: '#00c6ff',                       // Solid border
  borderWidth: 1,
  borderRadius: 0,
  barThickness: 12,
}
```

---

### 2.4 Semantic Colors

| CSS Custom Property | Hex Value | RGBA Value | Semantic Meaning | Chart.js Usage |
|:---|:---|:---|:---|:---|
| `--color-success` | `#2ecc71` | `rgba(46, 204, 113, 1)` | Positive, completed, online | Positive trend lines, success metrics |
| `--color-warning` | `#f39c12` | `rgba(243, 156, 18, 1)` | Pending, caution, attention | Warning datasets, pending states |
| `--color-danger` | `#e74c3c` | `rgba(231, 76, 60, 1)` | Error, cancelled, offline | Negative trends, error metrics |
| `--color-info` | `#00c6ff` | `rgba(0, 198, 255, 1)` | Informational, neutral | Info datasets, default primary |

**Note**: `--color-info` is identical to `--color-primary` and `--color-accent-blue`. Use `--color-info` for semantic clarity when the data represents information rather than brand identity.

---

### 2.5 Text Colors

| CSS Custom Property | Dark Theme Hex | Dark Theme RGBA | Light Theme Hex | Light Theme RGBA | Chart.js Usage |
|:---|:---|:---|:---|:---|:---|
| `--color-text-primary` | `#e2e8f0` | `rgba(226, 232, 240, 1)` | `#1e293b` | `rgba(30, 41, 59, 1)` | Axis labels, legend text, tooltip titles |
| `--color-text-secondary` | `#94a3b8` | `rgba(148, 163, 184, 1)` | `#64748b` | `rgba(100, 116, 139, 1)` | Subtitle text, secondary legends, tick labels |
| `--color-text-disabled` | `#475569` | `rgba(71, 85, 105, 1)` | `#94a3b8` | `rgba(148, 163, 184, 1)` | Disabled states, placeholder text |

**Chart.js Code Convention — Scale Ticks & Legend:**
```typescript
// ═══════════════════════════════════════════════════
// Token: --color-text-secondary
// Theme: Dark
// Usage: Axis tick labels and legend text
// ═══════════════════════════════════════════════════
options: {
  plugins: {
    legend: {
      labels: {
        color: '#94a3b8',           // --color-text-secondary
        font: {
          size: 12,
          family: "'Inter', 'Microsoft YaHei', sans-serif",
        },
      },
    },
  },
  scales: {
    x: {
      ticks: { color: '#94a3b8' },   // --color-text-secondary
    },
    y: {
      ticks: { color: '#94a3b8' },   // --color-text-secondary
    },
  },
}
```

**Chart.js Code Convention — Tooltip Text:**
```typescript
// ═══════════════════════════════════════════════════
// Token: --color-text-primary / --color-text-secondary
// Theme: Dark
// Usage: Tooltip title and body text
// ═══════════════════════════════════════════════════
tooltip: {
  backgroundColor: 'rgba(22, 32, 50, 0.9)',   // --color-bg-secondary @ 90%
  titleColor: '#e2e8f0',                       // --color-text-primary
  bodyColor: '#94a3b8',                        // --color-text-secondary
  borderColor: 'rgba(42, 58, 80, 0.5)',        // --color-border @ 50%
  borderWidth: 1,
  padding: 10,
  usePointStyle: true,
}
```

---

## 3. Alpha Channel Reference

When converting solid hex colors to RGBA for fills, gradients, or hover states, use these standard alpha multipliers:

| Visual Purpose | Recommended Alpha | Example (Primary Blue) | Usage |
|:---|:---|:---|:---|
| **Solid border / line** | `1.0` (100%) | `rgba(0, 198, 255, 1)` | `borderColor`, axis lines |
| **Strong fill** | `0.7` (70%) | `rgba(0, 198, 255, 0.7)` | Bar fills, prominent areas |
| **Medium fill** | `0.35` (35%) | `rgba(0, 198, 255, 0.35)` | Line chart gradient top |
| **Light fill** | `0.1` (10%) | `rgba(0, 198, 255, 0.1)` | Line chart solid fallback, subtle fills |
| **Very light fill** | `0.05` (5%) | `rgba(0, 198, 255, 0.05)` | Line chart gradient bottom |
| **Overlay background** | `0.9` (90%) | `rgba(22, 32, 50, 0.9)` | Tooltip backgrounds |
| **Subtle grid** | `0.2` (20%) | `rgba(42, 58, 80, 0.2)` | Grid lines |
| **Hover glow** | `0.3` (30%) | `rgba(0, 198, 255, 0.3)` | Shadow glow effects |

---

## 4. Theme-Aware Configuration Pattern

Since Chart.js configs are static objects, implement theme-aware coloring by selecting the appropriate hex values based on the active theme:

```typescript
// ═══════════════════════════════════════════════════
// File: chart-theme.service.ts (conceptual)
// Purpose: Centralized theme-aware color provider
// ═══════════════════════════════════════════════════

export const CHART_COLORS = {
  dark: {
    // Backgrounds
    bgPrimary: '#0c1220',
    bgSecondary: '#162032',
    bgTertiary: '#1e293b',
    // Borders
    border: '#2a3a50',
    borderLight: 'rgba(42, 58, 80, 0.3)',
    // Text
    textPrimary: '#e2e8f0',
    textSecondary: '#94a3b8',
    textDisabled: '#475569',
    // Accents
    primary: '#00c6ff',
    primaryDark: '#0072ff',
    success: '#2ecc71',
    warning: '#f39c12',
    danger: '#e74c3c',
    purple: '#9b59b6',
    teal: '#1abc9c',
    orange: '#e67e22',
  },
  light: {
    // Backgrounds
    bgPrimary: '#f8fafc',
    bgSecondary: '#ffffff',
    bgTertiary: '#f1f5f9',
    // Borders
    border: '#e2e8f0',
    borderLight: 'rgba(226, 232, 240, 0.5)',
    // Text
    textPrimary: '#1e293b',
    textSecondary: '#64748b',
    textDisabled: '#94a3b8',
    // Accents (intentionally same as dark for brand consistency)
    primary: '#00c6ff',
    primaryDark: '#0072ff',
    success: '#2ecc71',
    warning: '#f39c12',
    danger: '#e74c3c',
    purple: '#9b59b6',
    teal: '#1abc9c',
    orange: '#e67e22',
  },
} as const;

// Helper to get alpha-variant
export function withAlpha(hex: string, alpha: number): string {
  // Convert hex to rgba
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
```

---

## 5. Complete Chart.js Config Example

Below is a **complete, copy-pasteable** Chart.js configuration demonstrating **all tokens** in a dark-theme line chart:

```typescript
import type { ChartData, ChartOptions } from 'chart.js';

// ═══════════════════════════════════════════════════
// SHARP DESIGN TOKEN MAP — Line Chart Example
// File: dashboard.component.ts (reference)
// ═══════════════════════════════════════════════════

export const BOOKING_TREND_CHART_DATA: ChartData = {
  labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  datasets: [
    {
      label: 'Bookings',
      data: [12, 19, 15, 17, 22, 24, 20],
      // ── Token: --color-accent-blue ──
      borderColor: '#00c6ff',
      backgroundColor: (context: any) => {
        const { chart } = context;
        const { ctx, chartArea } = chart;
        if (!chartArea) return 'rgba(0, 198, 255, 0.1)';
        const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
        // Token: --color-accent-blue @ 5% alpha
        gradient.addColorStop(0, 'rgba(0, 198, 255, 0.05)');
        // Token: --color-accent-blue @ 35% alpha
        gradient.addColorStop(1, 'rgba(0, 198, 255, 0.35)');
        return gradient;
      },
      fill: true,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      // Token: --color-accent-blue
      pointBackgroundColor: '#00c6ff',
      // White point border for contrast
      pointBorderColor: '#ffffff',
      pointBorderWidth: 2,
    },
    {
      label: 'Revenue ($)',
      data: [350, 420, 380, 400, 520, 580, 490],
      // ── Token: --color-accent-green ──
      borderColor: '#2ecc71',
      // Token: --color-accent-green @ 10% alpha
      backgroundColor: 'rgba(46, 204, 113, 0.1)',
      fill: true,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      // Token: --color-accent-green
      pointBackgroundColor: '#2ecc71',
      pointBorderColor: '#ffffff',
      pointBorderWidth: 2,
      yAxisID: 'y1',
    },
  ],
};

export const BOOKING_TREND_CHART_OPTIONS: ChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top',
      labels: {
        usePointStyle: true,
        boxWidth: 6,
        // ── Token: --color-text-secondary ──
        color: '#94a3b8',
      },
    },
    tooltip: {
      mode: 'index',
      intersect: false,
      // ── Token: --color-bg-secondary @ 90% alpha ──
      backgroundColor: 'rgba(22, 32, 50, 0.9)',
      // ── Token: --color-text-primary ──
      titleColor: '#e2e8f0',
      // ── Token: --color-text-secondary ──
      bodyColor: '#94a3b8',
      // ── Token: --color-border @ 50% alpha ──
      borderColor: 'rgba(42, 58, 80, 0.5)',
      borderWidth: 1,
      padding: 10,
      usePointStyle: true,
    },
  },
  scales: {
    x: {
      grid: {
        // ── Token: --color-border @ 20% alpha ──
        color: 'rgba(42, 58, 80, 0.2)',
      },
      ticks: {
        // ── Token: --color-text-secondary ──
        color: '#94a3b8',
      },
    },
    y: {
      beginAtZero: true,
      grid: {
        // ── Token: --color-border @ 20% alpha ──
        color: 'rgba(42, 58, 80, 0.2)',
      },
      ticks: {
        // ── Token: --color-text-secondary ──
        color: '#94a3b8',
      },
    },
    y1: {
      beginAtZero: true,
      position: 'right',
      grid: { display: false },
      ticks: {
        // ── Token: --color-text-secondary ──
        color: '#94a3b8',
        callback: (val: any) => '$' + val,
      },
    },
  },
  interaction: { mode: 'nearest', axis: 'x', intersect: false },
};
```

---

## 6. Default Color Palette Audit

The current `app-chart.component.ts` defines a default color palette that **deviates** from the Sharp Design system:

| Current Default | Sharp Design Equivalent | Action Required |
|:---|:---|:---|
| `#667eea` | ❌ No match | Replace with `--color-accent-purple` (`#9b59b6`) or `--color-primary` (`#00c6ff`) |
| `#00B42A` | `--color-accent-green` (`#2ecc71`) | ✅ Close match; consider unifying to `#2ecc71` |
| `#FF7D00` | `--color-accent-orange` (`#e67e22`) | ✅ Close match; consider unifying to `#e67e22` |
| `#F53F3F` | `--color-accent-red` (`#e74c3c`) | ✅ Close match; consider unifying to `#e74c3c` |
| `#1677FF` | `--color-primary` (`#00c6ff`) | ❌ Different blue; should use `#00c6ff` |
| `#764ba2` | `--color-accent-purple` (`#9b59b6`) | ✅ Close match |
| `#86909C` | `--color-text-secondary` (`#94a3b8`) | ✅ Close match |

**Recommendation**: Update `app-chart.component.ts` defaultColors to use the official Sharp Design palette:

```typescript
readonly defaultColors: string[] = [
  '#00c6ff',   // --color-primary / --color-accent-blue
  '#2ecc71',   // --color-accent-green
  '#9b59b6',   // --color-accent-purple
  '#f39c12',   // --color-accent-yellow
  '#e74c3c',   // --color-accent-red
  '#1abc9c',   // --color-accent-teal
  '#e67e22',   // --color-accent-orange
];
```

---

## 7. Comment Convention Standard

All Chart.js color values in `.ts` files **must** use this comment block format:

```typescript
// ═══════════════════════════════════════════════════
// Token: {CSS_CUSTOM_PROPERTY_NAME}
// Theme: Dark | Light
// Alpha: {X.X} (if applicable)
// Usage: { brief description }
// ═══════════════════════════════════════════════════
{colorProperty}: '{hexOrRgbaValue}',
```

**Rules:**
1. Always reference the **CSS custom property name** (e.g., `--color-accent-blue`)
2. Always specify **theme context** (dark is default)
3. Include **alpha** when using RGBA
4. Describe **usage context** (border, fill, tooltip, grid, etc.)
5. Use `// ──` for inline single-token comments within existing code

---

## 8. Quick Reference Card

```
┌─────────────────────────────────────────────────┐
│  SHARP DESIGN → CHART.JS QUICK REFERENCE        │
├─────────────────────────────────────────────────┤
│  Primary:      #00c6ff  →  rgba(0, 198, 255, a) │
│  Success:      #2ecc71  →  rgba(46, 204, 113, a)│
│  Warning:      #f39c12  →  rgba(243, 156, 18, a)│
│  Danger:       #e74c3c  →  rgba(231, 76, 60, a) │
│  Purple:       #9b59b6  →  rgba(155, 89, 182, a)│
│  Teal:         #1abc9c  →  rgba(26, 188, 156, a)│
│  Orange:       #e67e22  →  rgba(230, 126, 34, a)│
├─────────────────────────────────────────────────┤
│  Text Primary:   #e2e8f0 (dark) / #1e293b (light)│
│  Text Secondary: #94a3b8 (dark) / #64748b (light)│
├─────────────────────────────────────────────────┤
│  Grid:    rgba(42, 58, 80, 0.2)  (dark)         │
│  Tooltip: rgba(22, 32, 50, 0.9)  (dark bg)      │
└─────────────────────────────────────────────────┘
```

---

## 9. File Cross-Reference

| Token Category | Source File(s) | Current Hardcoded Values |
|:---|:---|:---|
| Line chart colors | `dashboard.component.ts` | `borderColor: '#00c6ff'`, `pointBackgroundColor: '#00c6ff'` |
| Line chart gradient | `dashboard.component.ts` | `rgba(0, 198, 255, 0.05)` → `rgba(0, 198, 255, 0.35)` |
| Revenue line | `dashboard.component.ts` | `borderColor: '#2ecc71'`, `backgroundColor: 'rgba(46, 204, 113, 0.1)'` |
| Doughnut palette | `dashboard.component.ts` | `['#00c6ff', '#9b59b6', '#2ecc71', '#f39c12', '#e74c3c']` |
| Bar chart | `dashboard.component.ts` | `backgroundColor: 'rgba(0, 198, 255, 0.7)'`, `borderColor: '#00c6ff'` |
| Tooltip styling | `dashboard.component.ts` | `backgroundColor: 'rgba(22, 32, 50, 0.9)'`, `titleColor: '#e2e8f0'`, `bodyColor: '#94a3b8'` |
| Grid lines | `dashboard.component.ts` | `color: 'rgba(42, 58, 80, 0.2)'` |
| Axis ticks | `dashboard.component.ts` | `color: '#94a3b8'` |
| Default palette | `app-chart.component.ts` | `['#667eea', '#00B42A', '#FF7D00', '#F53F3F', '#1677FF', '#764ba2', '#86909C']` |
| Scale defaults | `app-chart.component.ts` | `color: '#86909C'`, `grid color: 'rgba(0, 0, 0, 0.04)'` |
| Tooltip defaults | `app-chart.component.ts` | `backgroundColor: 'rgba(29, 33, 41, 0.9)'` |

---

*End of Document*
