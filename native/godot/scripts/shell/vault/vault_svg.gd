extends RefCounted

const WALL := "#202327"
const PLATE := "#2b2f35"
const DOOR := "#343941"
const RING := "#40464f"
const EDGE := "#15171a"
const LIGHT := "#5b626c"
const BOLT := "#7b838d"
const LIT := "#d5dce6"
const WALL_COLUMNS := [0, 200, 400, 600, 800, 1000, 1200, 1400]
const WALL_ROWS := [0, 250, 500, 750]


static func num(value: float) -> String:
	return String.num(value, 3)


static func arc(cx: float, cy: float, r: float, from: float, to: float) -> String:
	var x1 := cx + cos(deg_to_rad(from)) * r
	var y1 := cy + sin(deg_to_rad(from)) * r
	var x2 := cx + cos(deg_to_rad(to)) * r
	var y2 := cy + sin(deg_to_rad(to)) * r
	return "M %.2f %.2f A %s %s 0 %d 1 %.2f %.2f" % [x1, y1, num(r), num(r), 1 if to - from > 180.0 else 0, x2, y2]


static func bevel(cx: float, cy: float, r: float, width: float, raised := true) -> String:
	var first := "<path d=\"%s\" stroke=\"%s\" opacity=\"%s\"/>" % [arc(cx, cy, r, 150.0, 300.0), LIT if raised else "#000", "0.34" if raised else "0.42"]
	var second := "<path d=\"%s\" stroke=\"%s\" opacity=\"%s\"/>" % [arc(cx, cy, r, 330.0, 480.0), "#000" if raised else LIT, "0.42" if raised else "0.26"]
	return "<g fill=\"none\" stroke-width=\"%s\" stroke-linecap=\"round\">%s%s</g>" % [num(width), first, second]


static func circle(cx: float, cy: float, r: float, fill: String, extra := "") -> String:
	return "<circle cx=\"%s\" cy=\"%s\" r=\"%s\" fill=\"%s\"%s/>" % [num(cx), num(cy), num(r), fill, extra]


static func bolt(x: float, y: float, r := 9.0) -> String:
	var parts: PackedStringArray = []
	parts.append(circle(x + r * 0.3, y + r * 0.45, r * 1.45, "#000", " opacity=\"0.35\""))
	parts.append(circle(x, y, r * 1.45, EDGE))
	parts.append(circle(x, y, r, BOLT))
	parts.append(circle(x + r * 0.2, y + r * 0.25, r * 0.72, "#000", " opacity=\"0.22\""))
	parts.append(circle(x - r * 0.3, y - r * 0.32, r * 0.3, LIT, " opacity=\"0.7\""))
	return "<g>%s</g>" % "".join(parts)


static func wall(width: float, height: float) -> String:
	var scale := maxf(width / 1600.0, height / 1000.0)
	var ox := (width - 1600.0 * scale) / 2.0
	var oy := (height - 1000.0 * scale) / 2.0
	var parts: PackedStringArray = []
	for x in WALL_COLUMNS:
		parts.append("<g><rect x=\"%d\" y=\"0\" width=\"3\" height=\"1000\" fill=\"%s\"/><rect x=\"%d\" y=\"0\" width=\"1.5\" height=\"1000\" fill=\"%s\" opacity=\"0.1\"/></g>" % [int(x), EDGE, int(x) + 3, LIT])
	for y in WALL_ROWS:
		parts.append("<g><rect x=\"0\" y=\"%d\" width=\"1600\" height=\"3\" fill=\"%s\"/><rect x=\"0\" y=\"%d\" width=\"1600\" height=\"1.5\" fill=\"%s\" opacity=\"0.1\"/></g>" % [int(y), EDGE, int(y) + 3, LIT])
	for x in WALL_COLUMNS:
		for y in WALL_ROWS:
			for corner in [[int(x) + 18, int(y) + 20], [int(x) + 186, int(y) + 20], [int(x) + 18, int(y) + 234], [int(x) + 186, int(y) + 234]]:
				var cx := float(corner[0])
				var cy := float(corner[1])
				parts.append("<g>%s%s%s</g>" % [circle(cx + 1.0, cy + 1.5, 4.5, "#000", " opacity=\"0.4\""), circle(cx, cy, 3.5, RING), circle(cx - 1.0, cy - 1.0, 1.1, LIT, " opacity=\"0.55\"")])
	return "<g transform=\"translate(%s %s) scale(%s)\">%s</g>" % [num(ox), num(oy), String.num(scale, 6), "".join(parts)]


static func door_under(width: float, height: float, disc_uri: String) -> String:
	var parts: PackedStringArray = []
	parts.append(circle(807.0, 512.0, 447.0, "#000", " opacity=\"0.45\""))
	parts.append(circle(800.0, 500.0, 440.0, EDGE))
	if disc_uri.is_empty():
		parts.append(circle(800.0, 500.0, 428.0, PLATE))
		parts.append(circle(800.0, 500.0, 362.0, DOOR))
		parts.append(circle(800.0, 500.0, 290.0, PLATE))
	else:
		parts.append("<clipPath id=\"oh-vault-face\"><circle cx=\"800\" cy=\"500\" r=\"428\"/></clipPath>")
		parts.append("<image href=\"%s\" x=\"372\" y=\"72\" width=\"856\" height=\"856\" clip-path=\"url(#oh-vault-face)\" preserveAspectRatio=\"none\"/>" % disc_uri)
		parts.append("<circle cx=\"800\" cy=\"500\" r=\"395\" fill=\"none\" stroke=\"#000\" stroke-width=\"66\" opacity=\"0.34\"/>")
		parts.append(circle(800.0, 500.0, 290.0, "#000", " opacity=\"0.26\""))
	return _door_group(width, height, "".join(parts))


static func door_over(width: float, height: float) -> String:
	var parts: PackedStringArray = []
	parts.append(bevel(800.0, 500.0, 425.0, 4.0, false))
	parts.append("<circle cx=\"800\" cy=\"500\" r=\"362\" fill=\"none\" stroke=\"%s\" stroke-width=\"6\"/>" % EDGE)
	parts.append(bevel(800.0, 500.0, 357.0, 4.0))
	parts.append("<circle cx=\"800\" cy=\"500\" r=\"290\" fill=\"none\" stroke=\"%s\" stroke-width=\"6\"/>" % EDGE)
	parts.append(bevel(800.0, 500.0, 285.0, 3.5, false))
	for index in range(28):
		var angle := float(index) / 28.0 * TAU
		parts.append(bolt(800.0 + cos(angle) * 395.0, 500.0 + sin(angle) * 395.0))
	for index in range(12):
		var angle := float(index) / 12.0 * TAU + PI / 12.0
		parts.append(bolt(800.0 + cos(angle) * 326.0, 500.0 + sin(angle) * 326.0, 5.5))
	return _door_group(width, height, "".join(parts))


static func _door_group(width: float, height: float, inner: String) -> String:
	var side := minf(width, height)
	var k := side / 1000.0
	var dx := width / 2.0 - side / 2.0
	var dy := height / 2.0 - side / 2.0
	return "<g transform=\"translate(%s %s) scale(%s) translate(-300 0)\">%s</g>" % [num(dx), num(dy), String.num(k, 6), inner]


static func face(width: int, height: int, disc_uri: String) -> String:
	return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"%d\" height=\"%d\" viewBox=\"0 0 %d %d\">%s%s%s</svg>" % [width, height, width, height, wall(width, height), door_under(width, height, disc_uri), door_over(width, height)]


static func wheel(size: int, disc_uri: String, logo_uri: String) -> String:
	var parts: PackedStringArray = []
	for turn in [0, 120, 240]:
		parts.append("<g transform=\"rotate(%d)\"><rect x=\"-9\" y=\"-138\" width=\"18\" height=\"36\" rx=\"6\" fill=\"%s\" stroke=\"%s\" stroke-width=\"3\"/><rect x=\"-5.5\" y=\"-130\" width=\"3\" height=\"16\" rx=\"1.5\" fill=\"%s\" opacity=\"0.45\"/><circle cy=\"-136\" r=\"12\" fill=\"%s\" stroke=\"%s\" stroke-width=\"3\"/><circle cx=\"-3.2\" cy=\"-139.4\" r=\"3.4\" fill=\"%s\" opacity=\"0.6\"/></g>" % [int(turn), LIGHT, EDGE, LIT, BOLT, EDGE, LIT])
	parts.append("<circle r=\"118\" fill=\"%s\"/>" % EDGE)
	if disc_uri.is_empty():
		parts.append("<circle r=\"112\" fill=\"%s\"/>" % RING)
	else:
		parts.append("<clipPath id=\"oh-vault-wheel\"><circle r=\"112\"/></clipPath>")
		parts.append("<image href=\"%s\" x=\"-112\" y=\"-112\" width=\"224\" height=\"224\" clip-path=\"url(#oh-vault-wheel)\" preserveAspectRatio=\"none\"/>" % disc_uri)
		parts.append("<circle r=\"112\" fill=\"%s\" opacity=\"0.1\"/>" % LIT)
	parts.append(bevel(0.0, 0.0, 110.0, 3.0))
	parts.append("<circle r=\"104\" fill=\"%s\"/>" % EDGE)
	if not logo_uri.is_empty():
		parts.append("<clipPath id=\"oh-vault-hub\"><circle r=\"100\"/></clipPath>")
		parts.append("<image href=\"%s\" x=\"-100\" y=\"-100\" width=\"200\" height=\"200\" clip-path=\"url(#oh-vault-hub)\" preserveAspectRatio=\"xMidYMid slice\"/>" % logo_uri)
	parts.append("<circle r=\"100\" fill=\"none\" stroke=\"%s\" stroke-width=\"3\"/>" % LIGHT)
	parts.append(bevel(0.0, 0.0, 102.5, 2.0, false))
	return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"%d\" height=\"%d\" viewBox=\"-150 -150 300 300\">%s</svg>" % [size, size, "".join(parts)]


static func wheel_shadow(size: int) -> String:
	var parts: PackedStringArray = ["<circle r=\"120\" fill=\"#000\"/>"]
	for turn in [0, 120, 240]:
		parts.append("<g transform=\"rotate(%d)\" fill=\"#000\"><rect x=\"-10.5\" y=\"-139.5\" width=\"21\" height=\"39\" rx=\"7\"/><circle cy=\"-136\" r=\"13.5\"/></g>" % int(turn))
	return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"%d\" height=\"%d\" viewBox=\"-150 -150 300 300\">%s</svg>" % [size, size, "".join(parts)]
