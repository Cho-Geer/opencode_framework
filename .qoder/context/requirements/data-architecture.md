# Booking System - Data Architecture Design Document (Angular + NestJS Refactored Edition)

## Document Information
- **Document Version**: 2.6.2
- **Created**: 2026-04-14
- **Last Updated**: 2026-05-15
- **Contract Version**: contract.yaml v1.7.8
- **Refactored Tech Stack**: Angular v21+ + NestJS v11+ + Prisma 7.x + PostgreSQL 16
- **Database Engine**: PostgreSQL 16
- **ORM Tool**: Prisma 7.6.0+ (supports partial indexes and advanced index features)
- **Cache System**: Redis 7.x + BullMQ message queue
- **Document Status**: Baselined
- **Author**: System Architecture Analysis Tool

## 1. Data Architecture Overview

### 1.1 Design Principles
- **Consistency First**: Ensure data consistency throughout the system; enforce via database-level constraints under high-concurrency scenarios
- **Performance Optimization**: Rational index strategy, query optimization, specially optimized for high-concurrency booking scenarios
- **Scalability**: Data model that supports business growth, read-write separation architecture, horizontal scaling capability
- **Security**: Sensitive data encryption, access control, database-level security constraints
- **Maintainability**: Clear model relationships, comprehensive documentation, automated migration tooling
- **High-Concurrency Handling**: Atomic preemption mechanism, optimistic conflict detection, multi-layer caching strategy

### 1.2 Data Layered Architecture (Angular + NestJS Refactored Edition)
```
┌─────────────────────────────────────────────────────────┐
│              Application Layer                           │
│  Angular Frontend (v21+) ↔ DTO Objects ↔ Business       │
│  Entities ↔ Data Validation                             │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│              API Gateway Layer                          │
│             NestJS REST API (v11+) + WebSocket          │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│              Business Logic Layer                        │
│  Business Modules (Auth, Booking, Service, Notification,│
│  User Management)                                       │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│             Data Access Layer                           │
│     Prisma Client 7.x ↔ Prisma Schema (partial index   │
│     support)                                            │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│              Storage Layer                              │
│ PostgreSQL 16 (primary-replica) ↔ Redis 7.x ↔ File     │
│ Storage ↔ BullMQ                                        │
└─────────────────────────────────────────────────────────┘
```

### 1.3 Data Storage Strategy
| Data Type | Storage Solution | Technology | Data Lifecycle | High-Concurrency Optimization |
|---------|---------|---------|-------------|-----------|
| **Structured Business Data** | Relational Database | PostgreSQL 16 (primary-replica replication) | Long-term storage, periodic archiving | Read-write separation, partial unique indexes, connection pool optimization |
| **Session and Cache Data** | In-Memory Database | Redis 7.x Cluster | Short-term storage, TTL-controlled | Distributed locks, atomic counters, cache warm-up |
| **Async Message Queue** | Message Queue | BullMQ (Redis-based) | Deleted after task processing completes | Priority queues, delayed tasks, dead-letter queues |
| **File Resources** | Object Storage / File System | Local storage / S3-compatible storage | Long-term storage, CDN distribution | Multipart upload, cache header optimization |
| **Log Data** | Structured Logs | Winston + ELK Stack | Short-term storage, periodic cleanup | Async write, batch processing |

## 2. Core Data Model Design

### 2.1 Entity Relationship Diagram (ERD) - High-Concurrency Optimized Edition
```mermaid
erDiagram
    User ||--o{ UserSession : "has"
    User ||--o{ Appointment : "creates"
    User ||--o{ Notification : "receives"
    User ||--o{ ActivityLog : "generates"
    
    Appointment }|--|| TimeSlot : "uses"
    Appointment ||--o{ Service : "references"
    Appointment ||--o{ AppointmentHistory : "tracks"
    
    Service ||--o| ServiceCategory : "belongs to"
    
    SystemSetting ||--|| SystemLog : "records"
    
    User {
        string id PK "UUID"
        string name "User name"
        string phone "Masked phone display (e.g. 138****5678)"
        string phoneHash "SHA-256(phone+pepper), unique index"
        string phoneEncrypted "AES-256-GCM ciphertext"
        string email "Masked email display (e.g. us***@example.com)"
        string emailHash "SHA-256(email+pepper), unique index"
        string emailEncrypted "AES-256-GCM ciphertext"
        string passwordHash "bcrypt hash (rounds=12)"
        enum userType "User type"
        enum status "User status"
        timestamp lastLoginAt "Last login time"
        string preferredTimezone "Preferred timezone (IANA, e.g. Asia/Shanghai, nullable)"
        json deviceInfo "Device information"
        text remarks "Remarks"
        timestamp createdAt "Created time"
        timestamp updatedAt "Updated time"
    }
    
    Appointment {
        string id PK "UUID"
        string userId FK "User ID"
        string timeSlotId FK "Time slot ID"
        string serviceId FK "Service ID"
        string appointmentNumber "Appointment number"
        date appointmentDate "Appointment date"
        int slotSequence "Slot sequence number (atomic preemption)"
        int durationMinutes "Appointment duration (minutes)"
        decimal price "Price snapshot"
        decimal taxRate "Tax rate snapshot"
        decimal taxIncludedAmount "Tax-included total"
        enum status "Appointment status"
        json customerInfo "Customer information"
        text remarks "Remarks"
        timestamp createdAt "Created time"
        timestamp updatedAt "Updated time"
        @@unique([timeSlotId, appointmentDate, slotSequence], where: raw("status IN ('PENDING', 'CONFIRMED', 'COMPLETED')"))
    }
    
    
    TimeSlot {
        string id PK "UUID"
        string serviceId FK "Service ID"
        datetime startTime "Start time"
        datetime endTime "End time"
        int capacity "Slot capacity"
        int currentSequence "Current allocated sequence number"
        datetime createdAt "Created time"
        datetime updatedAt "Updated time"
    }
```

### 2.2 Complete Data Model Definitions (Prisma Schema 7.x)

#### 2.2.1 User Domain Model (Updated for High-Concurrency Support)
```prisma
// Enable partial index preview features
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["partialIndexes", "postgresqlExtensions"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  extensions = ["pg_trgm", "uuid-ossp"]
}

// User type enum
enum UserType {
  CUSTOMER    // Customer
  ADMIN       // Administrator
  SUPER_ADMIN // Super Administrator
}

// User status enum
enum UserStatus {
  ACTIVE      // Active
  INACTIVE    // Inactive
  BLOCKED     // Blocked
}

// User entity - three-field PII encryption model (Scheme C v4, TASK-D3 M-4)
model User {
  id           String        @id @default(uuid())
  name         String        // User name

  // Phone three-field (PII encryption, Scheme C v4)
  // phone: masked display (e.g. 138****5678), for frontend display only, not plaintext
  phone            String?       // Masked display column
  // phoneHash: SHA-256(phone_plaintext + PII_HASH_PEPPER), used for unique index and exact lookup; must not be exposed to frontend
  phoneHash        String?       @unique
  // phoneEncrypted: AES-256-GCM ciphertext (format: iv:authTag:ciphertext, Base64); must not be exposed to frontend
  phoneEncrypted   String?

  // Email three-field (PII encryption, Scheme C v4)
  // email: masked display (e.g. us***@example.com), for frontend display only, not plaintext
  email            String?       // Masked display column
  // emailHash: SHA-256(email_plaintext + PII_HASH_PEPPER), used for unique index and exact lookup; must not be exposed to frontend
  emailHash        String?       @unique
  // emailEncrypted: AES-256-GCM ciphertext (format: iv:authTag:ciphertext, Base64); must not be exposed to frontend
  emailEncrypted   String?

  // Password hash (bcrypt, rounds=12, OWASP 2023)
  passwordHash     String?

  userType     UserType      @default(CUSTOMER) // User type
  status       UserStatus    @default(ACTIVE) // User status
  lastLoginAt  DateTime?     // Last login time
  // Preferred timezone (IANA timezone, e.g. Asia/Shanghai; added in v2.7.0 timezone architecture)
  preferredTimezone String?  @map("preferred_timezone")
  deviceInfo   Json?         // Device information (JSON format)
  remarks      String?       // Remarks
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  
  // Relation fields
  sessions     UserSession[] // User sessions
  appointments Appointment[] // User appointments
  notifications Notification[] // User notifications
  activityLogs ActivityLog[] // User activity logs
  
  // Index: use hash column for exact lookup index (instead of plaintext @unique)
  @@index([phoneHash])
  @@index([emailHash])
  @@index([userType, status])
  @@index([createdAt])
  @@index([lastLoginAt], where: raw("\"status\" = 'ACTIVE'"))
}

// User session model - supports dual-token auth, device tracking and active revocation
model UserSession {
  id               String   @id @default(uuid())
  userId           String   @map("user_id")
  sessionToken     String   @unique @map("session_token")      // Session identifier for fast lookup
  refreshToken     String   @unique @map("refresh_token")     // Stores Refresh Token, supports rotation and revocation
  expiresAt        DateTime @map("expires_at")
  refreshExpiresAt DateTime? @map("refresh_expires_at")
  ipAddress        String?  @map("ip_address")                 // Audit and risk control
  userAgent        String?  @map("user_agent")                 // Device fingerprint
  deviceInfo       Json?    @map("device_info")                // Device details (JSON format)
  isActive         Boolean  @default(true) @map("is_active")  // Soft-delete flag, supports forced logout
  createdAt        DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([sessionToken])
  @@index([refreshToken])
  @@index([expiresAt])
  @@map("user_sessions")
}
```

**UserSession Field Responsibility Summary**:
| Field | Responsibility |
| :--- | :--- |
| `sessionToken` | Unique session identifier for fast session record lookup. |
| `refreshToken` | Stores Refresh Token, supports rotation and active revocation. |
| `ipAddress` / `userAgent` / `deviceInfo` | Audit and risk control; supports multi-device management and abnormal login detection. |
| `isActive` | Soft-delete flag; supports forced logout without losing audit records. |
| `expiresAt` / `refreshExpiresAt` | Used with scheduled tasks to automatically clean up expired sessions. |

#### 2.2.2 High-Concurrency Booking Business Model (Core Optimization)
```prisma
// Appointment status enum
enum AppointmentStatus {
  PENDING     // Pending confirmation
  CONFIRMED   // Confirmed
  CANCELLED   // Cancelled
  COMPLETED   // Completed
  EXPIRED     // Expired
}

// Time slot entity - supports capacity management
model TimeSlot {
  id               String   @id @default(uuid())
  serviceId        String   @map("service_id")   // Associated service ID
  startTime        DateTime @map("start_time")    // Time slot start time
  endTime          DateTime @map("end_time")      // Time slot end time
  capacity         Int      @default(1)           // Slot capacity (supports multi-person booking)
  currentSequence  Int      @default(0) @map("current_sequence") // Current allocated sequence number (atomic preemption; must use atomic DB operation to increment)
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")
  isActive         Boolean  @default(true) @map("is_active") // Whether the time slot is enabled (soft-delete flag)

  // Relation fields
  service          Service        @relation(fields: [serviceId], references: [id], onDelete: Restrict)
  appointments     Appointment[]

  // Index optimization
  @@index([serviceId, startTime, endTime])
  @@index([startTime])
  @@index([capacity, currentSequence])
  @@index([isActive])
}

// **Critical implementation constraints**:
// 1. Incrementing the `currentSequence` field MUST use a database atomic operation
//    (e.g. PostgreSQL: `UPDATE ... SET current_sequence = current_sequence + 1 WHERE ... RETURNING current_sequence`).
//    The application-layer pattern of `findUnique` + `update` is forbidden.
//    This is one of the key points to guarantee race-free `slotSequence` allocation.
// 2. TimeSlot must be associated with a Service (serviceId FK); time slots are partitioned by service.
// 3. Time slots use start_time + end_time (datetime) to define precise start/end; the old
//    slotTime (String HH:MM) format is no longer used.

// Appointment entity - high-concurrency optimization core
model Appointment {
  id                 String            @id @default(uuid())
  userId             String            // User ID
  timeSlotId         String            // Time slot ID
  serviceId          String            // Service ID
  appointmentNumber  String            @unique // Appointment number (unique)
  appointmentDate    DateTime          // Appointment date
  slotSequence       Int               @default(0) // Slot sequence number, used for atomic preemption
  durationMinutes    Int               @default(30) // Appointment duration (minutes)
  price              Decimal?          // Price snapshot (service price at time of booking)
  taxRate            Decimal?          // Tax rate snapshot (service tax rate at booking time, stored as decimal in DB; API returns percentage format)
  taxIncludedAmount  Decimal?          // Tax-included total (price * (1 + taxRate))
  status             AppointmentStatus @default(PENDING) // Appointment status
  customerInfo       Json              // Customer information (JSON format)
  remarks            String?           // Remarks
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt
   
  // Relation fields
  user               User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  timeSlot           TimeSlot          @relation(fields: [timeSlotId], references: [id], onDelete: Restrict)
  service            Service           @relation(fields: [serviceId], references: [id], onDelete: Restrict)
  histories          AppointmentHistory[] // Appointment history records
  notifications      Notification[]    // Associated notifications
  
  // Core: partial unique index constraint - ensures uniqueness per time slot+date+sequence (only for active appointments)
  // This is the key to high-concurrency booking conflict handling
  @@unique([timeSlotId, appointmentDate, slotSequence], 
           map: "appointment_slot_occupied",
           where: raw("\"status\" IN ('PENDING', 'CONFIRMED', 'COMPLETED')"))
  
  // Business index optimization
  @@index([userId, appointmentDate])
  @@index([timeSlotId, appointmentDate, status])
  @@index([appointmentNumber])
  @@index([createdAt])
  @@index([status, appointmentDate])
  
  // Covering index to optimize high-frequency queries
  @@index([appointmentDate, timeSlotId, status], 
          include: [userId, customerInfo],
          where: raw("\"status\" IN ('PENDING', 'CONFIRMED')"))
}

// Appointment history record entity
model AppointmentHistory {
  id              String            @id @default(uuid())
  appointmentId   String            // Appointment ID
  action          String            // Operation type
  previousStatus  AppointmentStatus? // Previous status
  newStatus       AppointmentStatus? // New status
  changeReason    String?           // Change reason
  performedBy     String            // Operator
  performedAt     DateTime          @default(now()) // Operation time
  metadata        Json?             // Metadata
  
  // Relation fields
  appointment     Appointment       @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
  
  // Index optimization
  @@index([appointmentId])
  @@index([performedAt])
  @@index([action])
  @@index([appointmentId, performedAt DESC])
}
```

#### 2.2.3 Service Management Model
```prisma
// Service category entity
model ServiceCategory {
  id          String    @id @default(uuid())
  name        String    // Category name
  description String?   // Category description
  iconUrl     String?   // Icon URL
  isActive    Boolean   @default(true) // Whether enabled
  displayOrder Int      @default(0) // Display order
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  
  // Relation fields
  services    Service[] // Associated services
  
  // Indexes
  @@index([name])
  @@index([isActive])
  @@index([displayOrder])
  @@index([isActive, displayOrder])
}

// Service entity
model Service {
  id               String    @id @default(uuid())
  categoryId       String?   // Category ID (aligned with contract.yaml v1.7.5 — nullable:true)
  name             String    // Service name
  description      String?   // Service description
  durationMinutes  Int       @default(60) // Service duration (minutes)
  price            Decimal?  // Service price
  pricePerMinute   Decimal?  // Price per minute
  taxRate          Decimal?  // Default tax rate (DB stores as decimal, e.g. 0.08 = 8%; API transmits as percentage 8)
  imageUrl         String?   // Image URL
  isActive         Boolean   @default(true) // Whether enabled
  displayOrder     Int       @default(0) // Display order
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
   
  // Relation fields
   category         ServiceCategory? @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  appointments     Appointment[] // Associated appointments
   
  // Index optimization
  @@index([categoryId])
  @@index([name])
  @@index([isActive])
  @@index([displayOrder])
  @@index([categoryId, isActive])
  @@index([price])
}
```

#### 2.2.4 Notification System Model (Integrated with BullMQ)
```prisma
// Notification type enum
enum NotificationType {
  SMS       // SMS notification
  EMAIL     // Email notification
  WECHAT    // WeChat notification
  PUSH      // Push notification
  SYSTEM    // System notification
}

// Notification status enum
enum NotificationStatus {
  PENDING   // Pending send
  SENT      // Sent
  FAILED    // Send failed
  READ      // Read
  QUEUED    // Queued (BullMQ integration)
}

// Notification entity - supports async processing
model Notification {
  id          String             @id @default(uuid())
  userId      String?            // User ID (optional; system notifications may have no specific user)
  appointmentId String?          // Appointment ID (optional)
  type        NotificationType   // Notification type
  title       String             // Notification title
  content     String             // Notification content
  isRead      Boolean            @default(false) // Whether read
  status      NotificationStatus @default(PENDING) // Notification status
  metadata    Json?              // Metadata (includes BullMQ jobId etc.)
  scheduledAt DateTime?          // Scheduled send time
  sentAt      DateTime?          // Actual send time
  retryCount  Int               @default(0) // Retry count
  lastError   String?           // Last error message
  createdAt   DateTime           @default(now())
  
  // Relation fields
  user        User?              @relation(fields: [userId], references: [id], onDelete: Cascade)
  appointment Appointment?        @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
  
  // Index optimization
  @@index([userId])
  @@index([appointmentId])
  @@index([type])
  @@index([status])
  @@index([isRead])
  @@index([scheduledAt])
  @@index([createdAt])
  @@index([status, scheduledAt], where: raw("\"status\" = 'PENDING'"))
}
```

#### 2.2.5 System Administration Model
```prisma
// System setting entity
model SystemSetting {
  id           String   @id @default(uuid())
  settingKey   String   @unique // Setting key (unique)
  settingValue String   // Setting value
  settingType  String   @default("STRING") // Setting type
  category     String   @default("GENERAL") // Setting category
  description  String?  // Setting description
  isProtected  Boolean  @default(false) // Whether protected
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  // Indexes
  @@index([settingKey])
  @@index([category])
}

/**
 * ⏰ Timezone-related SystemSetting Key definitions (added in v2.7.0):
 *
 * | Key | settingValue Format | Description |
 * |-----|---------------------|-------------|
 * | `default_timezone` | IANA timezone string (e.g. "Asia/Shanghai") | Clinic default timezone (Tier 3 fallback) |
 * | `business_hours` | JSON object: `{ timezone: string, schedule: { monday: [{ open, close }], ... } }` | Weekly business hours config. The timezone specifies in which timezone the schedule times take effect |
 *
 * Business hours JSON example:
 * {
 *   "timezone": "Asia/Shanghai",
 *   "schedule": {
 *     "monday":    [{ "open": "09:00", "close": "17:00" }],
 *     "tuesday":   [{ "open": "09:00", "close": "17:00" }],
 *     "wednesday": [{ "open": "09:00", "close": "17:00" }],
 *     "thursday":  [{ "open": "09:00", "close": "17:00" }],
 *     "friday":    [{ "open": "09:00", "close": "17:00" }],
 *     "saturday":  [{ "open": "10:00", "close": "14:00" }],
 *     "sunday":    []
 *   }
 * }
 *
 * Update: PUT /v1/admin/settings/business-hours (SUPER_ADMIN only)
 * Read: GET /v1/admin/settings/business-hours (ADMIN/SUPER_ADMIN)
 * - See `system-timezone-architecture.md §6`
 */

// Activity log entity
model ActivityLog {
  id           String   @id @default(uuid())
  userId       String?  // User ID (optional)
  action       String   // Operation type
  resourceType String   // Resource type
  resourceId   String?  // Resource ID
  ipAddress    String?  // IP address
  userAgent    String?  // User agent
  metadata     Json?    // Metadata
  createdAt    DateTime @default(now())
  
  // Relation fields
  user         User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  
  // Index optimization
  @@index([userId])
  @@index([action])
  @@index([resourceType])
  @@index([resourceId])
  @@index([createdAt])
  @@index([userId, createdAt DESC])
}

// System log entity
model SystemLog {
  id        String   @id @default(uuid())
  level     String   // Log level
  message   String   // Log message
  context   Json?    // Context information
  ipAddress String?  // IP address
  createdAt DateTime @default(now())
  
  // Indexes
  @@index([level])
  @@index([createdAt])
   @@index([level, createdAt])
}
```

#### 2.2.6 In-App Notification & Message Model

```prisma
// In-app notification entity (in-app notification bell)
model InAppNotification {
  id        String    @id @default(uuid())
  userId    String    // Recipient user ID
  type      String    // Notification type: info, warning, error, success
  title     String    // Notification title
  body      String    // Notification body
  readAt    DateTime? // Read time (null = unread, non-null = read)
                      // API mapping: readAt != null → response.read = true
                      //              readAt == null → response.read = false
                      // Mark as read: POST /v1/admin/notifications/:id/read → sets readAt = now()
                      // Unread count: count({ where: { readAt: null } })
  createdAt DateTime  @default(now())

  // Relation fields
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Index optimization
  @@index([userId, readAt])  // Supports efficient filtering by user + read/unread status
  @@index([createdAt])
}

// Internal message entity (internal messaging)
model Message {
  id          String    @id @default(uuid())
  senderId    String    // Sender ID
  recipientId String    // Recipient ID
  subject     String    // Message subject
  body        String    // Message body
  readAt      DateTime? // Read time (null = unread, non-null = read)
                        // API mapping: readAt != null → read = true; readAt == null → read = false
                        // Unread count: GET /v1/admin/messages/unread-count → count({ where: { recipientId, readAt: null } })
  createdAt   DateTime  @default(now())

  // Relation fields
  sender      User      @relation("SentMessages", fields: [senderId], references: [id], onDelete: Cascade)
  recipient   User      @relation("ReceivedMessages", fields: [recipientId], references: [id], onDelete: Cascade)

  // Index optimization
  @@index([recipientId, readAt])
  @@index([senderId])
}
```

> **Note**: The `InAppNotification` and `Message` models added in this section are simplified models for in-app notification and direct messaging features, distinct from the async notification system model `Notification` in §2.2.4 (which integrates BullMQ for external channels such as SMS/EMAIL/PUSH). The in-app models focus on UI-layer alert display (bell icon, envelope icon, read/unread state); external-channel notifications are handled by the BullMQ notification system in §2.2.4.
>
> **readAt → read API mapping** [v2.5.1]: The database layer uses `readAt: DateTime?` (null = unread, datetime = read) to support precise read timestamps and auditing. The API layer (`contract.yaml` §2 admin.notifications) maps this to `read: boolean`. Conversion rules:
> - `readAt == null` → API `read: false`
> - `readAt != null` → API `read: true`
> - Mark-as-read endpoint `POST /v1/admin/notifications/:id/read` → backend sets `readAt = now()` on the `InAppNotification` record
> - `GET /v1/admin/messages/unread-count` → backend executes `count({ where: { recipientId: currentUser, readAt: null } })`
>
> This mapping also applies to the `Message` model defined in §2.2.6.

### 2.3 Data Model Statistics (High-Concurrency Optimized Edition)
| Model Category | Entity Count | Field Count | Relation Count | Index Count | Partial Index Count |
|---------|---------|---------|---------|---------|-------------|
| **User Management** | 2 | 28 | 4 | 16 | 1 |
| **Booking Business** | 3 | 38 | 7 | 23 | 2 (core optimization) |
| **Service Management** | 2 | 20 | 3 | 8 | 0 |
| **Notification System** | 1 | 19 | 2 | 9 | 1 |
| **In-App Notification & Message** | 2 | 16 | 3 | 4 | 0 |
| **System Administration** | 3 | 24 | 1 | 10 | 0 |
| **Total** | **14** | **150** | **21** | **71** | **4** |

## 3. Data Relationship Design

### 3.1 One-to-One Relationships
| Relationship | Entity A | Entity B | Foreign Key Location | Cascade Operation | Concurrency Consideration |
|------|-------|-------|---------|---------|------|
| User - Default Session | User | UserSession | UserSession.userId | Cascade | Session is stateless; supports multi-device |
| Appointment - Latest History | Appointment | AppointmentHistory | AppointmentHistory.appointmentId | Cascade | History records written asynchronously |

### 3.2 One-to-Many Relationships (High-Concurrency Optimized)
| Relationship | "One" Side | "Many" Side | Foreign Key Location | Cascade Operation | Concurrency Optimization |
|------|--------|--------|---------|---------|------|
| User - Sessions | User | UserSession | UserSession.userId | Cascade | Redis-cached sessions, async DB sync |
| User - Appointments | User | Appointment | Appointment.userId | Cascade | User appointment list paginated query, cache optimization |
| User - Notifications | User | Notification | Notification.userId | Cascade | Async notification processing, BullMQ queue |
| TimeSlot - Appointments | TimeSlot | Appointment | Appointment.timeSlotId | Restrict | Partial unique index ensures atomicity |
| Service - Appointments | Service | Appointment | Appointment.serviceId | Restrict | Service info cached to reduce joins |
| Appointment - TimeSlot (with overtime detection) | Appointment | TimeSlot | Appointment.timeSlotId | Restrict | Same relation as "TimeSlot - Appointments". Overtime overlap detection: when creating an appointment, validate that overtime does not overlap with existing appointments in adjacent time slots; return 409 Conflict if overlap occurs |
| Category - Services | ServiceCategory | Service | Service.categoryId | Cascade | Category info statically cached |

### 3.3 Many-to-Many Relationships
No direct many-to-many relationships are used in the current architecture. All relationships are managed explicitly through foreign keys to avoid JOIN query performance bottlenecks.

## 4. Data Integrity Constraints

### 4.1 Entity Integrity (High-Concurrency Reinforced)
| Constraint Type | Implementation | Example | Concurrency Optimization |
|---------|---------|------|---------|
| **Primary Key Constraint** | `@id @default(uuid())` | `id String @id @default(uuid())` | UUID v7 (time-ordered) reduces index fragmentation |
| **Unique Constraint** | `@unique` | `phoneHash String? @unique` (PII hash column unique, not plaintext) | Application-layer cached uniqueness check |
| **Composite Unique Constraint** | `@@unique([field1, field2])` | `@@unique([timeSlotId, appointmentDate, slotSequence])` | **Partial unique index**, high-concurrency core |
| **Conditional Unique Constraint** | `@@unique(..., where: raw("condition"))` | `@@unique(..., where: raw("\"status\" IN ('PENDING', 'CONFIRMED')"))` | Reduces index size, improves performance |

### 4.2 Referential Integrity
| Constraint Type | Implementation | Cascade Strategy | Example | Concurrency Optimization |
|---------|---------|---------|------|---------|
| **Foreign Key Constraint** | `@relation` | Cascade/Restrict/SetNull | `user User @relation(fields: [userId], references: [id], onDelete: Cascade)` | Bulk delete optimization |
| **Non-Null Constraint** | Non-optional type | - | `name String` (non-optional type) | Application-layer validation reduces DB pressure |
| **Default Value Constraint** | `@default()` | - | `status UserStatus @default(ACTIVE)` | Reduces application-layer logic |

### 4.3 Domain Integrity
| Constraint Type | Implementation | Example | Concurrency Optimization |
|---------|---------|------|---------|
| **Enum Constraint** | Custom enum types | `enum UserType { CUSTOMER, ADMIN }` | DB enum type, storage optimization |
| **Range Constraint** | Application-layer validation + DB CHECK | `durationMinutes Int @default(60)` | Business-layer validation is primary, DB as fallback |
| **Format Constraint** | Regex validation | Phone number format validation | Application-layer validation, DB trigger as backup |
| **JSON Schema Constraint** | Prisma Json type + application-layer validation | `customerInfo Json` | JSON Schema validation, DB jsonb type performance optimization |
| **Price Snapshot Constraint** | Application-layer logic | `Appointment.price/taxRate` snapshots from Service | When creating an appointment, copy `price` and `taxRate` from the Service model; subsequent Service price changes do not affect existing appointments |
| **Tax-Included Amount Constraint** | Application-layer calculation | `taxIncludedAmount = price * (1 + taxRate)` | Uses DB-stored decimal format taxRate (e.g. 0.08), not the API percentage format. Calculated and persisted by the application layer when creating an appointment |

## 5. Index Strategy (High-Concurrency Optimized)

### 5.1 Primary Key Indexes
All entities automatically create a primary key index on the `id` field (B-tree index). UUID v7 is used to reduce index fragmentation.

> **Implementation Note**: Prisma's `@default(uuid())` generates UUID v4 (random) by default. To use UUID v7 (time-ordered), generate it at the application layer or use `@default(dbgenerated("gen_random_uuid()"))` to call a database extension function. At implementation time, verify the UUID version during application initialization.

### 5.2 Unique Indexes (Partial Index Optimization)
| Index Field | Entity | Index Type | Purpose | Concurrency Optimization |
|---------|---------|---------|------|---------|
| `phoneHash` | User | Unique index (SHA-256 hash column, not plaintext) | Phone number uniqueness validation | Application-layer cached check |
| `emailHash` | User | Unique index (SHA-256 hash column, not plaintext) | Email uniqueness validation | Application-layer cached check |
| `appointmentNumber` | Appointment | Unique index | Appointment number uniqueness | Prefix index optimizes queries |
| `[serviceId, startTime, endTime]` | TimeSlot | Composite index | Query by service and time slot | Business-layer caching |
| `settingKey` | SystemSetting | Unique index | System setting key uniqueness | Full in-memory cache |
| `[timeSlotId, appointmentDate, slotSequence]` | Appointment | **Partial composite unique index** | Atomic preemption core | **WHERE status IN ('PENDING', 'CONFIRMED', 'COMPLETED')** |

### 5.3 Non-Unique Indexes (Query Performance Optimization)
| Index Field | Entity | Index Type | Query Scenario | Concurrency Optimization |
|---------|---------|---------|---------|---------|
| `userId` | UserSession | B-tree | User session lookup | Session Redis-cached, DB as fallback |
| `userType` | User | B-tree | Filter by user type | Composite index `[userType, status]` |
| `status` | User/Appointment | B-tree | Status filter query | Partial index reduces size |
| `appointmentDate` | Appointment | B-tree | Query appointments by date | Time-partitioned index |
| `createdAt` | All entities | B-tree | Time range query | Time-series optimization |
| `categoryId` | Service | B-tree | Query services by category | Covering index optimization |
| `isActive` | Service/TimeSlot | B-tree | Enabled status filter | Partial index `WHERE isActive = true` |
| `bookingGroupId` | Appointment | B-tree | (Removed) Previously used for multi-slot appointment group queries | Deprecated; replaced by overtime-only mechanism |

### 5.4 Covering Indexes - High-Performance Queries
| Priority | Recommended Index | Estimated Benefit | Implementation Complexity | SQL Example |
|-------|---------|---------|-----------|---------|
| **P0** | `Appointment(appointmentDate, timeSlotId, status) INCLUDE (userId, customerInfo)` | Query performance 5-10x improvement | Low | `CREATE INDEX ... INCLUDE (user_id, customer_info)` |
| **P1** | `Notification(userId, isRead)` | High-frequency query optimization | Low | `CREATE INDEX ... WHERE is_read = false` |
| **P2** | `Appointment(userId, status)` | User appointment status query | Low | `CREATE INDEX ... WHERE status IN ('PENDING', 'CONFIRMED')` |
| **P3** | `ActivityLog(userId, createdAt DESC)` | User activity timeline | Medium | `CREATE INDEX ... ORDER BY created_at DESC` |

### 5.5 Index Optimization Recommendations (Based on PostgreSQL 16)
1. **Prefer partial indexes**: Use partial indexes on status fields to reduce index size by 40-60%
2. **Covering index optimization**: Use INCLUDE fields for high-frequency queries to avoid table lookups
3. **Parallel index scans**: PostgreSQL 16 supports improved parallel index scans
4. **Index maintenance**: Periodically run `REINDEX CONCURRENTLY` to avoid table locks
5. **Monitoring metrics**: Track index utilization and remove unused indexes

## 6. Data Partitioning Strategy

### 6.1 Partitioning Scheme (Time Partitioning Primary)
| Partition Dimension | Partition Table | Partition Key | Partition Strategy | Use Case | Implementation Phase |
|---------|--------|--------|---------|---------|------|
| **Time Partition** | Appointment | appointmentDate | Monthly range partitioning | Historical data archiving, query performance | Phase 1 |
| **Business Partition** | Notification | type | List partitioning | Notification type separation, maintenance optimization | Phase 2 |
| **Status Partition** | User | status | List partitioning | Active/inactive user separation | Phase 3 |
| **Hash Partition** | ActivityLog | userId hash | Hash partitioning | Distributed query load balancing | Phase 4 |

### 6.2 Partitioning Implementation Path
1. **Phase 1**: Appointment table monthly partitioning (historical data > 6 months)
   - Partition key: `appointmentDate`
   - Strategy: `RANGE (PARTITION BY RANGE (appointment_date))`
   - Retention: keep last 12 months as hot data, 12-24 months as warm data, 24+ months as cold data

2. **Phase 2**: Notification table partitioning by type
   - Partition key: `type`
   - Strategy: `LIST (PARTITION BY LIST (type))`
   - Partitions: `email_notifications`, `sms_notifications`, `system_notifications`

3. **Phase 3**: User table partitioning by status
   - Partition key: `status`
   - Strategy: `LIST (PARTITION BY LIST (status))`
   - Partitions: `active_users`, `inactive_users`, `blocked_users`

### 6.3 Partitioning Performance Benefits
- **Query performance**: Partition pruning reduces scanned data by 70-90%
- **Maintenance efficiency**: Partitions maintained independently without affecting overall availability
- **Backup/recovery**: Partition-level backup and recovery reduces time by 60%
- **Data lifecycle**: Automated data archiving and cleanup

## 7. Cache Strategy (Multi-Layer Cache Architecture)

### 7.1 Redis Cache Design (High-Concurrency Optimization)
| Cache Type | Cache Key Format | TTL | Update Strategy | Purpose | Concurrency Optimization |
|---------|-----------|-----|---------|------|---------|
| **User Session** | `session:{sessionToken}` | 7 days | Write-through + read-refresh | User authentication state | Distributed session, stateless service |
| **Verification Code Cache** | `verification:phone:{phone}:{type}`<br>`verification:email:{email}:{type}` | 5 min | Write-on-set | Phone/email verification codes | Atomic operation, replay-attack prevention |
| **Service List** | `services:active` | 1 hour | Scheduled refresh + invalidation notification | Active service list | Pub/Sub update |
| **Time-Slot Cache** | `timeslots:available:{date}` | 30 min | Scheduled refresh | Available time-slot queries | **Atomic counter soft rate-limiting** |
| **User Profile** | `user:{userId}:profile` | 1 day | Write-invalidate | User basic info | Cache-penetration protection |
| **Booking Capacity** | `slot:{timeSlotId}:remaining` | 1 hour | Atomic DECR operation | **High-concurrency booking soft rate-limiting** | Redis single-thread atomicity |

### 7.2 Cache Consistency Guarantees (Multi-Level Strategy)
| Scenario | Consistency Strategy | Implementation | Concurrency Optimization |
|------|-----------|---------|---------|
| **Data Update** | Write-invalidate + delayed double-delete | Delete cache after DB update; async delayed re-delete | Reduce cache avalanche risk |
| **Cache Expiry** | TTL auto-expiry + renewal | Reasonable TTL, auto-renewal for hot data | Avoid cache breakdown |
| **Cache Penetration** | Null-value caching + Bloom filter | Cache empty query results; Bloom filter pre-checks existence | RedisBloom module |
| **Cache Avalanche** | Random TTL + tiered cache | Add random jitter to TTL, multi-level cache architecture | Layered expiry strategy |
| **Cache Breakdown** | Mutex lock + hot-data never-expire | Redis distributed lock; background update for hot data | Redlock algorithm |

### 7.3 Cache Performance Optimization
1. **Connection Pool Tuning**: Redis connection pool configuration to avoid connection storms
2. **Pipeline**: Use pipeline for batch operations to reduce network round-trips
3. **Lua Scripts**: Complex operations use Lua scripts to guarantee atomicity
4. **Memory Optimization**: Appropriate data structures; ziplist optimization for small objects
5. **Cluster Sharding**: Redis Cluster automatic sharding for horizontal scale-out

## 8. Data Security Design

### 8.1 Sensitive Data Protection
| Data Type | Protection Measures | Encryption Algorithm | Storage Format | Access Control |
|---------|---------|---------|---------|---------|
| **User Password** | One-way hash + salt | bcrypt (rounds=12, OWASP 2023) | passwordHash hash value | Authentication service only |
| **JWT Token** | Signed encryption + short validity | HMAC-SHA256 | Signed token | Token blacklist management |
| **Phone Number** | Three-field PII encryption + SHA-256 hash index | AES-256-GCM (phoneEncrypted) + SHA-256 (phoneHash) | phone masked / phoneHash hash / phoneEncrypted ciphertext | Hash column for lookup; ciphertext column for authorized decryption only |
| **Email Address** | Three-field PII encryption + SHA-256 hash index | AES-256-GCM (emailEncrypted) + SHA-256 (emailHash) | email masked / emailHash hash / emailEncrypted ciphertext | Hash column for lookup; ciphertext column for authorized decryption only |
| **ID Number** | Full-field encryption | AES-256-GCM | Encrypted storage | Strict access control |
| **Device Info** | JSON storage + field-level encryption | Selective field encryption | Plain JSON + encrypted fields | Device fingerprint verification |

> **[M-5 Amendment Note v2.1.0]** Added email address row, sensitivity level aligned with phone number (High).
> Added three-field model description column. Phone number row updated to three-field model format.
> Design basis: piiEncryptionStrategy.md § 2 (Three-Field Model Design).

### 8.2 Data Access Control (Multi-Level)
| Data Layer | Access Control Mechanism | Implementation | Audit Log |
|---------|-------------|---------|---------|
| **Database Level** | PostgreSQL role permissions | Separate DBs/accounts, principle of least privilege | PostgreSQL audit log |
| **Application Level** | NestJS guards + RBAC | JWT authentication, role/permission decorators | Structured operation log |
| **Row Level** | Business logic policy | User ID match check, tenant isolation | Business operation log |
| **Field Level** | DTO transformation + masking | Data masking, field filtering, sensitive field masks | Field access log |

### 8.3 Audit Logs (Full Traceability)
| Audit Type | Recorded Content | Storage Location | Retention Period | Query Performance |
|---------|---------|---------|---------|---------|
| **User Operations** | User ID, operation type, resource, IP, timestamp | ActivityLog table + Elasticsearch | 1 year | Time-partition index |
| **Data Changes** | Before/after data, operator, timestamp | AppointmentHistory table | Permanent | Sharded by appointmentId |
| **System Events** | Event level, message, context, timestamp | SystemLog table | 6 months | Time-series index |
| **Security Events** | Login attempts, permission changes, anomalous access | Dedicated security event table | 2 years | Real-time stream processing |

## 9. Data Migration Strategy

### 9.1 Migration Toolchain (Modern)
| Tool Component | Version | Purpose | High-Concurrency Support |
|---------|------|------|-----------|
| **Prisma Migrate** | 7.6.0+ | Database schema migration, version control | Zero-downtime migration support |
| **Prisma Studio** | 7.6.0+ | Data visualization and management | Read-replica queries |
| **Custom Migration Scripts** | Node.js + TypeScript | Data migration and transformation | Batch processing, transaction control |
| **Backup Tools** | pg_dump + WAL archiving | Data backup and recovery | Parallel backup, incremental recovery |
| **Data Validation Tools** | Custom validation scripts | Post-migration data integrity verification | Sampling validation, diff comparison |

### 9.2 Migration Process (High-Availability Guarantee)
```
High-availability migration process:
1. Pre-migration check → 2. Create backup snapshot → 3. Switch to read-only replica →
4. Execute migration (Prisma Migrate) → 5. Data validation → 6. Traffic switch →
7. Monitor and verify → 8. Clean up old data → 9. Update documentation
```

### 9.3 Rollback Strategy (Multi-Level Protection)
| Rollback Scenario | Rollback Method | Data Impact | Recovery Time Objective (RTO) |
|---------|---------|---------|-------------------|
| **Migration Failure** | Roll back migration transaction | No data impact | < 5 min |
| **Data Error** | Restore backup snapshot | Restored to backup point | < 15 min |
| **Application Compatibility** | Version rollback + DB version compatibility | App and data versions matched | < 10 min |
| **Performance Issue** | Failback to read-only replica | Read-only query impact | < 3 min |

## 10. Data Governance

### 10.1 Data Quality Management (Real-Time Monitoring)
| Quality Dimension | Monitoring Metric | Check Frequency | Alert Threshold | Auto-Remediation |
|---------|---------|---------|---------|---------|
| **Completeness** | Non-null field compliance rate | Real-time | < 99.5% | Data fill task |
| **Consistency** | Foreign key constraint violation count | Real-time | > 0 | Auto-fix script |
| **Accuracy** | Data validation error rate | Real-time | > 0.1% | Data cleansing process |
| **Timeliness** | Data update delay | Every minute | > 5 min | Cache refresh mechanism |
| **Uniqueness** | Unique constraint violation count | Real-time | > 0 | Duplicate data handling |

### 10.2 Data Lifecycle Management (Automated)
| Data Category | Active Period | Archive Period | Destruction Period | Retention Policy | Automation Tool |
|---------|--------|--------|--------|---------|-----------|
| **User Data** | Account active period | 6 months | 2 years | Soft delete + archive | Scheduled task + event-driven |
| **Booking Data** | After booking completion | 1 year | 3 years | Partition archive | PostgreSQL table partitioning |
| **Log Data** | 30 days | 6 months | 1 year | Compressed storage | Elasticsearch index lifecycle |
| **Cache Data** | Within TTL | - | TTL expiry | Auto-cleanup | Redis expiry policy |
| **Notification Data** | 30 days after sending | 3 months | 6 months | Summary archive | BullMQ completion queue cleanup |

### 10.3 Data Backup Strategy (Multi-Level Protection)
| Backup Type | Backup Frequency | Retention Period | Storage Location | Recovery Objective | Encryption |
|---------|---------|---------|---------|---------|---------|
| **Full Backup** | Daily 02:00 | 7 days | Object storage (S3-compatible) | Within 24 hours | AES-256 |
| **Incremental Backup** | Hourly | 24 hours | Object storage (S3-compatible) | Within 1 hour | AES-256 |
| **WAL Archiving** | Real-time | 7 days | Dedicated storage volume | Within 5 min | Transport encryption |
| **Config Backup** | On change | Permanent | Version control (Git) | Immediate | Git encryption |
| **Cache Snapshot** | Daily 04:00 | 3 days | Object storage | Within 30 min | Redis RDB encryption |

## 11. Performance Optimization Design (High-Concurrency Focus)

### 11.1 Query Optimization (Booking System Core)
| Optimization Measure | Implementation | Expected Benefit | Implementation Phase |
|---------|---------|---------|---------|
| **Partial Unique Index** | `WHERE status IN ('PENDING', 'CONFIRMED')` | 60% index size reduction, 40% write performance improvement | P0 (implemented) |
| **Covering Index Optimization** | `INCLUDE (userId, customerInfo)` | 5–10x performance improvement for high-frequency queries | P0 (implemented) |
| **Query Rewrite** | Avoid SELECT *, use specific fields | 30–50% reduction in data transfer | P1 |
| **Pagination Optimization** | Cursor pagination + time partitioning | Improved pagination performance for large datasets | P1 |
| **Join Optimization** | Appropriate redundant fields to reduce table joins | Improved complex query performance | P2 |
| **Materialized Views** | Materialize high-frequency statistical queries | 10x performance improvement for reports | P3 |

#### 11.1.1 Dashboard Statistics Data Source Description

> **DASH Statistics API Data Sources** [v2.2.0]: The four statistical dimensions of Admin Dashboard (DASH-001~004) are **NOT stored in separate tables**; they are computed in real-time via Prisma aggregate queries from existing business tables:

| Statistical Dimension | Source Table | Calculation Method |
|----------|------|----------|
| **Core Statistics Cards** (DASH-001) | Appointment, User | `prisma.appointment.count({ where: {...} })` + `prisma.appointment.aggregate({ _sum: { ... } })` |
| **Booking Trend** (DASH-002) | Appointment | `prisma.appointment.groupBy({ by: ['appointmentDate'], _count: true })` aggregated by time granularity |
| **Service Distribution** (DASH-003) | Appointment, Service | `prisma.appointment.groupBy({ by: ['serviceId'], _count: true })` JOIN Service.name |
| **Time Distribution** (DASH-004) | Appointment | Extract hour field from `appointmentDate`, `groupBy` by hour |
| **Notification List** (SYS-002) | InAppNotification (in-app) | `prisma.inAppNotification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })` paginated query |
| **Unread Message Count** (MSG-004) | Message | `prisma.message.count({ where: { recipientId, readAt: null } })` aggregate count |

> **Note** [v2.3.0]: The two new Dashboard dimensions — **Notification List** and **Unread Message Count** — are backed by the `InAppNotification` (in-app) and `Message` models from §2.2.7 respectively, consistent with DASH-001~004; no separate statistics tables are created.

> **Performance Note**: For high-frequency access scenarios, it is recommended to create a PostgreSQL **Materialized View** with periodic refresh (e.g., every 5 minutes), or cache statistical results in Redis (TTL=300s), to avoid repeated aggregate computation pressure on primary business tables.

### 11.2 Write Optimization (High-Concurrency Booking)
| Optimization Measure | Implementation | Applicable Scenario | Concurrency Optimization |
|---------|---------|---------|---------|
| **Atomic Preemption** | Partial unique index + slot_sequence | Booking conflict handling | Eliminates race conditions, TPS 1000+ |
| **Batch Write** | Batch insert operations, transaction optimization | Data initialization, import | Reduced transaction overhead |
| **Async Write** | BullMQ message queue | Logs, non-critical data | Peak shaving, throughput improvement |
| **Deferred Index** | Insert first, then create index | Large-scale batch data import | Avoid index maintenance overhead |
| **Connection Pool Tuning** | PgBouncer transaction pool mode | High-concurrency connections | Connection reuse, supports 1000+ connections |

#### 11.2.1 Concurrent Conflict Scenario Example

**Scenario Description**: Two users simultaneously attempt to book the last available slot (`slot_sequence=0`) in the same time slot.

**Timing Steps**:
1. **Time T0**: User A and User B initiate booking requests almost simultaneously
2. **Time T1**: System assigns `slot_sequence=0` to User A; `TimeSlot.currentSequence` updated successfully (atomic increment)
3. **Time T2**: System attempts to insert booking record for User A; partial unique index check passes; insert succeeds
4. **Time T3**: System assigns `slot_sequence=0` to User B (because User B's request hasn't seen the updated `currentSequence` yet)
5. **Time T4**: System attempts to insert booking record for User B; partial unique index detects conflict (`slot_sequence=0` already occupied)
6. **Time T5**: Database throws unique constraint violation error (Prisma error code `P2002`)
7. **Time T6**: System catches the error and returns "Booking failed — time slot already taken" to User B

**Key Points**:
- The partial unique index guarantees atomicity at the database level, even when two requests arrive simultaneously
- The record inserted first immediately occupies the unique index slot; subsequent insert attempts fail immediately
- The `P2002` error is an expected, normal conflict — it should NOT be treated as a system exception

**Error Handling Recommendations**:
- The application layer should catch `P2002` errors and convert them to user-friendly messages
- Automatically retry with another available `slot_sequence` (e.g., `slot_sequence=1`, if capacity allows)
- Record conflict rate metrics for monitoring system concurrency pressure

### 11.3 Storage Optimization
| Optimization Measure | Implementation | Storage Savings | Performance Impact |
|---------|---------|---------|---------|
| **Data Compression** | TOAST auto-compression + columnar storage optimization | 50–70% savings on text fields | Minor query performance impact |
| **Columnar Storage Optimization** | Appropriate data types, avoid over-normalization | 20–30% storage reduction | Improved query performance |
| **Partition Pruning** | Query condition optimization, partition key selection | 70–90% reduction in scanned data | Significant query performance improvement |
| **Index Optimization** | Partial indexes, covering indexes | 40–60% index size reduction | Improved write performance, stable queries |

## 12. Scalability Design

### 12.1 Read-Write Separation Architecture
| Read Operations | Write Operations | Separation Strategy | Technical Implementation | Performance Benefit |
|-------|-------|---------|---------|---------|
| Query-type APIs | Create/Update/Delete APIs | Application-layer routing | NestJS middleware + Prisma extensions | 3–5x read performance improvement |
| Report queries | Business transactions | Database-level replication | PostgreSQL streaming replication | 70% reduction in primary DB load |
| Cache filling | Data updates | Async synchronization | Redis pub/sub | 50% reduction in response time |

**Technical Implementation**:
```typescript
// Prisma Client extension for read-write separation
import { PrismaClient } from '@prisma/client';
import { withReplicas } from '@prisma/extension-read-replicas';

const prisma = new PrismaClient().$extends(
  withReplicas({
    url: process.env.DATABASE_PRIMARY_URL,
    replicas: [
      { url: process.env.DATABASE_REPLICA1_URL },
      { url: process.env.DATABASE_REPLICA2_URL }
    ]
  })
);
```

### 12.2 Sharding Evolution Path
| Sharding Dimension | Shard Key | Sharding Strategy | Implementation Phase | Complexity |
|---------|--------|---------|---------|--------|
| **Time Sharding** | appointmentDate | Shard by month | Phase 1 (current) | Low |
| **User Sharding** | userId hash | Range sharding | Phase 2 (users > 1M) | Medium |
| **Business Sharding** | Business type | Vertical database split | Phase 3 (microservice evolution) | High |
| **Geographic Sharding** | Region code | Geographic partitioning | Phase 4 (internationalization) | Medium |

### 12.3 Microservice Evolution (Long-Term Architecture)
| Service Split | Split Rationale | Tech Stack | Communication Protocol | Data Boundary |
|---------|---------|---------|---------|---------|
| **User Service** | User authentication, profile, permissions | NestJS + Prisma | REST + gRPC | User core data |
| **Booking Service** | Booking management, time slots, conflict detection | NestJS + Prisma + Redis | REST + WebSocket | Booking business data |
| **Notification Service** | Message push, template management, channel integration | NestJS + BullMQ | REST + Message Queue | Notification configs and records |
| **Report Service** | Statistical analysis, data export, BI integration | NestJS + ClickHouse | gRPC + File stream | Analytics data warehouse |
| **System Service** | Config management, log collection, monitoring & alerting | NestJS + Elasticsearch | REST + Event bus | System operations data |

### 12.4 Horizontal Scaling Strategy
1. **Database Layer Scaling**:
   - PostgreSQL read-write separation (1 primary + N replicas)
   - Connection pool: PgBouncer supports 1000+ concurrent connections
   - Data partitioning: time partitioning + business partitioning
   - Read-only replicas: read traffic auto-routing

2. **Application Layer Scaling**:
   - NestJS stateless service, supports Kubernetes horizontal scaling
   - Redis Cluster: automatic sharding, distributed data storage
   - BullMQ queue: distributed workers, load balancing

3. **Cache Layer Scaling**:
   - Redis Cluster: automatic failover, data sharding
   - Multi-level cache: local cache + Redis + database
   - Cache warm-up: hot data pre-loading

## 13. Implementation Roadmap and Priorities

### 13.1 Phased Implementation Plan
| Phase | Time Window | Core Tasks | Key Deliverables | Risk Control |
|------|---------|---------|---------|---------|
| **Phase 1 (MVP)** | Month 1–2 | Basic data models, core booking flow | Minimum runnable system | Tech stack validation, prototype testing |
| **Phase 2 (Optimization)** | Month 3–4 | High-concurrency optimization, cache integration | Support 1000+ concurrent bookings | Load testing, performance tuning |
| **Phase 3 (Expansion)** | Month 5–6 | Read-write separation, partitioning strategy | Production-ready scalable architecture | Canary release, monitoring & alerting |
| **Phase 4 (Evolution)** | Month 7–12 | Microservice decomposition, internationalization | Enterprise-grade distributed system | Service governance, data migration |

### 13.2 Priority Matrix (MoSCoW Method)
| Priority | Data Architecture Requirement | Business Value | Implementation Difficulty | Dependencies |
|-------|------------|---------|---------|--------|
| **Must Have** | 1. High-concurrency booking atomic preemption<br>2. Core data model integrity<br>3. Basic index strategy | Core business operable | Medium | Tech stack confirmed |
| **Should Have** | 1. Redis cache integration<br>2. Read-write separation architecture<br>3. Partitioning strategy | Performance scalability | High | Phase 1 complete |
| **Could Have** | 1. Advanced index optimization<br>2. Data compression<br>3. Enhanced audit logs | System optimization | Medium | Phase 2 complete |
| **Won't Have (Now)** | 1. Microservice decomposition<br>2. Geographic sharding<br>3. Multi-tenant architecture | Long-term evolution | High | Business scale expansion |

## 14. Summary and Recommendations

### 14.1 Key Design Decisions
1. **Modern Tech Stack**: Angular v21+ + NestJS v11+ + Prisma 7.x + PostgreSQL 16 + Redis 7.x
2. **High-Concurrency Core**: PostgreSQL partial unique index + slot_sequence atomic preemption mechanism
3. **Multi-Layer Cache**: Redis soft rate-limiting + session cache + business data cache
4. **Async Architecture**: BullMQ message queue decouples non-critical paths
5. **Scalability Design**: Read-write separation + data partitioning + stateless services

### 14.2 Risks and Mitigation
| Risk Category | Risk Description | Impact Level | Mitigation Measures | Monitoring Metric |
|---------|---------|---------|---------|---------|
| **Technical Risk** | Prisma version compatibility, PostgreSQL performance bottleneck | High | Tech stack validation, POC testing, rollback plan | DB connection count, query latency |
| **Performance Risk** | Overselling under high-concurrency booking scenarios | Extremely High | Partial unique index guarantee, Redis soft rate-limiting, load testing | Booking success rate, conflict rate |
| **Scalability Risk** | Query performance degradation as data volume grows | Medium | Partitioning strategy, index optimization, read-write separation | Query response time, index hit rate |
| **Security Risk** | Sensitive data leakage, SQL injection attacks | High | Field-level encryption, parameterized queries, security audit | Anomalous access logs, security event count |

### 14.3 Next Action Recommendations
1. **Immediate Actions**:
   - Complete the full Prisma Schema definition and migration scripts
   - Implement the atomic preemption prototype for high-concurrency booking
   - Set up basic Redis cache and BullMQ message queue

2. **Short-Term Plan (within 1 month)**:
   - Complete end-to-end implementation of the core booking business flow
   - Implement basic index strategy and query optimization
   - Establish data monitoring and alerting mechanism

3. **Medium to Long-Term Plan (3–6 months)**:
   - Implement read-write separation architecture and data partitioning
   - Optimize cache strategy and async processing flow
   - Prepare architecture design for microservice decomposition

### 14.4 Document Version History
- **v2.5.0**: Removed §2.2.6 Staff model (including model definition, data model statistics row, relationship table references); Staff model is an isolated entity with no corresponding API; also removed contract.yaml SCH-001 endpoint.
- **v2.4.0**: Marked §2.2.6 Staff model as FUTURE-PHASE (reserved for scheduling management SCH-001); verified §11.1.1 Dashboard Statistics table has no STAFF-003 residual references (removed in contract.yaml v1.6.3).
- **v2.3.0**: Added §2.2.6 Staff employee management model, §2.2.7 Notification/Message in-app notification and message models; updated §2.3 data model statistics table; extended §11.1.1 Dashboard Statistics with two new dimensions: Notification List and Unread Message Count.
- **v2.2.0**: Added §11.1.1 Dashboard Statistics data source description; documented DASH-001~004 statistical metrics Prisma aggregate calculation methods and materialized view performance optimization recommendations.
- **v2.1.0**: PII encryption three-field model (Scheme C v4): User Schema replaced with three-field model (phone/phoneHash/phoneEncrypted + email/emailHash/emailEncrypted + passwordHash); 8.1 Sensitive Data Protection table added email row; ERD updated.
- **v2.0.0**: Angular+NestJS refactored edition, integrated high-concurrency optimization strategy
- **Baseline alignment**: Fully aligned with tech stack recommendation document and System Architecture Design (SAD)
- **Update records**: 2026-04-14 - Updated based on latest tech stack info via MCP; 2026-04-21 - TASK-D3 PII encryption three-field model; 2026-05-04 - DASH-001~004 Dashboard statistics

---

**Document Status**: ✅ Complete  
**Review Status**: Pending architecture review  
**Implementation Status**: Guiding development implementation  
