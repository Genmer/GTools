// 各语言预设逐类断言（engine.test.ts 覆盖代表性差异，本文件补齐 16 套预设 × 全部上下文的完整值表）
import { describe, expect, it } from 'vitest'
import { generate } from '../../../../src/plugins/var-name/logic/engine'
import { LANGUAGE_PRESETS, type LanguagePreset } from '../../../../src/plugins/var-name/data/presets'

const byId = (id: string): LanguagePreset => LANGUAGE_PRESETS.find((p) => p.id === id)!

/** words → { contextId: value } 完整映射，配合 toEqual 做逐类断言 */
function valuesOf(words: readonly string[], preset: LanguagePreset): Record<string, string> {
  return Object.fromEntries(generate(words, preset).map((c) => [c.contextId, c.value]))
}

describe('逐语言预设完整值表', () => {
  it('JavaScript：9 上下文（camel 变量族 / pascal 类型族 / screaming 常量 / kebab 文件与包名）', () => {
    expect(valuesOf(['max', 'retry', 'count'], byId('javascript'))).toEqual({
      variable: 'maxRetryCount',
      param: 'maxRetryCount',
      function: 'maxRetryCount',
      class: 'MaxRetryCount',
      'enum-name': 'MaxRetryCount',
      'enum-value': 'MAX_RETRY_COUNT',
      constant: 'MAX_RETRY_COUNT',
      file: 'max-retry-count',
      package: 'max-retry-count'
    })
  })

  it('TypeScript：member 无 _ 前缀、文件名 snake（Google TS 版）', () => {
    expect(valuesOf(['user', 'settings'], byId('typescript'))).toEqual({
      variable: 'userSettings',
      function: 'userSettings',
      type: 'UserSettings',
      constant: 'USER_SETTINGS',
      member: 'userSettings',
      file: 'user_settings'
    })
  })

  it('Python：异常类 Error 后缀、私有成员 _ 前缀、模块与包同为 snake', () => {
    expect(valuesOf(['cache', 'config'], byId('python'))).toEqual({
      variable: 'cache_config',
      function: 'cache_config',
      class: 'CacheConfig',
      exception: 'CacheConfigError',
      constant: 'CACHE_CONFIG',
      module: 'cache_config',
      package: 'cache_config',
      private: '_cache_config'
    })
  })

  it('Java：包名全小写直接连接（禁下划线）、文件名与类同名 Pascal', () => {
    expect(valuesOf(['user', 'service'], byId('java'))).toEqual({
      variable: 'userService',
      function: 'userService',
      class: 'UserService',
      constant: 'USER_SERVICE',
      package: 'userservice',
      file: 'UserService'
    })
  })

  it('Kotlin：id 按闭合复合词弯折（UserId 非 UserID）、后备属性 _ 前缀', () => {
    expect(valuesOf(['user', 'id'], byId('kotlin'))).toEqual({
      variable: 'userId',
      function: 'userId',
      class: 'UserId',
      constant: 'USER_ID',
      'enum-value': 'USER_ID',
      file: 'UserId',
      private: '_userId'
    })
  })

  it('Go：包名全小写连续、文件名 snake；api 整体同格（导出 APIKey / 未导出 apiKey）', () => {
    expect(valuesOf(['retry', 'limit'], byId('go'))).toEqual({
      variable: 'retryLimit',
      exported: 'RetryLimit',
      constant: 'RetryLimit',
      package: 'retrylimit',
      file: 'retry_limit'
    })
    expect(valuesOf(['api', 'key'], byId('go'))).toMatchObject({ exported: 'APIKey', variable: 'apiKey' })
  })

  it('Rust：类型缩写按单词弯折（UuidGenerator，注释与策略一致）', () => {
    expect(valuesOf(['uuid', 'generator'], byId('rust'))).toEqual({
      variable: 'uuid_generator',
      function: 'uuid_generator',
      type: 'UuidGenerator',
      constant: 'UUID_GENERATOR'
    })
  })

  it('C#：私有字段 _ 前缀、接口 I 前缀、常量 Pascal、db 闭合复合词（DbConnection）', () => {
    expect(valuesOf(['db', 'connection'], byId('csharp'))).toEqual({
      variable: 'dbConnection',
      'private-field': '_dbConnection',
      function: 'DbConnection',
      class: 'DbConnection',
      interface: 'IDbConnection',
      constant: 'DbConnection',
      namespace: 'DbConnection'
    })
  })

  it('C++ (Google)：常量/枚举值 kCamel、类成员尾下划线、宏 SCREAMING、命名空间 snake', () => {
    expect(valuesOf(['table', 'row'], byId('cpp-google'))).toEqual({
      variable: 'table_row',
      member: 'table_row_',
      function: 'TableRow',
      class: 'TableRow',
      constant: 'kTableRow',
      'enum-value': 'kTableRow',
      macro: 'TABLE_ROW',
      namespace: 'table_row'
    })
  })

  it('C++ (LLVM)：变量首字母大写、函数首字母小写（反直觉组合）', () => {
    expect(valuesOf(['ast', 'walker'], byId('cpp-llvm'))).toEqual({
      variable: 'AstWalker',
      function: 'astWalker',
      class: 'AstWalker',
      'enum-value': 'AST_WALKER'
    })
  })

  it('PHP：类/命名空间/文件名 Pascal（PSR-4）、方法 camel、类常量 screaming', () => {
    expect(valuesOf(['user', 'repo'], byId('php'))).toEqual({
      variable: 'userRepo',
      function: 'userRepo',
      class: 'UserRepo',
      constant: 'USER_REPO',
      namespace: 'UserRepo',
      file: 'UserRepo'
    })
  })

  it('Ruby：谓词方法 ? 后缀、变量/方法 snake、常量 screaming', () => {
    expect(valuesOf(['order', 'item'], byId('ruby'))).toEqual({
      variable: 'order_item',
      function: 'order_item',
      predicate: 'order_item?',
      class: 'OrderItem',
      constant: 'ORDER_ITEM'
    })
  })

  it('Swift：常量也是 camel（禁 k 前缀）、URL 升格（类 URLSession / 变量 urlSession）', () => {
    expect(valuesOf(['url', 'session'], byId('swift'))).toEqual({
      variable: 'urlSession',
      function: 'urlSession',
      class: 'URLSession',
      constant: 'urlSession',
      bool: 'urlSession'
    })
    expect(valuesOf(['uuid', 'string'], byId('swift'))).toMatchObject({ class: 'UUIDString' })
  })

  it('CSS/BEM：类名/ID kebab、自定义属性 -- 前缀', () => {
    expect(valuesOf(['header', 'title'], byId('css'))).toEqual({
      class: 'header-title',
      id: 'header-title',
      'custom-prop': '--header-title'
    })
  })

  it('SQL：列/表 snake、布尔列 is_ 前缀、外键 _id 后缀', () => {
    expect(valuesOf(['user', 'name'], byId('sql'))).toEqual({
      column: 'user_name',
      table: 'user_name',
      'bool-column': 'is_user_name',
      'foreign-key': 'user_name_id'
    })
    expect(valuesOf(['active'], byId('sql'))).toMatchObject({ 'bool-column': 'is_active' })
    expect(valuesOf(['order'], byId('sql'))).toMatchObject({ 'foreign-key': 'order_id' })
  })

  it('Shell：变量 snake、常量 screaming、文件名 snake 禁连字符', () => {
    expect(valuesOf(['backup', 'dir'], byId('shell'))).toEqual({
      variable: 'backup_dir',
      constant: 'BACKUP_DIR',
      file: 'backup_dir'
    })
  })
})

describe('同一词组跨语言硬差异', () => {
  it('常量四派：Python SCREAMING / Go Pascal / Swift camel / C++ Google kCamel', () => {
    expect(valuesOf(['max', 'size'], byId('python')).constant).toBe('MAX_SIZE')
    expect(valuesOf(['max', 'size'], byId('go')).constant).toBe('MaxSize')
    expect(valuesOf(['max', 'size'], byId('swift')).constant).toBe('maxSize')
    expect(valuesOf(['max', 'size'], byId('cpp-google')).constant).toBe('kMaxSize')
  })

  it('url 缩写三派：Kotlin Url / Go 与 Swift URL（word 按词弯折，go 与 swift 整体同格）', () => {
    expect(valuesOf(['url', 'builder'], byId('javascript'))).toMatchObject({ class: 'UrlBuilder' })
    expect(valuesOf(['url', 'builder'], byId('kotlin'))).toMatchObject({ class: 'UrlBuilder' })
    expect(valuesOf(['url', 'builder'], byId('go'))).toMatchObject({ exported: 'URLBuilder' })
    expect(valuesOf(['url', 'builder'], byId('swift'))).toMatchObject({ class: 'URLBuilder' })
  })

  it('id 缩写：Go UserID（整体同格）vs Kotlin/JS UserId（按词弯折）', () => {
    expect(valuesOf(['user', 'id'], byId('go'))).toMatchObject({ exported: 'UserID', variable: 'userID' })
    expect(valuesOf(['user', 'id'], byId('kotlin'))).toMatchObject({ class: 'UserId' })
    expect(valuesOf(['user', 'id'], byId('javascript'))).toMatchObject({ variable: 'userId' })
  })

  it('两字母缩写 io：C# 全大写（IOError/ioError）vs TS 按词（IoError）', () => {
    expect(valuesOf(['io', 'error'], byId('csharp'))).toMatchObject({ class: 'IOError', variable: 'ioError' })
    expect(valuesOf(['io', 'error'], byId('typescript'))).toMatchObject({ type: 'IoError' })
  })
})
