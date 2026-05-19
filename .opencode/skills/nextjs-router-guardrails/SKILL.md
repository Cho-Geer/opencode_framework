---
name: "nextjs-router-guardrails"
description: "Enforces Next.js router guardrails and authentication best practices for secure routing. Invoke when working with Next.js routing, authentication, or middleware."
---

# Next.js 路由守卫最佳实践

## 概述

本技能定义了在 Next.js 应用中实施路由保护和身份验证守卫的完整标准、最佳实践和技术规范。这些指导原则旨在确保应用程序安全、可维护且符合行业标准。

---

## 核心原则

### 1. 分层防护策略

在 Next.js 应用中实施三层防护：

| 层级 | 技术 | 保护范围 | 实现位置 |
|------|------|----------|----------|
| **L1 - 边缘层** | Next.js Middleware | 所有路由请求 | `middleware.ts` |
| **L2 - 页面层** | 认证 HOC 或自定义 Hooks | 页面组件 | `withAuth.tsx`, `withAdmin.tsx` |
| **L3 - API 层** | API 路由验证 | API 端点 | API 路由中的认证检查 |

### 2. 安全优先原则

- 所有受保护的路由必须实施多重验证
- Token 验证不应依赖单一来源
- 始终验证 JWT 的签名和过期时间
- 敏感操作需要重新验证

---

## Next.js Middleware 实施标准

### 标准结构

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // 1. 定义公开路径
  const publicPaths = ['/login', '/register', '/public'];
  
  // 2. 获取认证信息
  const accessToken = request.cookies.get('access_token')?.value;
  
  // 3. 路由保护逻辑
  if (!publicPaths.includes(pathname) && !accessToken) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  
  // 4. 添加安全头部
  const response = NextResponse.next();
  response.headers.set('X-XSS-Protection', '1; mode=block');
  
  return response;
}

export const config = {
  matcher: ['/', '/login', '/register', '/admin/:path*'],
};
```

### 必须实施的安全头部

```typescript
// 在所有响应中添加这些安全头部
response.headers.set('X-XSS-Protection', '1; mode=block');
response.headers.set('X-Frame-Options', 'SAMEORIGIN');
response.headers.set('X-Content-Type-Options', 'nosniff');
response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
response.headers.set('Content-Security-Policy', "default-src 'self'");
```

### 公开路径配置标准

```typescript
// 公开路径必须明确定义，不能使用通配符
const publicPaths = [
  '/login',
  '/register',
  '/demo-ui',
  '/image-gallery',
  '/account-disabled',
  // 静态资源路径
];

// 检查是否为公开路径的标准化方法
function isPublicPath(pathname: string): boolean {
  return pathname === '/' || 
         publicPaths.some(path => 
           pathname === path || pathname.startsWith(`${path}/`)
         );
}
```

---

## 高阶组件 (HOC) 标准

### withAuth 标准实现

```typescript
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useSelector } from 'react-redux';

export function withAuth<P extends object>(WrappedComponent: React.ComponentType<P>) {
  return function WithAuthComponent(props: P) {
    const router = useRouter();
    const { currentUser, authInitialized } = useSelector((state: RootState) => state.user);

    useEffect(() => {
      if (authInitialized && !currentUser) {
        router.push('/login?redirect=' + encodeURIComponent(router.asPath));
      }
    }, [authInitialized, currentUser, router]);

    if (!authInitialized) {
      return <LoadingSpinner />;
    }

    if (!currentUser) {
      return null;
    }

    return <WrappedComponent {...props} />;
  };
}
```

### withAdmin 标准实现

```typescript
export function withAdmin<P extends object>(WrappedComponent: React.ComponentType<P>) {
  return function WithAdminComponent(props: P) {
    const router = useRouter();
    const { currentUser } = useSelector((state: RootState) => state.user);

    useEffect(() => {
      if (currentUser && currentUser.role !== 'ADMIN') {
        router.push('/unauthorized');
      }
    }, [currentUser, router]);

    if (!currentUser || currentUser.role !== 'ADMIN') {
      return <AccessDenied />;
    }

    return <WrappedComponent {...props} />;
  };
}
```

### 使用标准

```typescript
// ✅ 正确：在页面组件上使用
export default withAuth(BookingPage);

// ✅ 正确：组合使用
export default withAuth(withAdmin(AdminDashboard));

// ❌ 错误：在子组件上使用
// 只应该在页面级别使用
```

---

## 认证状态管理标准

### Token 验证流程

```typescript
interface JwtPayload {
  sub: string;
  role: string;
  exp: number;
  iat: number;
}

function decodeToken(token: string): JwtPayload | null {
  try {
    const decoded = jwtDecode<JwtPayload>(token);
    
    // 验证过期时间
    if (decoded.exp && Date.now() >= decoded.exp * 1000) {
      return null;
    }
    
    return decoded;
  } catch (error) {
    console.error('Token decode failed:', error);
    return null;
  }
}
```

### 重定向处理标准

```typescript
function createLoginRedirect(
  request: NextRequest, 
  errorMessage?: string, 
  redirectPath?: string
): NextResponse {
  const loginUrl = new URL('/login', request.url);
  
  // 保存原始路径用于登录后跳转
  if (redirectPath) {
    loginUrl.searchParams.set('redirect', redirectPath);
  }
  
  // 添加错误信息
  if (errorMessage) {
    loginUrl.searchParams.set('error', 'invalid_token');
    loginUrl.searchParams.set('message', errorMessage);
  }
  
  const response = NextResponse.redirect(loginUrl);
  
  // 清除无效的认证 cookies
  response.cookies.delete('access_token');
  response.cookies.delete('refresh_token');
  
  return response;
}
```

---

## 特殊场景处理

### CSRF 错误处理

```typescript
// 在 middleware 中检测 CSRF 错误
const isCsrfError = searchParams.get('csrf_error') === 'true';

if (isCsrfError && pathname === '/login') {
  const response = NextResponse.next();
  response.cookies.delete('access_token');
  response.cookies.delete('refresh_token');
  response.cookies.delete('csrf_token');
  return response;
}
```

### 角色变更处理

```typescript
// 检测角色变更
const isRoleChanged = searchParams.get('role_changed') === 'true' || 
                      searchParams.get('reason') === 'ROLE_CHANGED_FROM_ADMIN';

if (isRoleChanged && pathname === '/login') {
  const response = NextResponse.next();
  response.cookies.delete('access_token');
  response.cookies.delete('refresh_token');
  return response;
}
```

### 账户禁用处理

```typescript
// 账户禁用页面允许访问，即使有 token
if (pathname === '/account-disabled') {
  const response = NextResponse.next();
  // 添加安全头部但不重定向
  return response;
}
```

---

## 性能优化标准

### Matcher 配置优化

```typescript
// ✅ 正确：只匹配需要的路径
export const config = {
  matcher: [
    '/',
    '/login',
    '/register',
    '/account-disabled',
    '/admin/:path*',
    '/{feature}/:path*',
    '/{user_feature}/:path*',
  ],
};

// ❌ 错误：匹配所有路径
// export const config = {
//   matcher: '/:path*',
// };
```

### 避免不必要的处理

```typescript
// ✅ 正确：快速路径跳过
if (isPublicPath(pathname)) {
  const response = NextResponse.next();
  response.headers.set('X-XSS-Protection', '1; mode=block');
  return response;
}
```

---

## 测试标准

### Middleware 测试

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { middleware } from './middleware';

describe('Middleware Auth', () => {
  it('should redirect unauthenticated users from protected routes', () => {
    const request = new NextRequest('https://example.com/admin');
    const response = middleware(request);
    expect(response.status).toBe(307);
  });
});
```

### HOC 测试

```typescript
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { withAuth } from './withAuth';

describe('withAuth HOC', () => {
  it('should show loading spinner when auth not initialized', () => {
    const TestComponent = withAuth(() => <div>Protected</div>);
    render(
      <Provider store={mockStore({ user: { authInitialized: false } })}>
        <TestComponent />
      </Provider>
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
```

---

## 禁止模式

### ❌ 禁止：单一验证点

```typescript
// ❌ 错误：只在 middleware 中验证
// 缺少页面级和 API 级验证
```

### ❌ 禁止：硬编码路径

```typescript
// ❌ 错误：硬编码路径检查
if (pathname === '/admin/{entity_1}' || pathname === '/admin/{entity_2}') {
  // 难以维护
}
```

### ❌ 禁止：客户端验证为主

```typescript
// ❌ 错误：只依赖客户端验证
// 必须在服务器端也验证
```

### ❌ 禁止：泄露敏感信息

```typescript
// ❌ 错误：在重定向 URL 中暴露详细错误
// 只应该提供通用错误信息
```

---

## 最佳实践清单

在实施路由守卫前，请检查：

- [ ] **Middleware 层**：已在 `middleware.ts` 中实现边缘层保护
- [ ] **HOC 层**：已创建 `withAuth` 和 `withAdmin` 高阶组件
- [ ] **安全头部**：已在所有响应中添加必需的安全头部
- [ ] **公开路径**：已明确定义公开路径列表
- [ ] **Token 验证**：已实现完整的 JWT 验证流程
- [ ] **重定向处理**：已正确处理登录后跳转
- [ ] **错误处理**：已处理 CSRF、角色变更、账户禁用等特殊场景
- [ ] **性能优化**：已优化 matcher 配置避免不必要的处理
- [ ] **测试覆盖**：已为 middleware 和 HOC 编写测试
- [ ] **文档更新**：已更新本文档记录实施细节

---

## 验证机制

使用本技能时，必须验证：

1. **分层防护验证**：确认已实施三层防护（Middleware、HOC、API）
2. **安全头部验证**：确认所有响应都包含必需的安全头部
3. **路径配置验证**：确认公开路径和受保护路径正确配置
4. **Token 验证验证**：确认 JWT 过期时间和签名验证已实施
5. **重定向处理验证**：确认登录后跳转逻辑正确
6. **错误场景验证**：确认 CSRF、角色变更、账户禁用等场景已处理

---

## 强制约束

- **禁止**：只有单一验证点，必须实施多层防护
- **禁止**：在子组件上使用 withAuth/withAdmin，只能在页面组件上使用
- **禁止**：在响应中泄露敏感信息
- **必须**：在所有响应中添加安全头部
- **必须**：验证 JWT 的过期时间和签名
- **必须**：优化 matcher 配置，避免不必要的处理

---

## 集成点

本技能应与以下技能配合使用：
- `devops-ci-cd-guardrails`：确保 CI/CD 配置的可靠性
- `global-cicd-practices-enforcement`：强制执行 CI/CD 最佳实践
- `context7-first`：获取最新的 Next.js 技术栈文档

---

## 相关资源

- [Next.js Middleware 文档](https://nextjs.org/docs/app/building-your-application/routing/middleware)
- [Next.js Authentication 最佳实践](https://nextjs.org/docs/authentication)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
