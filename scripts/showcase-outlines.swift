// 仅把随项目分发的思源字体转换成轮廓；不读取系统字体，不把文字留给 SVG 查看器。
import Foundation
import CoreText
import CoreGraphics
let root = CommandLine.arguments[1]
let input = URL(fileURLWithPath: CommandLine.arguments[2])
let output = CommandLine.arguments[3]
let payload = try JSONSerialization.jsonObject(with: Data(contentsOf: input)) as! [String: Any]
let directory = URL(fileURLWithPath: root + "/frontend/node_modules/@fontsource-variable/noto-serif-sc/files")
let urls = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).filter { $0.pathExtension == "woff2" }.sorted { $0.path < $1.path }
let descriptors = urls.flatMap { CTFontManagerCreateFontDescriptorsFromURL($0 as CFURL) as? [CTFontDescriptor] ?? [] }.filter { (CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String ?? "").hasSuffix("-Regular") }
if descriptors.isEmpty { fatalError("CoreText 未能读取打包字体的 WOFF2；请使用支持 WOFF2 的 macOS") }
func n(_ x: CGFloat) -> String { String(format: "%.3f", Double(x)) }
func outline(_ text: String, _ x: CGFloat, _ baseline: CGFloat, _ size: CGFloat, _ color: String) -> String {
    var cursor = x
    var paths = ""
    for scalar in text.utf16 {
        var ch = scalar
        var found: (CTFont, CGGlyph)?
        for descriptor in descriptors {
            let f = CTFontCreateWithFontDescriptor(descriptor, size, nil)
            var glyph: CGGlyph = 0
            if CTFontGetGlyphsForCharacters(f, &ch, &glyph, 1) && glyph != 0 { found = (f, glyph); break }
        }
        guard let (font, glyph) = found else { fatalError("打包字体缺少字符 \(scalar)") }
        if let path = CTFontCreatePathForGlyph(font, glyph, nil) {
            var d = ""
            path.applyWithBlock { p in
                let p = p.pointee
                func xy(_ i: Int) -> String { n(cursor + p.points[i].x) + " " + n(baseline - p.points[i].y) }
                switch p.type {
                case .moveToPoint: d += "M" + xy(0)
                case .addLineToPoint: d += "L" + xy(0)
                case .addQuadCurveToPoint: d += "Q" + xy(0) + " " + xy(1)
                case .addCurveToPoint: d += "C" + xy(0) + " " + xy(1) + " " + xy(2)
                case .closeSubpath: d += "Z"
                @unknown default: break
                }
            }
            paths += "<path fill=\"\(color)\" d=\"\(d)\"/>"
        }
        var g = glyph
        var advance = CGSize.zero
        CTFontGetAdvancesForGlyphs(font, .horizontal, &g, &advance, 1)
        cursor += advance.width
    }
    return paths
}
let iconRaw = try String(contentsOfFile: root + "/build/icons/icon-master.svg", encoding: .utf8)
let iconContent: String = {
    guard let start = iconRaw.firstIndex(of: ">"), let end = iconRaw.range(of: "</svg>", options: .backwards) else { return iconRaw }
    return String(iconRaw[iconRaw.index(after: start)..<end.lowerBound])
}()

func measure(_ text: String, _ size: CGFloat) -> CGFloat {
    var cursor: CGFloat = 0
    for scalar in text.utf16 {
        var ch = scalar
        var found: (CTFont, CGGlyph)?
        for descriptor in descriptors {
            let f = CTFontCreateWithFontDescriptor(descriptor, size, nil)
            var glyph: CGGlyph = 0
            if CTFontGetGlyphsForCharacters(f, &ch, &glyph, 1) && glyph != 0 { found = (f, glyph); break }
        }
        guard let (font, glyph) = found else { continue }
        var g = glyph
        var advance = CGSize.zero
        CTFontGetAdvancesForGlyphs(font, .horizontal, &g, &advance, 1)
        cursor += advance.width
    }
    return cursor
}

for theme in ["day", "night"] {
    let colors = payload[theme] as! [String: String]
    for social in [false, true] {
        let height = social ? 640 : 320
        let base: CGFloat = social ? 300 : 145
        let paper = colors["paper"]!, ink = colors["ink"]!, secondary = colors["ink-2"]!, red = colors["cinnabar"]!
        if social {
            // 社交卡只保留官方图标与应用名：图标在上，AidoChat 居中在下，不加标语和装饰。
            let iconSize: CGFloat = 240
            let iconX = (1280 - iconSize) / 2
            let iconY: CGFloat = 125
            let fontSize: CGFloat = 84
            let label = "AidoChat"
            let textX = (1280 - measure(label, fontSize)) / 2
            let baseline = iconY + iconSize + 92
            let iconScale = String(format: "%.6f", Double(iconSize / 1254))
            var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1280\" height=\"640\" viewBox=\"0 0 1280 640\" role=\"img\" aria-label=\"AidoChat\">"
            svg += "<defs><clipPath id=\"app-icon\"><rect x=\"\(n(iconX))\" y=\"\(n(iconY))\" width=\"\(n(iconSize))\" height=\"\(n(iconSize))\" rx=\"38\"/></clipPath></defs>"
            svg += "<rect width=\"1280\" height=\"640\" fill=\"\(paper)\"/>"
            svg += "<g clip-path=\"url(#app-icon)\"><g transform=\"translate(\(n(iconX)) \(n(iconY))) scale(\(iconScale))\">\(iconContent)</g></g>"
            svg += outline(label, textX, baseline, fontSize, ink)
            svg += "</svg>"
            try svg.write(toFile: output + "/social-\(theme).svg", atomically: true, encoding: .utf8)
        } else {
            var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1280\" height=\"\(height)\" viewBox=\"0 0 1280 \(height)\" role=\"img\" aria-label=\"AidoChat — 把 AI 拉进群，把决定留在案头\"><rect width=\"1280\" height=\"\(height)\" fill=\"\(paper)\"/>"
            // 唯一朱印代表用户自己；不把朱色用作品牌装饰。
            let sy = base - 66
            svg += "<rect x=\"96\" y=\"\(n(sy))\" width=\"76\" height=\"76\" rx=\"4\" fill=\"\(paper)\" stroke=\"\(red)\" stroke-width=\"2\"/>"
            svg += outline("我", 106, sy + 61, 56, red)
            svg += outline("AidoChat", 208, base, 68, ink)
            svg += outline("把 AI 拉进群，把决定留在案头。", 210, base + 63, 28, secondary)
            svg += "</svg>"
            try svg.write(toFile: output + "/banner-\(theme).svg", atomically: true, encoding: .utf8)
        }
    }
}
// README 仅保留这三个本地徽章；文字同样转为轮廓，避免网络与字体依赖。
let dayColors = payload["day"] as! [String: String]
let version = payload["version"] as! String
for (name, label, width) in [("version", "v" + version, 84), ("license", "Apache-2.0", 112), ("platforms", "macOS · Windows · Linux", 208)] {
    let paper = dayColors["paper"]!, rule = dayColors["rule"]!, ink = dayColors["ink-2"]!
    var badge = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"\(width)\" height=\"28\" viewBox=\"0 0 \(width) 28\" role=\"img\" aria-label=\"\(label)\"><rect x=\"0.5\" y=\"0.5\" width=\"\(width - 1)\" height=\"27\" rx=\"4\" fill=\"\(paper)\" stroke=\"\(rule)\"/>"
    badge += outline(label, 10, 19, 13, ink) + "</svg>"
    try badge.write(toFile: output + "/badge-" + name + ".svg", atomically: true, encoding: .utf8)
}
