// 稳定示例（demo 态与「载入示例」共用）：中等复杂度——对象+数组+嵌套+各基本类型。
// 内容必须保持确定性（无时间戳/随机值），截图与单测都依赖它不变。

export const SAMPLE_JSON = `{
  "name": "GTools 发布清单",
  "version": "4.2.0",
  "stable": true,
  "tags": ["launcher", "efficiency", "json"],
  "stats": {
    "plugins": 21,
    "downloads": 128000,
    "rating": 4.8,
    "openIssues": null
  },
  "changelog": [
    {
      "date": "2026-09-01",
      "type": "feature",
      "items": ["JSON 编辑器：树视图 + 错误定位", "大 JSON 懒渲染"]
    },
    {
      "date": "2026-08-15",
      "type": "fix",
      "items": ["深色主题下树视图徽标对比度"]
    }
  ],
  "author": {
    "name": "genmer",
    "homepage": "https://gtools.example.com",
    "social": null
  }
}
`
