import type { RawEntry } from './types'

const entries: RawEntry[] = [
  { slug: '100', name: '100', summary: 'Continue：继续（客户端应继续发 body）', keywords: ['Continue', '继续'], md: `客户端带 \`Expect: 100-continue\` 请求大 body 时，服务器先回 100 表示"可以继续发"。日常开发几乎只在抓包/代理日志里见到。` },
  { slug: '101', name: '101', summary: 'Switching Protocols：协议切换（WebSocket 握手）', keywords: ['Switching Protocols', 'websocket', '协议切换'], md: `WebSocket 升级握手成功：\`Upgrade: websocket\` + \`Connection: Upgrade\` 后服务器回 101，连接从 HTTP 切到 WebSocket 协议。` },
  { slug: '103', name: '103', summary: 'Early Hints：预提示（预热资源加载）', keywords: ['Early Hints', '预热'], md: `正式响应前先回 103 提示 \`Link\` 头，让浏览器提前拉取 CSS/JS。需要 CDN/服务器支持，配合 preload 使用。` },
  { slug: '200', name: '200', summary: 'OK：成功', keywords: ['OK', '成功'], md: `标准成功。GET 拿到资源、PUT 更新成功都返回 200 + 响应体。` },
  { slug: '201', name: '201', summary: 'Created：创建成功（应带 Location）', keywords: ['Created', '创建成功'], md: `POST 创建资源成功，应在 \`Location\` 头返回新资源地址，body 返回新资源内容。REST API 建资源用它而不是裸 200。` },
  { slug: '202', name: '202', summary: 'Accepted：已受理，异步处理中', keywords: ['Accepted', '异步', '受理'], md: `请求已进队列但未处理完（异步任务）。客户端需轮询或回调拿最终结果，任务失败也可能仍返回 202。` },
  { slug: '204', name: '204', summary: 'No Content：成功但无响应体', keywords: ['No Content', '无内容', '删除成功'], md: `成功且没有 body（DELETE 成功、PUT 更新无需返回内容）。注意：204 必须无 body，有些网关会给 204 塞 body 导致客户端解析异常。` },
  { slug: '206', name: '206', summary: 'Partial Content：范围请求（断点续传）', keywords: ['Partial Content', '断点续传', '分片'], md: `\`Range: bytes=0-1023\` 请求片段时返回 206 + \`Content-Range\`。视频拖动进度条、下载器分片、HTTP 大文件并行下载的基础。` },
  { slug: '301', name: '301', summary: 'Moved Permanently：永久重定向（SEO 传权重）', keywords: ['Moved Permanently', '永久重定向', 'redirect'], md: `资源永久搬家，浏览器/搜索引擎会缓存并更新索引。

- 方法保留：POST → POST（大多数现代客户端）
- 换域名、http→https 全站跳转常用
- 配合 HSTS 减少首次明文请求` },
  { slug: '302', name: '302', summary: 'Found：临时重定向（方法可能变 GET）', keywords: ['Found', '临时重定向', 'redirect'], md: `临时跳转。历史遗留：许多客户端会把 302 的 POST 改成 GET（规范要求保留方法，但事实标准变了）。需要严格保留方法用 307/308。` },
  { slug: '303', name: '303', summary: 'See Other：重定向为 GET（PRG 模式）', keywords: ['See Other', 'PRG'], md: `明确指示用 GET 访问新地址。经典用途 **PRG 模式**：表单 POST 成功后 303 到结果页，防刷新重复提交。` },
  { slug: '304', name: '304', summary: 'Not Modified：缓存仍有效（省带宽）', keywords: ['Not Modified', '缓存', 'etag'], md: `请求带 \`If-None-Match\`（ETag）或 \`If-Modified-Since\` 且资源没变时返回 304 无 body，浏览器用本地缓存。

排查缓存问题：看响应头 ETag/Last-Modified 与请求头条件字段是否配对。` },
  { slug: '307', name: '307', summary: 'Temporary Redirect：临时重定向（保留方法）', keywords: ['Temporary Redirect', '重定向'], md: `与 302 类似但**严格保留请求方法与 body**（POST 重定向后仍是 POST）。网关/负载均衡转发时用它最安全。` },
  { slug: '308', name: '308', summary: 'Permanent Redirect：永久重定向（保留方法）', keywords: ['Permanent Redirect', '重定向'], md: `301 的严格版：永久跳转且保留方法与 body。站点迁移 + API 路径永久变更时用。` },
  { slug: '400', name: '400', summary: 'Bad Request：请求语法/参数错误', keywords: ['Bad Request', '参数错误', '请求错误'], md: `服务端无法理解请求。常见原因：JSON 格式错、缺必填字段、参数类型不对、header 编码问题。前端排查优先看请求 body 与 Content-Type。` },
  { slug: '401', name: '401', summary: 'Unauthorized：未认证（没登录/token 无效）', keywords: ['Unauthorized', '未登录', '未认证', 'token'], md: `**没证明你是谁**：缺少或无效的凭证。带 \`WWW-Authenticate\` 头指示认证方式。token 过期、未登录、API key 错都是它。与 403 的区别：401 是"没登录"，403 是"登录了但没权限"。` },
  { slug: '403', name: '403', summary: 'Forbidden：已认证但无权限', keywords: ['Forbidden', '无权限', '禁止访问'], md: `服务器知道你是谁，但你没权限访问该资源。原因：角色不足、IP 被封、目录无读权限。**不要**用 403 表达"未登录"（那是 401）。` },
  { slug: '404', name: '404', summary: 'Not Found：资源不存在', keywords: ['Not Found', '不存在', '找不到'], md: `最出名的错误码。路径错、资源已删、方法+路径组合不存在都会 404。SPA 路由刷新 404 通常是服务器没配 fallback 到 index.html。` },
  { slug: '405', name: '405', summary: 'Method Not Allowed：方法不被允许', keywords: ['Method Not Allowed', '方法不允许'], md: `路径存在但不接受该动词（对只支持 GET 的接口发 POST）。响应应带 \`Allow\` 头列出支持的方法。REST 接口排查先看动词。` },
  { slug: '406', name: '406', summary: 'Not Acceptable：无法满足 Accept 协商', keywords: ['Not Acceptable', '内容协商'], md: `请求的 \`Accept\` 与服务端能产出的格式不匹配（要 XML 只有 JSON）。实际很少见，多数框架直接忽略。` },
  { slug: '408', name: '408', summary: 'Request Timeout：客户端超时未发完请求', keywords: ['Request Timeout', '超时'], md: `客户端太慢，服务器等不及断开。网络差、上传大文件中途断流时出现；与 504（网关等上游）方向相反。` },
  { slug: '409', name: '409', summary: 'Conflict：状态冲突（并发/重复资源）', keywords: ['Conflict', '冲突'], md: `请求与资源当前状态冲突：重复创建（唯一键）、版本冲突（乐观锁）、非空目录删除。适合给"业务规则冲突"当返回码。` },
  { slug: '410', name: '410', summary: 'Gone：资源永久消失（区别于 404）', keywords: ['Gone', '已删除'], md: `资源曾经存在、已被**有意**永久删除（如促销活动下线）。爬虫见到 410 会从索引删除；比 404 语义更强。` },
  { slug: '411', name: '411', summary: 'Length Required：必须带 Content-Length', keywords: ['Length Required'], md: `服务器要求请求声明长度（不支持分块编码时）。代理/老网关后面偶见。` },
  { slug: '412', name: '412', summary: 'Precondition Failed：前置条件不满足', keywords: ['Precondition Failed', '前置条件'], md: `\`If-Match\`/\`If-Unmodified-Since\` 等条件头失败。并发编辑冲突检测的标准实现（乐观锁：带 ETag 的 If-Match 提交）。` },
  { slug: '413', name: '413', summary: 'Payload Too Large：请求体过大', keywords: ['Payload Too Large', '文件太大'], md: `body 超过服务器限制（nginx \`client_max_body_size\`、框架 body limit）。上传大文件报 413 先查这两处配置。` },
  { slug: '414', name: '414', summary: 'URI Too Long：地址过长', keywords: ['URI Too Long'], md: `GET 塞了过多查询参数（老网关限制 8KB 左右）。改 POST 或精简参数。` },
  { slug: '415', name: '415', summary: 'Unsupported Media Type：Content-Type 不支持', keywords: ['Unsupported Media Type', '媒体类型'], md: `发了 XML 服务器只收 JSON。前后端联调高频错误：AJAX 忘设 \`Content-Type: application/json\`（默认表单编码）。` },
  { slug: '416', name: '416', summary: 'Range Not Satisfiable：范围越界', keywords: ['Range Not Satisfiable'], md: `\`Range\` 请求的区间超出资源大小（文件 1KB 却要 bytes=2000-）。下载器断点文件已变更时常见。` },
  { slug: '418', name: '418', summary: "I'm a teapot：茶壶（愚人节彩蛋）", keywords: ['teapot', "I'm a teapot", '茶壶', '彩蛋'], md: `1998 愚人节协议 HTCPCP 的彩蛋："茶壶不能煮咖啡"。部分框架保留作彩蛋，也有拿它当"被限流的玩笑值"。**不要**用于真实业务语义。` },
  { slug: '422', name: '422', summary: 'Unprocessable Entity：语法对但语义校验失败', keywords: ['Unprocessable Entity', '校验失败', '验证失败'], md: `请求格式正确但字段校验不过（邮箱格式、年龄为负）。比 400 更精确地表达"参数到了但值不合法"，Rails/许多 API 用它做表单校验失败返回码。` },
  { slug: '425', name: '425', summary: 'Too Early：过早（防重放攻击）', keywords: ['Too Early', '重放'], md: `服务器不愿冒险处理可能被重放的早期请求（证书尚未验证完成的场景），安全场景专用。` },
  { slug: '428', name: '428', summary: 'Precondition Required：要求前置条件', keywords: ['Precondition Required'], md: `服务器要求请求带条件头（如 If-Match）防"丢失更新"。配合乐观锁：先 GET 拿 ETag，更新时 If-Match 提交。` },
  { slug: '429', name: '429', summary: 'Too Many Requests：请求过多（限流）', keywords: ['Too Many Requests', '限流', '频率', 'rate limit'], md: `触发限流。应带 \`Retry-After\` 头告知重试等待秒数。调用第三方 API 高频出现：读 Retry-After、加退避重试、检查是否超额。` },
  { slug: '431', name: '431', summary: 'Request Header Fields Too Large：请求头过大', keywords: ['Request Header Fields Too Large', '头过大'], md: `单头或总头超限（token 塞太长、Cookie 堆积）。清 Cookie 或加大网关头限制。` },
  { slug: '451', name: '451', summary: 'Unavailable For Legal Reasons：法律原因不可用', keywords: ['Unavailable For Legal Reasons', '法律'], md: `因法律原因拒绝访问（地区封锁、版权下架）。出自《华氏451度》，多由 CDN 按地区返回。` },
  { slug: '500', name: '500', summary: 'Internal Server Error：服务器内部错误', keywords: ['Internal Server Error', '服务器错误', '内部错误'], md: `服务端未捕获的异常。排查顺序：服务日志堆栈 → 最近发布变更 → 依赖服务/数据库 → 内存溢出。别吞异常返回裸 500，至少记日志带 trace id。` },
  { slug: '501', name: '501', summary: 'Not Implemented：功能未实现', keywords: ['Not Implemented', '未实现'], md: `服务器不支持该请求所需能力（不认识的方法/不支持的视频编码协商）。代理见到上游不支持时也可能回它。` },
  { slug: '502', name: '502', summary: 'Bad Gateway：网关拿到无效上游响应', keywords: ['Bad Gateway', '网关错误', 'bad gateway'], md: `网关/代理（nginx、CDN）连上了上游但响应不合法：上游崩了、返回格式坏、连接被重置。与 504 区别：502 是"回话坏了"，504 是"根本没回话"。` },
  { slug: '503', name: '503', summary: 'Service Unavailable：服务不可用（过载/维护）', keywords: ['Service Unavailable', '过载', '维护', '不可用'], md: `服务过载或停机维护。应带 \`Retry-After\`。常见于：重启发布窗口、连接池打满、熔断器打开。健康检查失败被摘流也会表现为 503。` },
  { slug: '504', name: '504', summary: 'Gateway Timeout：网关等上游超时', keywords: ['Gateway Timeout', '网关超时', '超时'], md: `网关在时限内没等到上游响应。慢 SQL、下游服务卡死、超时配置过短都会 504。排查：网关超时配置 vs 接口 P99 耗时。` },
  { slug: '505', name: '505', summary: 'HTTP Version Not Supported：协议版本不支持', keywords: ['HTTP Version Not Supported', '版本'], md: `服务器不认请求的 HTTP 版本（老服务收到 HTTP/2 明文语义等）。极少见，多在自研代理层出现。` },
  { slug: '507', name: '507', summary: 'Insufficient Storage：存储不足（WebDAV）', keywords: ['Insufficient Storage', '存储'], md: `WebDAV 专用：服务器存储不够完成请求。对象存储/网盘后端常见。` },
  { slug: '511', name: '511', summary: 'Network Authentication Required：需网络认证（ captive portal）', keywords: ['Network Authentication Required', 'wifi 认证'], md: `公共 Wi-Fi 要求先登录认证时，网关拦截请求返回 511。连咖啡店 Wi-Fi 后 API 全挂，先怀疑这个。` }
]

export default entries
