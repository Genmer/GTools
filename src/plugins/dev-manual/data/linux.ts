import type { RawEntry } from './types'

// linux-command 风格的常用命令精选（简介 + 常用参数 + 示例）
const entries: RawEntry[] = [
  {
    slug: 'ls',
    name: 'ls',
    summary: '列出目录内容',
    keywords: ['列出文件', '目录内容'],
    md: `列出目录内容（默认当前目录，按字母序）。

## 常用参数

- \`-l\` 长格式（权限/属主/大小/时间）
- \`-a\` 含隐藏文件（. 开头）
- \`-h\` 人类可读大小（配合 -l）
- \`-t\` / \`-rt\` 按修改时间排序 / 反序
- \`-R\` 递归子目录

## 示例

\`\`\`bash
ls -lah --sort=time
\`\`\``
  },
  {
    slug: 'cd',
    name: 'cd',
    summary: '切换工作目录',
    keywords: ['切换目录'],
    md: `切换当前 shell 的工作目录。

## 常用写法

- \`cd -\` 回到上一个目录
- \`cd ~\` 或 \`cd\` 回家目录
- \`cd ..\` 上一级
- \`cd /etc\` 绝对路径`
  },
  {
    slug: 'pwd',
    name: 'pwd',
    summary: '打印当前工作目录的绝对路径',
    keywords: ['当前目录'],
    md: `打印当前工作目录。

- \`pwd -P\` 显示物理路径（解析软链）
- \`pwd -L\` 显示逻辑路径（默认）`
  },
  {
    slug: 'mkdir',
    name: 'mkdir',
    summary: '创建目录',
    keywords: ['创建目录', '新建目录'],
    md: `创建目录。

- \`mkdir -p a/b/c\` 递归创建多级目录（已存在不报错）

\`\`\`bash
mkdir -p project/{src,test,docs}
\`\`\``
  },
  {
    slug: 'rm',
    name: 'rm',
    summary: '删除文件或目录（不可恢复，慎用）',
    keywords: ['删除', '删除文件'],
    md: `删除文件或目录，**没有回收站，删了就没了**。

## 常用参数

- \`-r\` 递归删目录
- \`-f\` 强制（忽略不存在与提示）
- \`-i\` 逐个确认

## 示例

\`\`\`bash
rm -rf build/          # 删整个目录
rm -i *.log            # 逐个确认删除
\`\`\``
  },
  {
    slug: 'cp',
    name: 'cp',
    summary: '复制文件或目录',
    keywords: ['复制', '复制文件'],
    md: `复制文件或目录。

- \`-r\` 递归复制目录
- \`-a\` 归档模式（保留权限/时间戳/软链）
- \`-u\` 仅在源较新时覆盖
- \`-v\` 显示过程

\`\`\`bash
cp -a src/ /backup/src
\`\`\``
  },
  {
    slug: 'mv',
    name: 'mv',
    summary: '移动/重命名文件或目录',
    keywords: ['移动', '重命名'],
    md: `移动或重命名（同分区 mv 是原子改名）。

\`\`\`bash
mv old.txt new.txt        # 重命名
mv *.log logs/            # 批量移动
mv -n a.txt b.txt         # 目标存在时不覆盖
\`\`\``
  },
  {
    slug: 'touch',
    name: 'touch',
    summary: '创建空文件或更新时间戳',
    keywords: ['新建文件'],
    md: `文件不存在则创建空文件，存在则更新 mtime/atime。

\`\`\`bash
touch a.txt               # 创建/更新
touch -t 202401010000 f   # 设定指定时间戳
\`\`\``
  },
  {
    slug: 'ln',
    name: 'ln',
    summary: '创建链接（默认硬链，-s 软链）',
    keywords: ['软链', '硬链', '链接'],
    md: `- \`ln -s target link\` 创建软链（符号链接，可跨分区、可指目录）
- \`ln target link\` 硬链（同 inode，不能跨分区/不能指目录）`
  },
  {
    slug: 'cat',
    name: 'cat',
    summary: '查看/拼接文件内容',
    keywords: ['查看文件'],
    md: `顺序输出文件内容。

- \`cat -n\` 带行号
- \`cat file1 file2 > all\` 拼接

大文件看内容用 less，别用 cat。`
  },
  {
    slug: 'less',
    name: 'less',
    summary: '分页查看文件（大文件首选）',
    keywords: ['分页', '翻页'],
    md: `分页浏览器，大文件秒开（不全量加载）。

## 按键

- 空格 / \`b\` 下翻 / 上翻
- \`/pattern\` 向下搜索，\`n\` / \`N\` 下一个/上一个
- \`g\` / \`G\` 到头 / 到尾
- \`q\` 退出

\`\`\`bash
less +F app.log   # 类 tail -f 跟踪模式，Ctrl+C 退出跟踪
\`\`\``
  },
  {
    slug: 'head',
    name: 'head',
    summary: '查看文件开头若干行',
    keywords: ['开头'],
    md: `- \`head -n 20 file\` 前 20 行（默认 10）
- \`head -c 1k file\` 前 1KB
- \`head -n -20 file\` 除去最后 20 行的全部`
  },
  {
    slug: 'tail',
    name: 'tail',
    summary: '查看文件末尾 / 跟踪日志',
    keywords: ['末尾', '日志', '跟踪'],
    md: `- \`tail -n 50 file\` 最后 50 行（默认 10）
- \`tail -f app.log\` 跟踪新增内容（看日志必备）
- \`tail -F app.log\` 文件被轮转（重建）后继续跟踪

\`\`\`bash
tail -f app.log | grep ERROR
\`\`\``
  },
  {
    slug: 'grep',
    name: 'grep',
    summary: '按模式搜索文本',
    keywords: ['搜索', '过滤', '查找'],
    md: `逐行匹配模式（基础正则；\`-E\` 扩展正则）。

## 常用参数

- \`-i\` 忽略大小写
- \`-r\` 递归目录
- \`-n\` 显示行号
- \`-v\` 反选（不匹配的行）
- \`-l\` 只列文件名
- \`-c\` 只数匹配行数
- \`-A3 / -B3 / -C3\` 匹配行后/前/前后各 3 行上下文

## 示例

\`\`\`bash
grep -rn "TODO" src/ --include="*.ts"
ps aux | grep nginx
\`\`\``
  },
  {
    slug: 'find',
    name: 'find',
    summary: '按名称/大小/时间等条件查找文件',
    keywords: ['查找文件', '搜索文件'],
    md: `在目录树中查找文件。

## 常用姿势

\`\`\`bash
find . -name "*.log"                  # 按名（-iname 忽略大小写）
find . -type f -size +100M            # 大于 100M 的普通文件
find . -mtime -7                      # 7 天内改过
find . -name "*.tmp" -delete          # 找到即删
find . -type d -name node_modules -prune -o -name "*.ts" -print   # 剪掉 node_modules
\`\`\``
  },
  {
    slug: 'chmod',
    name: 'chmod',
    summary: '修改文件权限',
    keywords: ['权限'],
    md: `修改读/写/执行权限。

- 数字法：\`chmod 755 script.sh\`（rwxr-xr-x）
- 符号法：\`chmod +x file\`、\`chmod u+x,go-w file\`
- \`-R\` 递归目录

r=4 w=2 x=1；常用：755（脚本/目录）、644（普通文件）、600（私钥）。`
  },
  {
    slug: 'chown',
    name: 'chown',
    summary: '修改文件属主/属组',
    keywords: ['属主'],
    md: `\`\`\`bash
chown user:group file     # 同时改属主与属组
chown -R www-data: /var/www
\`\`\`

改属组也可用 \`chgrp\`。`
  },
  {
    slug: 'ps',
    name: 'ps',
    summary: '查看进程快照',
    keywords: ['进程'],
    md: `- \`ps aux\` BSD 风格全量（CPU/内存占用）
- \`ps -ef\` System V 风格（含父 PID）
- \`ps aux --sort=-%mem | head\` 按内存排

配合 grep 找进程：\`ps aux | grep java\`。`
  },
  {
    slug: 'top',
    name: 'top',
    summary: '实时查看进程与系统资源',
    keywords: ['资源', '监控'],
    md: `交互式资源监视器。

## 按键

- \`M\` / \`P\` 按内存 / CPU 排序
- \`1\` 展开各 CPU 核
- \`k\` 杀进程（输入 PID）
- \`q\` 退出

更好用的替代：\`htop\`（需安装）。`
  },
  {
    slug: 'kill',
    name: 'kill',
    summary: '向进程发信号（默认 TERM）',
    keywords: ['杀进程', '终止进程'],
    md: `\`\`\`bash
kill 1234            # 发 SIGTERM（15），可被捕获做清理
kill -9 1234         # SIGKILL，立即强杀，慎用
kill -HUP 1234       # 常被守护进程用作重载配置
pkill -f "node app"  # 按命令行匹配杀
killall nginx        # 按进程名杀
\`\`\``
  },
  {
    slug: 'df',
    name: 'df',
    summary: '查看磁盘分区占用',
    keywords: ['磁盘', '空间'],
    md: `- \`df -h\` 人类可读容量
- \`df -i\` inode 占用（小文件海量时看这个）`
  },
  {
    slug: 'du',
    name: 'du',
    summary: '统计目录/文件磁盘用量',
    keywords: ['目录大小', '占用'],
    md: `\`\`\`bash
du -sh .                       # 当前目录总大小
du -sh * | sort -rh            # 各子项从大到小
du -h --max-depth=1 /var       # 只看一层
\`\`\``
  },
  {
    slug: 'free',
    name: 'free',
    summary: '查看内存使用',
    keywords: ['内存'],
    md: `\`free -h\`：看 **available** 判断可用内存，别看 free 列（缓存占用可回收）。

Linux 会把闲置内存拿去做磁盘缓存，available 才是进程真正能用的量。`
  },
  {
    slug: 'tar',
    name: 'tar',
    summary: '打包/解包归档（常配 gzip）',
    keywords: ['打包', '解压', '压缩'],
    md: `## 常用组合

\`\`\`bash
tar -czf pkg.tar.gz dir/       # 打包 + gzip
tar -xzf pkg.tar.gz            # 解包 gzip
tar -xjf pkg.tar.bz2           # 解包 bzip2
tar -xJf pkg.tar.xz            # 解包 xz
tar -tf pkg.tar.gz             # 只列内容不解
tar -czf pkg.tar.gz -C /src .  # 指定基础目录打包
\`\`\`

记忆：c 创建 / x 解 / t 列表；z/j/Z 对应 gzip/bzip2/xz。`
  },
  {
    slug: 'gzip',
    name: 'gzip',
    summary: '单文件压缩/解压（gunzip）',
    keywords: ['压缩'],
    md: `\`\`\`bash
gzip big.log        # 就地压缩成 big.log.gz（原文件消失）
gzip -d big.log.gz  # 解压（= gunzip）
gzip -k big.log     # 保留原文件
zcat a.log.gz       # 不解压直接看内容
\`\`\``
  },
  {
    slug: 'ssh',
    name: 'ssh',
    summary: '远程登录 / 远程执行命令',
    keywords: ['远程', '登录'],
    md: `\`\`\`bash
ssh user@host                # 登录
ssh -p 2222 user@host        # 指定端口
ssh user@host "uptime"       # 远程执行单条命令
ssh -L 8080:localhost:80 user@host   # 本地端口转发
ssh -J jump user@target      # 经跳板机
\`\`\`

免密：\`ssh-keygen\` 后 \`ssh-copy-id user@host\`。`
  },
  {
    slug: 'scp',
    name: 'scp',
    summary: '基于 SSH 的远程复制',
    keywords: ['远程复制', '传输'],
    md: `\`\`\`bash
scp a.txt user@host:/tmp/            # 上传
scp user@host:/tmp/a.txt .           # 下载
scp -r dir user@host:~/              # 递归目录
scp -P 2222 a.txt user@host:         # 大写 P 指端口
\`\`\`

增量同步大量文件用 rsync 更合适。`
  },
  {
    slug: 'rsync',
    name: 'rsync',
    summary: '增量同步文件（本地/远程）',
    keywords: ['同步', '备份'],
    md: `\`\`\`bash
rsync -av --delete src/ user@host:/dst/    # 镜像同步（含删除）
rsync -av --progress big.iso /mnt/usb/     # 看进度
rsync -avn src/ dst/                       # -n 干跑预演
\`\`\`

结尾斜杠语义：\`src/\` 同步目录内容，\`src\` 会把 src 目录本身放进目标。`
  },
  {
    slug: 'curl',
    name: 'curl',
    summary: 'HTTP 等协议的请求工具',
    keywords: ['请求', 'http', '接口'],
    md: `## 常用姿势

\`\`\`bash
curl https://api.example.com            # GET，输出响应体
curl -i url                             # 带响应头
curl -X POST -H "Content-Type: application/json" -d '{"a":1}' url
curl -d @data.json url                  # body 从文件读
curl -o out.json url                    # 存文件（-O 用远端名）
curl -L url                             # 跟随 3xx 跳转
curl -s -w "%{http_code}\\n" -o /dev/null url   # 只看状态码
curl -u user:pass url                   # 基础认证
curl --resolve api.x:443:10.0.0.1 https://api.x  # 指定解析 IP
\`\`\``
  },
  {
    slug: 'wget',
    name: 'wget',
    summary: '下载文件（断点续传/递归抓站）',
    keywords: ['下载'],
    md: `\`\`\`bash
wget https://example.com/a.zip
wget -c https://example.com/a.zip       # 断点续传
wget -q --spider url                    # 只探测可达性
wget -r -l2 -np https://example.com/docs/   # 递归抓两层
\`\`\``
  },
  {
    slug: 'ping',
    name: 'ping',
    summary: '测试网络连通性与延迟',
    keywords: ['连通性', '延迟'],
    md: `\`\`\`bash
ping -c 4 example.com     # 发 4 包后停
ping -i 0.2 host          # 间隔 0.2s（默认 1s）
\`\`\`

看 RTT 与丢包率；ICMP 被禁的机器 ping 不通但服务可能正常。`
  },
  {
    slug: 'ss',
    name: 'ss',
    summary: '查看套接字/端口占用（netstat 现代替代）',
    keywords: ['端口', 'netstat', '监听'],
    md: `\`\`\`bash
ss -tlnp          # 监听中的 TCP 端口与进程
ss -tulnp         # TCP+UDP 全量
ss -s             # 连接数摘要
\`\`\`

t=TCP u=UDP l=listen n=数字端口 p=进程。老命令 netstat 参数相同：\`netstat -tlnp\`。`
  },
  {
    slug: 'ip',
    name: 'ip',
    summary: '查看/配置网卡与路由（ifconfig 替代）',
    keywords: ['网卡', 'ip地址', '路由', 'ifconfig'],
    md: `\`\`\`bash
ip addr            # 或 ip a，看网卡与地址
ip route           # 路由表（默认网关）
ip link set eth0 up
\`\`\`

\`ifconfig\` 已逐步被弃用，新系统优先 ip。`
  },
  {
    slug: 'lsof',
    name: 'lsof',
    summary: '列出打开的文件/端口占用者',
    keywords: ['端口占用', '文件占用'],
    md: `\`\`\`bash
lsof -i :8080             # 谁占用 8080
lsof -i -P -n | grep LISTEN
lsof +D /var/log          # 谁在写该目录
lsof -p 1234              # 进程打开了哪些文件
\`\`\``
  },
  {
    slug: 'systemctl',
    name: 'systemctl',
    summary: '管理 systemd 服务',
    keywords: ['服务', 'service', '守护进程'],
    md: `\`\`\`bash
systemctl status nginx
systemctl start|stop|restart nginx
systemctl enable nginx       # 开机自启（--now 立即启动）
systemctl disable nginx
systemctl list-units --type=service --state=running
\`\`\`

日志用 journalctl -u nginx 看。`
  },
  {
    slug: 'journalctl',
    name: 'journalctl',
    summary: '查看 systemd 日志',
    keywords: ['日志', 'log'],
    md: `\`\`\`bash
journalctl -u nginx -f          # 跟踪某服务日志
journalctl -n 100 -u nginx      # 最近 100 行
journalctl --since "1 hour ago"
journalctl -p err -b            # 本次启动以来的错误级
journalctl --disk-usage         # 日志占用
\`\`\``
  },
  {
    slug: 'crontab',
    name: 'crontab',
    summary: '定时任务',
    keywords: ['定时', '计划任务'],
    md: `\`\`\`bash
crontab -e     # 编辑当前用户任务
crontab -l     # 列出
\`\`\`

5 个时间位：分 时 日 月 周。

\`\`\`
*/5 * * * * /usr/bin/backup.sh     # 每 5 分钟
0 3 * * 1  /usr/bin/clean.sh       # 每周一 3:00
\`\`\`

注意：crontab 环境变量极少，脚本里写绝对路径。`
  },
  {
    slug: 'useradd',
    name: 'useradd',
    summary: '创建用户',
    keywords: ['用户', '添加用户'],
    md: `\`\`\`bash
useradd -m -s /bin/bash tom    # -m 建家目录，-s 指定 shell
passwd tom                     # 设密码
userdel -r tom                 # 删除并清家目录
usermod -aG docker tom         # 追加进附加组（-aG 别漏 a）
\`\`\``
  },
  {
    slug: 'sudo',
    name: 'sudo',
    summary: '以其他用户（默认 root）身份执行',
    keywords: ['提权', 'root'],
    md: `- \`sudo cmd\`：以 root 执行（需在 sudoers 中授权）
- \`sudo -i\` / \`sudo -s\`：切到 root 交互 shell
- \`sudo -u tom whoami\`：指定用户执行
- \`sudo !!\`：以 sudo 重跑上一条命令

授权配置 \`visudo\`，别直接编辑 /etc/sudoers。`
  },
  {
    slug: 'apt',
    name: 'apt',
    summary: 'Debian/Ubuntu 软件包管理',
    keywords: ['安装', '包管理', 'ubuntu', 'debian'],
    md: `\`\`\`bash
apt update                 # 刷新索引（装前必跑）
apt install nginx
apt remove nginx           # 卸载（--purge 连配置删）
apt upgrade                # 升级已装包
apt search redis
apt list --upgradable
\`\`\`

RHEL 系对应：\`dnf\`（老版本 yum），用法同构。`
  },
  {
    slug: 'echo',
    name: 'echo',
    summary: '输出文本/变量',
    keywords: ['输出'],
    md: `\`\`\`bash
echo $PATH
echo -e "a\\tb"           # 解释转义
echo "data" >> a.log       # 追加写入
echo "CPU: $(nproc)"       # 命令替换
\`\`\``
  },
  {
    slug: 'export',
    name: 'export',
    summary: '设置环境变量（当前 shell 及子进程可见）',
    keywords: ['环境变量', 'env'],
    md: `\`\`\`bash
export PATH=$PATH:/opt/bin
export JAVA_HOME=/usr/lib/jvm/java-21
env            # 查看全部环境变量
\`\`\`

只对当前会话有效；永久生效写进 ~/.bashrc 或 ~/.zshrc。`
  },
  {
    slug: 'alias',
    name: 'alias',
    summary: '命令别名',
    keywords: ['别名'],
    md: `\`\`\`bash
alias ll='ls -lAF'
alias gs='git status -sb'
alias           # 列出全部
unalias ll
\`\`\`

持久化写进 ~/.bashrc / ~/.zshrc；看命令真身用 \`type ll\` 或 \`command ls\`。`
  },
  {
    slug: 'wc',
    name: 'wc',
    summary: '统计行数/单词数/字节数',
    keywords: ['行数', '统计'],
    md: `- \`wc -l file\` 行数
- \`wc -w\` 单词数；\`wc -c\` 字节数；\`wc -m\` 字符数

\`\`\`bash
grep -c ERROR app.log     # 或直接用 grep -c 数匹配行
cat *.ts | wc -l
\`\`\``
  },
  {
    slug: 'sort',
    name: 'sort',
    summary: '排序文本行',
    keywords: ['排序'],
    md: `- \`-n\` 按数值；\`-r\` 倒序；\`-u\` 去重
- \`-k2\` 按第 2 列；\`-h\` 按人类可读大小（2K<1M）
- \`-t,\` 指定分隔符

\`\`\`bash
du -sh * | sort -rh | head
sort -t: -k3 -n /etc/passwd
\`\`\``
  },
  {
    slug: 'uniq',
    name: 'uniq',
    summary: '去重相邻重复行（先 sort）',
    keywords: ['去重'],
    md: `\`\`\`bash
sort access.log | uniq -c | sort -rn    # 计数排行
uniq -d                                 # 只输出重复行
uniq -u                                 # 只输出未重复行
\`\`\`

uniq 只处理**相邻**重复，务必先 sort。`
  },
  {
    slug: 'awk',
    name: 'awk',
    summary: '按列处理文本的微型语言',
    keywords: ['列', '文本处理'],
    md: `按行扫描，\$1..\$n 为第 n 列，\$0 为整行。

\`\`\`bash
awk '{print $1, $3}' file               # 取第 1、3 列
awk -F: '{print $1}' /etc/passwd        # 指定分隔符
df -h | awk 'NR>1 && $5+0 > 80 {print $6, $5}'   # 过滤+数值比较
awk '{s+=$1} END{print s/NR}' nums.txt  # 求平均
\`\`\``
  },
  {
    slug: 'sed',
    name: 'sed',
    summary: '流编辑器（替换/删除文本行）',
    keywords: ['替换', '文本处理'],
    md: `\`\`\`bash
sed 's/old/new/' file            # 每行第一个替换
sed 's/old/new/g' file           # 全部替换
sed -i 's/old/new/g' file        # 就地改文件（macOS 需 -i ''）
sed -n '20,30p' file             # 只打印 20-30 行
sed '/^#/d' file                 # 删注释行
sed -i.bak '3d' file             # 删第 3 行，先备份
\`\`\``
  },
  {
    slug: 'xargs',
    name: 'xargs',
    summary: '把 stdin 转成命令参数',
    keywords: ['管道', '批量'],
    md: `\`\`\`bash
cat urls.txt | xargs -n1 curl -sO        # 每行一个参数执行
find . -name "*.tmp" | xargs rm          # 批量删除
grep -rl "TODO" . | xargs -n1 sed -i 's/TODO/DONE/'
ls | head -100 | xargs -P4 -n1 compress  # 并行 4 路
\`\`\`

文件名含空格时：\`find -print0 | xargs -0\`。`
  },
  {
    slug: 'which',
    name: 'which',
    summary: '定位可执行文件路径',
    keywords: ['路径', '命令位置'],
    md: `\`\`\`bash
which node          # PATH 中第一个 node
which -a node       # 所有匹配
type node           # 别名/内建也能识别
whereis node        # 连 man 手册一起找
\`\`\``
  },
  {
    slug: 'nohup',
    name: 'nohup',
    summary: '脱离终端后台运行（挂断不退出）',
    keywords: ['后台', '后台运行'],
    md: `\`\`\`bash
nohup ./server > server.log 2>&1 &
jobs -l            # 看后台任务
disown -h %1       # 从当前 shell 摘除
\`\`\`

输出默认进 nohup.out；重定向日志更清晰。更现代的做法是 systemd 服务或 tmux。`
  },
  {
    slug: 'tmux',
    name: 'tmux',
    summary: '终端复用器：会话不随断连而死',
    keywords: ['会话', '终端复用', 'screen'],
    md: `远程长任务的保命工具：断线后会话还在，重连即可恢复。

\`\`\`bash
tmux new -s work       # 新会话
tmux ls                # 列会话
tmux attach -t work    # 重连
\`\`\`

## 会话内前缀键 Ctrl+b

- \`d\` 脱离会话（任务继续跑）
- \`%\` / \`"\` 右分屏 / 下分屏
- \`方向键\` 切窗格；\`x\` 关窗格`
  },
  {
    slug: 'stat',
    name: 'stat',
    summary: '查看文件元数据（大小/权限/时间戳）',
    keywords: ['元数据', '时间'],
    md: `\`\`\`bash
stat file            # 全量元数据
stat -c '%s %y' f    # 自定义输出：大小 + 修改时间
\`\`\`

三个时间：atime 访问 / mtime 内容修改 / ctime 元数据变更。`
  },
  {
    slug: 'file',
    name: 'file',
    summary: '识别文件真实类型',
    keywords: ['文件类型'],
    md: `\`\`\`bash
file icon.png data.bin
# icon.png: PNG image data, 512 x 512
\`\`\`

靠魔数而非扩展名判断，排查"改了扩展名打不开"类问题必备。`
  },
  {
    slug: 'diff',
    name: 'diff',
    summary: '比较文件差异',
    keywords: ['差异', '比较'],
    md: `\`\`\`bash
diff a.txt b.txt
diff -u a.txt b.txt       # 补丁格式（git diff 同款）
diff -r dir1 dir2         # 递归比目录
\`\`\`

\`<\` 开头是左边文件独有，\`>\` 是右边独有。`
  },
  {
    slug: 'tee',
    name: 'tee',
    summary: '把管道内容同时写文件与 stdout',
    keywords: ['管道', '分流'],
    md: `\`\`\`bash
make 2>&1 | tee build.log          # 屏幕看 + 存档
ps aux | tee p.txt | grep nginx    # 继续接管道
cmd | tee -a log                   # 追加模式
\`\`\``
  },
  {
    slug: 'history',
    name: 'history',
    summary: '查看命令历史',
    keywords: ['历史', '命令历史'],
    md: `\`\`\`bash
history | tail -20
history | grep ssh
!1234          # 重跑第 1234 条
!ssh           # 重跑最近一条 ssh 开头命令
Ctrl+R         # 交互式搜历史（最常用）
\`\`\``
  },
  {
    slug: 'man',
    name: 'man',
    summary: '查看命令手册页',
    keywords: ['帮助', '手册', 'help'],
    md: `\`\`\`bash
man ls             # 完整手册
man 3 printf       # 指定章节（3=库函数）
man -k network     # 按关键词搜手册（= apropos）
\`\`\`

快捷：很多命令支持 \`cmd --help\`；tldr 页（tldr.sh）给出最常用例子。`
  }
]

export default entries
