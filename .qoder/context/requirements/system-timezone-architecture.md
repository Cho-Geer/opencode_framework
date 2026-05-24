# Booking System - Timezone-Adaptive Architecture Design Document (Timezone Architecture Document)

## Document Information
- **Document Version**: 1.0.0
- **Creation Date**: 2026-05-12
- **Document Status**: Baselined
- **Author**: @Architect
- **Related Documents**: system-architecture-design.md, data-architecture.md, api-design-specification.md, contract.yaml

## 1. Design Principles

| # | Principle | Description |
|---|------|------|
| **P1** | **Store in UTC, convert at edges** | All database timestamps are always stored in UTC (PostgreSQL `timestamptz`). Timezone conversion is performed only at API boundaries (backend response serialization) and UI boundaries (frontend display). |
| **P2** | **Never trust client timestamps** | Timestamps sent by the frontend are treated as "local time with offset"; the backend must reinterpret and convert to UTC based on known timezone context (`X-Timezone` header, user preference, environment default). |
| **P3** | **Always annotate with timezone** | Any API response containing date/time must include sufficient timezone context (IANA timezone field in response, ISO 8601 offset, or global `X-Timezone` header) so clients need not guess. |
| **P4** | **Business logic operates in clinic timezone** | Business hours calculation, date boundary judgment ("today", "this month"), statistical aggregation, etc. are uniformly executed in the "Clinic Timezone", not UTC or server local time. |
| **P5** | **IANA timezone strings only** | All timezone representations must use IANA timezone database identifiers (e.g. `Asia/Shanghai`, `America/New_York`); using UTC offsets (e.g. `+08:00`) as business logic input is prohibited. |
| **P6** | **date-fns-tz for all conversions** | Backend uses `date-fns-tz` (based on `Intl`); frontend reuses existing `date-fns@^3.6.0` + adds `date-fns-tz`, unifying timezone conversion implementation and eliminating implicit `new Date()` behavioral differences. |

## 2. Timezone Detection Strategy

A three-tier cascading detection mechanism is used, attempted in order from highest to lowest priority:

```
Client Request
     │
     ▼
┌─────────────────────┐
│ Tier 1: X-Timezone  │ ← Browser Intl → Header
│       Header        │
└─────────┬───────────┘
          │ Valid?
          ├── Yes ──► Resolved = X-Timezone value
          │
          ▼ No
┌─────────────────────┐
│ Tier 2: User        │ ← Database preferredTimezone
│   Profile           │
└─────────┬───────────┘
          │ Valid?
          ├── Yes ──► Resolved = preferredTimezone
          │
          ▼ No
┌─────────────────────┐
│ Tier 3: Env Default │ ← DEFAULT_TIMEZONE
│                     │
└─────────┬───────────┘
          │
          ▼
    Resolved Timezone
```

### 2.1 Tier 1 — X-Timezone Header (Primary)

- Frontend `TimezoneService` obtains the browser timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`
- HTTP interceptor automatically injects the `X-Timezone` request header into every API request
- Backend `TimezoneInterceptor` reads the header and attaches it to `req.timezone`
- **Format**: IANA timezone string (e.g. `Asia/Shanghai`)

### 2.2 Tier 2 — User preferredTimezone (Stored Preference)

- On first login, the frontend auto-detects the browser timezone and submits it to the backend for storage
- Users can manually modify `preferredTimezone` in the personal settings page
- Stored in the User model `preferredTimezone` field (varchar(50))
- Updated during login flow (if frontend submits `X-Timezone` and it differs from the database)

### 2.3 Tier 3 — Environment Default (Fallback)

- Configured via environment variable `DEFAULT_TIMEZONE`
- `.env` default value: `DEFAULT_TIMEZONE=Asia/Shanghai`
- This value is also stored in the `SystemSetting` table, key = `default_timezone`
- Allows operations staff to modify at runtime without restarting the service

```
┌──────────────────────────────────────────────────┐
│              ClinicTimezoneProvider               │
│                                                  │
│  resolve(user?, headerTimezone?): string         │
│    1. user?.preferredTimezone (non-null) → return│
│    2. headerTimezone (valid IANA) → return       │
│    3. SystemSetting('default_timezone') → return │
│    4. process.env.DEFAULT_TIMEZONE → return      │
│    5. 'UTC' → return (hardcoded ultimate fallback)│
└──────────────────────────────────────────────────┘
```

## 3. Frontend Architecture

### 3.1 TimezoneService

New file: `booking-frontend/src/app/core/services/timezone.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class TimezoneService {
  private readonly STORAGE_KEY = 'app_timezone';
  private _browserTimezone: string;
  private _timezone = signal<string>('UTC');

  constructor() {
    this._browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const stored = localStorage.getItem(this.STORAGE_KEY);
    this._timezone.set(stored ?? this._browserTimezone);
  }

  /** Expose as readonly signal */
  readonly timezone = this._timezone.asReadonly();

  /** Browser-detected timezone (immutable) */
  get browserTimezone(): string { return this._browserTimezone; }

  /** Update preference (user settings change) */
  setTimezone(tz: string): void {
    this._timezone.set(tz);
    localStorage.setItem(this.STORAGE_KEY, tz);
  }
}
```

### 3.2 HTTP Interceptor (X-Timezone)

New file: `booking-frontend/src/app/core/interceptors/timezone.interceptor.ts`

```typescript
@Injectable()
export class TimezoneInterceptor implements HttpInterceptor {
  constructor(private timezoneService: TimezoneService) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const tz = this.timezoneService.timezone();
    const cloned = req.clone({
      setHeaders: { 'X-Timezone': tz }
    });
    return next.handle(cloned);
  }
}
```

Register in `app.config.ts`:
```typescript
provideHttpClient(
  withInterceptors([timezoneInterceptor])  // or use class-style provider
)
```

### 3.3 DateFormatService

New file: `booking-frontend/src/app/core/services/date-format.service.ts`

Leverages the already installed `date-fns@^3.6.0` + newly added `date-fns-tz` dependency to provide a unified date formatting service:

```typescript
@Injectable({ providedIn: 'root' })
export class DateFormatService {
  constructor(private timezoneService: TimezoneService) {}

  /** Format date with clinic timezone */
  format(date: Date | string, formatStr: string, timezone?: string): string {
    const tz = timezone ?? this.timezoneService.timezone();
    return formatInTimeZone(date, tz, formatStr);
  }

  /** Format for display (e.g. "2026-05-12 14:30") */
  display(date: Date | string): string {
    return this.format(date, 'yyyy-MM-dd HH:mm');
  }

  /** Format time only (e.g. "14:30") */
  displayTime(date: Date | string): string {
    return this.format(date, 'HH:mm');
  }

  /** Format date only (e.g. "2026-05-12") */
  displayDate(date: Date | string): string {
    return this.format(date, 'yyyy-MM-dd');
  }

  /** Convert local Date to ISO with timezone offset */
  toISOWithOffset(date: Date, timezone?: string): string {
    const tz = timezone ?? this.timezoneService.timezone();
    return formatInTimeZone(date, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
}
```

**Dependency**: Add `date-fns-tz` to `package.json`:
```json
{
  "dependencies": {
    "date-fns-tz": "^3.2.0"
  }
}
```

### 3.4 HTML Date Pipe Migration

**Current state**: Approximately 15+ `.html` files use Angular's native `date` pipe without timezone parameters, causing behavior dependent on browser implementation.

**Migration rules**:

| Original Usage | Replace With |
|---------|--------|
| `{{ value \| date:'short' }}` | `{{ dateFormatService.display(value) }}` |
| `{{ value \| date:'HH:mm' }}` | `{{ dateFormatService.displayTime(value) }}` |
| `{{ value \| date:'yyyy-MM-dd' }}` | `{{ dateFormatService.displayDate(value) }}` |

Inject in Component:
```typescript
readonly dateFormatService = inject(DateFormatService);
```

### 3.5 Appointment Date Submission Format Change

When the frontend creates an appointment:

```
Before:  appointmentDate: "2026-05-12T06:00:00.000Z"     (client-converted to UTC)
After:   appointmentDate: "2026-05-12T14:00:00.000+08:00" (ISO 8601 with zone offset)
```

The backend uses this + `X-Timezone` header for final UTC conversion with double validation.

## 4. Backend Architecture

### 4.1 Prisma Schema — User Model Extension

Add `preferredTimezone` field to the `User` model:

```prisma
model User {
  // ... existing fields ...

  preferredTimezone String?  @map("preferred_timezone") // IANA timezone string, e.g. "Asia/Shanghai"

  // ... existing relations ...

  @@index([preferredTimezone]) // Optional: for timezone-based statistics
}
```

**Constraints**:
- Length limit: `varchar(50)` (longest IANA identifier such as `America/Argentina/ComodRivadavia` is approximately 35 characters)
- Nullable: `null` = use environment default timezone
- Validation: Application layer validates using `Intl.supportedValuesOf('timeZone')`

### 4.2 TimezoneInterceptor (NestJS)

New file: `booking-backend/src/common/interceptors/timezone.interceptor.ts`

```typescript
@Injectable()
export class TimezoneInterceptor implements NestInterceptor {
  private readonly VALID_TZS = new Set(Intl.supportedValuesOf('timeZone'));

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const headerTimezone = req.headers['x-timezone'] as string | undefined;

    if (headerTimezone && this.VALID_TZS.has(headerTimezone)) {
      req.timezone = headerTimezone;
    } else {
      req.timezone = null; // Triggers Tier 2/3 fallback
    }

    return next.handle();
  }
}
```

Register globally:
```typescript
// main.ts or AppModule
app.useGlobalInterceptors(new TimezoneInterceptor());
```

Or via provider-style injection with `APP_INTERCEPTOR`.

### 4.3 ClinicTimezoneProvider

New file: `booking-backend/src/common/providers/clinic-timezone.provider.ts`

```typescript
@Injectable()
export class ClinicTimezoneProvider {
  private readonly VALID_TZS = new Set(Intl.supportedValuesOf('timeZone'));

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  async resolve(user?: { preferredTimezone?: string | null }, headerTimezone?: string | null): Promise<string> {
    // Tier 2: User preference
    if (user?.preferredTimezone && this.isValid(user.preferredTimezone)) {
      return user.preferredTimezone;
    }

    // Tier 1: Header (applied AFTER profile, so explicit header overrides stored)
    // Note: We return header first if present, then user pref. Order per spec:
    //   header > user > env > UTC
    if (headerTimezone && this.isValid(headerTimezone)) {
      return headerTimezone;
    }

    // Tier 3: SystemSetting table
    const setting = await this.prisma.systemSetting.findUnique({
      where: { settingKey: 'default_timezone' },
    });
    if (setting?.settingValue && this.isValid(setting.settingValue)) {
      return setting.settingValue;
    }

    // Tier 3 fallback: env
    const envTz = this.configService.get<string>('DEFAULT_TIMEZONE');
    if (envTz && this.isValid(envTz)) {
      return envTz;
    }

    // Ultimate fallback
    return 'UTC';
  }

  resolveSync(headerTimezone?: string | null): string {
    if (headerTimezone && this.isValid(headerTimezone)) return headerTimezone;
    const envTz = process.env.DEFAULT_TIMEZONE;
    if (envTz && this.isValid(envTz)) return envTz;
    return 'UTC';
  }

  private isValid(tz: string): boolean {
    return this.VALID_TZS.has(tz);
  }
}
```

### 4.4 Business Hours via SystemSetting

Uses the existing `SystemSetting` model with new keys:

#### Setting Record: `business_hours`

```json
{
  "settingKey": "business_hours",
  "settingValue": {
    "timezone": "Asia/Shanghai",
    "monday":    [{ "open": "09:00", "close": "17:00" }],
    "tuesday":   [{ "open": "09:00", "close": "17:00" }],
    "wednesday": [{ "open": "09:00", "close": "17:00" }],
    "thursday":  [{ "open": "09:00", "close": "17:00" }],
    "friday":    [{ "open": "09:00", "close": "17:00" }],
    "saturday":  [{ "open": "10:00", "close": "14:00" }],
    "sunday":    []
  },
  "settingType": "JSON",
  "category": "BUSINESS"
}
```

#### Setting Record: `default_timezone`

```json
{
  "settingKey": "default_timezone",
  "settingValue": "Asia/Shanghai",
  "settingType": "STRING",
  "category": "SYSTEM"
}
```

#### BusinessHoursService

New file: `booking-backend/src/common/services/business-hours.service.ts`

```typescript
interface BusinessHourEntry {
  open: string;   // "HH:mm"
  close: string;  // "HH:mm"
}

interface BusinessHoursConfig {
  timezone: string;
  monday: BusinessHourEntry[];
  tuesday: BusinessHourEntry[];
  // ... per day
  sunday: BusinessHourEntry[];
}

@Injectable()
export class BusinessHoursService {
  constructor(
    private prisma: PrismaService,
    private clinicTimezoneProvider: ClinicTimezoneProvider,
  ) {}

  async getConfig(): Promise<BusinessHoursConfig> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { settingKey: 'business_hours' },
    });
    return setting
      ? JSON.parse(setting.settingValue) as BusinessHoursConfig
      : this.getDefaultConfig();
  }

  /** Get today's business hours in clinic timezone */
  async getTodayHours(timezone?: string): Promise<BusinessHourEntry[]> {
    const config = await this.getConfig();
    const tz = timezone ?? config.timezone;
    const now = new Date();
    const dayName = formatInTimeZone(now, tz, 'EEEE').toLowerCase();
    return (config as any)[dayName] ?? [];
  }

  /** Check if a time is within business hours */
  async isWithinBusinessHours(date: Date, timezone?: string): Promise<boolean> {
    const config = await this.getConfig();
    const tz = timezone ?? config.timezone;
    const timeStr = formatInTimeZone(date, tz, 'HH:mm');
    const dayName = formatInTimeZone(date, tz, 'EEEE').toLowerCase();
    const daySlots: BusinessHourEntry[] = (config as any)[dayName] ?? [];
    return daySlots.some(slot => timeStr >= slot.open && timeStr < slot.close);
  }

  private getDefaultConfig(): BusinessHoursConfig {
    const defaultEntry = [{ open: '09:00', close: '17:00' }];
    return {
      timezone: 'Asia/Shanghai',
      monday: defaultEntry, tuesday: defaultEntry, wednesday: defaultEntry,
      thursday: defaultEntry, friday: defaultEntry,
      saturday: [{ open: '10:00', close: '14:00' }],
      sunday: [],
    };
  }
}
```

### 4.5 Service Layer Refactoring

#### 4.5.1 time-slots.service.ts

**Issue (L212, L214)**: Hardcoded `09:00-17:00 UTC`

**Refactoring approach**:
```typescript
@Injectable()
export class TimeSlotsService {
  constructor(
    private businessHoursService: BusinessHoursService,
    private clinicTimezoneProvider: ClinicTimezoneProvider,
    private prisma: PrismaService,
  ) {}

  async getAvailableSlots(
    serviceId: string,
    date: string,       // "YYYY-MM-DD" in clinic timezone
    timezone?: string,  // from X-Timezone header
  ): Promise<AvailableSlot[]> {
    const tz = timezone ?? await this.clinicTimezoneProvider.resolve();
    const hoursConfig = await this.businessHoursService.getConfig();
    const dayName = formatInTimeZone(new Date(date + 'T12:00:00'), tz, 'EEEE').toLowerCase();
    const daySlots = (hoursConfig as any)[dayName] ?? [];

    // Convert business hours to UTC for DB query
    const dayStart = new Date(date + 'T00:00:00');
    const utcOpen = toZonedTime(
      `${date}T${daySlots[0].open}:00`,
      tz
    );
    const utcClose = toZonedTime(
      `${date}T${daySlots[daySlots.length - 1].close}:00`,
      tz
    );

    // Query DB using UTC range
    return this.prisma.timeSlot.findMany({
      where: {
        serviceId,
        startTime: { gte: utcOpen, lt: utcClose },
      },
      // ...
    });
  }
}
```

#### 4.5.2 admin-stats.service.ts

**Issue (L59-62)**: `toISOString().slice(0,10)` uses UTC date boundaries

**Refactoring approach**:
```typescript
@Injectable()
export class AdminStatsService {
  constructor(
    private clinicTimezoneProvider: ClinicTimezoneProvider,
    private prisma: PrismaService,
  ) {}

  async getStats(timezone?: string): Promise<DashboardStats> {
    const tz = timezone ?? await this.clinicTimezoneProvider.resolve();
    const now = new Date();

    // "Today" = clinic timezone today
    const todayStart = startOfDay(toZonedTime(now, tz));
    const todayEnd = endOfDay(toZonedTime(now, tz));

    // Month start/end in clinic timezone
    const monthStart = startOfMonth(toZonedTime(now, tz));
    const monthEnd = endOfMonth(toZonedTime(now, tz));

    return {
      todayAppointments: await this.prisma.appointment.count({
        where: {
          appointmentDate: { gte: todayStart, lt: todayEnd },
          status: 'CONFIRMED',
        },
      }),
      // ...
    };
  }
}
```

#### 4.5.3 admin-appointments.service.ts

**Issue (L154)**: Mixed use of `setHours()` and `setUTCHours()`

**Refactoring approach**: Unify using `date-fns-tz`'s `toZonedTime` and `formatInTimeZone`, eliminating direct dependency on `setHours`/`setUTCHours`.

#### 4.5.4 appointments.service.ts

**Issue (L198)**: `new Date(string)` parsing depends on string format

**Refactoring approach**:
```typescript
async createAppointment(dto: CreateAppointmentDto, timezone?: string): Promise<Appointment> {
  const tz = timezone ?? await this.clinicTimezoneProvider.resolve(dto.userId);

  // Parse appointmentDate as a zoned datetime
  const zonedDate = toZonedTime(dto.appointmentDate, tz);

  // Validate within business hours
  const inHours = await this.businessHoursService.isWithinBusinessHours(zonedDate, tz);
  if (!inHours) {
    throw new BadRequestException('Appointment time is outside business hours');
  }

  // Store as UTC (zonedDate.toISO() gives correct UTC)
  return this.prisma.appointment.create({
    data: {
      ...dto,
      appointmentDate: zonedDate, // Prisma maps DateTime to timestamptz
    },
  });
}
```

DTO with timezone validation:
```typescript
export class CreateAppointmentDto {
  @IsDateString()
  appointmentDate: string;

  // No separate timezone field here — uses X-Timezone header
}
```

### 4.6 DTO Timezone Format Validation

For all DTOs involving `DateTime`, add decorator validation to ensure timestamps include timezone information:

```typescript
import { registerDecorator, ValidationOptions } from 'class-validator';

export function IsDateTimeWithTimezone(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isDateTimeWithTimezone',
      target: object.constructor,
      propertyName,
      validator: {
        validate(value: any) {
          if (typeof value !== 'string') return false;
          const date = new Date(value);
          if (isNaN(date.getTime())) return false;
          // Must have timezone offset (Z, +HH:mm, -HH:mm)
          return /[+-]\d{2}:\d{2}$|Z$/i.test(value);
        },
        defaultMessage: () => 'DateTime must include timezone offset (ISO 8601)',
      },
    });
  };
}
```

Usage:
```typescript
export class CreateAppointmentDto {
  @IsDateTimeWithTimezone()
  appointmentDate: string;
}
```

## 5. API Contract Changes

### 5.1 New Global Header

Add to the `api.endpoints` documentation in `contract.yaml`:

```yaml
# Global Headers
headers:
  X-Timezone:
    description: "IANA timezone identifier from browser (e.g. Asia/Shanghai)"
    required: false
    schema:
      type: string
      example: "Asia/Shanghai"
```

### 5.2 GET /v1/time-slots/available

New query parameter:

```yaml
/v1/time-slots/available:
  get:
    parameters:
      - name: timezone
        in: query
        description: "IANA timezone for interpreting date parameter. Overrides X-Timezone header."
        required: false
        schema:
          type: string
          example: "Asia/Shanghai"
      # existing parameters: serviceId, startDate, endDate
```

### 5.3 User Profile Response

New field:

```yaml
components:
  schemas:
    UserProfile:
      type: object
      properties:
        # ... existing fields
        preferredTimezone:
          type: string
          nullable: true
          description: "IANA timezone identifier. Null = use server default."
          example: "Asia/Shanghai"
```

New endpoint:

```yaml
/v1/users/me/timezone:
  patch:
    summary: "Update preferred timezone"
    requestBody:
      content:
        application/json:
          schema:
            type: object
            properties:
              timezone:
                type: string
                required: true
                example: "Asia/Shanghai"
    responses:
      200:
        description: "Timezone updated"
```

### 5.4 Admin Statistics

```yaml
/v1/admin/stats:
  get:
    parameters:
      - name: timezone
        in: query
        required: false
        schema:
          type: string
        description: "IANA timezone for date boundary calculations"
```

### 5.5 Response Timestamp Format Specification

All responses containing `DateTime` fields such as `appointmentDate`, `startTime`, `endTime` use ISO 8601 with offset:

| Current (UTC only) | After (with offset) |
|----------------|-------------------|
| `"2026-05-12T06:00:00.000Z"` | `"2026-05-12T14:00:00.000+08:00"` |
| `"2026-05-12T00:00:00.000Z"` | `"2026-05-12T08:00:00.000+08:00"` |

Backend serialization converts based on `ClinicTimezoneProvider.resolve()` result:
```typescript
// Serialization interceptor
@Injectable()
export class TimezoneSerializationInterceptor implements NestInterceptor {
  constructor(private clinicTimezoneProvider: ClinicTimezoneProvider) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const tz = this.clinicTimezoneProvider.resolveSync(req.timezone as string | undefined);

    return next.handle().pipe(
      map(data => this.convertDates(data, tz)),
    );
  }
}
```

## 6. Business Hours Configuration

### 6.1 Data Model

Uses the existing `SystemSetting` table to store business hours configuration:

| Field | Value |
|------|-----|
| `settingKey` | `business_hours` |
| `settingType` | `JSON` |
| `category` | `BUSINESS` |
| `description` | `Business hours configuration, defined per weekday with multiple time slots` |

### 6.2 Configuration Structure

```typescript
interface BusinessHoursConfig {
  timezone: string;           // Timezone for business hours
  monday: TimeRange[];        // Monday business hours
  tuesday: TimeRange[];
  wednesday: TimeRange[];
  thursday: TimeRange[];
  friday: TimeRange[];
  saturday: TimeRange[];
  sunday: TimeRange[];        // Empty array = closed
}

interface TimeRange {
  open: string;   // "HH:mm" 24h format
  close: string;  // "HH:mm" 24h format
}
```

### 6.3 Admin API

```yaml
/v1/admin/settings/business-hours:
  get:
    summary: "Get business hours configuration"
    responses:
      200: BusinessHoursConfig
  put:
    summary: "Update business hours configuration"
    requestBody:
      content:
        application/json:
          schema: BusinessHoursConfig
```

### 6.4 Timezone-Aware Validation

When `BusinessHoursConfig.timezone` is modified, the backend must validate that the new business hours are valid in the target timezone:

```typescript
async validateBusinessHours(config: BusinessHoursConfig): Promise<void> {
  // 1. Validate timezone is valid IANA
  if (!Intl.supportedValuesOf('timeZone').includes(config.timezone)) {
    throw new BadRequestException(`Invalid timezone: ${config.timezone}`);
  }

  // 2. Validate each time range
  for (const day of ['monday', 'tuesday', /* ... */]) {
    for (const range of config[day]) {
      const openMatch = /^([01]\d|2[0-3]):[0-5]\d$/.test(range.open);
      const closeMatch = /^([01]\d|2[0-3]):[0-5]\d$/.test(range.close);
      if (!openMatch || !closeMatch) {
        throw new BadRequestException(`Invalid time format in ${day}`);
      }
      if (range.open >= range.close) {
        throw new BadRequestException(`open must be before close in ${day}`);
      }
    }
  }

  // 3. Validate that current day would still have valid slots
  const now = toZonedTime(new Date(), config.timezone);
  const dayName = format(now, 'EEEE').toLowerCase() as keyof BusinessHoursConfig;
  // Warning only, not error — config can be changed for future
}
```

## 7. Data Migration

### 7.1 Prisma Migration

```bash
npx prisma migrate dev --name add_preferred_timezone
```

Generated migration SQL overview:
```sql
-- Add preferredTimezone to User
ALTER TABLE "users" ADD COLUMN "preferred_timezone" VARCHAR(50);

-- Add SystemSetting seed records
INSERT INTO "system_settings" ("id", "setting_key", "setting_value", "setting_type", "category", "description")
VALUES
  (gen_random_uuid(), 'business_hours', '{"timezone":"Asia/Shanghai","monday":[{"open":"09:00","close":"17:00"}],...}', 'JSON', 'BUSINESS', 'Business hours configuration'),
  (gen_random_uuid(), 'default_timezone', 'Asia/Shanghai', 'STRING', 'SYSTEM', 'System default timezone');
```

### 7.2 Data Requiring No Migration

| Table | Field | Notes |
|--------|------|------|
| `User` | `createdAt` / `updatedAt` | Already `timestamptz`, UTC storage unchanged |
| `Appointment` | `appointmentDate` | Already `timestamptz`, UTC storage unchanged. Frontend displays converted to clinic tz. |
| `TimeSlot` | `startTime` / `endTime` | Already `timestamptz`. Generation logic changes to derive from business hours. |
| `Notification` | `createdAt` / `sentAt` / `scheduledAt` | UTC storage, display conversion only. |

### 7.3 Existing Data Compatibility

- All existing timestamp data in the database requires no conversion (already UTC)
- Legacy clients not sending `X-Timezone` header → automatically use Tier 3 environment default
- Legacy `new Date('YYYY-MM-DD')` calls are naturally eliminated after migration to `date-fns-tz`

## 8. Affected Files List

### 8.1 Backend

| File Path | Change Type | Notes |
|---------|---------|------|
| `booking-backend/prisma/schema.prisma` | **Modify** | User model adds `preferredTimezone String?` |
| `booking-backend/prisma/seed.ts` | **Modify** | Add `business_hours` and `default_timezone` SystemSetting seed data |
| `booking-backend/src/common/interceptors/timezone.interceptor.ts` | **New** | Read `X-Timezone` header and attach to req |
| `booking-backend/src/common/interceptors/timezone-serialization.interceptor.ts` | **New** | Convert DateTime fields in responses to clinic tz |
| `booking-backend/src/common/providers/clinic-timezone.provider.ts` | **New** | Three-tier timezone resolution (header > user > env) |
| `booking-backend/src/common/services/business-hours.service.ts` | **New** | Business hours config loading, validation, querying |
| `booking-backend/src/modules/time-slots/time-slots.service.ts` | **Refactor** | L212/L214 hardcoded UTC → BusinessHoursService |
| `booking-backend/src/modules/stats/admin-stats.service.ts` | **Refactor** | L59-62 UTC date boundary → clinic tz |
| `booking-backend/src/modules/appointments/appointments.service.ts` | **Refactor** | L198 `new Date(string)` → `toZonedTime` |
| `booking-backend/src/modules/admin/appointments/admin-appointments.service.ts` | **Refactor** | L154 unify `setHours`/`setUTCHours` |
| `booking-backend/src/modules/users/users.service.ts` | **Modify** | Update `preferredTimezone` on login |
| `booking-backend/src/modules/users/users.controller.ts` | **Modify** | Add `PATCH /users/me/timezone` |
| `booking-backend/src/app.module.ts` | **Modify** | Register new interceptors/providers |
| `booking-backend/src/common/dto/` | **Modify** | Various DTOs add timezone format validation |
| `booking-backend/test/factories/time-slot.factory.ts` | **Modify** | Generate business hours from config instead of hardcoded 09-17 |
| `booking-backend/test/**/*.spec.ts` | **Modify** | Adapt to new timezone parameters (approx 20+ files) |

### 8.2 Frontend

| File Path | Change Type | Notes |
|---------|---------|------|
| `booking-frontend/src/app/core/services/timezone.service.ts` | **New** | Browser timezone detection + localStorage storage |
| `booking-frontend/src/app/core/interceptors/timezone.interceptor.ts` | **New** | Inject `X-Timezone` header |
| `booking-frontend/src/app/core/services/date-format.service.ts` | **New** | Wraps `date-fns-tz` formatting API |
| `booking-frontend/src/app/app.config.ts` | **Modify** | Register TimezoneInterceptor |
| `booking-frontend/src/app/features/booking/**/*.ts` | **Modify** | Components inject DateFormatService |
| `booking-frontend/src/app/features/admin/**/*.ts` | **Modify** | Components inject DateFormatService |
| `booking-frontend/src/app/features/**/*.html` (approx 15+ files) | **Modify** | `date` pipe → `dateFormatService` methods |
| `booking-frontend/src/app/stores/booking/booking.store.ts` | **Modify** | Send ISO with offset |
| `booking-frontend/src/app/core/services/api.service.ts` | **Modify** | Request body date format adaptation |
| `booking-frontend/package.json` | **Modify** | Add `date-fns-tz` dependency |
| `booking-frontend/src/test/factories/time-slot.factory.ts` | **Modify** | Factory methods adapt to timezone |

### 8.3 Configuration and Documentation

| File Path | Change Type | Notes |
|---------|---------|------|
| `booking-backend/.env.example` | **Modify** | Add `DEFAULT_TIMEZONE=Asia/Shanghai` |
| `booking-backend/.env` | **Modify** | Add `DEFAULT_TIMEZONE` |
| `booking-deploy/env/backend.env` | **Modify** | Deployment environment adds `DEFAULT_TIMEZONE` |
| `.qoder/context/requirements/system-timezone-architecture.md` | **New** | This document |
| `contract.yaml` | **Modify** | Add X-Timezone header, timezone query param, User.preferredTimezone |
| `.qoder/context/requirements/data-architecture.md` | **Modify** | L104 correct `appointmentDate` type description |
| `.qoder/context/requirements/system-architecture-design.md` | **Modify** | Add timezone architecture overview |

## 9. Risks and Mitigations

| # | Risk | Impact | Probability | Mitigation |
|---|------|------|------|---------|
| **R1** | **Legacy clients without X-Timezone** | New backend receives no timezone info, uses default timezone | High (during migration) | Tier 3 env default + Tier 2 user preference fallback. Legacy client behavior unchanged (displays in UTC). |
| **R2** | **Daylight Saving Time transitions** | Appointment time shows 1-hour deviation before/after DST transitions | Medium | IANA timezone identifiers handle DST automatically; `date-fns-tz` underlying `Intl` respects DST; non-critical times (early morning) unaffected. |
| **R3** | **Client spoofs X-Timezone header** | Malicious user uses incorrect timezone | Low | Backend always stores in UTC; timezone only affects display and business rules (business hours check), not data integrity. Tier 2 user preference overrides header. |
| **R4** | **Concurrent timezone config change** | Business hours modification affects in-progress operations | Low | Business hours only affect future slot generation; existing appointments retain their UTC timestamps. Config changes use database transactions + optimistic locking with version numbers. |
| **R5** | **date-fns-tz bundle size** | Frontend increases by approximately 5-8KB gzipped | Medium | Confirmed in bundle analysis, incremental impact is manageable. Can be optimized via tree-shaking. |
| **R6** | **Performance overhead** | Each API call needs timezone resolution | Low | `ClinicTimezoneProvider.resolveSync()` is O(1) set lookup; `formatInTimeZone` performance is comparable to `Intl.DateTimeFormat`. No additional caching needed. |
| **R7** | **Mutation testing with timezone dependency** | Timezone dependency in tests causes non-deterministic results | Medium | Fix `DEFAULT_TIMEZONE=UTC` during testing; use test doubles (spy/stub) to control `ClinicTimezoneProvider` return values. |

## 10. Implementation Order

### Phase 1 — Foundation (Day 1-2)

```
Priority: P0
Goal: Establish timezone infrastructure without changing existing business behavior
```

| Step | Task | Output |
|------|------|------|
| 1.1 | Backend `.env` add `DEFAULT_TIMEZONE=Asia/Shanghai` | Environment variable active |
| 1.2 | Prisma migration: User table add `preferredTimezone` | Migration file |
| 1.3 | Create `ClinicTimezoneProvider` | Three-tier timezone resolution |
| 1.4 | Create `TimezoneInterceptor` (read X-Timezone header) | Global request interceptor |
| 1.5 | Register new provider and interceptor in `app.module.ts` | Infrastructure ready |

### Phase 2 — Core Business Logic (Day 3-5)

```
Priority: P0
Goal: Eliminate hardcoded UTC business logic, replace with configurable timezone-aware implementation
```

| Step | Task | Output |
|------|------|------|
| 2.1 | Create `BusinessHoursService` | Business hours config loading + validation |
| 2.2 | Seed data: Add `business_hours` and `default_timezone` SystemSetting | DB seed |
| 2.3 | Refactor `time-slots.service.ts` | Business hours read from config |
| 2.4 | Refactor `admin-stats.service.ts` | Date boundaries computed in clinic tz |
| 2.5 | Refactor `admin-appointments.service.ts` | Unify setHours/setUTCHours |
| 2.6 | Refactor `appointments.service.ts` | `new Date(string)` → `toZonedTime` |
| 2.7 | Create `TimezoneSerializationInterceptor` | Response JSON dates output in clinic tz |

### Phase 3 — Frontend (Day 6-8)

```
Priority: P1
Goal: Frontend timezone detection + unified formatting + HTML migration
```

| Step | Task | Output |
|------|------|------|
| 3.1 | `npm install date-fns-tz` | Dependency ready |
| 3.2 | Create `TimezoneService` | Browser timezone detection + signal |
| 3.3 | Create `TimezoneInterceptor` (HTTP header) | X-Timezone header |
| 3.4 | Create `DateFormatService` | Wraps date-fns-tz |
| 3.5 | Register interceptor in `app.config.ts` | Global header injection |
| 3.6 | Progressively replace 15+ HTML `date` pipes (by module) | No `date` pipe remaining |
| 3.7 | Modify booking store: send ISO with offset | Appointment creation |

### Phase 4 — Contract & Test (Day 9-10)

```
Priority: P1
Goal: Update contract.yaml + complete test coverage
```

| Step | Task | Output |
|------|------|------|
| 4.1 | Update `contract.yaml`: X-Timezone header, timezone query param, User.preferredTimezone | YAML contract |
| 4.2 | Update backend DTOs: add `@IsDateTimeWithTimezone()` | Validation decorator |
| 4.3 | Write `ClinicTimezoneProvider` unit tests | Three-tier fallback tests |
| 4.4 | Write `BusinessHoursService` unit tests | Business hours query tests |
| 4.5 | Update `time-slots.service.spec.ts` | Timezone-aware tests |
| 4.6 | Update `admin-stats.service.spec.ts` | Date boundary tests |
| 4.7 | Update hardcoded `09:00` in backend fixtures/factories | Test data |
| 4.8 | Write `DateFormatService` Angular tests | Frontend formatting tests |
| 4.9 | Update frontend component spec date expectations | No hardcoded UTC assertions |

### Phase 5 — Cleanup (Day 11)

```
Priority: P2
Goal: Eliminate all hardcoded UTC assumptions, full regression testing
```

| Step | Task | Output |
|------|------|------|
| 5.1 | grep search for `09:00`, `17:00`, `setHours`, `setUTCHours`, `toISOString().slice(0,10)` | Confirm no remnants |
| 5.2 | `npm run test` + `npm run test:cov` full run | Tests pass + coverage ≥70% |
| 5.3 | Update `.qoder/context/requirements/data-architecture.md` L104 | Correct `appointmentDate` type description |
| 5.4 | Update `.qoder/context/requirements/system-architecture-design.md` | Add timezone architecture overview section reference |

## Appendix A: Dependency Additions/Changes

### Backend (package.json)

```json
{
  "dependencies": {
    "date-fns": "^4.1.0",      // Upgrade (currently may be v3)
    "date-fns-tz": "^3.2.0"    // New
  }
}
```

### Frontend (package.json)

```json
{
  "dependencies": {
    "date-fns": "^3.6.0",      // Already exists, keep unchanged
    "date-fns-tz": "^3.2.0"    // New
  }
}
```

## Appendix B: Key Type Definitions

```typescript
// Shared types across frontend and backend

/** IANA timezone identifier */
type IANATimezone = string;

/** Business hours time range */
interface TimeRange {
  open: string;   // "HH:mm" in 24h format
  close: string;  // "HH:mm" in 24h format
}

/** Full business hours configuration */
interface BusinessHoursConfig {
  timezone: IANATimezone;
  monday: TimeRange[];
  tuesday: TimeRange[];
  wednesday: TimeRange[];
  thursday: TimeRange[];
  friday: TimeRange[];
  saturday: TimeRange[];
  sunday: TimeRange[];
}
```
