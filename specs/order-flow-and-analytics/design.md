# 技术设计

## 信息架构

- 主导航：点菜、出餐、我的。
- 我的：数据看板、菜品管理、小料库、工作台设置。
- 点单：选择号码 -> 品类及菜品 -> 小料及金额确认 -> 创建订单。

## 数据模型

### Dish 扩展

```text
allowedAddOnIds: string[]
```

SQLite `dishes` 表增加 `allowed_add_on_ids_json`，旧记录缺省时关联当前全部小料。

### 历史订单

SQLite 新增 `order_history` 表：

```text
id, completed_at, data_json
```

订单仍保存创建时的菜品名称、品类、基础价格、小料名称与价格快照，并增加 `quantity`（1–99）及按份数计算的 `totalCents`。旧订单缺少份数时按 1 份处理。完成取餐时增加 `completedAt` 并从 `orders` 移入 `order_history`。

## API

- 现有菜品 POST/PATCH 接口增加 `allowedAddOnIds` 校验。
- `GET /api/analytics?from=<ISO>&to=<ISO>` 返回所选区间的汇总和排行。
- 分析结果结构：`summary / categories / dishes / addOns / range`。

## 前端状态

- 主视图使用 `order / kitchen / mine`。
- “我的”内部使用 `dashboard / dishes / addOns / settings`。
- 点单选择状态拆分为 `number / selectedGroup / dish / extras / quantity`。
- 小料总价实时与菜品基础价格相加后乘以份数，确认按钮显示订单总额。

## 视觉规范

- 方向：工业实用型工作台。
- 色彩：`#F7F8F6` 背景、`#20211F` 主文字与按钮、`#D9DDDA` 分隔、`#2F6B4F` 成功状态。
- 字体：沿用项目现有中文工作台字栈，不新增外部字体依赖。
- 密度：高频操作区紧凑，数字权重大，解释文字最少。
- 形状：卡片 14px、输入框 10px、主要按钮 10px，交互控件保持一致。
- 动效：只保留状态切换与按压反馈，尊重 `prefers-reduced-motion`。

## 验证

- 数据迁移：现有菜品、小料、账号、队列保留，历史表可写入。
- API：菜品小料关系、完成订单归档、日期过滤和汇总计算。
- 浏览器：三标签导航、“我的”四分区、品类到菜品再到小料的完整下单流程。
