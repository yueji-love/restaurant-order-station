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
| 是否导入本机数据库 | 是 / 否 | 保留现有账号、菜单和历史数据 |

在腾讯云控制台的服务器安全组中，只开放：

- `22`：SSH 登录
- `80`：HTTP，用于跳转 HTTPS
- `443`：HTTPS 正式访问

不要开放 `5175` 端口。

> 当前系统开放所有人注册，而且注册用户共享同一家餐厅的数据。正式公开营业前，建议在腾讯云安全组中限制访问来源，或后续增加邀请码/管理员审核。不要把弱密码测试账号用于公开生产环境。

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

## 六、选择数据库方案

### 方案 A：全新开始

不需要做任何数据库操作，直接进入下一节。程序首次启动时会自动创建数据库，然后可以注册新账号、录入菜单。

### 方案 B：导入你电脑上的现有数据（推荐给当前项目）

现有数据库包含账号、密码哈希、菜单、订单和历史数据。它不会上传到公开 Git 仓库，需要单独传到服务器。

先在服务器执行以下命令，确保程序未运行：

```bash
cd /opt/restaurant-order-station
docker compose down
```

然后在你自己的 Windows PowerShell 中执行：

```powershell
scp "C:\Users\Administrator\Desktop\点餐\server\data\restaurant.sqlite" ubuntu@服务器公网IP:/tmp/restaurant.sqlite
```

上传成功后，再回到服务器的 SSH 窗口执行：

```bash
sudo install -o 1000 -g 1000 -m 600 /tmp/restaurant.sqlite /opt/restaurant-order-station/data/restaurant.sqlite
rm -f /tmp/restaurant.sqlite
```

不要把 `restaurant.sqlite` 提交到 Gitee 或 GitHub，它包含真实业务数据。

## 七、构建并启动程序

在服务器执行：

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
- [ ] 如果导入了旧数据库，原账号能登录，菜单数据存在
- [ ] A 设备下单后，B 设备的出餐页能及时出现订单
- [ ] 开始制作、完成取餐功能正常
- [ ] Chrome/Edge 可以安装到桌面，打开后没有普通地址栏
- [ ] 腾讯云安全组没有开放 `5175`

## 十一、以后更新程序

每次代码推送到 Gitee 后，在服务器执行：

```bash
cd /opt/restaurant-order-station
git pull origin master
docker compose build --pull
docker compose up -d
docker compose ps
```

确认新版本正常后，可清理旧镜像：

```bash
docker image prune -f
```

## 十二、备份与恢复

### 备份数据库

为了保证 SQLite 备份完整，先短暂停止应用再复制：

```bash
cd /opt/restaurant-order-station
mkdir -p backups
docker compose stop app
cp data/restaurant.sqlite "backups/restaurant-$(date +%F-%H%M%S).sqlite"
docker compose start app
ls -lh backups
```

建议再把备份下载到自己的电脑，不要只保存在同一台服务器。

### 恢复数据库

```bash
cd /opt/restaurant-order-station
docker compose down
cp backups/要恢复的文件.sqlite data/restaurant.sqlite
sudo chown 1000:1000 data/restaurant.sqlite
sudo chmod 600 data/restaurant.sqlite
docker compose up -d
```

## 十三、常见问题

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

## 十四、最常用排查命令

```bash
cd /opt/restaurant-order-station
docker compose ps
docker compose logs --tail=200 app
curl -I http://127.0.0.1:5175/
curl -I https://你的域名/manifest.webmanifest
```

部署过程中如果某一步报错，不要连续重试或删除文件。复制“执行的命令 + 完整报错文字”再排查，通常能更快定位问题。
