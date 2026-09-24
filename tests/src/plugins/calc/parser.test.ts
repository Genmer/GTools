import { describe, expect, it } from 'vitest'
import { CalcError, evaluateExpression, formatDisplay, formatNumber, groupThousands, normalizeExpr } from '../../../../src/plugins/calc/logic/parser'

const empty = new Map<string, number>()
const env = (entries: Record<string, number>): Map<string, number> => new Map(Object.entries(entries))

function expectErr(src: string, msgPart: string): void {
  try {
    evaluateExpression(src, empty)
    expect.unreachable(`「${src}」应当报错`)
  } catch (e) {
    expect(e).toBeInstanceOf(CalcError)
    expect((e as CalcError).message).toContain(msgPart)
  }
}

describe('calc parser 基础四则', () => {
  it('加减乘除与优先级', () => {
    expect(evaluateExpression('1+2', empty)).toBe(3)
    expect(evaluateExpression('1+2*3', empty)).toBe(7)
    expect(evaluateExpression('(1+2)*3', empty)).toBe(9)
    expect(evaluateExpression('10/4', empty)).toBe(2.5)
    expect(evaluateExpression('10 - 2 - 3', empty)).toBe(5)
    expect(evaluateExpression('100*(2+3)/4', empty)).toBe(125)
  })

  it('取模（% 与数字之间有空格才取模，紧邻则是百分比）', () => {
    expect(evaluateExpression('7 % 3', empty)).toBe(1)
    expect(evaluateExpression('10 % 3', empty)).toBe(1)
    expectErr('10%3', '多余')
  })

  it('一元正负号', () => {
    expect(evaluateExpression('-3+5', empty)).toBe(2)
    expect(evaluateExpression('2*-3', empty)).toBe(-6)
    expect(evaluateExpression('-(-5)', empty)).toBe(5)
    expect(evaluateExpression('+-5', empty)).toBe(-5)
  })

  it('幂运算：右结合、高于一元负号、支持 ** 写法', () => {
    expect(evaluateExpression('2^10', empty)).toBe(1024)
    expect(evaluateExpression('2^3^2', empty)).toBe(512)
    expect(evaluateExpression('-2^2', empty)).toBe(-4)
    expect(evaluateExpression('2^-2', empty)).toBe(0.25)
    expect(evaluateExpression('2**8', empty)).toBe(256)
  })

  it('科学计数法与小数', () => {
    expect(evaluateExpression('1.5e3*2', empty)).toBe(3000)
    expect(evaluateExpression('2e-2', empty)).toBe(0.02)
    expect(evaluateExpression('.5+1', empty)).toBe(1.5)
  })
})

describe('calc parser 百分比', () => {
  it('独立百分号字面量 = 数值/100', () => {
    expect(evaluateExpression('50%', empty)).toBe(0.5)
    expect(evaluateExpression('50%*80', empty)).toBe(40)
    expect(evaluateExpression('100*(1+5%)', empty)).toBe(105)
  })

  it('乘除中百分比按 字面量 参与：200*5% = 10', () => {
    expect(evaluateExpression('200*5%', empty)).toBe(10)
  })

  it('加减中的 b% 是相对百分比（商用计算器语义）：100+10% = 110', () => {
    expect(evaluateExpression('100+10%', empty)).toBe(110)
    expect(evaluateExpression('100-10%', empty)).toBe(90)
    expect(evaluateExpression('50+20%', empty)).toBe(60)
  })

  it('百分号紧邻数字才是百分比，隔空格按取模处理', () => {
    expectErr('100 + 10 %', '不完整')
  })
})

describe('calc parser 变量与全角容错', () => {
  it('变量从环境读取', () => {
    expect(evaluateExpression('a*5', env({ a: 3 }))).toBe(15)
    expect(evaluateExpression('a+b', env({ a: 1, b: 2 }))).toBe(3)
  })

  it('未知变量报错并指出名字', () => {
    expectErr('b*2', '未知变量：b')
  })

  it('内置函数调用（sqrt/sin/cos/tan/round/floor/ceil/abs/log/ln）', () => {
    expect(evaluateExpression('sqrt(16)', empty)).toBe(4)
    expect(evaluateExpression('sin(0)', empty)).toBe(0)
    expect(evaluateExpression('cos(0)', empty)).toBe(1)
    expect(evaluateExpression('tan(0)', empty)).toBe(0)
    expect(evaluateExpression('round(2.5)', empty)).toBe(3)
    expect(evaluateExpression('floor(2.9)', empty)).toBe(2)
    expect(evaluateExpression('ceil(2.1)', empty)).toBe(3)
    expect(evaluateExpression('abs(-7)', empty)).toBe(7)
    expect(evaluateExpression('log(1000)', empty)).toBe(3)
    expect(evaluateExpression('ln(1)', empty)).toBe(0)
  })

  it('函数参与表达式与变量环境', () => {
    expect(evaluateExpression('sqrt(3^2+4^2)', empty)).toBe(5)
    expect(evaluateExpression('sqrt(a)+1', env({ a: 9 }))).toBe(4)
    expect(evaluateExpression('round(a/2)*sqrt(16)', env({ a: 7 }))).toBe(16)
    expect(evaluateExpression('SQRT(4)', empty)).toBe(2)
  })

  it('函数相关错误：未知函数与未闭合括号', () => {
    expectErr('foo(1)', '未知函数：foo')
    expectErr('sqrt(4', '括号未闭合')
    expectErr('sqrt(-1)', '不是有效数字')
    expectErr('log(0)', '溢出')
  })

  it('函数名仍可作普通变量（未跟括号时不解析为调用）', () => {
    expect(evaluateExpression('sqrt+1', env({ sqrt: 3 }))).toBe(4)
  })

  it('全角运算符与 ×÷ 归一', () => {
    expect(normalizeExpr('１＋２')).toBe('1+2')
    expect(evaluateExpression('１＋２', empty)).toBe(3)
    expect(evaluateExpression('6×7', empty)).toBe(42)
    expect(evaluateExpression('8÷2', empty)).toBe(4)
    expect(evaluateExpression('（1+2）×3', empty)).toBe(9)
  })
})

describe('calc parser 错误输入', () => {
  it('算术错误', () => {
    expectErr('1/0', '除数为 0')
    expectErr('5 % 0', '模数为 0')
    expectErr('(-8)^0.5', '不是有效数字')
    expectErr('1e308*10', '溢出')
  })

  it('语法错误', () => {
    expectErr('', '表达式为空')
    expectErr('1+', '不完整')
    expectErr('(1+2', '括号未闭合')
    expectErr('1+2)', '多余')
    expectErr('1 2', '多余')
    expectErr('1..2', '多余')
    expectErr('1=2', '无法识别的字符')
    expectErr('a==1', '无法识别的字符')
    expectErr('$1+2', '无法识别的字符')
    expectErr('*3', '不应出现')
  })
})

describe('calc formatNumber', () => {
  it('整数与浮点误差清理', () => {
    expect(formatNumber(2)).toBe('2')
    expect(formatNumber(-42)).toBe('-42')
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(1 / 3)).toBe('0.333333333333')
    expect(formatNumber(10000000000000000)).toBe('10000000000000000')
  })

  it('特殊值透传', () => {
    expect(formatNumber(Number.NaN)).toBe('NaN')
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('Infinity')
  })
})

describe('calc formatDisplay 千分位', () => {
  it('整数部分插逗号，小数不动', () => {
    expect(formatDisplay(4175270)).toBe('4,175,270')
    expect(formatDisplay(51599.25)).toBe('51,599.25')
    expect(formatDisplay(1942)).toBe('1,942')
    expect(formatDisplay(999)).toBe('999')
    expect(formatDisplay(1000)).toBe('1,000')
    expect(formatDisplay(-1234567.89)).toBe('-1,234,567.89')
  })

  it('科学计数与特殊值原样（不硬插逗号）', () => {
    expect(formatDisplay(Number.NaN)).toBe('NaN')
    expect(groupThousands('1e+21')).toBe('1e+21')
  })
})

describe('calc parser 边界补充', () => {
  it('全角 ％＾＝ 归一后仍参与百分比/幂语义', () => {
    expect(normalizeExpr('１００％')).toBe('100%')
    expect(normalizeExpr('２＾１０')).toBe('2^10')
    expect(normalizeExpr('＝')).toBe('=')
    expect(evaluateExpression('１００＋５０％', empty)).toBe(150)
    expect(evaluateExpression('50％＊8', empty)).toBe(4)
    expect(evaluateExpression('２＾１０', empty)).toBe(1024)
  })

  it('纯空白输入按空表达式报错', () => {
    expectErr('   ', '表达式为空')
    expectErr(' \t ', '表达式为空')
  })

  it('深层括号嵌套', () => {
    expect(evaluateExpression('((((5))))', empty)).toBe(5)
    expect(evaluateExpression('((1+2)*(3+4))', empty)).toBe(21)
  })

  it('百分比字面量作加法左操作数按普通数处理', () => {
    // a% + b：a% 是字面量 a/100，右侧 b 非 pct，走普通加法
    expect(evaluateExpression('2%+3', empty)).toBe(3.02)
  })
})

describe('calc 格式化边界补充', () => {
  it('负浮点误差清理与小数多位不插逗号', () => {
    expect(formatNumber(-0.1 - 0.2)).toBe('-0.3')
    expect(groupThousands('1234.56789')).toBe('1,234.56789')
    expect(groupThousands('-9876.5')).toBe('-9,876.5')
    expect(formatDisplay(1234567.891)).toBe('1,234,567.891')
  })

  it('超 1e21 的整数走有效数字分支输出科学计数', () => {
    expect(formatNumber(1e21)).toBe('1e+21')
  })
})
