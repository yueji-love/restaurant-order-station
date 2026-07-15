# 小白部署教程：腾讯云 Ubuntu + Docker

这份教程适合第一次部署网站的人。命令可以直接复制，但凡是 `服务器公网IP`、`你的域名`、`证书文件名` 这样的中文占位文字，都要替换成你自己的内容。

代码仓库：

- Gitee：`https://gitee.com/yuejilove/restaurant-order-station.git`
- GitHub：`https://github.com/yueji-love/restaurant-order-station.git`

腾讯云服务器部署时从 Gitee 拉取代码，速度通常比 GitHub 更稳定；GitHub 作为同步备份仓库。

## 一、推荐部署方案

```text
电脑或手机浏览器
        ↓ HTTPS 443
腾讯云服务器上的 Nginx
        ↓ 127.0.0.1:5175
Docker 中的点单程序
        ↓
data/restaurant.sqlite
```

这套方案的特点：

- 应用只监听服务器本机的 `127.0.0.1:5175`，不会把程序端口直接暴露到公网。
- Nginx 负责域名、HTTPS 和实时订单同步连接。
- SQLite 数据库保存在服务器的 `data/` 目录中，更新代码不会删除数据。
- Docker 使用腾讯云镜像加速，npm 使用国内镜像，减少国外源带来的等待。

## 二、开始前准备

请先记下这些信息：

| 信息 | 示例 | 用途 |
| --- | --- | --- |
| 服务器公网 IP | `1.2.3.4` | SSH 登录和域名解析 |
| SSH 用户名 | 常见为 `ubuntu` 或 `root` | 登录服务器 |
| 域名（可稍后准备） | `order.example.com` | 正式 HTTPS 访问 |
| SSL 证书（可稍后准备） | `.crt/.pem` 和 `.key` | 启用 HTTPS |
| 对外访问地址 | `https://order.example.com` | 生成号牌二维码中的网址 |

在腾讯云控制台的服务器安全组中，只开放：

- `22`：SSH 登录
- `80`：HTTP，用于跳转 HTTPS
- `443`：HTTPS 正式访问

不要开放 `5175` 端口。

> 当前系统开放所有人注册，但每个账号的菜单、设置、账单和经营数据相互隔离。同一商家的多台设备必须登录同一个账号才能实时协作。固定账号 `yue / 123` 用于演示，正式营业请另外注册强密码账号。

## 三、连接服务器

在你的 Windows 电脑打开 PowerShell，执行：

```powershell
ssh ubuntu@服务器公网IP
```

例如服务器 IP 是 `1.2.3.4`：

```powershell
ssh ubuntu@1.2.3.4
```

第一次连接会询问是否信任，输入 `yes`。如果腾讯云镜像给你的用户名不是 `ubuntu`，改成控制台显示的用户名。

登录成功后，检查 Docker：

```bash
docker --version
docker compose version
```

两条命令都能显示版本号即可。如果出现 Docker 权限不足：

```bash
sudo usermod -aG docker "$USER"
exit
```

然后重新 SSH 登录一次。

## 四、配置腾讯云 Docker 镜像

先查看服务器是否已有 Docker 配置：

```bash
sudo mkdir -p /etc/docker
sudo nano /etc/docker/daemon.json
```

如果文件是空的，粘贴以下内容：

```json
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com"
  ],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

按 `Ctrl + O` 保存，按回车确认，再按 `Ctrl + X` 退出。

如果这个文件原来已有内容，请把镜像配置合并进去，不要直接覆盖原配置。保存后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart docker
docker info | sed -n '/Registry Mirrors/,+3p'
```

项目的 Dockerfile 已默认使用国内 npm 镜像 `https://registry.npmmirror.com`。

## 五、从 Gitee 下载项目

在服务器执行：

```bash
cd /opt
sudo git clone https://gitee.com/yuejilove/restaurant-order-station.git
sudo chown -R "$USER":"$USER" restaurant-order-station
cd restaurant-order-station
mkdir -p data
sudo chown -R 1000:1000 data
```

如果提示 `git: command not found`，先安装 Git：

```bash
sudo apt update
sudo apt install -y git
```

## 六、数据库初始化规则

全新部署时不要上传本机测试数据库。程序发现数据库为空，会在第一次启动时自动建立：

- 固定测试账号 `yue / 123`
- 4 个菜品大类、35 个菜品、24 个小料和 40 张号牌
- 空账单、空经营历史

这套初始化逻辑包含在生产程序中，腾讯云和本地行为一致。数据库已有账号后，重启、更新 Docker 或重新构建镜像都不会再次导入，也不会覆盖现有数据。

当前版本不迁移早期测试结构。如果服务器的 `data/restaurant.sqlite` 来自旧版，容器会明确提示需要重建。项目尚未正式上线时，可以先把旧文件备份到项目目录外，再按“十二、显式重建测试数据库”操作。不要把任何 `.sqlite` 文件提交到 Gitee 或 GitHub。

## 七、构建并启动程序

如果已经有正式 HTTPS 域名，先把它写入 `.env`。这个地址会写进号牌二维码，因此应在打印二维码前配置正确：

```bash
cd /opt/restaurant-order-station
cat > .env <<'EOF'
PUBLIC_BASE_URL=https://你的域名
EOF
```

没有域名、只想临时测试时，可以暂时不创建 `.env`。此时二维码会使用浏览器访问当前页面时的地址；正式打印前仍应配置固定 HTTPS 域名并重新下载二维码。

然后构建并启动：

```bash
cd /opt/restaurant-order-station
docker compose build
docker compose up -d
docker compose ps
```

第一次构建通常需要几分钟。完成后检查接口：

```bash
curl -fsS http://127.0.0.1:5175/api/auth/me
```

正常情况下会返回：

```json
{"user":null}
```

再检查容器状态：

```bash
docker compose ps
```

看到 `healthy` 表示程序运行正常。

## 八、暂时没有域名：安全试用

如果你还没有域名，可以先通过 SSH 隧道安全测试，不要在安全组开放 `5175`。

在你自己的 Windows PowerShell 中执行，并保持这个窗口不要关闭：

```powershell
ssh -L 5175:127.0.0.1:5175 ubuntu@服务器公网IP
```

然后在本机浏览器打开：

```text
http://127.0.0.1:5175/
```

这种方式适合临时验收。要让其他设备访问并安装为桌面 PWA，应继续配置域名和 HTTPS。

## 九、有域名：配置正式 HTTPS

### 1. 解析域名

在域名解析控制台增加一条 A 记录，指向服务器公网 IP。例如：

```text
order.example.com → 1.2.3.4
```

如果服务器位于中国大陆，请按腾讯云要求完成域名备案。

### 2. 下载证书

在腾讯云 SSL 证书服务申请证书，下载 Nginx 格式证书。一般会得到一个证书文件和一个私钥文件。

从 Windows PowerShell 上传证书，替换本机文件路径、用户名和服务器 IP：

```powershell
scp "C:\下载目录\你的证书.pem" ubuntu@服务器公网IP:/tmp/fullchain.pem
scp "C:\下载目录\你的私钥.key" ubuntu@服务器公网IP:/tmp/private.key
```

### 3. 安装并配置 Nginx

回到服务器执行：

```bash
sudo apt update
sudo apt install -y nginx
sudo mkdir -p /etc/nginx/ssl/restaurant-order-station
sudo install -m 644 /tmp/fullchain.pem /etc/nginx/ssl/restaurant-order-station/fullchain.pem
sudo install -m 600 /tmp/private.key /etc/nginx/ssl/restaurant-order-station/private.key
rm -f /tmp/fullchain.pem /tmp/private.key
```

复制项目自带配置，并把示例域名替换成你的真实域名：

```bash
cd /opt/restaurant-order-station
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/restaurant-order-station
sudo sed -i 's/order.example.com/你的域名/g' /etc/nginx/sites-available/restaurant-order-station
sudo ln -sf /etc/nginx/sites-available/restaurant-order-station /etc/nginx/sites-enabled/restaurant-order-station
sudo nginx -t
sudo systemctl reload nginx
```

如果 `sudo nginx -t` 显示 `syntax is ok` 和 `test is successful`，再访问：

```text
https://你的域名
```

HTTPS 生效后，Chrome 或 Edge 才能在非本机设备上正常安装 PWA。项目自带的 Nginx 配置也已经处理实时订单同步所需的长连接。

## 十、上线检查清单

按顺序检查：

- [ ] `docker compose ps` 显示应用为 `healthy`
- [ ] 浏览器能打开登录页
- [ ] `yue / 123` 能登录，测试菜单存在
- [ ] 同一号牌可以多次加菜，总金额正确累计
- [ ] A 设备加菜后，B 设备的出餐页能及时出现独立菜品任务
- [ ] 后厨只有开始制作、完成制作两次操作
- [ ] 全部菜品完成后可以结算，结算后号牌恢复空闲
- [ ] 顾客扫描号牌二维码能看到本号牌当前进度和金额
- [ ] Chrome/Edge 可以安装到桌面，打开后没有普通地址栏
- [ ] 腾讯云安全组没有开放 `5175`

## 十一、日常备份数据库并更新 Docker

这是以后每次发布新版本时使用的标准流程。顺序必须是：**确认环境、备份数据库、保留旧镜像、拉取代码、重建容器、检查结果**。

项目的真实数据文件是：

```text
/opt/restaurant-order-station/data/restaurant.sqlite
```

`compose.yaml` 已把服务器的 `./data` 目录挂载到容器的 `/app/server/data`，所以正常执行 `docker compose build`、`up`、`down` 都不会删除数据库。不要使用 `docker compose down -v`，不要手动删除 `data` 目录，也不要把数据库提交到 Git。

### 第 1 步：进入项目并确认没有服务器本地改动

```bash
cd /opt/restaurant-order-station
git status --short
docker compose ps
```

`git status --short` 正常应该没有任何输出。如果出现文件名，先不要拉取代码，保留完整输出再排查，避免覆盖服务器上的临时修改。

### 第 2 步：停止应用并备份 SQLite 数据库

备份放在项目目录外的 `/opt/restaurant-order-station-backups`，不会因为重新拉取项目而丢失：

```bash
cd /opt/restaurant-order-station
sudo mkdir -p /opt/restaurant-order-station-backups
BACKUP_FILE="/opt/restaurant-order-station-backups/restaurant-$(date +%F-%H%M%S).sqlite"

docker compose stop app
sudo cp --preserve=timestamps data/restaurant.sqlite "$BACKUP_FILE"
docker compose start app

sudo test -s "$BACKUP_FILE" && echo "数据库备份成功：$BACKUP_FILE"
sudo ls -lh "$BACKUP_FILE"
sudo sha256sum "$BACKUP_FILE"
docker compose ps
```

停止应用后再复制，可以保证 SQLite 主文件、WAL 日志和内存中的写入已经正确收尾。停机时间通常只有几秒钟。

如果 `test -s` 没有显示“数据库备份成功”，不要继续更新。先执行下面命令确认原数据库是否存在：

```bash
sudo ls -lh /opt/restaurant-order-station/data/
```

### 第 3 步：记录旧版本并保留回滚镜像

```bash
cd /opt/restaurant-order-station
BEFORE_VERSION="$(git rev-parse HEAD)"
echo "$BEFORE_VERSION" | sudo tee "/opt/restaurant-order-station-backups/version-before-$(date +%F-%H%M%S).txt"

if docker image inspect restaurant-order-station:latest >/dev/null 2>&1; then
  docker image tag restaurant-order-station:latest restaurant-order-station:rollback
fi
```

`restaurant-order-station:rollback` 是更新前的应用镜像。新版本发生严重问题时，可以立即切回。

### 第 4 步：从 Gitee 拉取并重建 Docker

腾讯云服务器优先从 Gitee 拉取，避免 GitHub 网络不稳定：

```bash
cd /opt/restaurant-order-station
git pull --ff-only origin master
docker compose build --pull app
docker compose up -d --remove-orphans
```

项目构建阶段默认使用国内 npm 镜像 `https://registry.npmmirror.com`。`--ff-only` 可以在服务器代码发生意外分叉时停止更新，而不是自动生成难以处理的合并提交。

### 第 5 步：检查新版本

```bash
cd /opt/restaurant-order-station
docker compose ps
docker compose logs --tail=100 app
curl -fsS http://127.0.0.1:5175/api/auth/me
```

正常结果：

- `docker compose ps` 中的应用最终显示 `healthy`
- 日志没有反复重启或数据库报错
- `curl` 返回 `{"user":null}`，表示接口可访问
- 浏览器中原账号、菜单、未结算账单和历史数据仍然存在

PWA 可能短时间显示旧界面。关闭桌面应用后重新打开，或在浏览器中强制刷新一次，让 Service Worker 获取新资源。

### 第 6 步：确认正常后清理无用镜像（可选）

至少正常使用一段时间后再执行：

```bash
docker image prune -f
```

带有 `restaurant-order-station:rollback` 标签的回滚镜像不会被这条命令删除。

## 十二、显式重建测试数据库

只有在确认要清空全部账号、菜单、账单和经营历史时才执行。本操作会重新生成唯一的 `yue / 123` 和默认测试菜单。

先备份，再停止应用：

```bash
cd /opt/restaurant-order-station
sudo mkdir -p /opt/restaurant-order-station-backups
sudo cp data/restaurant.sqlite "/opt/restaurant-order-station-backups/before-reset-$(date +%F-%H%M%S).sqlite"
docker compose stop app
```

然后执行带有明确确认参数的重建命令：

```bash
docker compose run --rm app npm run db:reset-demo -- --confirm-reset
docker compose up -d
docker compose ps
```

缺少 `--confirm-reset` 时程序会拒绝清空。生产营业数据不应使用此命令。

## 十三、下载备份、恢复与回滚

### 把数据库备份下载到自己的 Windows 电脑

先在服务器查看备份文件名：

```bash
sudo ls -lht /opt/restaurant-order-station-backups/
```

然后在自己电脑的 PowerShell 中执行，把文件名和服务器 IP 换成真实值：

```powershell
scp root@服务器公网IP:/opt/restaurant-order-station-backups/restaurant-2026-07-14-120000.sqlite "D:\餐厅数据库备份\"
```

不要只把备份放在同一台云服务器上。服务器磁盘故障或误删时，本地副本才能真正起到备份作用。

### 只恢复数据库

先从备份列表中选择要恢复的文件，再执行：

```bash
cd /opt/restaurant-order-station
RESTORE_FILE="/opt/restaurant-order-station-backups/要恢复的文件.sqlite"

docker compose stop app
sudo cp "$RESTORE_FILE" data/restaurant.sqlite
sudo chown 1000:1000 data/restaurant.sqlite
sudo chmod 600 data/restaurant.sqlite
docker compose start app

docker compose ps
docker compose logs --tail=100 app
```

### 新版本异常时同时回滚应用和数据库

只有新版本确实无法正常使用时才执行。把 `RESTORE_FILE` 改成更新前刚创建的备份：

```bash
cd /opt/restaurant-order-station
RESTORE_FILE="/opt/restaurant-order-station-backups/更新前的数据库备份.sqlite"

docker compose stop app
sudo cp "$RESTORE_FILE" data/restaurant.sqlite
sudo chown 1000:1000 data/restaurant.sqlite
sudo chmod 600 data/restaurant.sqlite

docker image tag restaurant-order-station:rollback restaurant-order-station:latest
docker compose up -d --no-build --force-recreate app

docker compose ps
docker compose logs --tail=100 app
```

回滚成功后先不要再次构建镜像。保留错误日志和执行过的命令，再修复新版本问题。

## 十四、常见问题

### 1. 页面显示 502 Bad Gateway

```bash
cd /opt/restaurant-order-station
docker compose ps
docker compose logs --tail=200 app
```

通常是容器没有启动成功，日志会显示具体原因。

### 2. 数据库提示 Permission denied

```bash
cd /opt/restaurant-order-station
sudo chown -R 1000:1000 data
docker compose restart app
```

### 3. Docker 下载镜像超时

```bash
docker info | sed -n '/Registry Mirrors/,+3p'
sudo systemctl restart docker
```

确认腾讯云镜像地址已经生效，再重新执行 `docker compose build`。

### 4. PWA 没有“安装应用”按钮

正式远程访问必须使用 HTTPS。确认下面地址可以打开：

```text
https://你的域名/manifest.webmanifest
```

然后刷新页面或重启浏览器。

### 5. 两台设备订单不同步

先检查容器日志：

```bash
docker compose logs --tail=200 app
```

再确认线上使用的是项目自带的 `deploy/nginx.conf.example`，其中已经关闭实时连接的代理缓冲。

### 6. 二维码打开了错误地址

检查部署目录中的 `.env`：

```bash
cd /opt/restaurant-order-station
cat .env
```

应看到 `PUBLIC_BASE_URL=https://你的域名`。修改后执行 `docker compose up -d --force-recreate`，再从“我的 → 工作台设置”重新下载号牌二维码。已经打印的二维码不会自动改变。

## 十五、最常用排查命令

```bash
cd /opt/restaurant-order-station
docker compose ps
docker compose logs --tail=200 app
curl -I http://127.0.0.1:5175/
curl -I https://你的域名/manifest.webmanifest
```

部署过程中如果某一步报错，不要连续重试或删除文件。复制“执行的命令 + 完整报错文字”再排查，通常能更快定位问题。
