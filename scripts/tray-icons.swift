// 托盘图标生成与像素级核验（macOS Template + 彩色 Win 托盘）
// 用法：swift scripts/tray-icons.swift generate | verify
// 源几何取自 GTools.svg（512 viewBox：圆角方块 rx=115 + G 光轨 + 光标圆点），
// Template 只用纯黑与 alpha 渐变抗锯齿，杜绝任何白色杂色。
import Foundation
import CoreGraphics
import ImageIO

let repoRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let resourcesDir = repoRoot.appendingPathComponent("resources").path

// ---------- SVG 路径（endpoint→center 转弧段再转三次贝塞尔，避免 CG 弧方向在翻转坐标系下的歧义） ----------
struct SvgPathBuilder {
    let path = CGMutablePath()
    let map: (CGPoint) -> CGPoint
    var current = CGPoint.zero

    init(map: @escaping (CGPoint) -> CGPoint) {
        self.map = map
    }

    mutating func move(_ p: CGPoint) {
        current = p
        path.move(to: map(p))
    }

    mutating func line(_ p: CGPoint) {
        current = p
        path.addLine(to: map(p))
    }

    mutating func close() {
        path.closeSubpath()
    }

    mutating func arc(to end: CGPoint, rx: CGFloat, ry: CGFloat, largeArc: Bool, sweep: Bool) {
        let p0 = current
        let dx2 = (p0.x - end.x) / 2
        let dy2 = (p0.y - end.y) / 2
        let x1p = dx2
        let y1p = dy2
        var rx = max(rx, 0.0001)
        var ry = max(ry, 0.0001)
        let lambda = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry)
        if lambda > 1 {
            let f = lambda.squareRoot()
            rx *= f
            ry *= f
        }
        let sign: CGFloat = (largeArc != sweep) ? 1 : -1
        let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
        let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        let co = sign * max(0, num / den).squareRoot()
        let cxp = co * rx * y1p / ry
        let cyp = -co * ry * x1p / rx
        let cx = cxp + (p0.x + end.x) / 2
        let cy = cyp + (p0.y + end.y) / 2

        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let dot = ux * vx + uy * vy
            let len = (ux * ux + uy * uy) * (vx * vx + vy * vy)
            var a = acos(min(1, max(-1, dot / len)))
            if ux * vy - uy * vx < 0 { a = -a }
            return a
        }
        let theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
        var dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
        if !sweep && dTheta > 0 { dTheta -= 2 * .pi }
        if sweep && dTheta < 0 { dTheta += 2 * .pi }

        let segCount = Int((abs(dTheta) / (.pi / 2)).rounded(.up))
        let delta = dTheta / CGFloat(segCount)
        let k = 4.0 / 3.0 * tan(delta / 4)
        func ellipse(_ th: CGFloat) -> CGPoint {
            CGPoint(x: cx + rx * cos(th), y: cy + ry * sin(th))
        }
        func deriv(_ th: CGFloat) -> CGPoint {
            CGPoint(x: -rx * sin(th), y: ry * cos(th))
        }
        var th = theta1
        for _ in 0..<segCount {
            let s = ellipse(th)
            let e = ellipse(th + delta)
            let ds = deriv(th)
            let de = deriv(th + delta)
            path.addCurve(
                to: map(e),
                control1: map(CGPoint(x: s.x + k * ds.x, y: s.y + k * ds.y)),
                control2: map(CGPoint(x: e.x - k * de.x, y: e.y - k * de.y))
            )
            th += delta
        }
        current = end
    }
}

// ---------- 布局：SVG 512 空间 → size 空间（y 翻转，四周留 inset 透明边） ----------
struct Layout {
    let size: CGFloat
    var inset: CGFloat { size == 16 ? 1.0 : 2.0 } // 16px→1px、32px→2px，像素对齐且四周留透明边，无贴边截断
    var scale: CGFloat { (size - inset * 2) / 512 }
    func map(_ p: CGPoint) -> CGPoint {
        CGPoint(x: inset + p.x * scale, y: size - inset - p.y * scale)
    }
}

func makeLayout(size: CGFloat) -> Layout {
    Layout(size: size)
}

func roundedSquarePath(size: CGFloat) -> CGPath {
    let layout = makeLayout(size: size)
    var b = SvgPathBuilder(map: layout.map)
    let r: CGFloat = 115
    b.move(CGPoint(x: r, y: 0))
    b.arc(to: CGPoint(x: 0, y: r), rx: r, ry: r, largeArc: false, sweep: true)
    b.line(CGPoint(x: 0, y: 512 - r))
    b.arc(to: CGPoint(x: r, y: 512), rx: r, ry: r, largeArc: false, sweep: true)
    b.line(CGPoint(x: 512 - r, y: 512))
    b.arc(to: CGPoint(x: 512, y: 512 - r), rx: r, ry: r, largeArc: false, sweep: true)
    b.line(CGPoint(x: 512, y: r))
    b.arc(to: CGPoint(x: 512 - r, y: 0), rx: r, ry: r, largeArc: false, sweep: true)
    b.close()
    return b.path
}

// G 光轨：M 360 180 A 130 130 0 1 0 370 330 L 260 330 A 25 25 0 0 1 260 280 L 330 280 A 80 80 0 1 1 325 205 L 360 180 Z
func gTrackPath(size: CGFloat) -> CGPath {
    let layout = makeLayout(size: size)
    var b = SvgPathBuilder(map: layout.map)
    b.move(CGPoint(x: 360, y: 180))
    b.arc(to: CGPoint(x: 370, y: 330), rx: 130, ry: 130, largeArc: true, sweep: false)
    b.line(CGPoint(x: 260, y: 330))
    b.arc(to: CGPoint(x: 260, y: 280), rx: 25, ry: 25, largeArc: false, sweep: true)
    b.line(CGPoint(x: 330, y: 280))
    b.arc(to: CGPoint(x: 325, y: 205), rx: 80, ry: 80, largeArc: true, sweep: true)
    b.line(CGPoint(x: 360, y: 180))
    b.close()
    return b.path
}

func cursorDotPath(size: CGFloat) -> CGPath {
    let layout = makeLayout(size: size)
    var b = SvgPathBuilder(map: layout.map)
    b.move(CGPoint(x: 278, y: 200))
    b.arc(to: CGPoint(x: 242, y: 200), rx: 18, ry: 18, largeArc: false, sweep: true)
    b.arc(to: CGPoint(x: 278, y: 200), rx: 18, ry: 18, largeArc: false, sweep: true)
    b.close()
    return b.path
}

// ---------- 颜色 ----------
func srgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(
        srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
        green: CGFloat((hex >> 8) & 0xFF) / 255,
        blue: CGFloat(hex & 0xFF) / 255,
        alpha: alpha
    )
}

func gradient(_ stops: [(UInt32, CGFloat)]) -> CGGradient {
    let space = CGColorSpaceCreateDeviceRGB()
    return CGGradient(
        colorsSpace: space,
        colors: stops.map { srgb($0.0) } as CFArray,
        locations: stops.map { $0.1 }
    )!
}

let bgGrad = gradient([(0x1E293B, 0), (0x0F172A, 1)])
let gGrad = gradient([(0x38BDF8, 0), (0x2563EB, 0.5), (0x6366F1, 1)])

// ---------- 渲染 ----------
func makeContext(size: Int) -> CGContext {
    CGContext(
        data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )!
}

func renderTemplate(size: Int) -> CGImage {
    let ctx = makeContext(size: size)
    let s = CGFloat(size)
    ctx.setFillColor(srgb(0x000000))
    ctx.addPath(roundedSquarePath(size: s))
    ctx.fillPath()
    ctx.setBlendMode(.clear) // G 与圆点镂空，RGB 保持 0、仅 alpha 变化
    ctx.addPath(gTrackPath(size: s))
    ctx.fillPath()
    ctx.addPath(cursorDotPath(size: s))
    ctx.fillPath()
    return ctx.makeImage()!
}

func renderColored(size: Int) -> CGImage {
    let ctx = makeContext(size: size)
    let s = CGFloat(size)
    ctx.saveGState()
    ctx.addPath(roundedSquarePath(size: s))
    ctx.clip()
    let a = makeLayout(size: s).map(CGPoint(x: 0, y: 0))
    let b = makeLayout(size: s).map(CGPoint(x: 512, y: 512))
    ctx.drawLinearGradient(bgGrad, start: a, end: b, options: [])
    ctx.restoreGState()
    ctx.saveGState()
    ctx.addPath(gTrackPath(size: s))
    ctx.clip()
    ctx.drawLinearGradient(gGrad, start: a, end: b, options: [])
    ctx.restoreGState()
    ctx.setAlpha(0.85) // SVG 光标点 opacity 0.85
    ctx.setFillColor(srgb(0x38BDF8))
    ctx.addPath(cursorDotPath(size: s))
    ctx.fillPath()
    ctx.setAlpha(1)
    return ctx.makeImage()!
}

func writePNG(_ image: CGImage, to path: String) {
    let url = URL(fileURLWithPath: path) as CFURL
    let dest = CGImageDestinationCreateWithURL(url, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else {
        fatalError("写入失败: \(path)")
    }
    print("生成 \(path) (\(image.width)x\(image.height))")
}

func generate() {
    writePNG(renderTemplate(size: 16), to: "\(resourcesDir)/trayTemplate.png")
    writePNG(renderTemplate(size: 32), to: "\(resourcesDir)/trayTemplate@2x.png")
    writePNG(renderColored(size: 16), to: "\(resourcesDir)/tray.png")
    writePNG(renderColored(size: 32), to: "\(resourcesDir)/tray@2x.png")
}

// ---------- 核验 ----------
struct Pixels {
    let data: [UInt8]
    let w: Int
    let h: Int

    func at(_ x: Int, _ y: Int) -> (r: UInt8, g: UInt8, b: UInt8, a: UInt8) {
        let i = (y * w + x) * 4
        return (data[i], data[i + 1], data[i + 2], data[i + 3])
    }
}

func loadPNG(_ path: String) -> Pixels {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil)
    else { fatalError("读取失败: \(path)") }
    let w = img.width
    let h = img.height
    var data = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(
        data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )!
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return Pixels(data: data, w: w, h: h)
}

func pixelContaining(_ p: Pixels, svgPoint: CGPoint) -> (x: Int, y: Int) {
    let layout = makeLayout(size: CGFloat(p.w))
    let m = layout.map(svgPoint)
    return (min(p.w - 1, Int(m.x)), min(p.h - 1, Int(m.y)))
}

var failures = 0
func check(_ cond: Bool, _ label: String) {
    print((cond ? "PASS  " : "FAIL  ") + label)
    if !cond { failures += 1 }
}

func verifyTemplate(_ path: String, expectW: Int, expectH: Int) {
    print("--- \(path) ---")
    let p = loadPNG(path)
    check(p.w == expectW && p.h == expectH, "尺寸 \(p.w)x\(p.h) == \(expectW)x\(expectH)")

    var badRGB = 0
    var firstBad: (Int, Int, UInt8, UInt8, UInt8)?
    var opaque = 0
    var partial = 0
    for y in 0..<p.h {
        for x in 0..<p.w {
            let c = p.at(x, y)
            if c.r != 0 || c.g != 0 || c.b != 0 {
                badRGB += 1
                if firstBad == nil { firstBad = (x, y, c.r, c.g, c.b) }
            }
            if c.a == 255 { opaque += 1 }
            if c.a > 0 && c.a < 255 { partial += 1 }
        }
    }
    check(badRGB == 0, "无杂色像素（RGB 全 0，仅 alpha 变化）\(badRGB == 0 ? "" : "，首个坏点 \(firstBad!)")")
    check(opaque > 0, "存在纯黑不透明像素（方块本体）: \(opaque)")
    check(partial > 0, "存在 alpha 渐变抗锯齿像素: \(partial)")

    let corners = [(0, 0), (p.w - 1, 0), (0, p.h - 1), (p.w - 1, p.h - 1)]
    check(corners.allSatisfy { p.at($0.0, $0.1).a == 0 }, "四角透明")

    // 方块左侧内部安全区应不透明（SVG (40,256)）
    let edge = pixelContaining(p, svgPoint: CGPoint(x: 40, y: 256))
    check(p.at(edge.x, edge.y).a == 255, "方块内部不透明 @(\(edge.x),\(edge.y))")

    // G 环带正中应镂空（SVG (201,164)，环心 (259.2,262.06) 半径带 80~130 正中）
    let band = pixelContaining(p, svgPoint: CGPoint(x: 201, y: 164))
    check(p.at(band.x, band.y).a == 0, "G 环带镂空 @(\(band.x),\(band.y))")

    if p.w >= 32 {
        // @2x 才有足够分辨率校验圆点：SVG (260,205) r18 内部（避开顶部与 G 内弧相切过渡区）
        let dot = pixelContaining(p, svgPoint: CGPoint(x: 260, y: 205))
        check(p.at(dot.x, dot.y).a == 0, "光标圆点镂空 @(\(dot.x),\(dot.y))")
    }

    // ASCII 预览（人工目检形状）
    let chars: [Character] = [" ", ".", "+", "*", "#"]
    for y in 0..<p.h {
        var line = ""
        for x in 0..<p.w {
            let a = p.at(x, y).a
            line.append(chars[Int(a) / 52])
        }
        print(line)
    }
}

func verifyColored(_ path: String, expectW: Int, expectH: Int) {
    print("--- \(path) ---")
    let p = loadPNG(path)
    check(p.w == expectW && p.h == expectH, "尺寸 \(p.w)x\(p.h) == \(expectW)x\(expectH)")

    let corners = [(0, 0), (p.w - 1, 0), (0, p.h - 1), (p.w - 1, p.h - 1)]
    let cornerClean = corners.allSatisfy { c in
        let v = p.at(c.0, c.1)
        return v.a == 0 && v.r == 0 && v.g == 0 && v.b == 0
    }
    check(cornerClean, "四角纯透明（无白边残留）")

    var fringe = 0
    var whiteish = 0
    for y in 0..<p.h {
        for x in 0..<p.w {
            let c = p.at(x, y)
            if c.r > 240 && c.g > 240 && c.b > 240 { whiteish += 1 }
            // 白边抗锯齿特征：半透明像素 RGB 无彩度（r≈g≈b）；调色板全部为带彩度深色
            if c.a > 0 && c.a < 255 && abs(Int(c.r) - Int(c.g)) <= 1 && abs(Int(c.g) - Int(c.b)) <= 1 && c.r > 2 {
                fringe += 1
            }
        }
    }
    check(whiteish == 0, "无近白像素: \(whiteish)")
    check(fringe == 0, "无白边抗锯齿像素（半透明且无彩度）: \(fringe)")

    let edge = pixelContaining(p, svgPoint: CGPoint(x: 40, y: 256))
    check(p.at(edge.x, edge.y).a == 255, "方块内部不透明 @(\(edge.x),\(edge.y))")
}

func verify() {
    verifyTemplate("\(resourcesDir)/trayTemplate.png", expectW: 16, expectH: 16)
    verifyTemplate("\(resourcesDir)/trayTemplate@2x.png", expectW: 32, expectH: 32)
    verifyColored("\(resourcesDir)/tray.png", expectW: 16, expectH: 16)
    verifyColored("\(resourcesDir)/tray@2x.png", expectW: 32, expectH: 32)
    print(failures == 0 ? "全部核验通过" : "核验失败 \(failures) 项")
    exit(failures == 0 ? 0 : 1)
}

func ascii(_ image: CGImage) {
    let p = Pixels(data: {
        let w = image.width
        let h = image.height
        var d = [UInt8](repeating: 0, count: w * h * 4)
        let ctx = CGContext(
            data: &d, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        return d
    }(), w: image.width, h: image.height)
    let chars: [Character] = [" ", ".", "+", "*", "#"]
    for y in 0..<p.h {
        var line = ""
        for x in 0..<p.w {
            line.append(chars[Int(p.at(x, y).a) / 52])
        }
        print(line)
    }
}

func preview(size: Int) {
    let s = CGFloat(size)
    let ctx = makeContext(size: size)
    ctx.setFillColor(srgb(0x000000))
    ctx.addPath(roundedSquarePath(size: s))
    ctx.fillPath()
    print("== square ==")
    ascii(ctx.makeImage()!)
    let ctx2 = makeContext(size: size)
    ctx2.setFillColor(srgb(0x000000))
    ctx2.addPath(gTrackPath(size: s))
    ctx2.fillPath()
    print("== G ==")
    ascii(ctx2.makeImage()!)
    let ctx3 = makeContext(size: size)
    ctx3.setFillColor(srgb(0x000000))
    ctx3.addPath(cursorDotPath(size: s))
    ctx3.fillPath()
    print("== dot ==")
    ascii(ctx3.makeImage()!)
}

switch CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "" {
case "generate":
    generate()
case "verify":
    verify()
case "preview":
    preview(size: CommandLine.arguments.count > 2 ? Int(CommandLine.arguments[2]) ?? 64 : 64)
default:
    print("用法: swift scripts/tray-icons.swift generate|verify|preview [size]")
    exit(2)
}
