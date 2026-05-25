# Appointment System - Data Architecture Design Document (Angular + NestJS Refactored Version)

## Document Information
- **Document Version**: 2.6.2
- **Creation Date**: 2026-04-14
- **Last Updated**: 2026-05-15
- **Contract Version**: contract.yaml v1.7.8
- **Refactored Tech Stack**: Angular v21+ + NestJS v11+ + Prisma 7.x + PostgreSQL 16
- **Database Engine**: PostgreSQL 16
- **ORM Tool**: Prisma 7.6.0+ (supports partial indexes and advanced index features)
- **Cache System**: Redis 7.x + BullMQ Message Queue
- **Document Status**: Baselined
- **Author**: System Architecture Analysis Tool

## 1. Data Architecture Overview

### 1.1 Design Principles
- **Consistency First**: Ensure data consistency across the system, guaranteed by database-level constraints in high-concurrency scenarios
- **Performance Optimization**: Reasonable indexing strategy, query optimization, specially optimized for high-concurrency appointment scenarios
- **Scalability**: Data model supporting business growth, read-write separation architecture, horizontal scalability
- **Security**: Sensitive data encryption, access control, database-level security constraints
- **Maintainability**: Clear model relationships, comprehensive documentation, automated migration tools
- **High Concurrency Handling**: Atomic preemption mechanism, optimistic conflict detection, multi-layer caching strategy

### 1.2 Data Layered Architecture (Angular + NestJS Refactored Version)
```
┌─────────────────────────────────────────────────────────┐
│              Application Layer                           │
│  Angular Frontend (v21+) ↔ DTO Objects ↔ Business         │
│               Entities ↔ Data Validation                 │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│              API Gateway Layer                           │
│             NestJS REST API (v11+) + WebSocket          │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│              Business Logic Layer                        │
│          Business Modules (Auth, Appointment,            │
│            Service, Notification, User Management)       │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│              Data Access Layer                           │
│     Prisma Client 7.x ↔ Prisma Schema (Partial Index     │
│                       Support)                           │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│               Storage Layer                              │
│ PostgreSQL 16 (Primary-Replica) ↔ Redis 7.x ↔ File       │
│                   Storage ↔ BullMQ                       │
└─────────────────────────────────────────────────────────┘
```

### 1.3 Data Storage Strategy
| Data Type | Storage Solution | Technology Selection | Data Lifecycle | High Concurrency Optimization |
|---------|---------|---------|-------------|-----------|
| **Structured Business Data** | Relational Database | PostgreSQL 16 (Primary-Replica) | Long-term storage, periodic archival | Read-write separation, partial unique indexes, connection pool optimization |
| **Session and Cache Data** | In-memory Database | Redis 7.x Cluster | Short-term storage, TTL control | Distributed locks, atomic counters, cache warm-up |
| **Async Message Queue** | Message Queue | BullMQ (Redis-based) | Deleted after task completion | Priority queues, delayed tasks, dead letter queues |
| **File Resources** | Object Storage / File System | Local Storage / S3-compatible Storage | Long-term storage, CDN distribution | Chunked upload, cache header optimization |
| **Log Data** | Structured Logging | Winston + ELK Stack | Short-term storage, periodic cleanup | Async writes, batch processing |

## 2. Core Data Model Design

### 2.1 Entity Relationship Diagram (ERD) - High Concurrency Optimized Version
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
        string name "User Name"
        string phone "Masked phone display (e.g. 138****5678)"
        string phoneHash "SHA-256(phone+pepper), unique index"
        string phoneEncrypted "AES-256-GCM ciphertext"
        string email "Masked email display (e.g. us***@example.com)"
        string emailHash "SHA-256(email+pepper), unique index"
        string emailEncrypted "AES-256-GCM ciphertext"
        string passwordHash "bcrypt hash (rounds=12)"
        enum userType "User Type"
        enum status "User Status"
        timestamp lastLoginAt "Last Login Time"
        string preferredTimezone "Preferred timezone (IANA, e.g. Asia/Shanghai, nullable)"
        json deviceInfo "Device Info"
        text remarks "Remarks"
        timestamp createdAt "Creation Time"
        timestamp updatedAt "Update Time"
    }
    
    Appointment {
        string id PK "UUID"
        string userId FK "User ID"
        string timeSlotId FK "TimeSlot ID"
        string serviceId FK "Service ID"
        string appointmentNumber "Appointment Number"
        date appointmentDate "Appointment Date"
        int slotSequence "Slot Sequence (atomic preemption)"
        int durationMinutes "Appointment Duration (minutes)"
        decimal price "Price Snapshot"
        decimal taxRate "Tax Rate Snapshot"
        decimal taxIncludedAmount "Tax-Included Total"
        enum status "Appointment Status"
        json customerInfo "Customer Info"
        text remarks "Remarks"
        timestamp createdAt "Creation Time"
        timestamp updatedAt "Update Time"
        @@unique([timeSlotId, appointmentDate, slotSequence], where: raw("status IN ('PENDING', 'CONFIRMED', 'COMPLETED')"))
    }
    
    
    TimeSlot {
        string id PK "UUID"
        string serviceId FK "Service ID"
        datetime startTime "Start Time"
        datetime endTime "End Time"
        int capacity "Slot Capacity"
        int currentSequence "Current Allocated Sequence"
        datetime createdAt "Creation Time"
        datetime updatedAt "Update Time"
    }
```

### 2.2 Complete Data Model Definition (Prisma Schema 7.x)

#### 2.2.1 User Domain Model (Updated for High Concurrency Support)
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

// User entity - Three-field PII encryption model (Plan C v4, TASK-D3 M-4)
model User {
  id           String        @id @default(uuid())
  name         String        // User name

  // Phone three-field (PII encryption, Plan C v4)
  // phone: Masked display (e.g. 138****5678), for frontend display only, not plaintext
  phone            String?       // Masked display column
  // phoneHash: SHA-256(phone_plaintext + PII_HASH_PEPPER), for unique index and exact lookup, must not be exposed to frontend
  phoneHash        String?       @unique
  // phoneEncrypted: AES-256-GCM ciphertext (format: iv:authTag:ciphertext, Base64), must not be exposed to frontend
  phoneEncrypted   String?

  // Email three-field (PII encryption, Plan C v4)
  // email: Masked display (e.g. us***@example.com), for frontend display only, not plaintext
  email            String?       // Masked display column
  // emailHash: SHA-256(email_plaintext + PII_HASH_PEPPER), for unique index and exact lookup, must not be exposed to frontend
  emailHash        String?       @unique
  // emailEncrypted: AES-256-GCM ciphertext (format: iv:authTag:ciphertext, Base64), must not be exposed to frontend
  emailEncrypted   String?

  // Password hash (bcrypt, rounds=12, OWASP 2023)
  passwordHash     String?

  userType     UserType      @default(CUSTOMER) // User type
  status       UserStatus    @default(ACTIVE) // User status
  lastLoginAt  DateTime?     // Last login time
  // Preferred timezone (iana timezone, e.g. Asia/Shanghai; added in v2.7.0 timezone architecture)
  preferredTimezone String?  @map("preferred_timezone")
  deviceInfo   Json?         // Device info (JSON format)
  remarks      String?       // Remarks
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  
  // Relationship fields
  sessions     UserSession[] // User sessions
  appointments Appointment[] // User appointments
  notifications Notification[] // User notifications
  activityLogs ActivityLog[] // User activity logs
  
  // Indexes: use hash columns as exact lookup indexes (instead of plaintext @unique)
  @@index([phoneHash])
  @@index([emailHash])
  @@index([userType, status])
  @@index([createdAt])
  @@index([lastLoginAt], where: raw("\"status\" = 'ACTIVE'"))
}

// User session model - supports dual-token authentication, device tracking, and active revocation
model UserSession {
  id               String   @id @default(uuid())
  userId           String   @map("user_id")
  sessionToken     String   @unique @map("session_token")      // Session identifier for fast query
  refreshToken     String   @unique @map("refresh_token")     // Stores Refresh Token, supports rotation and revocation
  expiresAt        DateTime @map("expires_at")
  refreshExpiresAt DateTime? @map("refresh_expires_at")
  ipAddress        String?  @map("ip_address")                 // Audit and risk control
  userAgent        String?  @map("user_agent")                 // Device fingerprint
  deviceInfo       Json?    @map("device_info")                // Device details (JSON format)
  isActive         Boolean  @default(true) @map("is_active")  // Soft delete flag, supports forced logout
  createdAt        DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([sessionToken])
  @@index([refreshToken])
  @@index([expiresAt])
  @@map("user_sessions")
}
```

**UserSession Field Responsibilities**:
| Field | Responsibility |
| :--- | :--- |
| `sessionToken` | Unique session identifier for quickly locating session records. |
| `refreshToken` | Stores Refresh Token, supports rotation and active revocation. |
| `ipAddress` / `userAgent` / `deviceInfo` | Audit and risk control, supports multi-device management and abnormal login detection. |
| `isActive` | Soft delete flag, supports forced logout without losing audit records. |
| `expiresAt` / `refreshExpiresAt` | Works with scheduled tasks to automatically clean up expired sessions. |

#### 2.2.2 High Concurrency Appointment Business Model (Core Optimization)
```prisma
// Appointment status enum
enum AppointmentStatus {
  PENDING     // Pending
  CONFIRMED   // Confirmed
  CANCELLED   // Cancelled
  COMPLETED   // Completed
  EXPIRED     // Expired
}

// TimeSlot entity - supports capacity management
model TimeSlot {
  id               String   @id @default(uuid())
  serviceId        String   @map("service_id")   // Associated service ID
  startTime        DateTime @map("start_time")    // TimeSlot start time
  endTime          DateTime @map("end_time")      // TimeSlot end time
  capacity         Int      @default(1)           // Slot capacity (supports multi-person appointments)
  currentSequence  Int      @default(0) @map("current_sequence") // Current allocated sequence (atomic preemption, must use database atomic operations for increment)
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")
  isActive         Boolean  @default(true) @map("is_active") // Whether the time slot is enabled (soft delete flag)

  // Relationship fields
  service          Service        @relation(fields: [serviceId], references: [id], onDelete: Restrict)
  appointments     Appointment[]

  // Index optimization
  @@index([serviceId, startTime, endTime])
  @@index([startTime])
  @@index([capacity, currentSequence])
  @@index([isActive])
}

// **Key Implementation Constraints**:
// 1. Increment of the `currentSequence` field MUST use database atomic operations
//    (e.g. PostgreSQL `UPDATE ... SET current_sequence = current_sequence + 1 WHERE ... RETURNING current_sequence`),
//    DO NOT use application-level `findUnique` + `update` pattern. This is one of the key points to guarantee contention-free `slotSequence` allocation.
// 2. TimeSlot must be associated with Service (serviceId FK), time slots are partitioned by service.
// 3. Time slots use start_time + end_time (datetime) to define precise start/end times,
//    no longer using slotTime (String HH:MM) format.

// Appointment entity - core of high concurrency optimization
model Appointment {
  id                 String            @id @default(uuid())
  userId             String            // User ID
  timeSlotId         String            // TimeSlot ID
  serviceId          String            // Service ID
  appointmentNumber  String            @unique // Appointment number (unique)
  appointmentDate    DateTime          // Appointment date
  slotSequence       Int               @default(0) // Slot sequence, for atomic preemption
  durationMinutes    Int               @default(30) // Appointment duration (minutes)
  price              Decimal?          // Price snapshot (service price at time of appointment)
  taxRate            Decimal?          // Tax rate snapshot (service tax rate at time of appointment; DB decimal format; API returns percentage format)
  taxIncludedAmount  Decimal?          // Tax-included total (price * (1 + taxRate))
  status             AppointmentStatus @default(PENDING) // Appointment status
  customerInfo       Json              // Customer info (JSON format)
  remarks            String?           // Remarks
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt
   
  // Relationship fields
  user               User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  timeSlot           TimeSlot          @relation(fields: [timeSlotId], references: [id], onDelete: Restrict)
  service            Service           @relation(fields: [serviceId], references: [id], onDelete: Restrict)
  histories          AppointmentHistory[] // Appointment history records
  notifications      Notification[]    // Associated notifications
  
  // Core: Partial unique index constraint - ensures uniqueness of each timeSlot+date+sequence (only for active appointments)
  // This is key to high concurrency appointment conflict handling
  @@unique([timeSlotId, appointmentDate, slotSequence], 
           map: "appointment_slot_occupied",
           where: raw("\"status\" IN ('PENDING', 'CONFIRMED', 'COMPLETED')"))
  
  // Business index optimization
  @@index([userId, appointmentDate])
  @@index([timeSlotId, appointmentDate, status])
  @@index([appointmentNumber])
  @@index([createdAt])
  @@index([status, appointmentDate])
  
  // Covering index for high-frequency query optimization
  @@index([appointmentDate, timeSlotId, status], 
          include: [userId, customerInfo],
          where: raw("\"status\" IN ('PENDING', 'CONFIRMED')"))
}

// Appointment history record entity
model AppointmentHistory {
  id              String            @id @default(uuid())
  appointmentId   String            // Appointment ID
  action          String            // Action type
  previousStatus  AppointmentStatus? // Previous status
  newStatus       AppointmentStatus? // New status
  changeReason    String?           // Change reason
  performedBy     String            // Performed by
  performedAt     DateTime          @default(now()) // Action time
  metadata        Json?             // Metadata
  
  // Relationship fields
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
  
  // Relationship fields
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
  taxRate          Decimal?  // Default tax rate (DB stores as decimal format, e.g. 0.08 = 8%; API transmits as percentage format 8)
  imageUrl         String?   // Image URL
  isActive         Boolean   @default(true) // Whether enabled
  displayOrder     Int       @default(0) // Display order
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
   
  // Relationship fields
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
  userId      String?            // User ID (optional, system notifications may have no specific user)
  appointmentId String?          // Appointment ID (optional)
  type        NotificationType   // Notification type
  title       String             // Notification title
  content     String             // Notification content
  isRead      Boolean            @default(false) // Whether read
  status      NotificationStatus @default(PENDING) // Notification status
  metadata    Json?              // Metadata (contains BullMQ jobId etc.)
  scheduledAt DateTime?          // Scheduled send time
  sentAt      DateTime?          // Actual send time
  retryCount  Int               @default(0) // Retry count
  lastError   String?           // Last error message
  createdAt   DateTime           @default(now())
  
  // Relationship fields
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

#### 2.2.5 System Management Model
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
 * ⏰ Timezone Configuration Related SystemSetting Key Definitions (Added v2.7.0):
 *
 * | Key | settingValue Format | Description |
 * |-----|-------------------|------|
 * | `default_timezone` | IANA timezone string (e.g. "Asia/Shanghai") | Clinic default timezone (Tier 3 fallback) |
 * | `business_hours` | JSON object: `{ timezone: string, schedule: { monday: [{ open, close }], ... } }` | Weekly business hours configuration. The timezone specifies which timezone the schedule times are effective in |
 *
 * Business Hours JSON Example:
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
 * Update Method: PUT /v1/admin/settings/business-hours (SUPER_ADMIN only)
 * Read Method: GET /v1/admin/settings/business-hours (ADMIN/SUPER_ADMIN)
 * - See `System Timezone Architecture Design Document.md §6`
 */

// Activity log entity
model ActivityLog {
  id           String   @id @default(uuid())
  userId       String?  // User ID (optional)
  action       String   // Action type
  resourceType String   // Resource type
  resourceId   String?  // Resource ID
  ipAddress    String?  // IP address
  userAgent    String?  // User agent
  metadata     Json?    // Metadata
  createdAt    DateTime @default(now())
  
  // Relationship fields
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
  context   Json?    // Context info
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
  body      String    // Notification content
  readAt    DateTime? // Read time (null = unread, non-null = read)
                      // API mapping: readAt != null → response.read = true
                      //            readAt == null → response.read = false
                      // Mark as read: POST /v1/admin/notifications/:id/read → set readAt = now()
                      // Unread count: count({ where: { readAt: null } })
  createdAt DateTime  @default(now())

  // Relationship fields
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
  body        String    // Message content
  readAt      DateTime? // Read time (null = unread, non-null = read)
                        // API mapping: readAt != null → read = true; readAt == null → read = false
                        // Unread count: GET /v1/admin/messages/unread-count → count({ where: { recipientId, readAt: null } })
  createdAt   DateTime  @default(now())

  // Relationship fields
  sender      User      @relation("SentMessages", fields: [senderId], references: [id], onDelete: Cascade)
  recipient   User      @relation("ReceivedMessages", fields: [recipientId], references: [id], onDelete: Cascade)

  // Index optimization
  @@index([recipientId, readAt])
  @@index([senderId])
}
```

> **Note**: The `InAppNotification` and `Message` models added in this section are simplified models for in-app notification and private messaging functionality, distinct from the BullMQ-integrated async notification system model `Notification` (SMS/EMAIL/PUSH etc. external channel notifications) in §2.2.4. In-app models focus on UI-level alert display (bell icon, envelope icon, read/unread status), while external channel notifications are handled by the BullMQ notification system in §2.2.4.
>
> **readAt → read API Mapping** [v2.5.1]: The database layer uses `readAt: DateTime?` (null = unread, datetime = read) to support precise read timestamps and auditing. The API layer (`contract.yaml` §2 admin.notifications) maps this to `read: boolean`. Conversion rules are as follows:
> - `readAt == null` → API `read: false`
> - `readAt != null` → API `read: true`
> - Mark-read endpoint `POST /v1/admin/notifications/:id/read` → backend sets `readAt = now()` on the `InAppNotification` record
> - `GET /v1/admin/messages/unread-count` → backend executes `count({ where: { recipientId: currentUser, readAt: null } })`
>
> This mapping also applies to the `Message` model defined in §2.2.6.

### 2.3 Data Model Statistics (High Concurrency Optimized Version)
| Model Category | Entity Count | Total Fields | Relationship Count | Index Count | Partial Index Count |
|---------|---------|---------|---------|---------|-------------|
| **User Management** | 2 | 28 | 4 | 16 | 1 |
| **Appointment Business** | 3 | 38 | 7 | 23 | 2 (Core Optimization) |
| **Service Management** | 2 | 20 | 3 | 8 | 0 |
| **Notification System** | 1 | 19 | 2 | 9 | 1 |
| **In-App Notification & Message** | 2 | 16 | 3 | 4 | 0 |
| **System Management** | 3 | 24 | 1 | 10 | 0 |
| **Total** | **14** | **150** | **21** | **71** | **4** |

## 3. Data Relationship Design

### 3.1 One-to-One Relationships
| Relationship | Entity A | Entity B | FK Location | Cascade Operation | Concurrency Consideration |
|------|-------|-------|---------|---------|---------|
| User-Default Session | User | UserSession | UserSession.userId | Cascade | Stateless sessions, supports multiple devices |
| Appointment-Latest History | Appointment | AppointmentHistory | AppointmentHistory.appointmentId | Cascade | History records written asynchronously |

### 3.2 One-to-Many Relationships (High Concurrency Optimized)
| Relationship | "One" Side | "Many" Side | FK Location | Cascade Operation | Concurrency Optimization |
|------|--------|--------|---------|---------|---------|
| User-Session | User | UserSession | UserSession.userId | Cascade | Redis cached sessions, DB async sync |
| User-Appointment | User | Appointment | Appointment.userId | Cascade | User appointment list paginated queries, cache optimization |
| User-Notification | User | Notification | Notification.userId | Cascade | Async notification processing, BullMQ queue |
| TimeSlot-Appointment | TimeSlot | Appointment | Appointment.timeSlotId | Restrict | Partial unique index ensures atomicity |
| Service-Appointment | Service | Appointment | Appointment.serviceId | Restrict | Service info cached, reduce joins |
| Appointment-TimeSlot (incl. overtime detection) | Appointment | TimeSlot | Appointment.timeSlotId | Restrict | Same relationship as "TimeSlot-Appointment". Overtime overlap detection: validate at creation that overtime does not overlap with existing appointments in adjacent slots; return 409 Conflict if overlapping |
| Category-Service | ServiceCategory | Service | Service.categoryId | Cascade | Category info static cache |

### 3.3 Many-to-Many Relationships
No direct many-to-many relationships are used in the current architecture. All relationships are explicitly managed through foreign keys to avoid join query performance bottlenecks.

## 4. Data Integrity Constraints

### 4.1 Entity Integrity (High Concurrency Hardened)
| Constraint Type | Implementation | Example | Concurrency Optimization |
|---------|---------|------|---------|
| **Primary Key Constraint** | `@id @default(uuid())` | `id String @id @default(uuid())` | UUID v7 (time-ordered) reduces index fragmentation |
| **Unique Constraint** | `@unique` | `phoneHash String? @unique` (PII hash column unique, not plaintext) | Application-layer cached uniqueness checks |
| **Composite Unique Constraint** | `@@unique([field1, field2])` | `@@unique([timeSlotId, appointmentDate, slotSequence])` | **Partial unique index**, high concurrency core |
| **Conditional Unique Constraint** | `@@unique(..., where: raw("condition"))` | `@@unique(..., where: raw("\"status\" IN ('PENDING', 'CONFIRMED')"))` | Reduces index size, improves performance |

### 4.2 Referential Integrity
| Constraint Type | Implementation | Cascade Strategy | Example | Concurrency Optimization |
|---------|---------|---------|------|---------|
| **Foreign Key Constraint** | `@relation` | Cascade/Restrict/SetNull | `user User @relation(fields: [userId], references: [id], onDelete: Cascade)` | Batch delete optimization |
| **Not Null Constraint** | Non-optional type | - | `name String` (non-optional type) | Application-layer validation reduces database pressure |
| **Default Value Constraint** | `@default()` | - | `status UserStatus @default(ACTIVE)` | Reduces application-layer logic |

### 4.3 Domain Integrity
| Constraint Type | Implementation | Example | Concurrency Optimization |
|---------|---------|------|---------|
| **Enum Constraint** | Custom enum type | `enum UserType { CUSTOMER, ADMIN }` | Database enum type, storage optimization |
| **Range Constraint** | Application-layer validation + DB CHECK | `durationMinutes Int @default(60)` | Business-layer validation as primary, DB as fallback |
| **Format Constraint** | Regex validation | Phone number format validation | Application-layer validation, DB triggers as backup |
| **JSON Schema Constraint** | Prisma Json type + app layer validation | `customerInfo Json` | JSON Schema validation, database jsonb type performance optimization |
| **Price Snapshot Constraint** | Application-layer logic | `Appointment.price/taxRate` snapshot from Service | price and taxRate are copied from Service model at appointment creation; subsequent Service price changes do not affect existing appointments |
| **Tax-Included Amount Constraint** | Application-layer calculation | `taxIncludedAmount = price * (1 + taxRate)` | Uses DB-stored decimal format taxRate (e.g. 0.08) for calculation, not API percentage format. Calculated and persisted by application layer based on price and taxRate at appointment creation |

## 5. Index Strategy (High Concurrency Optimization)

### 5.1 Primary Key Indexes
All entities automatically create B-tree indexes based on the `id` field, using UUID v7 to reduce index fragmentation.

> **Implementation Note**: Prisma's `@default(uuid())` generates UUID v4 (random) by default. If UUID v7 (time-ordered) is needed, it should be generated at the application layer or use `@default(dbgenerated("gen_random_uuid()"))` to call a database extension function. Verify the UUID version meets expectations during application initialization.

### 5.2 Unique Indexes (Partial Index Optimization)
| Index Field | Entity | Index Type | Purpose | Concurrency Optimization |
|---------|---------|---------|------|---------|
| `phoneHash` | User | Unique Index (SHA-256 hash column, not plaintext) | Phone number uniqueness validation | Application-layer cache check |
| `emailHash` | User | Unique Index (SHA-256 hash column, not plaintext) | Email uniqueness validation | Application-layer cache check |
| `appointmentNumber` | Appointment | Unique Index | Appointment number uniqueness | Prefix index query optimization |
| `[serviceId, startTime, endTime]` | TimeSlot | Composite Index | Query by service and time slot | Business-layer cache |
| `settingKey` | SystemSetting | Unique Index | System setting key uniqueness | Full in-memory cache |
| `[timeSlotId, appointmentDate, slotSequence]` | Appointment | **Partial Composite Unique Index** | Atomic preemption core | **WHERE status IN ('PENDING', 'CONFIRMED', 'COMPLETED')** |

### 5.3 Non-Unique Indexes (Query Performance Optimization)
| Index Field | Entity | Index Type | Query Scenario | Concurrency Optimization |
|---------|---------|---------|---------|---------|
| `userId` | UserSession | B-tree | User session queries | Sessions in Redis cache, DB as fallback |
| `userType` | User | B-tree | Filter by user type | Composite index `[userType, status]` |
| `status` | User/Appointment | B-tree | Status filter queries | Partial index reduces size |
| `appointmentDate` | Appointment | B-tree | Query appointments by date | Time-partitioned index |
| `createdAt` | All Entities | B-tree | Time range queries | Time series optimization |
| `categoryId` | Service | B-tree | Query services by category | Covering index optimization |
| `isActive` | Service/TimeSlot | B-tree | Active status filter | Partial index `WHERE isActive = true` |
| `bookingGroupId` | Appointment | B-tree | (Removed) Previously used for multi-slot appointment group queries | Deprecated, replaced by overtime-only mechanism |

### 5.4 Covering Indexes - High Performance Queries
| Priority | Recommended Index | Estimated Benefit | Implementation Complexity | SQL Example |
|-------|---------|---------|-----------|---------|
| **P0** | `Appointment(appointmentDate, timeSlotId, status) INCLUDE (userId, customerInfo)` | Query performance 5-10x improvement | Low | `CREATE INDEX ... INCLUDE (user_id, customer_info)` |
| **P1** | `Notification(userId, isRead)` | High-frequency query optimization | Low | `CREATE INDEX ... WHERE is_read = false` |
| **P2** | `Appointment(userId, status)` | User appointment status queries | Low | `CREATE INDEX ... WHERE status IN ('PENDING', 'CONFIRMED')` |
| **P3** | `ActivityLog(userId, createdAt DESC)` | User activity timeline | Medium | `CREATE INDEX ... ORDER BY created_at DESC` |

### 5.5 Index Optimization Recommendations (Based on PostgreSQL 16)
1. **Partial Index Priority**: Use partial indexes for status fields, reducing index size by 40-60%
2. **Covering Index Optimization**: Use INCLUDE fields for high-frequency queries to avoid table lookups
3. **Parallel Index Scanning**: PostgreSQL 16 supports better parallel index scanning
4. **Index Maintenance**: Regular `REINDEX CONCURRENTLY` to avoid table locks
5. **Monitoring Metrics**: Track index usage rates, remove unused indexes

## 6. Data Partitioning Strategy

### 6.1 Partitioning Plan (Time-Partitioning Primary)
| Partition Dimension | Partition Table | Partition Key | Partition Strategy | Use Case | Implementation Phase |
|---------|--------|--------|---------|---------|---------|
| **Time Partitioning** | Appointment | appointmentDate | Monthly range partition | Historical data archival, query performance | Phase 1 |
| **Business Partitioning** | Notification | type | List partition | Notification type separation, maintenance optimization | Phase 2 |
| **Status Partitioning** | User | status | List partition | Active/inactive user separation | Phase 3 |
| **Hash Partitioning** | ActivityLog | userId hash | Hash partition | Distributed query load balancing | Phase 4 |

### 6.2 Partition Implementation Path
1. **Phase 1**: Appointment table monthly partitioning (historical data > 6 months)
   - Partition key: `appointmentDate`
   - Partition strategy: `RANGE (PARTITION BY RANGE (appointment_date))`
   - Retention policy: Keep last 12 months hot data, 12-24 months warm data, 24+ months cold data

2. **Phase 2**: Notification table partitioned by type
   - Partition key: `type`
   - Partition strategy: `LIST (PARTITION BY LIST (type))`
   - Partitions: `email_notifications`, `sms_notifications`, `system_notifications`

3. **Phase 3**: User table partitioned by status
   - Partition key: `status`
   - Partition strategy: `LIST (PARTITION BY LIST (status))`
   - Partitions: `active_users`, `inactive_users`, `blocked_users`

### 6.3 Partitioning Performance Benefits
- **Query Performance**: Partition pruning reduces scanned data volume by 70-90%
- **Maintenance Efficiency**: Independent partition maintenance without affecting overall availability
- **Backup and Recovery**: Partition-level backup and recovery, time reduced by 60%
- **Data Lifecycle**: Automated data archival and cleanup

## 7. Cache Strategy (Multi-Layer Cache Architecture)

### 7.1 Redis Cache Design (High Concurrency Optimization)
| Cache Type | Cache Key Format | TTL | Update Strategy | Purpose | Concurrency Optimization |
|---------|-----------|-----|---------|------|---------|
| **User Session** | `session:{sessionToken}` | 7 days | Write-through + read refresh | User authentication state | Distributed sessions, stateless services |
| **Verification Code Cache** | `verification:phone:{phone}:{type}`<br>`verification:email:{email}:{type}` | 5 minutes | Write-through | Phone/Email verification codes | Atomic operations, anti-replay |
| **Service List** | `services:active` | 1 hour | Periodic refresh + invalidation notification | Active service list | Pub/sub pattern updates |
| **TimeSlot Cache** | `timeslots:available:{date}` | 30 minutes | Periodic refresh | Available time slot queries | **Atomic counter soft rate limiting** |
| **User Info** | `user:{userId}:profile` | 1 day | Delete on write | Basic user info | Cache penetration protection |
| **Appointment Capacity** | `slot:{timeSlotId}:remaining` | 1 hour | Atomic DECR operation | **High concurrency appointment soft rate limiting** | Redis single-thread atomicity |

### 7.2 Cache Consistency Guarantee (Multi-Level Strategy)
| Scenario | Consistency Strategy | Implementation | Concurrency Optimization |
|------|-----------|---------|---------|
| **Data Update** | Delete on write + Delayed double delete | Delete cache after DB update, async delayed delete again | Reduce cache avalanche risk |
| **Cache Invalidation** | TTL auto-expiry + renewal mechanism | Set reasonable expiration time, auto-renew hot data | Avoid cache breakdown |
| **Cache Penetration** | Null value caching + Bloom filter | Cache empty query results, Bloom filter pre-checks existence | RedisBloom module |
| **Cache Avalanche** | Random TTL + tiered caching | Add random offset to TTL, multi-level cache architecture | Layered expiration strategy |
| **Cache Breakdown** | Mutex lock + hot data never expires | Use Redis distributed lock, background update hot data | Redlock algorithm implementation |

### 7.3 Cache Performance Optimization
1. **Connection Pool Optimization**: Redis connection pool configuration to avoid connection storms
2. **Pipeline Technology**: Use pipeline for batch operations to reduce network round trips
3. **Lua Scripts**: Use Lua scripts for complex operations to ensure atomicity
4. **Memory Optimization**: Appropriate data structures, ziplist optimization for small objects
5. **Cluster Sharding**: Redis Cluster automatic sharding, horizontal scaling

## 8. Data Security Design

### 8.1 Sensitive Data Protection
| Data Type | Protection Measure | Encryption Algorithm | Storage Format | Access Control |
|---------|---------|---------|---------|---------|
| **User Password** | One-way hash + salt | bcrypt (rounds=12, OWASP 2023) | passwordHash value | Auth service access only |
| **JWT Token** | Signed encryption + short expiry | HMAC-SHA256 | Signed token | Token blacklist management |
| **Phone Number** | Three-field PII encryption + SHA-256 hash index | AES-256-GCM (phoneEncrypted) + SHA-256 (phoneHash) | phone masked / phoneHash hash / phoneEncrypted ciphertext | hash column for lookup, ciphertext column requires authorized decryption |
| **Email Address** | Three-field PII encryption + SHA-256 hash index | AES-256-GCM (emailEncrypted) + SHA-256 (emailHash) | email masked / emailHash hash / emailEncrypted ciphertext | hash column for lookup, ciphertext column requires authorized decryption |
| **ID Card Number** | Full-field encryption | AES-256-GCM | Encrypted storage | Strict permission control |
| **Device Info** | JSON storage + field-level encryption | Selective field encryption | Plaintext JSON + encrypted fields | Device fingerprint verification |

> **[M-5 Modification Note v2.1.0]** Added email address row, sensitivity level aligned with phone number (High).
> Added three-field model description column. Phone number row updated to three-field model format in sync.
> Design basis: piiEncryptionStrategy.md § 2 (Three-field model design).

### 8.2 Data Access Control (Multi-Level)
| Data Level | Access Control Mechanism | Implementation | Audit Log |
|---------|-------------|---------|---------|
| **Database Level** | PostgreSQL role permissions | Split databases and accounts, least privilege principle | PostgreSQL audit log |
| **Application Level** | NestJS Guards + RBAC | JWT authentication, role/permission decorators | Structured operation logs |
| **Row Level** | Business logic policies | User ID match check, tenant isolation | Business operation logs |
| **Field Level** | DTO transformation + masking | Data masking, field filtering, sensitive field masking | Field access logs |

### 8.3 Audit Log (Complete Traceability)
| Audit Type | Recorded Content | Storage Location | Retention Period | Query Performance |
|---------|---------|---------|---------|---------|
| **User Operations** | User ID, action type, resource, IP, time | ActivityLog table + Elasticsearch | 1 year | Time-partitioned index |
| **Data Changes** | Before/after data, operator, time | AppointmentHistory table | Permanent | Sharded by appointmentId |
| **System Events** | Event level, message, context, time | SystemLog table | 6 months | Time series index |
| **Security Events** | Login attempts, permission changes, abnormal access | Dedicated security events table | 2 years | Real-time stream processing |

## 9. Data Migration Strategy

### 9.1 Migration Tool Stack (Modernized)
| Tool Component | Version | Purpose | High Concurrency Support |
|---------|------|------|-----------|
| **Prisma Migrate** | 7.6.0+ | Database schema migration, version control | Supports zero-downtime migration |
| **Prisma Studio** | 7.6.0+ | Data visualization and management | Read-only replica queries |
| **Custom Migration Scripts** | Node.js + TypeScript | Data migration and transformation | Batch processing, transaction control |
| **Backup Tools** | pg_dump + WAL archiving | Data backup and recovery | Parallel backup, incremental recovery |
| **Data Validation Tools** | Custom validation scripts | Post-migration data integrity validation | Sampling validation, diff comparison |

### 9.2 Migration Process (High Availability Guarantee)
```
High Availability Migration Process:
1. Pre-migration Check → 2. Create Backup Snapshot → 3. Read-Only Replica Switch →
4. Execute Migration (Prisma Migrate) → 5. Data Validation → 6. Traffic Switch →
7. Monitoring Verification → 8. Clean Up Old Data → 9. Update Documentation
```

### 9.3 Rollback Strategy (Multi-Layer Protection)
| Rollback Scenario | Rollback Method | Data Impact | Recovery Time Objective (RTO) |
|---------|---------|---------|-------------------|
| **Migration Failure** | Rollback migration transaction | No data impact | < 5 minutes |
| **Data Error** | Restore backup snapshot | Restore to backup point | < 15 minutes |
| **Application Compatibility** | Version rollback + DB version compatibility | App and data version match | < 10 minutes |
| **Performance Issues** | Read-only replica switchback | Read query impact | < 3 minutes |

## 10. Data Governance

### 10.1 Data Quality Management (Real-Time Monitoring)
| Quality Dimension | Monitoring Metric | Check Frequency | Alert Threshold | Auto-Fix |
|---------|---------|---------|---------|---------|
| **Completeness** | Non-null field compliance rate | Real-time | < 99.5% | Data completion task |
| **Consistency** | Foreign key constraint violation count | Real-time | > 0 | Auto-fix script |
| **Accuracy** | Data validation error rate | Real-time | > 0.1% | Data cleaning process |
| **Timeliness** | Data update latency | Per minute | > 5 minutes | Cache refresh mechanism |
| **Uniqueness** | Unique constraint violation count | Real-time | > 0 | Duplicate data handling |

### 10.2 Data Lifecycle Management (Automated)
| Data Category | Active Period | Archival Period | Destruction Period | Retention Policy | Automation Tool |
|---------|--------|--------|--------|---------|-----------|
| **User Data** | Account active period | 6 months | 2 years | Soft delete + archive | Scheduled tasks + event-driven |
| **Appointment Data** | After appointment completion | 1 year | 3 years | Partition archival | PostgreSQL table partitioning |
| **Log Data** | 30 days | 6 months | 1 year | Compressed storage | Elasticsearch index lifecycle |
| **Cache Data** | Within TTL | - | TTL expiry | Auto-cleanup | Redis expiry policy |
| **Notification Data** | 30 days after sending | 3 months | 6 months | Summary archival | BullMQ completed queue cleanup |

### 10.3 Data Backup Strategy (Multi-Layer Protection)
| Backup Type | Backup Frequency | Retention Period | Storage Location | Recovery Objective | Encryption Method |
|---------|---------|---------|---------|---------|---------|
| **Full Backup** | Daily 02:00 | 7 days | Object Storage (S3-compatible) | Within 24 hours | AES-256 |
| **Incremental Backup** | Hourly | 24 hours | Object Storage (S3-compatible) | Within 1 hour | AES-256 |
| **WAL Archiving** | Real-time | 7 days | Dedicated storage volume | Within 5 minutes | Transport encryption |
| **Config Backup** | On change | Permanent | Version Control (Git) | Instant | Git encryption |
| **Cache Snapshot** | Daily 04:00 | 3 days | Object Storage | Within 30 minutes | Redis RDB encryption |

## 11. Performance Optimization Design (High Concurrency Focus)

### 11.1 Query Optimization (Appointment System Core)
| Optimization Measure | Implementation Method | Expected Benefit | Implementation Phase |
|---------|---------|---------|---------|
| **Partial Unique Index** | `WHERE status IN ('PENDING', 'CONFIRMED')` | Index size reduced by 60%, write performance improved by 40% | P0 (Implemented) |
| **Covering Index Optimization** | `INCLUDE (userId, customerInfo)` | High-frequency query performance 5-10x improvement | P0 (Implemented) |
| **Query Rewriting** | Avoid SELECT *, use specific fields | Data transfer reduced by 30-50% | P1 |
| **Pagination Optimization** | Cursor pagination + time partitioning | Large dataset pagination performance improvement | P1 |
| **Join Optimization** | Appropriate redundant fields, reduce table joins | Complex query performance improvement | P2 |
| **Materialized Views** | Materialize high-frequency statistical queries | Report query performance 10x improvement | P3 |

#### 11.1.1 Dashboard Statistics Data Source Description

> **DASH Statistics API Data Source** [v2.2.0]: The four statistical dimensions (DASH-001~004) of the Admin Dashboard **do not use a separate storage table**, but are calculated in real-time from existing business tables via Prisma aggregation queries:

| Statistical Dimension | Source Table | Calculation Method |
|----------|------|----------|
| **Core Statistics Cards** (DASH-001) | Appointment, User | `prisma.appointment.count({ where: {...} })` + `prisma.appointment.aggregate({ _sum: { ... } })` |
| **Appointment Trends** (DASH-002) | Appointment | `prisma.appointment.groupBy({ by: ['appointmentDate'], _count: true })` aggregated by time granularity |
| **Service Distribution** (DASH-003) | Appointment, Service | `prisma.appointment.groupBy({ by: ['serviceId'], _count: true })` JOIN Service.name |
| **Time Distribution** (DASH-004) | Appointment | Extract hour field from `appointmentDate`, `groupBy` by hour |
| **Notification List** (SYS-002) | InAppNotification (in-app) | `prisma.inAppNotification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })` paginated query |
| **Unread Message Count** (MSG-004) | Message | `prisma.message.count({ where: { recipientId, readAt: null } })` aggregation count |

> **Note** [v2.3.0]: The **Notification List** and **Unread Message Count** dimensions newly added to Dashboard are respectively supported by the `InAppNotification` (in-app) and `Message` models from §2.2.7, consistent with existing DASH-001~004, with no separate table for storing statistical results.

> **Performance Note**: For high-frequency access scenarios, it is recommended to create PostgreSQL **Materialized Views** with periodic refresh (e.g. every 5 minutes), or use Redis to cache statistical results (TTL=300 seconds), to avoid pressure on primary business tables from repeated aggregation calculations.

### 11.2 Write Optimization (High Concurrency Appointments)
| Optimization Measure | Implementation Method | Use Case | Concurrency Optimization |
|---------|---------|---------|---------|
| **Atomic Preemption** | Partial unique index + slot_sequence | Appointment conflict handling | Eliminates race conditions, TPS 1000+ |
| **Batch Writing** | Batch insert operations, transaction optimization | Data initialization, import | Reduces transaction overhead |
| **Async Writing** | BullMQ message queue | Logs, non-critical data | Peak shaving, throughput improvement |
| **Delayed Indexing** | Insert first, create indexes later | Large batch data import | Avoids index maintenance overhead |
| **Connection Pool Optimization** | PgBouncer transaction pooling mode | High concurrency connections | Connection reuse, supports 1000+ connections |

#### 11.2.1 Concurrency Conflict Scenario Example

**Scenario Description**: Two users simultaneously attempt to book the last available slot of the same time slot (`slot_sequence=0`).

**Sequence Steps**:
1. **Time T0**: User A and User B almost simultaneously initiate appointment requests
2. **Time T1**: System allocates `slot_sequence=0` for User A, successfully updates `TimeSlot.currentSequence` (atomic increment)
3. **Time T2**: System attempts to insert appointment record for User A, partial unique index check passes, insertion succeeds
4. **Time T3**: System allocates `slot_sequence=0` for User B (because `currentSequence` has not yet been seen by User B's request)
5. **Time T4**: System attempts to insert appointment record for User B, partial unique index detects conflict (`slot_sequence=0` already occupied)
6. **Time T5**: Database throws unique constraint violation error (Prisma error code `P2002`)
7. **Time T6**: System catches the error, returns "Appointment failed, slot already taken" message to User B

**Key Points**:
- Partial unique index ensures atomicity at the database level, even if two requests arrive simultaneously
- The first successfully inserted record immediately occupies the unique index position, subsequent insertion attempts fail immediately
- `P2002` errors are expected normal conflict handling and should not be treated as system exceptions

**Error Handling Recommendations**:
- Application layer should catch `P2002` errors and convert them to user-friendly messages
- Can automatically retry other available `slot_sequence` values (e.g. `slot_sequence=1`, if capacity allows)
- Record conflict rate metrics for monitoring system concurrency pressure

### 11.3 Storage Optimization
| Optimization Measure | Implementation Method | Storage Savings | Performance Impact |
|---------|---------|---------|---------|
| **Data Compression** | TOAST auto-compression + columnar storage optimization | Text fields saved 50-70% | Slight query performance impact |
| **Columnar Storage Optimization** | Appropriate data types, avoid over-normalization | Storage space reduced 20-30% | Query performance improved |
| **Partition Pruning** | Query condition optimization, partition key selection | Scanned data volume reduced 70-90% | Query performance significantly improved |
| **Index Optimization** | Partial indexes, covering indexes | Index size reduced 40-60% | Write performance improved, query stable |

## 12. Scalability Design

### 12.1 Read-Write Separation Architecture
| Read Operations | Write Operations | Separation Strategy | Technical Implementation | Performance Benefit |
|-------|-------|---------|---------|---------|
| Query APIs | CRUD APIs | Application-layer routing | NestJS middleware + Prisma extension | Read performance 3-5x improvement |
| Report Queries | Business Transactions | Database-level replication | PostgreSQL streaming replication | Primary database load reduced by 70% |
| Cache Population | Data Updates | Async synchronization | Redis pub/sub | Response time reduced by 50% |

**Technical Implementation**:
```typescript
// Prisma Client extension configuration for read-write separation
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
| Shard Dimension | Shard Key | Shard Strategy | Implementation Phase | Complexity |
|---------|--------|---------|---------|--------|
| **Time Sharding** | appointmentDate | Monthly table partitioning | Phase 1 (Current) | Low |
| **User Sharding** | userId hash | Range sharding | Phase 2 (Users > 1M) | Medium |
| **Business Sharding** | Business type | Vertical database split | Phase 3 (Microservices evolution) | High |
| **Geographic Sharding** | Region code | Geographic partition | Phase 4 (Internationalization) | Medium |

### 12.3 Microservices Evolution (Long-Term Architecture)
| Service Split | Split Basis | Tech Stack | Communication Protocol | Data Boundary |
|---------|---------|---------|---------|---------|
| **User Service** | User auth, personal info, permissions | NestJS + Prisma | REST + gRPC | User core data |
| **Appointment Service** | Appointment management, time slots, conflict detection | NestJS + Prisma + Redis | REST + WebSocket | Appointment business data |
| **Notification Service** | Message push, template management, channel integration | NestJS + BullMQ | REST + Message Queue | Notification config and records |
| **Reporting Service** | Statistical analysis, data export, BI integration | NestJS + ClickHouse | gRPC + File Stream | Analytics data warehouse |
| **System Service** | Config management, log collection, monitoring alerts | NestJS + Elasticsearch | REST + Event Bus | System operations data |

### 12.4 Horizontal Scaling Strategy
1. **Database Layer Scaling**:
   - PostgreSQL read-write separation (1 Primary + N Replicas)
   - Connection pooling: PgBouncer supports 1000+ concurrent connections
   - Data partitioning: Time partitioning + Business partitioning
   - Read-only replicas: Read traffic auto-routing

2. **Application Layer Scaling**:
   - NestJS stateless services, supports Kubernetes horizontal scaling
   - Redis Cluster: Auto-sharding, distributed data storage
   - BullMQ queues: Distributed workers, load balancing

3. **Cache Layer Scaling**:
   - Redis Cluster: Automatic failover, data sharding
   - Multi-level caching: Local cache + Redis + Database
   - Cache warm-up: Hot data preloading

## 13. Implementation Roadmap and Priorities

### 13.1 Phased Implementation Plan
| Phase | Time Window | Core Tasks | Key Deliverables | Risk Control |
|------|---------|---------|---------|---------|
| **Phase 1 (MVP)** | Month 1-2 | Basic data model, core appointment flow | Runnable minimal system | Tech stack validation, prototype testing |
| **Phase 2 (Optimization)** | Month 3-4 | High concurrency optimization, cache integration | Support 1000+ concurrent appointments | Stress testing, performance tuning |
| **Phase 3 (Expansion)** | Month 5-6 | Read-write separation, partitioning strategy | Production-grade scalable architecture | Canary deployment, monitoring alerts |
| **Phase 4 (Evolution)** | Month 7-12 | Microservices split, internationalization | Enterprise-grade distributed system | Service governance, data migration |

### 13.2 Priority Matrix (MoSCoW Method)
| Priority | Data Architecture Requirements | Business Value | Implementation Difficulty | Dependencies |
|-------|------------|---------|---------|--------|
| **Must Have** | 1. High concurrency appointment atomic preemption<br>2. Core data model integrity<br>3. Basic indexing strategy | Core business operational | Medium | Tech stack determined |
| **Should Have** | 1. Redis cache integration<br>2. Read-write separation architecture<br>3. Partitioning strategy | Performance scalability | High | Phase 1 complete |
| **Could Have** | 1. Advanced index optimization<br>2. Data compression<br>3. Audit log enhancement | System optimization | Medium | Phase 2 complete |
| **Won't Have (Now)** | 1. Microservices split<br>2. Geographic sharding<br>3. Multi-tenant architecture | Long-term evolution | High | Business scale growth |

## 14. Summary and Recommendations

### 14.1 Key Design Decisions
1. **Modernized Tech Stack**: Angular v21+ + NestJS v11+ + Prisma 7.x + PostgreSQL 16 + Redis 7.x
2. **High Concurrency Core**: PostgreSQL partial unique index + slot_sequence atomic preemption mechanism
3. **Multi-Layer Caching**: Redis soft rate limiting + session cache + business data cache
4. **Async Architecture**: BullMQ message queue decouples non-critical paths
5. **Scalability Design**: Read-write separation + data partitioning + stateless services

### 14.2 Risks and Countermeasures
| Risk Category | Risk Description | Impact Level | Countermeasure | Monitoring Metric |
|---------|---------|---------|---------|---------|
| **Technical Risk** | Prisma version compatibility, PostgreSQL performance bottlenecks | High | Tech stack validation, POC testing, rollback plan | Database connection count, query latency |
| **Performance Risk** | Overselling in high concurrency appointment scenarios | Critical | Partial unique index guarantee, Redis soft rate limiting, stress testing | Appointment success rate, conflict rate |
| **Scaling Risk** | Query performance degradation after data volume growth | Medium | Partitioning strategy, index optimization, read-write separation | Query response time, index hit rate |
| **Security Risk** | Sensitive data leakage, SQL injection attacks | High | Field-level encryption, parameterized queries, security audit | Abnormal access logs, security event count |

### 14.3 Next Step Action Recommendations
1. **Immediate Actions**:
   - Complete full Prisma Schema definition and migration scripts
   - Implement high concurrency appointment atomic preemption mechanism prototype
   - Establish basic Redis cache and BullMQ message queue

2. **Short-Term Plan (Within 1 Month)**:
   - Complete end-to-end implementation of core appointment business flow
   - Implement basic indexing strategy and query optimization
   - Establish data monitoring and alerting mechanism

3. **Medium-to-Long-Term Plan (3-6 Months)**:
   - Implement read-write separation architecture and data partitioning
   - Optimize cache strategy and async processing flow
   - Prepare microservices split architecture design

### 14.4 Document Version Notes
- **v2.5.0**: Removed §2.2.6 Staff model (including model definition, data model statistics row, relationship table references), Staff model was an orphan entity with no corresponding API; synchronously removed contract.yaml SCH-001 endpoint.
- **v2.4.0**: Marked §2.2.6 Staff model as FUTURE-PHASE (reserved for scheduling management SCH-001); verified §11.1.1 Dashboard Statistics table has no residual STAFF-003 references (already removed in contract.yaml v1.6.3).
- **v2.3.0**: Added §2.2.6 Staff employee management model, §2.2.7 Notification/Message in-app notification and message models; updated §2.3 Data model statistics table; extended §11.1.1 Dashboard Statistics with two new statistical dimensions: notification list and unread message count.
- **v2.2.0**: Added §11.1.1 Dashboard Statistics data source description, documented Prisma aggregation calculation methods for DASH-001~004 statistical metrics and materialized view performance optimization recommendations.
- **v2.1.0**: PII encryption three-field model (Plan C v4): User Schema replaced with three-field model (phone/phoneHash/phoneEncrypted + email/emailHash/emailEncrypted + passwordHash); §8.1 Sensitive data protection table added email row; ERD updated.
- **v2.0.0**: Angular+NestJS refactored version, integrated high concurrency optimization strategy
- **Baseline Alignment**: Fully aligned with tech stack recommendations and System Architecture Design Document (SAD)
- **Update Record**: 2026-04-14 - Updated based on latest tech stack information obtained via MCP; 2026-04-21 - TASK-D3 PII encryption three-field model; 2026-05-04 - DASH-001~004 Dashboard statistics

---

**Document Status**: ✅ Completed  
**Review Status**: Pending Architecture Review  
**Implementation Status**: Guiding Development Implementation  
