# 腾讯云 Ubuntu + Docker 部署

项目仓库：

- Gitee：`https://gitee.com/yuejilove/restaurant-order-station.git`
- GitHub：`https://github.com/yueji-love/restaurant-order-station.git`

腾讯云服务器部署优先从 Gitee 拉取。应用容器只监听本机 `127.0.0.1:5175`，由宿主机 Nginx 提供 HTTPS；SQLite 数据单独保存在 `data/`，不会进入代码仓库。

## 1. 上线前准备

1. 域名 A 记录指向腾讯云服务器公网 IP。
2. 腾讯云安全组只开放需要的端口：`22`、`80`、`443`，不要开放 `5175`。
3. 在腾讯云 SSL 证书服务申请或上传证书，下载 Nginx 格式证书。
4. 确认服务器已安装 Docker 与 Docker Compose：

```bash
docker --version
docker compose version
```

> 当前系统开放注册，并且所有注册用户共享同一套餐厅数据。若站点直接暴露给公网，任何访客都能注册后查看和操作订单。正式营业前应使用腾讯云安全组限制访问来源，或后续增加邀请码/管理员审核；不要把本地测试账号和弱密码直接带到公网环境。

## 2. 配置国内镜像

腾讯云服务器可在 `/etc/docker/daemon.json` 中合并以下配置。若该文件已有内容，不要直接覆盖其他配置：

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

应用配置前先检查 JSON，然后重启 Docker：

```bash
sudo systemctl daemon-reload
sudo systemctl restart docker
docker info | sed -n '/Registry Mirrors/,+3p'
```

Dockerfile 默认使用国内 npm 镜像 `https://registry.npmmirror.com`。如需临时切回 npm 官方源：

```bash
NPM_REGISTRY=https://registry.npmjs.org docker compose build
```

## 3. 拉取并启动

```bash
cd /opt
sudo git clone https://gitee.com/yuejilove/restaurant-order-station.git
sudo chown -R "$USER":"$USER" restaurant-order-station
cd restaurant-order-station

mkdir -p data
sudo chown -R 1000:1000 data

docker compose build
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:5175/api/auth/me
```

最后一条命令应返回类似：

```json
{"user":null}
```

## 4. 导入现有数据库

数据库包含账号、密码哈希、菜单、订单与历史数据，不能上传到公开 Git 仓库。请使用 SCP 单独传输当前电脑里的 `server/data/restaurant.sqlite`。

在本地 PowerShell 执行，替换服务器 IP 和登录用户：

```powershell
scp "C:\Users\Administrator\Desktop\点餐\server\data\restaurant.sqlite" ubuntu@服务器IP:/tmp/restaurant.sqlite
```

在服务器执行：

```bash
cd /opt/restaurant-order-station
docker compose down
sudo install -o 1000 -g 1000 -m 600 /tmp/restaurant.sqlite data/restaurant.sqlite
rm -f /tmp/restaurant.sqlite
docker compose up -d
docker compose ps
```

## 5. 配置 Nginx 与 HTTPS

安装 Nginx：

```bash
sudo apt update
sudo apt install -y nginx
```

把腾讯云下载的 Nginx 证书保存为：

```text
/etc/nginx/ssl/restaurant-order-station/fullchain.pem
/etc/nginx/ssl/restaurant-order-station/private.key
```

复制项目内示例并修改域名：

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/restaurant-order-station
sudo sed -i 's/order.example.com/你的域名/g' /etc/nginx/sites-available/restaurant-order-station
sudo ln -s /etc/nginx/sites-available/restaurant-order-station /etc/nginx/sites-enabled/restaurant-order-station
sudo nginx -t
sudo systemctl reload nginx
```

然后访问 `https://你的域名`。HTTPS 生效后，Chrome/Edge 才能在非本机设备上安装 PWA。

## 6. 更新版本

```bash
cd /opt/restaurant-order-station
git pull origin master
docker compose build --pull
docker compose up -d
docker compose ps
```

确认新版本运行正常后，可以清理旧镜像：

```bash
docker image prune -f
```

## 7. 备份与恢复

为保证 SQLite 备份一致性，先短暂停止应用再复制：

```bash
cd /opt/restaurant-order-station
mkdir -p backups
docker compose stop app
cp data/restaurant.sqlite "backups/restaurant-$(date +%F-%H%M%S).sqlite"
docker compose start app
```

恢复某个备份：

```bash
docker compose down
cp backups/要恢复的文件.sqlite data/restaurant.sqlite
sudo chown 1000:1000 data/restaurant.sqlite
sudo chmod 600 data/restaurant.sqlite
docker compose up -d
```

## 8. 常用排查命令

```bash
docker compose ps
docker compose logs --tail=200 app
docker inspect --format='{{json .State.Health}}' restaurant-order-station-app-1
curl -I http://127.0.0.1:5175/
curl -I https://你的域名/manifest.webmanifest
```
