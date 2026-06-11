# NestJS Controller, Service & Module Testing

**Source**: Context7 (/nestjs/nest) + NestJS official docs
**Library**: /nestjs/nest
**Fetched**: 2026-06-11

## Controller Testing

### Basic Controller Unit Test

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { CatsController } from './cats.controller';
import { CatsService } from './cats.service';

describe('CatsController', () => {
  let controller: CatsController;
  let service: jest.Mocked<CatsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CatsController],
      providers: [
        {
          provide: CatsService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<CatsController>(CatsController);
    service = module.get(CatsService);
  });

  describe('findAll', () => {
    it('should return an array of cats', async () => {
      const expected = [{ id: 1, name: 'Tom' }];
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll();

      expect(result).toEqual(expected);
      expect(service.findAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('findOne', () => {
    it('should return a single cat', async () => {
      const expected = { id: 1, name: 'Tom' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('1');

      expect(result).toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith(1);
    });
  });
});
```

## Service Testing

### Service with Repository Pattern

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { CatsService } from './cats.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CatsService', () => {
  let service: CatsService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatsService,
        {
          provide: PrismaService,
          useValue: {
            cat: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CatsService>(CatsService);
    prisma = module.get(PrismaService);
  });

  describe('findAll', () => {
    it('should return all cats', async () => {
      const expected = [{ id: 1, name: 'Tom', breed: 'Siamese' }];
      prisma.cat.findMany.mockResolvedValue(expected);

      const result = await service.findAll();

      expect(result).toEqual(expected);
      expect(prisma.cat.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
```

### Testing Error Handling

```typescript
describe('create', () => {
  it('should throw ConflictException when name already exists', async () => {
    const dto = { name: 'Tom', breed: 'Siamese' };
    prisma.cat.findUnique.mockResolvedValue({ id: 1, name: 'Tom' });

    await expect(service.create(dto)).rejects.toThrow(ConflictException);
    expect(prisma.cat.findUnique).toHaveBeenCalledWith({
      where: { name: 'Tom' },
    });
  });
});
```

## Module Testing

### Testing Module Configuration

```typescript
import { Test } from '@nestjs/testing';
import { CatsModule } from './cats.module';
import { CatsService } from './cats.service';
import { CatsController } from './cats.controller';

describe('CatsModule', () => {
  it('should compile the module', async () => {
    const module = await Test.createTestingModule({
      imports: [CatsModule],
    }).compile();

    expect(module).toBeDefined();
    expect(module.get(CatsController)).toBeInstanceOf(CatsController);
    expect(module.get(CatsService)).toBeInstanceOf(CatsService);
  });
});
```

### Testing with Database Module

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatsModule } from './cats.module';

describe('CatsModule (integration)', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          autoLoadEntities: true,
          synchronize: true,
        }),
        CatsModule,
      ],
    }).compile();
  });

  it('should resolve CatsService', () => {
    const service = module.get(CatsService);
    expect(service).toBeDefined();
  });
});
```

## Key Testing Features

| Feature | Method | Purpose |
|---------|--------|---------|
| Override Provider | `.overrideProvider(token).useValue(mock)` | Replace real service with mock |
| Override Guard | `.overrideGuard(GuardClass).useValue({ canActivate: () => true })` | Disable auth guards |
| Override Pipe | `.overridePipe(PipeClass).useValue({ transform: (v) => v })` | Bypass validation |
| Override Interceptor | `.overrideInterceptor(InterceptorClass).useValue({ intercept: (...) => next.handle() })` | Bypass interceptors |
| Auto-Mocking | `.useMocker(token => mock)` | Auto-generate mocks |
