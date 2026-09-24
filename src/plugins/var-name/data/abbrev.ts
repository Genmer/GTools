// 缩写词典，数据源 docs/research/abbreviations.md Part 1（A1 仓库）+ Part 2 分歧双收裁决。
// level 语义（DESIGN 附录 C.5）：recommended 开关开启时才自动替换；contextual 只出建议；avoid 只用于反查提示。

export interface AbbrEntry {
  full: string
  primary: string
  variants?: string[]
  level: 'recommended' | 'contextual' | 'avoid'
  context?: string
}

const R = (full: string, primary: string, variants?: string[]): AbbrEntry => ({ full, primary, variants, level: 'recommended' })
const C = (full: string, primary: string, context: string, variants?: string[]): AbbrEntry => ({ full, primary, context, variants, level: 'contextual' })
const A = (full: string, primary: string): AbbrEntry => ({ full, primary, level: 'avoid' })

// Part 1.1 🟢 推荐（含 Part 2 裁决后的双收条目：buffer/current/config 等）
const RECOMMENDED: AbbrEntry[] = [
  R('abbreviation', 'abbr'), R('absolute', 'abs'), R('acronym', 'acro'), R('addition', 'sum'),
  R('address', 'addr'), R('algorithm', 'algo'), R('alternative', 'alt'), R('annotation', 'anno'),
  R('application', 'app'), R('argument', 'arg'), R('array', 'arr'), R('asynchronous', 'async'),
  R('attribute', 'attr'), R('authentication', 'auth'), R('auxiliary', 'aux'), R('average', 'avg'),
  R('background', 'bg'), R('binary', 'bin'), R('boolean', 'bool'),
  R('buffer', 'buf', ['buff']), R('button', 'btn'), R('calculator', 'calc'), R('callback', 'cb'),
  R('certificate', 'cert'), R('character', 'char'), R('check', 'chk'), R('clear', 'clr'),
  R('collection', 'coll'), R('column', 'col'), R('command', 'cmd'), R('communication', 'com'),
  R('component', 'comp'), R('concatenation', 'concat'), R('condition', 'cond'),
  R('configuration', 'config'), R('connection', 'conn'), R('constant', 'const'),
  R('container', 'cntr'), R('context', 'ctx'), R('continue', 'cont'), R('control', 'ctrl'),
  R('conversation', 'conv'), R('coordinate', 'coord'), R('current', 'curr', ['cur']),
  R('database', 'db'), R('debug', 'dbg'), R('decimal', 'dec'), R('declaration', 'decl'),
  R('definition', 'def'), R('degrees', 'deg'), R('deletion', 'del'), R('dependency', 'dep'),
  R('description', 'desc'), R('destination', 'dest'), R('developer', 'dev'), R('development', 'dev'),
  R('dimension', 'dim'), R('direction', 'dir'), R('directory', 'dir'), R('disable', 'dis'),
  R('display', 'disp'), R('division', 'div'), R('document', 'doc'), R('documentation', 'docs'),
  R('driver', 'drv'), R('dynamic', 'dyn'), R('element', 'elm'), R('enable', 'en'),
  R('environment', 'env'), R('error', 'err'), R('event', 'evt', ['e']), R('execution', 'exe'),
  R('exponential', 'exp'), R('expression', 'expr'), R('extension', 'ext'), R('factory', 'fac'),
  R('figure', 'fig'), R('file chooser', 'fc'), R('file descriptor', 'fd'), R('file processor', 'fp'),
  R('file reader', 'fr'), R('file system', 'fs'), R('file writer', 'fw'), R('format', 'fmt'),
  R('fraction', 'frac'), R('frequency', 'freq'), R('function', 'func'), R('generation', 'gen'),
  R('geometry', 'geom'), R('hexadecimal', 'hex'), R('identifier', 'id'), R('image', 'img'),
  R('implementation', 'impl'), R('import', 'imp'), R('increase', 'inc'), R('index', 'idx'),
  R('information', 'info'), R('initialization', 'init'), R('input', 'in'), R('insertion', 'ins'),
  R('instance', 'inst'), R('integer', 'int'), R('interface', 'iface'), R('inverse', 'inv'),
  R('keymap', 'km'), R('keyword', 'kwd'), R('language', 'lang'), R('length', 'len'),
  R('level', 'lvl'), R('library', 'lib'), R('linked list', 'll'), R('location', 'loc'),
  R('manager', 'mng'), R('maximum', 'max'), R('memory', 'mem'), R('message', 'msg'),
  R('microcontroller', 'mcu'), R('middle', 'mid'), R('minimum', 'min'), R('miscellaneous', 'misc'),
  R('modulo', 'mod'), R('multiplication', 'mul'), R('navigation', 'nav'), R('network', 'net'),
  R('number', 'num'), R('object', 'obj'), R('octal', 'oct'), R('open source software', 'oss'),
  R('operating system', 'os'), R('option', 'opt'), R('organization', 'org'), R('origin', 'orig'),
  R('output', 'out'), R('package', 'pkg'), R('parameter', 'param'), R('performance', 'perf'),
  R('picture', 'pic'), R('pixel', 'px'), R('pointer', 'ptr'), R('prediction', 'pred'),
  R('preference', 'pref'), R('previous', 'prev'), R('private', 'priv'), R('production', 'prod'),
  R('profiler', 'prof'), R('property', 'prop'), R('public', 'pub'), R('query', 'q'),
  R('radians', 'rad'), R('range', 'rng'), R('receive', 'recv'), R('record', 'rec'),
  R('reference', 'ref'), R('regex', 'regex'), R('relation', 'rel'), R('remote', 'rem'),
  R('remove', 'rm'), R('repository', 'repo'), R('request', 'req'), R('response', 'res'),
  R('result', 'res'), R('return', 'ret'), R('revision', 'rev'), R('selection', 'sel'),
  R('separator', 'sep'), R('sequence', 'seq'), R('service', 'svc'), R('solution', 'sol'),
  R('source', 'src'), R('specification', 'spec'), R('square root', 'sqrt'), R('standard', 'std'),
  R('standard input output', 'stdio'), R('statement', 'stmt'), R('statistic', 'stat'),
  R('string', 'str'), R('subtraction', 'sub'), R('synchronization', 'sync'),
  R('temporary', 'tmp', ['temp']), R('timer', 'tmr'), R('timestamp', 'ts'), R('transaction', 'tx'),
  R('utility', 'util'), R('value', 'val'), R('variable', 'var'), R('vector', 'vec'),
  R('vertical', 'ver'), R('window', 'win'), R('wizard', 'wiz')
]

// Part 1.2 🟡 上下文敏感（context 必填）
const CONTEXTUAL: AbbrEntry[] = [
  C('allocation', 'alloc', '内存管理'), C('breakline', 'bl', '字符编码'), C('channel', 'ch', '连接/IO'),
  C('checksum', 'csum', '运算'), C('circle', 'circ', '图形'), C('commercial', 'com', 'URL 域名'),
  C('comparison', 'cmp', '条件运算'), C('delta time', 'dt', '计算/游戏循环'),
  C('difference', 'diff', '运算；VCS 语境通行'), C('device', 'dev', '设备枚举（与 developer 撞形）'),
  C('equal', 'eq', '二元运算'), C('greater than', 'gt', '二元运算/shell'),
  C('greater or equal', 'ge', '二元运算/shell'), C('less than', 'lt', '二元运算/shell'),
  C('less or equal', 'le', '二元运算/shell'), C('height', 'h', '图形且带配套单位'),
  C('width', 'w', '图形且带配套单位'), C('horizontal', 'hor', '图形'), C('iterator', 'iter', '循环'),
  C('key', 'k', '仅键值对连用'), C('value', 'v', '仅与 k 连用（键值对）'),
  C('latitude', 'lat', '仅与坐标连用'), C('longitude', 'lon', '仅与坐标连用'),
  C('matrix', 'mat', '数学', ['mtx']), C('mutable', 'mut', '变量修饰（Rust 关键字）'),
  C('newline', 'nl', '字符编码'), C('no', 'n', '仅 y/n 成对出现'), C('yes', 'y', '仅 y/n 成对出现'),
  C('not equal', 'ne', '二元运算'), C('operation', 'op', '二元运算'),
  C('order', 'ord', '数据科学'), C('pointer', 'p', '内存'), C('power', 'pwr', '能耗'),
  C('process', 'proc', '进程/线程'), C('radius', 'r', '圆形'), C('rectangle', 'rect', '图形'),
  C('semaphore', 'sem', '并发原语'), C('software', 'sw', '计算机科学'), C('time', 't', '物理'),
  C('type', 't', '修饰符/泛型 T'), C('user', 'u', '仅 URL 语境'), C('vector', 'v', '物理'),
  C('white space', 'ws', '字符编码'),
  // Part 2 裁决补录：A1 标 🔴 但实践双收/降级的条目
  C('user', 'usr', 'Unix 历史惯例'), C('function', 'fn', 'Rust/匿名函数参数惯例'),
  C('configuration', 'cfg', '嵌入式/C 惯例'), C('session', 'sess', '低频，实践多写全称'),
  C('version', 'v', '仅 v+版本号形态')
]

// Part 1.3 🔴 不推荐（只用于反查：用户输入该缩写时提示写全称）
const AVOID: AbbrEntry[] = [
  A('action', 'act'), A('break', 'brk'), A('class', 'cls'), A('common', 'com'),
  A('connection', 'con'), A('copy', 'cpy'), A('default', 'def'), A('header', 'hdr'),
  A('interface', 'intf'), A('link', 'lnk'), A('query', 'qry'), A('random', 'rnd'),
  A('script', 'sc'), A('solution', 'sln'), A('target', 'tgt'), A('toggle', 'tgl'),
  A('text', 'txt'), A('type', 'tpe'), A('version', 'ver')
]

export const ABBREVIATIONS: readonly AbbrEntry[] = [...RECOMMENDED, ...CONTEXTUAL, ...AVOID]

// full → recommended 主形态（同 full 多条时取首个 recommended，如 connection 取 conn 而非 avoid 的 con）
const FULL_TO_RECOMMENDED = new Map<string, AbbrEntry>()
for (const e of ABBREVIATIONS) {
  if (e.level === 'recommended' && !FULL_TO_RECOMMENDED.has(e.full)) FULL_TO_RECOMMENDED.set(e.full, e)
}
// 缩写 → 词条（反查表按收录序首个命中，recommended 在前天然优先）
const BY_ABBR = new Map<string, AbbrEntry>()
for (const e of ABBREVIATIONS) {
  for (const a of [e.primary, ...(e.variants ?? [])]) {
    if (!BY_ABBR.has(a)) BY_ABBR.set(a, e)
  }
}

function abbrForWord(word: string): AbbrEntry | undefined {
  const hit = FULL_TO_RECOMMENDED.get(word)
  if (hit) return hit
  // 复数：arguments → argument 的 arg + s
  if (word.endsWith('s') && word.length > 3) {
    const sing = FULL_TO_RECOMMENDED.get(word.slice(0, -1))
    if (sing) return { full: sing.full, primary: `${sing.primary}s`, level: 'recommended' }
  }
  return undefined
}

/** 开关开启时：仅 recommended 级主形态替换全称（复数保留 s）；其余级别不动 */
export function applyAbbrevs(words: readonly string[]): string[] {
  return words.map((w) => {
    const e = abbrForWord(w)
    return e !== undefined && e.level === 'recommended' ? e.primary : w
  })
}

export interface AbbrSuggestion {
  full: string
  abbr: string
  context: string
}

/** contextual 级建议（带上下文标签），UI 可点选后才替换 */
export function contextualSuggestions(words: readonly string[]): AbbrSuggestion[] {
  const out: AbbrSuggestion[] = []
  for (const w of words) {
    for (const e of ABBREVIATIONS) {
      if (e.level !== 'contextual' || e.full !== w) continue
      out.push({ full: e.full, abbr: e.primary, context: e.context ?? '' })
    }
  }
  return out
}

/** 反查：输入缩写命中词典 → 全称 + 推荐度（avoid 级提示写全称，绝不主动生成） */
export function reverseLookup(token: string): AbbrEntry | undefined {
  return BY_ABBR.get(token)
}

export const ABBR_LEVEL_LABEL: Readonly<Record<AbbrEntry['level'], string>> = {
  recommended: '推荐缩写',
  contextual: '上下文缩写',
  avoid: '不推荐，建议全称'
}
