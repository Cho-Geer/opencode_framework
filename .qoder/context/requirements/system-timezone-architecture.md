# 预约系统 - 时区自适应架构设计文档 (Timezone Architecture Document)

## 文档信息
- **文档版本**: 1.0.0
- **创建日期**: 2026-05-12
- **文档状态**: 已基线化
- **作者**: @Architect
- **关联文档**: 系统架构设计文档（SAD）.md, 数据架构设计文档.md, 接口设计规范文档.md, contract.yaml

## 1. 设计原则 (Design Principles)

| # | 原则 | 说明 |
|---|------|------|
| **P1** | **Store in UTC, convert at edges** | 数据库所有时间戳始终以 UTC 存储（PostgreSQL `timestamptz`）。时区转换仅在 API 边界（后端响应序列化）和 UI 边界（前端展示）执行。 |
| **P2** | **Never trust client timestamps** | 前端发送的时间戳视为"带有偏移的本地时间"，后端必须根据已知的时区上下文（`X-Timezone` header、用户偏好、环境默认）重新解释并转换为 UTC。 |
| **P3** | **Always annotate with timezone** | 任何包含日期/时间的 API 响应，必须附带足够的时区上下文（响应中的 IANA 时区字段、ISO 8601 偏移量、或全局 `X-Timezone` header），使客户端无需猜测。 |
| **P4** | **Business logic operates in clinic timezone** | 营业时间计算、日期边界判断（"今天"、"本月"）、统计聚合等业务逻辑，统一在"诊所时区"（Clinic Timezone）下执行，而非 UTC 或服务器本地时间。 |
| **P5** | **IANA timezone strings only** | 所有时区表示必须使用 IANA 时区数据库标识符（如 `Asia/Shanghai`、`America/New_York`），禁止使用 UTC 偏移量（如 `+08:00`）作为业务逻辑输入。 |
| **P6** | **date-fns-tz for all conversions** | 后端使用 `date-fns-tz`（基于 `Intl`），前端复用已有 `date-fns@^3.6.0` + 新增 `date-fns-tz`，统一时区转换实现，消除隐式 `new Date()` 行为差异。 |

## 2. 时区检测策略 (Timezone Detection Strategy)

采用三层级联检测机制，按优先级从高到低依次尝试：

```
Client Request
     │
     ▼
┌─────────────────────┐
│ Tier 1: X-Timezone  │ ← Browser Intl → Header
│       Header        │
└─────────┬───────────┘
          │ 有效?
          ├── Yes ──► Resolved = X-Timezone value
          │
          ▼ No
┌─────────────────────┐
│ Tier 2: User        │ ← Database preferredTimezone
│   Profile           │
└─────────┬───────────┘
          │ 有效?
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

- 前端 `TimezoneService` 通过 `Intl.DateTimeFormat().resolvedOptions().timeZone` 获取浏览器时区
- HTTP 拦截器自动注入 `X-Timezone` 请求头到每个 API 请求
- 后端 `TimezoneInterceptor` 读取该 header 并挂载到 `req.timezone`
- **格式**: IANA 时区字符串（如 `Asia/Shanghai`）

### 2.2 Tier 2 — User preferredTimezone (Stored Preference)

- 用户在首次登录时，前端自动检测浏览器时区并提交到后端存储
- 用户可在个人设置页面手动修改 `preferredTimezone`
- 存储在 User 模型 `preferredTimezone` 字段（varchar(50)）
- 登录流程中更新该字段（若前端提交了 `X-Timezone` 且与数据库不同）

### 2.3 Tier 3 — Environment Default (Fallback)

- 通过环境变量 `DEFAULT_TIMEZONE` 配置
- `.env` 默认值: `DEFAULT_TIMEZONE=Asia/Shanghai`
- 该值也存储在 `SystemSetting` 表中，key = `default_timezone`
- 允许运维人员在运行时修改，无需重启服务

```
┌──────────────────────────────────────────────────┐
│              ClinicTimezoneProvider               │
│                                                  │
│  resolve(user?, headerTimezone?): string         │
│    1. user?.preferredTimezone (非空) → return    │
│    2. headerTimezone (有效 IANA) → return        │
│    3. SystemSetting('default_timezone') → return │
│    4. process.env.DEFAULT_TIMEZONE → return      │
│    5. 'UTC' → return (hardcoded ultimate fallback)│
└──────────────────────────────────────────────────┘
```

## 3. 前端架构 (Frontend Architecture)

### 3.1 TimezoneService

新文件: `booking-frontend/src/app/core/services/timezone.service.ts`

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

新文件: `booking-frontend/src/app/core/interceptors/timezone.interceptor.ts`

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

在 `app.config.ts` 中注册:
```typescript
provideHttpClient(
  withInterceptors([timezoneInterceptor])  // 或使用类式 provider
)
```

### 3.3 DateFormatService

新文件: `booking-frontend/src/app/core/services/date-format.service.ts`

利用已安装的 `date-fns@^3.6.0` + 新增 `date-fns-tz` 依赖，提供统一的日期格式化服务：

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

**依赖**: 添加 `date-fns-tz` 到 `package.json`:
```json
{
  "dependencies": {
    "date-fns-tz": "^3.2.0"
  }
}
```

### 3.4 HTML Date Pipe Migration

**现状**: 约 15+ 个 `.html` 文件使用 Angular 原生 `date` pipe，缺少 timezone 参数，导致行为依赖浏览器实现。

**迁移规则**:

| 原始用法 | 替换为 |
|---------|--------|
| `{{ value \| date:'short' }}` | `{{ dateFormatService.display(value) }}` |
| `{{ value \| date:'HH:mm' }}` | `{{ dateFormatService.displayTime(value) }}` |
| `{{ value \| date:'yyyy-MM-dd' }}` | `{{ dateFormatService.displayDate(value) }}` |

在 Component 中注入:
```typescript
readonly dateFormatService = inject(DateFormatService);
```

### 3.5 Appointment Date 发送格式变更

前端创建预约时:

```
Before:  appointmentDate: "2026-05-12T06:00:00.000Z"     (client-converted to UTC)
After:   appointmentDate: "2026-05-12T14:00:00.000+08:00" (ISO 8601 with zone offset)
```

后端据此 + `X-Timezone` header 做最终 UTC 转换，双重校验。

## 4. 后端架构 (Backend Architecture)

### 4.1 Prisma Schema — User Model 扩展

在 `User` 模型上新增 `preferredTimezone` 字段:

```prisma
model User {
  // ... existing fields ...

  preferredTimezone String?  @map("preferred_timezone") // IANA timezone string, e.g. "Asia/Shanghai"

  // ... existing relations ...

  @@index([preferredTimezone]) // 可选：用于按时区统计
}
```

**约束**:
- 长度限制: `varchar(50)`（最长 IANA 标识符如 `America/Argentina/ComodRivadavia` 约 35 字符）
- 可空: `null` = 使用环境默认时区
- 验证: 应用层使用 `Intl.supportedValuesOf('timeZone')` 校验合法性

### 4.2 TimezoneInterceptor (NestJS)

新文件: `booking-backend/src/common/interceptors/timezone.interceptor.ts`

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
      req.timezone = null; // 触发 Tier 2/3 fallback
    }

    return next.handle();
  }
}
```

注册到全局:
```typescript
// main.ts or AppModule
app.useGlobalInterceptors(new TimezoneInterceptor());
```

或通过 provider 方式注入 `APP_INTERCEPTOR`。

### 4.3 ClinicTimezoneProvider

新文件: `booking-backend/src/common/providers/clinic-timezone.provider.ts`

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

使用已有的 `SystemSetting` 模型，新增 key:

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

新文件: `booking-backend/src/common/services/business-hours.service.ts`

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

### 4.5 服务层重构

#### 4.5.1 time-slots.service.ts

**问题 (L212, L214)**: 硬编码 `09:00-17:00 UTC`

**重构方案**:
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

**问题 (L59-62)**: `toISOString().slice(0,10)` 使用 UTC 日期边界

**重构方案**:
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

**问题 (L154)**: `setHours()` 与 `setUTCHours()` 混用

**重构方案**: 统一使用 `date-fns-tz` 的 `toZonedTime` 和 `formatInTimeZone`，消除对 `setHours`/`setUTCHours` 的直接依赖。

#### 4.5.4 appointments.service.ts

**问题 (L198)**: `new Date(string)` 解析依赖字符串格式

**重构方案**:
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

DTO 添加时区验证:
```typescript
export class CreateAppointmentDto {
  @IsDateString()
  appointmentDate: string;

  // No separate timezone field here — uses X-Timezone header
}
```

### 4.6 DTO 时区格式化校验

所有涉及 `DateTime` 的 DTO，添加装饰器校验确保时间戳包含时区信息：

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

使用:
```typescript
export class CreateAppointmentDto {
  @IsDateTimeWithTimezone()
  appointmentDate: string;
}
```

## 5. API 契约变更 (Contract Changes)

### 5.1 新增全局 Header

在 `contract.yaml` 的 `api.endpoints` 文档中增加:

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

新增 query parameter:

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

### 5.3 User Profile 响应

新增字段:

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

新增端点:

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

### 5.4 管理端统计

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

### 5.5 响应中时间戳格式规范

所有包含 `appointmentDate`、`startTime`、`endTime` 等 `DateTime` 字段的响应，使用带偏移的 ISO 8601:

| 当前 (UTC only) | 改后 (with offset) |
|----------------|-------------------|
| `"2026-05-12T06:00:00.000Z"` | `"2026-05-12T14:00:00.000+08:00"` |
| `"2026-05-12T00:00:00.000Z"` | `"2026-05-12T08:00:00.000+08:00"` |

后端序列化时，根据 `ClinicTimezoneProvider.resolve()` 结果转换:
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

## 6. 营业时间配置 (Business Hours Configuration)

### 6.1 数据模型

使用现有 `SystemSetting` 表存储营业时间配置：

| 字段 | 值 |
|------|-----|
| `settingKey` | `business_hours` |
| `settingType` | `JSON` |
| `category` | `BUSINESS` |
| `description` | `营业时间配置，按星期定义多个时段` |

### 6.2 配置结构

```typescript
interface BusinessHoursConfig {
  timezone: string;           // 营业时间的时区
  monday: TimeRange[];        // 周一营业时段
  tuesday: TimeRange[];
  wednesday: TimeRange[];
  thursday: TimeRange[];
  friday: TimeRange[];
  saturday: TimeRange[];
  sunday: TimeRange[];        // 空数组 = 休息
}

interface TimeRange {
  open: string;   // "HH:mm" 24h format
  close: string;  // "HH:mm" 24h format
}
```

### 6.3 管理端 API

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

### 6.4 时区感知验证

当 `BusinessHoursConfig.timezone` 被修改时，后端需验证新的营业时间在目标时区下是否有效：

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

## 7. 数据迁移 (Data Migration)

### 7.1 Prisma Migration

```bash
npx prisma migrate dev --name add_preferred_timezone
```

生成的迁移 SQL 概要:
```sql
-- Add preferredTimezone to User
ALTER TABLE "users" ADD COLUMN "preferred_timezone" VARCHAR(50);

-- Add SystemSetting seed records
INSERT INTO "system_settings" ("id", "setting_key", "setting_value", "setting_type", "category", "description")
VALUES
  (gen_random_uuid(), 'business_hours', '{"timezone":"Asia/Shanghai","monday":[{"open":"09:00","close":"17:00"}],...}', 'JSON', 'BUSINESS', '营业时间配置'),
  (gen_random_uuid(), 'default_timezone', 'Asia/Shanghai', 'STRING', 'SYSTEM', '系统默认时区');
```

### 7.2 无需迁移的数据

| 数据表 | 字段 | 说明 |
|--------|------|------|
| `User` | `createdAt` / `updatedAt` | 已为 `timestamptz`，UTC 存储不变 |
| `Appointment` | `appointmentDate` | 已为 `timestamptz`，UTC 存储不变。前端展示时按 clinic tz 转换。 |
| `TimeSlot` | `startTime` / `endTime` | 已为 `timestamptz`。生成逻辑改为从 biz hours 推算。 |
| `Notification` | `createdAt` / `sentAt` / `scheduledAt` | UTC 存储，展示转换。 |

### 7.3 现有数据兼容

- 所有数据库中现存时间戳数据无需转换（已为 UTC）
- 旧版客户端不发送 `X-Timezone` header → 自动使用 Tier 3 环境默认值
- 旧版 `new Date('YYYY-MM-DD')` 调用在迁移为 `date-fns-tz` 后自然消除

## 8. 受影响文件清单 (Affected Files)

### 8.1 后端

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `booking-backend/prisma/schema.prisma` | **修改** | User 模型新增 `preferredTimezone String?` |
| `booking-backend/prisma/seed.ts` | **修改** | 添加 `business_hours` 和 `default_timezone` SystemSetting 种子数据 |
| `booking-backend/src/common/interceptors/timezone.interceptor.ts` | **新建** | 读取 `X-Timezone` header 挂载到 req |
| `booking-backend/src/common/interceptors/timezone-serialization.interceptor.ts` | **新建** | 响应中 DateTime 字段按 clinic tz 转换 |
| `booking-backend/src/common/providers/clinic-timezone.provider.ts` | **新建** | 三层时区解析 (header > user > env) |
| `booking-backend/src/common/services/business-hours.service.ts` | **新建** | 营业时间配置读取、校验、查询 |
| `booking-backend/src/modules/time-slots/time-slots.service.ts` | **重构** | L212/L214 硬编码 UTC → BusinessHoursService |
| `booking-backend/src/modules/stats/admin-stats.service.ts` | **重构** | L59-62 UTC date boundary → clinic tz |
| `booking-backend/src/modules/appointments/appointments.service.ts` | **重构** | L198 `new Date(string)` → `toZonedTime` |
| `booking-backend/src/modules/admin/appointments/admin-appointments.service.ts` | **重构** | L154 `setHours`/`setUTCHours` 统一 |
| `booking-backend/src/modules/users/users.service.ts` | **修改** | 登录时更新 `preferredTimezone` |
| `booking-backend/src/modules/users/users.controller.ts` | **修改** | 新增 `PATCH /users/me/timezone` |
| `booking-backend/src/app.module.ts` | **修改** | 注册新 interceptors/providers |
| `booking-backend/src/common/dto/` | **修改** | 各类 DTO 添加时区格式校验 |
| `booking-backend/test/factories/time-slot.factory.ts` | **修改** | 生成业务时间根据配置，而非硬编码 09-17 |
| `booking-backend/test/**/*.spec.ts` | **修改** | 适配新时区参数（约 20+ 文件） |

### 8.2 前端

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `booking-frontend/src/app/core/services/timezone.service.ts` | **新建** | 浏览器时区检测 + localStorage 存储 |
| `booking-frontend/src/app/core/interceptors/timezone.interceptor.ts` | **新建** | 注入 `X-Timezone` header |
| `booking-frontend/src/app/core/services/date-format.service.ts` | **新建** | 封装 `date-fns-tz` 格式化 API |
| `booking-frontend/src/app/app.config.ts` | **修改** | 注册 TimezoneInterceptor |
| `booking-frontend/src/app/features/booking/**/*.ts` | **修改** | Component 注入 DateFormatService |
| `booking-frontend/src/app/features/admin/**/*.ts` | **修改** | Component 注入 DateFormatService |
| `booking-frontend/src/app/features/**/*.html` (约 15+ 文件) | **修改** | `date` pipe → `dateFormatService` 方法 |
| `booking-frontend/src/app/stores/booking/booking.store.ts` | **修改** | 发送 ISO with offset |
| `booking-frontend/src/app/core/services/api.service.ts` | **修改** | 请求体日期格式适配 |
| `booking-frontend/package.json` | **修改** | 添加 `date-fns-tz` 依赖 |
| `booking-frontend/src/test/factories/time-slot.factory.ts` | **修改** | 工厂方法适配时区 |

### 8.3 配置与文档

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `booking-backend/.env.example` | **修改** | 添加 `DEFAULT_TIMEZONE=Asia/Shanghai` |
| `booking-backend/.env` | **修改** | 添加 `DEFAULT_TIMEZONE` |
| `booking-deploy/env/backend.env` | **修改** | 部署环境添加 `DEFAULT_TIMEZONE` |
| `.qoder/context/requirements/system-timezone-architecture.md` | **新建** | 本文档 |
| `contract.yaml` | **修改** | 添加 X-Timezone header、timezone query param、User.preferredTimezone |
| `.qoder/context/requirements/数据架构设计文档.md` | **修改** | L104 修正 `appointmentDate` 类型说明 |
| `.qoder/context/requirements/系统架构设计文档（SAD）.md` | **修改** | 添加时区架构概述 |

## 9. 风险与缓解 (Risks and Mitigations)

| # | 风险 | 影响 | 概率 | 缓解措施 |
|---|------|------|------|---------|
| **R1** | **Legacy clients without X-Timezone** | 新后端接收不到时区信息，使用默认时区 | 高 (迁移期) | Tier 3 env default + Tier 2 user preference 兜底。旧客户端行为不变（按 UTC 显示）。 |
| **R2** | **Daylight Saving Time transitions** | 预约时间在 DST 转换前后出现 1 小时偏差 | 中 | IANA 时区标识符自动处理 DST；`date-fns-tz` 底层使用 `Intl` 尊重 DST；非临界时间（凌晨）不受影响。 |
| **R3** | **Client spoofs X-Timezone header** | 恶意用户使用错误的时区 | 低 | 后端始终以 UTC 存储；时区仅影响展示和业务规则（营业时间检查），不影响数据完整性。Tier 2 用户偏好覆盖 header。 |
| **R4** | **Concurrent timezone config change** | 营业时间修改影响正在进行的操作 | 低 | 业务时间仅影响未来 slot 生成；已存在的预约保留其 UTC 时间戳不变。配置变更使用数据库事务 + 版本号乐观锁。 |
| **R5** | **date-fns-tz bundle size** | 前端增加约 5-8KB gzipped | 中 | 已在 bundle 分析中确认，增量可控。可通过 tree-shaking 优化。 |
| **R6** | **Performance overhead** | 每次 API 调用需解析时区 | 低 | `ClinicTimezoneProvider.resolveSync()` 是 O(1) 集合查找；`formatInTimeZone` 性能与 `Intl.DateTimeFormat` 相当。无需额外缓存。 |
| **R7** | **Mutation testing with timezone dependency** | 测试中时区依赖导致非确定性结果 | 中 | 测试时固定 `DEFAULT_TIMEZONE=UTC`；使用测试替身（spy/stub）控制 `ClinicTimezoneProvider` 返回值。 |

## 10. 实施顺序 (Implementation Order)

### Phase 1 — Foundation (Day 1-2)

```
优先级: P0
目标: 建立时区基础设施，不改变现有业务行为
```

| Step | 任务 | 产出 |
|------|------|------|
| 1.1 | 后端 `.env` 添加 `DEFAULT_TIMEZONE=Asia/Shanghai` | 环境变量生效 |
| 1.2 | Prisma migration: User 表新增 `preferredTimezone` | 迁移文件 |
| 1.3 | 创建 `ClinicTimezoneProvider` | 三层时区解析 |
| 1.4 | 创建 `TimezoneInterceptor` (读取 X-Timezone header) | 全局请求拦截器 |
| 1.5 | 在 `app.module.ts` 注册新 provider 和 interceptor | 基础设施就绪 |

### Phase 2 — Core Business Logic (Day 3-5)

```
优先级: P0
目标: 消除硬编码 UTC 业务逻辑，替换为可配置的时区感知实现
```

| Step | 任务 | 产出 |
|------|------|------|
| 2.1 | 创建 `BusinessHoursService` | 营业时间配置加载 + 验证 |
| 2.2 | 种子数据: 添加 `business_hours` 和 `default_timezone` SystemSetting | DB seed |
| 2.3 | 重构 `time-slots.service.ts` | 营业时间从配置读取 |
| 2.4 | 重构 `admin-stats.service.ts` | 日期边界在 clinic tz 计算 |
| 2.5 | 重构 `admin-appointments.service.ts` | 统一 setHours/setUTCHours |
| 2.6 | 重构 `appointments.service.ts` | `new Date(string)` → `toZonedTime` |
| 2.7 | 创建 `TimezoneSerializationInterceptor` | 响应 JSON 日期按 clinic tz 输出 |

### Phase 3 — Frontend (Day 6-8)

```
优先级: P1
目标: 前端时区检测 + 统一格式化 + HTML migration
```

| Step | 任务 | 产出 |
|------|------|------|
| 3.1 | `npm install date-fns-tz` | 依赖就绪 |
| 3.2 | 创建 `TimezoneService` | 浏览器时区检测 + signal |
| 3.3 | 创建 `TimezoneInterceptor` (HTTP header) | X-Timezone header |
| 3.4 | 创建 `DateFormatService` | 封装 date-fns-tz |
| 3.5 | 注册 interceptor 到 `app.config.ts` | 全局 header 注入 |
| 3.6 | 逐一替换 15+ HTML 中的 `date` pipe (按模块分批) | 无 `date` pipe 遗留 |
| 3.7 | 修改 booking store: 发送 ISO with offset | 预约创建 |

### Phase 4 — Contract & Test (Day 9-10)

```
优先级: P1
目标: 更新 contract.yaml + 完善测试
```

| Step | 任务 | 产出 |
|------|------|------|
| 4.1 | 更新 `contract.yaml`: X-Timezone header, timezone query param, User.preferredTimezone | YAML 契约 |
| 4.2 | 更新后端 DTO: 添加 `@IsDateTimeWithTimezone()` | 验证装饰器 |
| 4.3 | 编写 `ClinicTimezoneProvider` 单元测试 | 三层 fallback 测试 |
| 4.4 | 编写 `BusinessHoursService` 单元测试 | 营业时间查询测试 |
| 4.5 | 更新 `time-slots.service.spec.ts` | 时区感知测试 |
| 4.6 | 更新 `admin-stats.service.spec.ts` | 日期边界测试 |
| 4.7 | 更新后端 fixtures/factories 中的硬编码 `09:00` | 测试数据 |
| 4.8 | 编写 `DateFormatService` Angular 测试 | 前端格式化测试 |
| 4.9 | 更新前端 component spec 中的 date 期望值 | 无硬编码 UTC 断言 |

### Phase 5 — Cleanup (Day 11)

```
优先级: P2
目标: 消除所有硬编码 UTC 假设，全量回归测试
```

| Step | 任务 | 产出 |
|------|------|------|
| 5.1 | grep 搜索 `09:00`、`17:00`、`setHours`、`setUTCHours`、`toISOString().slice(0,10)` | 确认无残留 |
| 5.2 | `npm run test` + `npm run test:cov` 全量运行 | 测试通过 + 覆盖率 ≥70% |
| 5.3 | 更新 `.qoder/context/requirements/数据架构设计文档.md` L104 | 修正 `appointmentDate` 类型说明 |
| 5.4 | 更新 `.qoder/context/requirements/系统架构设计文档（SAD）.md` | 添加时区架构概述章节引用 |

## 附录 A: 依赖新增/变更

### Backend (package.json)

```json
{
  "dependencies": {
    "date-fns": "^4.1.0",      // 升级 (当前可能为 v3)
    "date-fns-tz": "^3.2.0"    // 新增
  }
}
```

### Frontend (package.json)

```json
{
  "dependencies": {
    "date-fns": "^3.6.0",      // 已存在, 保持不变
    "date-fns-tz": "^3.2.0"    // 新增
  }
}
```

## 附录 B: 关键类型定义

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
