# 餐厅点单台

面向餐厅前台与出餐员工的响应式点单工作台。

- Gitee：`https://gitee.com/yuejilove/restaurant-order-station.git`
- GitHub：`https://github.com/yueji-love/restaurant-order-station.git`

腾讯云 Ubuntu + Docker 的完整部署、数据库备份、日常更新和故障回滚步骤，见 [`DEPLOY_TENCENT_CLOUD.md`](./DEPLOY_TENCENT_CLOUD.md)。服务器更新时必须先备份 `/opt/restaurant-order-station/data/restaurant.sqlite`，再拉取代码并重建容器。

## 本地运行

```bash
npm install
npm run dev
```

开发模式会同时启动网页和实时接口。局域网内的其他设备访问开发电脑显示的局域网地址，即可实时共享订单和设置。

生产构建：

```bash
npm run build
npm start
```

生产模式默认监听 `5175` 端口。其他设备可访问 `http://开发电脑IP:5175`。

## 安装成桌面应用

先运行生产版本：

```bash
npm run build
npm start
```

在运行服务的电脑上使用 Chrome 或 Edge 打开 `http://127.0.0.1:5175/`，点击地址栏右侧的“安装”图标，或从浏览器菜单选择“安装 餐厅点单台”。安装完成后可从桌面或开始菜单启动，窗口将不显示浏览器地址栏。

浏览器只允许从 HTTPS 或本机 `localhost` / `127.0.0.1` 安装 PWA。局域网其他设备若通过 `http://电脑IP:5175` 访问，需要先配置 HTTPS 才能安装。

更新 `public/favicon.svg` 后，可重新生成各平台图标：

```bash
npm run generate:pwa-icons
```

## 已实现

- 号码、品类、小料、确认四步点单流程
- 使用中、已选择、未选择等可辨识状态
- 下单成功反馈与自动重置
- 多设备订单实时同步
- 不同商家账号的数据相互隔离，同账号设备继续实时协作
- 出餐队列的开始制作和完成取餐操作
- 可持久化的号牌与提示音设置
- 可安装到桌面或手机主屏幕的 PWA 独立窗口
- 桌面、iPad 和手机响应式布局
- 键盘焦点、语义化控件和减少动态效果支持

视觉意向图位于 `design-reference/order-entry-concept.png`，完整设计令牌和交互规则位于 `DESIGN.md`。

腾讯云 Ubuntu + Docker 的完整生产部署步骤见 [`DEPLOY_TENCENT_CLOUD.md`](./DEPLOY_TENCENT_CLOUD.md)。
