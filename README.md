# 餐厅点单台

适合小餐厅前台、后厨和结算协作的响应式 Web/PWA 工作台。

- Gitee：`https://gitee.com/yuejilove/restaurant-order-station.git`
- GitHub：`https://github.com/yueji-love/restaurant-order-station.git`
- 腾讯云 Ubuntu + Docker 教程：[`DEPLOY_TENCENT_CLOUD.md`](./DEPLOY_TENCENT_CLOUD.md)

## 业务流程

1. 前台选择号牌并加菜。同一号牌在结算前可以多次加菜，系统持续累计整张账单。
2. 后厨按每一道菜处理任务，每条任务只需“开始制作”和“完成制作”两次操作。
3. 全部菜品完成后，在“结算”中确认整张号牌账单；结算后号牌重新变为空闲。
4. 顾客扫描号牌背面的二维码，可查看当前消费、每道菜进度和同菜排队位置；商家可在页面底部配置收款码。

系统有四个主导航：**点菜、出餐、结算、我的**。“我的”中包含数据看板、菜品管理、小料库、号牌/提示音/收款码设置。

## 固定测试数据

全新空数据库首次启动会自动创建：

- 测试账号：`yue`
- 测试密码：`123`
- 4 个菜品大类、35 个菜品、24 个小料、40 张号牌
- 空账单和空经营历史

这不是只在开发环境运行的临时脚本：本地、Docker 和腾讯云首次部署都会执行相同的空库初始化。数据库一旦已有账号，后续重启或更新不会再次导入，也不会覆盖现有数据。系统仍开放注册，新账号的数据彼此隔离。

## 本地运行

需要 Node.js 22 或更高版本：

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm start
```

默认监听 `5175` 端口。

## 显式重建测试数据库

此操作会永久清空当前数据库，只能在确认不需要现有数据时使用：

```bash
npm run db:reset-demo -- --confirm-reset
```

命令缺少 `--confirm-reset` 时会拒绝执行。生产环境执行前必须先停止服务并备份数据库，具体步骤见部署文档。

## 安装成桌面应用

使用 Chrome 或 Edge 打开 HTTPS 地址（本机可用 `http://127.0.0.1:5175/`），点击地址栏中的“安装”图标，或从浏览器菜单选择“安装 餐厅点单台”。安装后会以没有普通地址栏的独立窗口运行。

非本机设备必须使用 HTTPS 才能安装 PWA。更新后如果仍显示旧界面，关闭已安装应用再重新打开，或在浏览器中强制刷新一次。

## 数据与导出

- SQLite 数据默认位于 `server/data/restaurant.sqlite`；Docker 中映射到宿主机 `./data/restaurant.sqlite`。
- 所有业务表按账号隔离；同账号多设备使用 SSE 实时同步。
- 数据看板和 CSV/JSON 导出以已结算账单为准，包含账单时间、号牌、菜品、小料、数量、状态和金额快照。
- 导出金额使用“元”，保留两位小数，不附加币种文字。
- 数据库和备份文件不会提交到 Git。

视觉和交互标准见 [`DESIGN.md`](./DESIGN.md)，本次号牌账单改造规格见 [`specs/table-billing-and-kitchen/`](./specs/table-billing-and-kitchen/)。
