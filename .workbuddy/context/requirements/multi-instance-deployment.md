# Multi-Instance Deployment Requirements Document

## 1. Background and Objectives

Run multiple independent booking system instances simultaneously on a single PC, where each instance has its own independent database, cache, backend API, and frontend development server, without interfering with each other.

## 2. Functional Requirements

### 2.1 Instance Isolation
- Each instance has its own independent PostgreSQL database (different database name, different host port)
- Each instance has its own independent Redis cache (different host port)
- Each instance has its own independent backend API service (different port)
- Each instance has its own independent frontend Angular development server (different port)
- Each instance has its own independent Docker container name, volume name, and network name

### 2.2 One-Click Generation and Startup
- Generate instance configuration files via script `scripts/start-instance.sh <instance-id>`
- Start via `docker compose -f instances/<instance-id>/docker-compose.yml up -d`
- Start frontend via `npx ng serve --port=<port> --proxyConfig=<path>`

### 2.3 Cleanup and Shutdown
- Support stopping and data cleanup for a single instance without affecting other instances
- `docker compose -f instances/<instance-id>/docker-compose.yml down -v`

## 3. Port Allocation Scheme

| Instance | PostgreSQL | Redis | Backend API | Frontend | Socket |
|----------|------------|-------|-------------|----------|--------|
| instance-1 | 5432 | 6379 | 3000 | 4200 | 3001 |
| instance-2 | 5433 | 6380 | 3001 | 4201 | 3002 |
| instance-3 | 5434 | 6381 | 3002 | 4202 | 3003 |
| instance-N | 5431+N | 6378+N | 2999+N | 4199+N | 3000+N |

## 4. Generated File Structure

```
instances/
├── instance-1/
│   ├── docker-compose.yml    # Independent Docker Compose file
│   ├── backend.env           # Backend environment variables
│   ├── proxy.conf.json       # Frontend proxy configuration
│   ├── environment.ts        # Frontend environment file
│   └── environment.prod.ts
├── instance-2/
│   └── ...
└── instance-3/
    └── ...
```

## 5. Technical Implementation Key Points

- Use bash scripts to dynamically generate instance configurations
- Docker Compose files use unique container names, volume names, and network names
- Backend injects configuration through `backend.env` environment variable file
- Frontend switches configuration via `--proxyConfig` and `--fileReplacements` parameters
- Database names use `booking_db_<instance-id>` to avoid data conflicts

## 6. Usage Flow

```bash
# 1. Generate instance configuration
bash scripts/start-instance.sh instance-1

# 2. Start backend infrastructure
docker compose -f instances/instance-1/docker-compose.yml up -d

# 3. Start frontend development server (new terminal)
cd booking-frontend
npx ng serve --port=4200 --proxyConfig=../instances/instance-1/proxy.conf.json

# 4. Second instance (new terminal)
bash scripts/start-instance.sh instance-2
docker compose -f instances/instance-2/docker-compose.yml up -d
npx ng serve --port=4201 --proxyConfig=../instances/instance-2/proxy.conf.json
```
