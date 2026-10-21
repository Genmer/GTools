import { describe, expect, it } from 'vitest'
import { formatNumber } from '../../../../src/plugins/calc/logic/parser'
import {
  HISTORY_LIMIT,
  evaluateScratch,
  makeHistoryEntry,
  parseHistory,
  tryNumberList,
  type HistoryEntry
} from '../../../../src/plugins/calc/logic/scratch'

describe('calc 稿纸逐行求值', () => {
  it('多行表达式逐行出结果，last 为末行', () => {
    const r = evaluateScratch('1+1\n2*3')
    expect(r.lines.map((l) => l.display)).toEqual(['= 2', '= 6'])
    expect(r.last).toBe(6)
    expect(r.lines[0]).toMatchObject({ kind: 'ok', value: 2 })
  })

  it('支持 CRLF 换行', () => {
    const r = evaluateScratch('1+1\r\n2+2')
    expect(r.lines).toHaveLength(2)
    expect(r.lines[1].display).toBe('= 4')
  })

  it('变量赋值与引用：a=3 下一行 a*5', () => {
    const r = evaluateScratch('a=3\na*5')
    expect(r.lines[0]).toMatchObject({ kind: 'ok', varName: 'a', value: 3, display: 'a = 3' })
    expect(r.lines[1]).toMatchObject({ kind: 'ok', value: 15 })
    expect(r.vars.get('a')).toBe(3)
  })

  it('重新赋值影响后续行（整稿顺序重算）', () => {
    const r = evaluateScratch('a=1\na+10\na=10\na+10')
    expect(r.lines.map((l) => (l.kind === 'ok' ? l.value : NaN))).toEqual([1, 11, 10, 20])
  })

  it('ans 引用上一个成功求值行的结果', () => {
    const r = evaluateScratch('1+1\nans*10')
    expect(r.lines[1].value).toBe(20)
    // 赋值行同样刷新 ans
    const r2 = evaluateScratch('5\na=7\nans+1')
    expect(r2.lines[2].value).toBe(8)
  })

  it('结果展示带千分位（对齐参考图 = 4,175,270）', () => {
    const r = evaluateScratch('55+88+7689*543')
    expect(r.lines[0].value).toBe(4175270)
    expect(r.lines[0].display).toBe('= 4,175,270')
  })

  it('内置常量 pi/e 可直接参与运算（参考图 2651*pi），也可被赋值覆盖', () => {
    const r = evaluateScratch('2651*pi')
    expect(r.lines[0].kind).toBe('ok')
    expect(r.lines[0].value).toBeCloseTo(2651 * Math.PI, 10)
    const r2 = evaluateScratch('pi = 3\npi*2')
    expect(r2.lines.map((l) => l.value)).toEqual([3, 6])
  })

  it('空行与 // # 注释行跳过', () => {
    const r = evaluateScratch('// 说明\n\n# 备注\n1+1')
    expect(r.lines.slice(0, 3).every((l) => l.kind === 'skip')).toBe(true)
    expect(r.lines[3].display).toBe('= 2')
  })

  it('错误行只标记自身，不中断后续行', () => {
    const r = evaluateScratch('1/0\n2+2\n未知*3')
    expect(r.lines[0]).toMatchObject({ kind: 'error', display: '除数为 0' })
    expect(r.lines[1]).toMatchObject({ kind: 'ok', value: 4 })
    expect(r.lines[2]).toMatchObject({ kind: 'error' })
    expect(r.last).toBe(4)
  })

  it('中文变量名与全角符号', () => {
    const r = evaluateScratch('单价 = 100\n数量 = 3\n单价*数量\n（1＋2）×4')
    expect(r.lines[0]).toMatchObject({ kind: 'ok', varName: '单价' })
    expect(r.lines[2].value).toBe(300)
    expect(r.lines[3].value).toBe(12)
  })

  it('a==b 不误判为赋值，按表达式报错', () => {
    const r = evaluateScratch('a==1')
    expect(r.lines[0].kind).toBe('error')
  })

  it('前向引用未定义变量报未知变量', () => {
    const r = evaluateScratch('b*2\nb = 1')
    expect(r.lines[0]).toMatchObject({ kind: 'error', display: '未知变量：b' })
    expect(r.lines[1].kind).toBe('ok')
  })

  it('浮点结果经 12 位有效数字清理展示', () => {
    const r = evaluateScratch('0.1+0.2')
    expect(r.lines[0].display).toBe('= 0.3')
  })

  it('赋值号右侧为空报错', () => {
    const r = evaluateScratch('a =')
    expect(r.lines[0].kind).toBe('error')
    expect(r.vars.has('a')).toBe(false)
  })
})

describe('calc 历史', () => {
  it('标题取第一条非注释非空行并截断 30 字', () => {
    expect(makeHistoryEntry('// 备注\n  \n1+1\n2+2', 0).title).toBe('1+1')
    expect(makeHistoryEntry('', 0).title).toBe('（空）')
    expect(makeHistoryEntry('头'.repeat(40), 0).title).toHaveLength(30)
  })

  it('id 互不相同且含时间戳', () => {
    const a = makeHistoryEntry('1', 1000)
    const b = makeHistoryEntry('1', 1000)
    expect(a.id).not.toBe(b.id)
    expect(a.ts).toBe(1000)
  })

  it('parseHistory 逐条校验，坏条目跳过', () => {
    const good: HistoryEntry = { id: 'x', ts: 1, text: '1+1', title: '1+1' }
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory('nope')).toEqual([])
    expect(parseHistory([good])).toEqual([good])
    expect(parseHistory([good, { id: '', ts: 1, text: 'a', title: 'a' }, { id: 'y', ts: 'bad', text: 'a', title: 'a' }, 42, null])).toEqual([good])
  })

  it('超过上限的历史截断到 HISTORY_LIMIT', () => {
    const many: HistoryEntry[] = Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => ({
      id: String(i),
      ts: i,
      text: '1',
      title: '1'
    }))
    expect(parseHistory(many)).toHaveLength(HISTORY_LIMIT)
  })
})

describe('calc tryNumberList 数字列表行识别', () => {
  it('空格分隔多个数字求和', () => {
    expect(tryNumberList('737 452 346 328 248')).toEqual({ value: 2111, count: 5 })
  })

  it('tab/顿号/分号/全角逗号/半角分号/\\r/连续空格/首尾空格/全角空格 均视为分隔符', () => {
    for (const s of ['737\t452', '737、452', '737；452', '737;452', '737，452', '737\r452', '737  452', ' 737 452 ', '737　452']) {
      expect(tryNumberList(s)).toEqual({ value: 1189, count: 2 })
    }
  })

  it('连续标点分隔符出现空段返回 null 走表达式路径', () => {
    for (const s of ['1,,2', '1、、2', '1,, 2', '1,;2']) {
      expect(tryNumberList(s)).toBeNull()
    }
  })

  it('千分位数字与普通数字混排', () => {
    expect(tryNumberList('1,234 5,678')).toEqual({ value: 6912, count: 2 })
  })

  it('半角逗号后不足 3 位数字时不做千分位合并，按分隔符切分', () => {
    expect(tryNumberList('12,34')).toEqual({ value: 46, count: 2 })
  })

  it('单个千分位数字原值返回 count=1', () => {
    expect(tryNumberList('737,452')).toEqual({ value: 737452, count: 1 })
    expect(tryNumberList('1,234,567')).toEqual({ value: 1234567, count: 1 })
  })

  it('千分位数带悬挂逗号时降级重扫为两数求和', () => {
    expect(tryNumberList('737,452,')).toEqual({ value: 1189, count: 2 })
  })

  it('前导/尾随空白不算分隔符，单个千分位数不触发降级重扫；非空白前导分隔符仍触发', () => {
    expect(tryNumberList(' 737,452')).toEqual({ value: 737452, count: 1 })
    expect(tryNumberList('737,452 ')).toEqual({ value: 737452, count: 1 })
    expect(tryNumberList('，737,452')).toEqual({ value: 1189, count: 2 })
  })

  it('负数、小数与科学计数', () => {
    expect(tryNumberList('-5 3.5')).toEqual({ value: -1.5, count: 2 })
    expect(tryNumberList('1e3 2e2')).toEqual({ value: 1200, count: 2 })
    expect(tryNumberList('737 452')).toEqual({ value: 1189, count: 2 })
    expect(tryNumberList('737 -452')).toEqual({ value: 285, count: 2 })
    expect(tryNumberList('1e-3 5')).toEqual({ value: 0.001 + 5, count: 2 })
  })

  it('含非数字字符/单普通数字/溢出/纯分隔符/孤立符号时返回 null 走表达式路径', () => {
    for (const s of ['737 abc 452', '737+452', '737 - 452', 'sqrt(16) 4', '5% 3', '737', '1e400 2', '，', '.', '-']) {
      expect(tryNumberList(s)).toBeNull()
    }
  })

  it('残缺数字形态（1e/9e999/--,5/-.5）返回 null', () => {
    for (const s of ['1e', '9e999', '--,5', '-.5']) {
      expect(tryNumberList(s)).toBeNull()
    }
  })

  it('数字 token 之间无分隔符的粘连形态返回 null（1.5.5/3..5/5-3）', () => {
    for (const s of ['1.5.5', '3..5', '5-3']) {
      expect(tryNumberList(s)).toBeNull()
    }
  })
})

describe('calc 数字列表行求值', () => {
  it('一行多个数字自动求和，写入 ans', () => {
    const r = evaluateScratch('737 452 346 328 248')
    expect(r.lines[0]).toMatchObject({ kind: 'ok', value: 2111, display: '= 2,111', listCount: 5 })
    expect(r.last).toBe(2111)
    expect(r.vars.get('ans')).toBe(2111)
  })

  it('全角数字归一后按数字列表求和', () => {
    const r = evaluateScratch('７３７ ４５２')
    expect(r.lines[0]).toMatchObject({ kind: 'ok', value: 1189, listCount: 2 })
  })

  it('赋值行右侧为数字列表', () => {
    const r = evaluateScratch('a=1 2 3')
    expect(r.lines[0]).toMatchObject({ kind: 'ok', varName: 'a', value: 6, display: 'a = 6', listCount: 3 })
  })

  it('非列表行仍走表达式路径，error 文案不变', () => {
    const r = evaluateScratch('737 abc 452')
    expect(r.lines[0]).toMatchObject({ kind: 'error', display: '多余的内容：「abc」' })
    const r2 = evaluateScratch('sqrt(16) 4')
    expect(r2.lines[0]).toMatchObject({ kind: 'error', display: '多余的内容：「4」' })
  })

  it('单个普通数字与既有表达式行为不变', () => {
    const r = evaluateScratch('737')
    expect(r.lines[0]).toMatchObject({ kind: 'ok', value: 737 })
    expect(r.lines[0].listCount).toBeUndefined()
    const r2 = evaluateScratch('1+1\n2*3')
    expect(r2.lines.map((l) => l.display)).toEqual(['= 2', '= 6'])
  })

  it('多行数字各自独立 ok 且值一一对应（Σ 合计的数据基础）', () => {
    const r = evaluateScratch('737\n452\n346\n328\n248')
    expect(r.lines.every((l) => l.kind === 'ok')).toBe(true)
    expect(r.lines.map((l) => l.value)).toEqual([737, 452, 346, 328, 248])
    expect(r.lines.reduce((s, l) => s + (l.value ?? 0), 0)).toBe(2111)
    expect(r.last).toBe(248)
  })

  it('超长数字列表行（1000 个数）求和正确', () => {
    const nums = Array.from({ length: 1000 }, (_, i) => i + 1)
    const r = evaluateScratch(nums.join(' '))
    expect(r.lines[0]).toMatchObject({ kind: 'ok', value: 500500, listCount: 1000 })
  })

  it('a==1 仍按表达式报错；a=737 452 赋值为列表和', () => {
    expect(evaluateScratch('a==1').lines[0].kind).toBe('error')
    const r = evaluateScratch('a=737 452')
    expect(r.lines[0]).toMatchObject({ kind: 'ok', varName: 'a', value: 1189 })
    expect(r.vars.get('a')).toBe(1189)
  })

  it('赋值号后残留空格不影响单个千分位数识别', () => {
    const r = evaluateScratch('a= 737,452')
    expect(r.lines[0]).toMatchObject({ kind: 'ok', varName: 'a', value: 737452 })
    expect(r.vars.get('a')).toBe(737452)
  })

  it('5-3 走表达式路径得 2，不识别为列表', () => {
    const r = evaluateScratch('5-3')
    expect(r.lines[0]).toMatchObject({ kind: 'ok', value: 2, display: '= 2' })
    expect(r.lines[0].listCount).toBeUndefined()
  })

  it('分隔符全家桶在整行求值层同样识别为列表（每条 1189）', () => {
    for (const s of ['737\t452', '737、452', '737；452', '737;452', '737，452', '737\r452', '737  452', ' 737 452 ', '737　452']) {
      const r = evaluateScratch(s)
      expect(r.lines).toHaveLength(1)
      expect(r.lines[0]).toMatchObject({ kind: 'ok', value: 1189, display: '= 1,189', listCount: 2 })
    }
  })

  it('负数/小数/科学计数/千分位混排在整行求值层正确求和', () => {
    expect(evaluateScratch('-5 3.5').lines[0]).toMatchObject({ kind: 'ok', value: -1.5, display: '= -1.5', listCount: 2 })
    expect(evaluateScratch('1e3 2e2').lines[0]).toMatchObject({ kind: 'ok', value: 1200, display: '= 1,200', listCount: 2 })
    expect(evaluateScratch('1,234 5,678').lines[0]).toMatchObject({ kind: 'ok', value: 6912, display: '= 6,912', listCount: 2 })
  })

  it('加减表达式不被识别为列表，listCount 为 undefined', () => {
    const r = evaluateScratch('737+452')
    expect(r.lines[0]).toMatchObject({ kind: 'ok', value: 1189 })
    expect(r.lines[0].listCount).toBeUndefined()
    const r2 = evaluateScratch('737 - 452')
    expect(r2.lines[0]).toMatchObject({ kind: 'ok', value: 285 })
    expect(r2.lines[0].listCount).toBeUndefined()
  })

  it('5% 3 与纯分隔符行走原表达式路径，error 文案与改动前一致', () => {
    expect(evaluateScratch('5% 3').lines[0]).toMatchObject({ kind: 'error', display: '多余的内容：「3」' })
    expect(evaluateScratch('，').lines[0]).toMatchObject({ kind: 'error', display: '无法识别的字符：「，」' })
  })

  it('9e999 溢出返回 null 后由表达式路径报「结果溢出」', () => {
    expect(tryNumberList('9e999')).toBeNull()
    expect(evaluateScratch('9e999').lines[0]).toMatchObject({ kind: 'error', display: '结果溢出' })
  })

  it('连续标点空段走表达式路径报错', () => {
    expect(evaluateScratch('1,,2').lines[0].kind).toBe('error')
  })
})

describe('calc 连续标点与 tryNumberList 边缘情况严密测试', () => {
  it('首尾单个标点与多个数字：首尾均允许单个标点切分', () => {
    for (const s of [', 1 2', '，1 2', '、1 2', '; 1 2', '；1 2']) {
      expect(tryNumberList(s)).toEqual({ value: 3, count: 2 })
    }
    for (const s of ['1 2,', '1 2，', '1 2、', '1 2;', '1 2；']) {
      expect(tryNumberList(s)).toEqual({ value: 3, count: 2 })
    }
    for (const s of [', 1 2,', '，1 2，']) {
      expect(tryNumberList(s)).toEqual({ value: 3, count: 2 })
    }
  })

  it('首尾连续标点：首部或尾部出现连续标点一律返回 null', () => {
    for (const s of [',, 1 2', '、、 1 2', '，，1 2', ',; 1 2', ';, 1 2']) {
      expect(tryNumberList(s)).toBeNull()
    }
    for (const s of ['1 2 ,,', '1 2 、、', '1 2 ，，', '1 2 ,;', '1 2 ;, ']) {
      expect(tryNumberList(s)).toBeNull()
    }
    expect(tryNumberList(',, 1 2 ,,')).toBeNull()
  })

  it('标点间夹带空白的连续标点形态一律返回 null', () => {
    for (const s of ['1 , , 2', '1 , \t , 2', '1 、  、 2', '1 ； ； 2', '1 ，  ， 2', '1 ,  ; 2', '1 ;  , 2']) {
      expect(tryNumberList(s)).toBeNull()
    }
    for (const s of ['1 ,,, 2', '1 、、、 2']) {
      expect(tryNumberList(s)).toBeNull()
    }
  })

  it('单个数字带首尾标点不构成数字列表，返回 null', () => {
    for (const s of [',1', '1,', '，1', '1，', '、1', '1、', ';1', '1;', '；1', '1；']) {
      expect(tryNumberList(s)).toBeNull()
    }
    for (const s of [',,1', '1,,', '、、1', '1、、']) {
      expect(tryNumberList(s)).toBeNull()
    }
  })

  it('纯标点、纯空白与空输入一律返回 null', () => {
    for (const s of [',', '，', '、', ';', '；']) {
      expect(tryNumberList(s)).toBeNull()
    }
    for (const s of [',,', '、、', '；；', ' , , ', ',,,,']) {
      expect(tryNumberList(s)).toBeNull()
    }
    for (const s of ['', '   ', '\t\n\r']) {
      expect(tryNumberList(s)).toBeNull()
    }
  })

  it('混合空白与合法单标点正常切分求和', () => {
    for (const s of ['1    2', '1 \t  2', '1　 2']) {
      expect(tryNumberList(s)).toEqual({ value: 3, count: 2 })
    }
    for (const s of ['1   ,   2', '1  \t、 \t  2', ' 1 ， 2 ']) {
      expect(tryNumberList(s)).toEqual({ value: 3, count: 2 })
    }
  })

  it('千分位边界：带小数、负号、逗号后非3位与连续逗号', () => {
    expect(tryNumberList('1,234.56')).toEqual({ value: 1234.56, count: 1 })
    expect(tryNumberList('1,234.56 10')).toEqual({ value: 1244.56, count: 2 })
    expect(tryNumberList('-1,234')).toEqual({ value: -1234, count: 1 })
    expect(tryNumberList('1,234,5,678')).toEqual({ value: 6912, count: 2 })
    expect(tryNumberList('1,234,,5,678')).toBeNull()
    expect(tryNumberList('1,234,,')).toBeNull()
    expect(tryNumberList(',, 1,234')).toBeNull()
    expect(tryNumberList('1,2')).toEqual({ value: 3, count: 2 })
    expect(tryNumberList('1,2345')).toEqual({ value: 2346, count: 2 })
  })

  it('连续标点错误行在 evaluateScratch 中报错且不污染后续行与 ans', () => {
    const r1 = evaluateScratch('1,,2\n3+4')
    expect(r1.lines[0].kind).toBe('error')
    expect(r1.lines[1]).toMatchObject({ kind: 'ok', value: 7 })
    expect(r1.last).toBe(7)
    expect(r1.vars.get('ans')).toBe(7)

    const r2 = evaluateScratch('10\n1,,2\nans*2')
    expect(r2.lines[0]).toMatchObject({ kind: 'ok', value: 10 })
    expect(r2.lines[1].kind).toBe('error')
    expect(r2.lines[2]).toMatchObject({ kind: 'ok', value: 20 })
    expect(r2.vars.get('ans')).toBe(20)

    const r3 = evaluateScratch('1、、2\n1,, 2\n1,;2')
    expect(r3.lines.every((l) => l.kind === 'error')).toBe(true)
  })

  it('copySum 合计计算基础：ok 行累加与 formatNumber 导出纯数值无千分位', () => {
    const script = [
      '// 销售明细',
      '1,234 5,678',
      '100 + 20',
      '-50',
      '0.1 + 0.2',
      '# 备注',
      '1,,2'
    ].join('\n')
    const r = evaluateScratch(script)
    const okLines = r.lines.filter((l) => l.kind === 'ok')
    expect(okLines).toHaveLength(4)
    const totalSum = okLines.reduce((acc, l) => acc + (l.value ?? 0), 0)
    expect(totalSum).toBeCloseTo(6982.3, 10)
    const pureText = formatNumber(totalSum)
    expect(pureText).toBe('6982.3')
    expect(pureText).not.toContain(',')
  })

  it('okCount 为 0 时不产出有效合计数值', () => {
    const r = evaluateScratch('// 注释\n\n1,,2\n未知+1')
    const okCount = r.lines.filter((l) => l.kind === 'ok').length
    expect(okCount).toBe(0)
  })
})
