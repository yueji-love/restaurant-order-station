# 技术设计

## 架构

- 保留现有 React + Express 结构，持久层迁移为项目内 SQLite 数据库。
- `state` 扩展为 `queue / settings / dishes / addOns / users / sessions`。
- 对客户端只输出 `queue / settings / dishes / addOns`；认证数据始终保留在服务端。
- 静态资源和认证接口公开，其余 `/api` 接口及 SSE 事件均经过会话校验。

## 认证设计

- 使用 Node.js `crypto.scrypt` 派生密码哈希，每个账号使用至少 16 字节随机盐。
- 登录成功生成高熵随机会话令牌，只把令牌放入 HttpOnly Cookie。
- 服务端持久化令牌哈希、用户 ID 和过期时间，不持久化明文令牌。
- Cookie 使用 `Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`；HTTPS 请求额外使用 `Secure`。
- 登录比较使用 `timingSafeEqual`，过期会话在读取和认证时清理。

## 数据模型

### Dish

```text
id, group, name, note, priceCents, active, createdAt, updatedAt
```

### AddOn

```text
id, name, priceCents, active, createdAt, updatedAt
```

### User

```text
id, username, passwordSalt, passwordHash, createdAt
```

### Session

```text
id, userId, tokenHash, expiresAt, createdAt
```

### Order 扩展

```text
dishId, category（名称快照）, priceCents（价格快照）
```

## API

- `GET /api/auth/me`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/dishes`
- `PATCH /api/dishes/:id`
- `DELETE /api/dishes/:id`
- `POST /api/add-ons`
- `PATCH /api/add-ons/:id`
- `DELETE /api/add-ons/:id`
- 现有订单、设置、状态和事件接口增加登录保护。

## 界面

- 未登录：左右不对称的登录/注册界面，表单只保留用户名、密码和确认密码。
- 顶栏：增加“菜品”入口及当前账号/退出按钮。
- 菜品页：左侧录入/编辑表单，右侧高密度菜品/加料清单；支持编辑、启停、删除。
- 点单页：菜品选项完全来自 `dishes`，展示名称、说明与价格。
- 设置页：删除顶部标题区，其余设置结构保持不变。

## 提示音

- 复用单例 `AudioContext`，依次触发三个短促音符并使用快速衰减包络，形成三全音风格。
- 首次用户操作后恢复音频上下文，避免初始数据加载误触发提示音。

## 验证策略

- API：注册、重复注册、登录失败、登录成功、未授权访问、退出、菜品 CRUD。
- 数据：旧存储迁移、认证字段不进入公共状态、订单保存菜品快照。
- 浏览器：注册→登录态→菜品新增/编辑/停用→点单页变化→退出→重新登录。
- 回归：号牌设置、订单锁号、出餐批量操作和 SSE 同步。
