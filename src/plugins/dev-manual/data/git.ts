import type { RawEntry } from './types'

const entries: RawEntry[] = [
  {
    slug: 'init',
    name: 'git init',
    summary: '初始化仓库',
    keywords: ['初始化'],
    md: `\`\`\`bash
git init                    # 当前目录建仓
git init myapp              # 建目录并初始化
git init --bare repo.git    # 裸仓（远端中心仓用）
git init -b main            # 指定初始分支名
\`\`\``
  },
  {
    slug: 'clone',
    name: 'git clone',
    summary: '克隆远端仓库',
    keywords: ['克隆', '下载仓库'],
    md: `\`\`\`bash
git clone <url>                     # 默认分支
git clone -b dev <url>              # 指定分支
git clone --depth 1 <url>           # 浅克隆（只要最新提交，大仓提速）
git clone <url> dir                 # 克隆到指定目录
\`\`\``
  },
  {
    slug: 'status',
    name: 'git status',
    summary: '查看工作区/暂存区状态',
    keywords: ['状态'],
    md: `\`\`\`bash
git status            # 详细
git status -s         # 短格式：?? 未跟踪  M 已改  A 新增
git status -sb        # 短格式 + 分支与领先/落后
\`\`\``
  },
  {
    slug: 'add',
    name: 'git add',
    summary: '把改动放入暂存区',
    keywords: ['暂存', 'stage'],
    md: `\`\`\`bash
git add a.ts          # 单文件
git add .             # 当前目录全部改动（含新增）
git add -u            # 只加已跟踪文件的修改/删除
git add -p            # 逐块挑选（交互式，拆分提交利器）
\`\`\``
  },
  {
    slug: 'commit',
    name: 'git commit',
    summary: '提交暂存区',
    keywords: ['提交'],
    md: `\`\`\`bash
git commit -m "feat: xxx"
git commit -am "msg"        # 跳过 add，直接提交已跟踪文件
git commit --amend          # 修正上一条提交（未推送前用）
git commit --amend --no-edit    # 只补文件不改信息
\`\`\`

规范信息格式（约定式提交）：\`feat: 新功能\` / \`fix: 修复\` / \`docs\` / \`refactor\` / \`test\` / \`chore\`。`
  },
  {
    slug: 'log',
    name: 'git log',
    summary: '查看提交历史',
    keywords: ['历史', '日志'],
    md: `\`\`\`bash
git log --oneline -20           # 紧凑单行
git log --oneline --graph --all # 全分支拓扑图
git log -p a.ts                 # 带文件差异
git log -S "functionName"       # 搜内容何时增删（pickaxe）
git log --author=yi --since="2 weeks ago"
git show HEAD                   # 看某次提交详情
\`\`\``
  },
  {
    slug: 'diff',
    name: 'git diff',
    summary: '查看差异',
    keywords: ['差异'],
    md: `\`\`\`bash
git diff                 # 工作区 vs 暂存区
git diff --staged        # 暂存区 vs 最新提交
git diff main dev        # 两分支差异
git diff HEAD~3 a.ts     # 与 3 个提交前比
git diff --stat          # 只看文件级增删行数
\`\`\``
  },
  {
    slug: 'branch',
    name: 'git branch',
    summary: '分支管理',
    keywords: ['分支'],
    md: `\`\`\`bash
git branch               # 本地分支
git branch -a            # 含远端
git branch dev           # 创建
git branch -d dev        # 删除（-D 强删未合并）
git branch -m old new    # 重命名
git branch -vv           # 看跟踪关系
\`\`\``
  },
  {
    slug: 'switch',
    name: 'git switch',
    summary: '切换分支（checkout 的现代细分）',
    keywords: ['切换分支', 'checkout'],
    md: `\`\`\`bash
git switch dev              # 切分支
git switch -c feature/x     # 创建并切换
git switch -                # 回上一个分支
git switch --detach v1.2    # 检出标签（游离头指针）
\`\`\`

老命令等价：\`git checkout dev\` / \`git checkout -b feature/x\`。`
  },
  {
    slug: 'restore',
    name: 'git restore',
    summary: '丢弃工作区改动 / 取消暂存',
    keywords: ['撤销', '恢复', '还原'],
    md: `\`\`\`bash
git restore a.ts            # 丢弃该文件未暂存改动（不可恢复！）
git restore --staged a.ts   # 取消暂存（改动保留在工作区）
git restore --source=HEAD~2 a.ts   # 恢复到历史版本
git restore .               # 全部丢弃
\`\`\`

老写法：\`git checkout -- a.ts\` / \`git reset HEAD a.ts\`。`
  },
  {
    slug: 'merge',
    name: 'git merge',
    summary: '合并分支',
    keywords: ['合并'],
    md: `\`\`\`bash
git switch main && git merge dev     # 把 dev 并进 main
git merge --no-ff dev                # 强制留合并提交
git merge --squash dev               # 压成一次提交（不建合并节点）
git merge --abort                    # 冲突中放弃合并
\`\`\`

冲突后：改文件解决 \`<<<<<<<\` 标记 → \`git add\` → \`git commit\`。`
  },
  {
    slug: 'rebase',
    name: 'git rebase',
    summary: '变基：把提交摘到目标分支之上',
    keywords: ['变基', 'rebase'],
    md: `\`\`\`bash
git switch feature && git rebase main   # feature 落到 main 最新
git rebase -i HEAD~5                    # 交互式：squash/reword/drop
git rebase --continue                   # 解决冲突后续接
git rebase --abort                      # 放弃回到变基前
\`\`\`

金规：**已推送到公共分支的提交不要 rebase**。多人协作同步上游用 rebase 保持线性历史。`
  },
  {
    slug: 'remote',
    name: 'git remote',
    summary: '管理远端仓库',
    keywords: ['远端'],
    md: `\`\`\`bash
git remote -v                          # 列远端
git remote add origin <url>            # 添加
git remote set-url origin <url>        # 改地址
git remote remove origin
git push -u origin main                # 首推并建立跟踪
\`\`\``
  },
  {
    slug: 'push',
    name: 'git push',
    summary: '推送本地提交到远端',
    keywords: ['推送'],
    md: `\`\`\`bash
git push                        # 推当前分支（有跟踪时）
git push origin dev             # 指定分支
git push -u origin dev          # 推并建立跟踪
git push --force-with-lease     # 强推但他人有新提交时拒绝（比 -f 安全）
git push origin --tags          # 推标签
git push origin :dev            # 删除远端分支
\`\`\``
  },
  {
    slug: 'pull',
    name: 'git pull',
    summary: '拉取并合并远端更新',
    keywords: ['拉取', '更新'],
    md: `\`\`\`bash
git pull                         # = fetch + merge
git pull --rebase                # = fetch + rebase（避免无意义合并节点）
git pull origin dev
\`\`\`

推荐全局配置：\`git config --global pull.rebase true\`。`
  },
  {
    slug: 'fetch',
    name: 'git fetch',
    summary: '只拉取远端数据不合并',
    keywords: ['拉取'],
    md: `\`\`\`bash
git fetch --all --prune     # 全部远端 + 清理已删分支引用
git fetch origin dev        # 只拉某分支
git log HEAD..origin/dev    # 看远端领先了什么
git diff HEAD origin/dev
\`\`\`

想先审查再合并时用 fetch；直接要结果用 pull。`
  },
  {
    slug: 'tag',
    name: 'git tag',
    summary: '打标签（版本发布）',
    keywords: ['标签', '版本'],
    md: `\`\`\`bash
git tag v1.2.0                     # 轻量标签
git tag -a v1.2.0 -m "发布说明"    # 附注标签（推荐）
git tag                            # 列出
git push origin v1.2.0             # 推单个
git push origin --tags             # 推全部
git tag -d v1.2.0                  # 删本地
git push origin :refs/tags/v1.2.0  # 删远端
\`\`\``
  },
  {
    slug: 'stash',
    name: 'git stash',
    summary: '临时存起工作区改动',
    keywords: ['暂存', '现场保存'],
    md: `\`\`\`bash
git stash                   # 存起已跟踪改动
git stash -u                # 含未跟踪文件
git stash push -m "说明"    # 带备注
git stash list
git stash pop               # 恢复最近一条并删除
git stash apply stash@{2}   # 恢复指定条不删
git stash drop stash@{0}
\`\`\`

场景：切分支前/拉更新前不想提交半成品。`
  },
  {
    slug: 'reset',
    name: 'git reset',
    summary: '移动分支指针（回退提交三档）',
    keywords: ['回退', '撤销', 'reset'],
    md: `\`\`\`bash
git reset --soft HEAD~1     # 撤提交，改动回暂存区
git reset --mixed HEAD~1    # 撤提交，改动回工作区（默认）
git reset --hard HEAD~1     # 撤提交，改动丢弃（危险）
git reset --hard origin/dev # 本地强制对齐远端
\`\`\`

\`--hard\` 会丢工作区改动；误操作后急救用 \`git reflog\` 找回提交。`
  },
  {
    slug: 'revert',
    name: 'git revert',
    summary: '用反向提交撤销（公共分支安全）',
    keywords: ['撤销', '回滚', 'revert'],
    md: `\`\`\`bash
git revert <commit-id>          # 生成一条"反做"提交
git revert --no-commit A B      # 多条合并成一次撤销
git revert -m 1 <merge-commit>  # 撤合并提交（m=保留的主线父）
\`\`\`

与 reset 区别：revert 不改历史，适合已推送的公共分支。`
  },
  {
    slug: 'cherry-pick',
    name: 'git cherry-pick',
    summary: '摘取指定提交到当前分支',
    keywords: ['摘提交', '移植'],
    md: `\`\`\`bash
git cherry-pick <commit>            # 摘一条
git cherry-pick A^..B               # 摘一段（含 A）
git cherry-pick -n <commit>         # 只改工作区不自动提交
git cherry-pick --continue          # 冲突解决后续接
\`\`\``
  },
  {
    slug: 'blame',
    name: 'git blame',
    summary: '查每行最后由谁修改',
    keywords: ['谁改的', '追责'],
    md: `\`\`\`bash
git blame a.ts
git blame -L 20,40 a.ts          # 只看行区间
git blame -w a.ts                # 忽略空白改动
git log -L 20,40:a.ts            # 该行的演进历史
\`\`\``
  },
  {
    slug: 'bisect',
    name: 'git bisect',
    summary: '二分法定位引入 bug 的提交',
    keywords: ['找bug', '二分'],
    md: `\`\`\`bash
git bisect start
git bisect bad                # 当前是坏的
git bisect good v1.0          # 这个版本是好的
# git 自动检出中间提交，逐个测试后标记：
git bisect good   # 或 git bisect bad
git bisect reset              # 定位完成后收尾
\`\`\`

支持自动跑：\`git bisect run npm test\`。`
  },
  {
    slug: 'stash-clean',
    name: 'git clean',
    summary: '删除未跟踪文件',
    keywords: ['清理', '未跟踪'],
    md: `\`\`\`bash
git clean -n         # 干跑：会删哪些（先看！）
git clean -f         # 删未跟踪文件
git clean -fd        # 连未跟踪目录
git clean -fdx       # 连 .gitignore 忽略的（如 node_modules，慎用）
\`\`\`

与 \`git reset --hard\` 组合 = 彻底还原工作区。`
  },
  {
    slug: 'reflog',
    name: 'git reflog',
    summary: '本地所有 HEAD 移动记录（后悔药）',
    keywords: ['找回', '后悔药', '误删'],
    md: `记录本机 90 天内 HEAD 的每次移动，reset --hard / rebase 失误的救命稻草。

\`\`\`bash
git reflog
# a1b2c3d HEAD@{2}: rebase (start)
git reset --hard a1b2c3d     # 回到该时刻
git checkout -b rescue a1b2c3d
\`\`\``
  },
  {
    slug: 'submodule',
    name: 'git submodule',
    summary: '仓库内嵌套其他仓库',
    keywords: ['子模块'],
    md: `\`\`\`bash
git submodule add <url> libs/foo
git submodule update --init --recursive   # 克隆后初始化
git submodule update --remote             # 拉子模块上游更新
git submodule deinit libs/foo && git rm libs/foo   # 移除
\`\`\`

克隆带子模块：\`git clone --recurse-submodules <url>\`。`
  },
  {
    slug: 'config',
    name: 'git config',
    summary: '读写配置',
    keywords: ['配置', '用户名', '邮箱'],
    md: `\`\`\`bash
git config --global user.name "yi"
git config --global user.email "yi@example.com"
git config --global core.editor "vim"
git config --global alias.st "status -sb"    # 别名
git config --list --show-origin              # 看全部来源
\`\`\`

三层：system < global（~/.gitconfig）< local（仓库内 .git/config）。`
  },
  {
    slug: 'worktree',
    name: 'git worktree',
    summary: '同一仓库多目录多分支并行',
    keywords: ['多工作区'],
    md: `\`\`\`bash
git worktree add ../hotfix hotfix-branch
# ../hotfix 目录检出 hotfix-branch，与原目录共享 .git
git worktree list
git worktree remove ../hotfix
\`\`\`

场景：正在 dev 上写代码，突然要在 main 上紧急修 bug，又不想 stash。`
  }
]

export default entries
