extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const ROOM := Color("#141311")
const WALL := Color("#1d1b18")
const INK := Color("#0b0a09")
const LAMP := Color("#e2a63b")
const PAPER := Color("#ebe5d6")
const PAPER_SOFT := Color(235 / 255.0, 229 / 255.0, 214 / 255.0, 0.74)
const RULE := Color(235 / 255.0, 229 / 255.0, 214 / 255.0, 0.16)
const STAMP := Color("#b8312f")
const FACE := "\"Courier New\", Courier, \"Lucida Console\", monospace"
const SWAY := "cubic-bezier(0.45, 0, 0.55, 1)"
const PULSE := "cubic-bezier(0.4, 0, 0.6, 1)"
const UNKNOWN := "#45423b"
const RELATION := {"self": "#f6f1e3", "crackdown": "#3a0a0e", "alliance": "#1d4f91", "nonAggression": "#3f7f7a", "trade": "#d6c48a", "friendly": "#82aac0", "cordial": "#bcd4e2", "neutral": "#bdb49c", "strained": "#d7965a"}
const STAMPS := [
	{"x": 470, "y": 46, "tilt": -8, "colour": "#3f7f7a", "mark": "M-10 0 L10 0 M0 -10 L0 10"},
	{"x": 600, "y": 70, "tilt": 6, "colour": "#e2a63b", "mark": "M-9 -7 A9 9 0 1 0 -9 7 M-12 -2 L4 -2 M-12 3 L4 3"},
	{"x": 520, "y": 150, "tilt": -4, "colour": "#82aac0", "mark": "M-10 6 L0 -9 L10 6 Z"},
	{"x": 660, "y": 168, "tilt": 9, "colour": "#b8312f", "mark": "M-10 -10 L10 10 M10 -10 L-10 10"},
]
const LAND := {
	"a": "40,40 230,28 260,110 180,150 60,130",
	"b": "230,28 430,36 450,120 260,110",
	"c": "260,110 450,120 470,200 280,220 180,150",
	"d": "60,130 180,150 280,220 230,236 40,226",
	"e": "430,36 640,30 660,130 450,120",
	"f": "450,120 660,130 690,214 470,200",
	"g": "640,30 770,46 776,170 660,130",
	"h": "660,130 776,170 760,230 690,214",
}
const LAND_FILL := {"a": "#d6c48a", "b": "#bcd4e2", "c": "#f6f1e3", "d": "#bdb49c", "e": "#d7965a", "f": UNKNOWN, "g": "#1d4f91", "h": UNKNOWN}
const AREAS := [
	{"points": "300,150 380,138 420,178 350,206 292,190", "colour": "#3a0a0e", "delay": 900.0},
	{"points": "150,60 214,54 228,98 170,112 138,90", "colour": "#3f7f7a", "delay": 1300.0},
	{"points": "520,60 600,58 618,104 540,112", "colour": "#82aac0", "delay": 1700.0},
]


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func chrome() -> Dictionary:
	return {
		"button": {"bg": LAMP, "border": LAMP, "radius": 2.0, "ink": INK, "font": FACE, "weight": 700, "spacing": 0.08, "caps": true},
		"arrow": {"bg": Color(226 / 255.0, 166 / 255.0, 59 / 255.0, 0.08), "border": LAMP, "radius": 2.0, "ink": LAMP},
		"dot": {"on": LAMP, "off": Color(235 / 255.0, 229 / 255.0, 214 / 255.0, 0.24), "radius": 0.0},
		"skip": {"ink": PAPER_SOFT, "font": FACE, "spacing": 0.06},
	}


static func with(base: Dictionary, extra: Dictionary) -> Dictionary:
	var merged := base.duplicate()
	for key in extra.keys():
		merged[key] = extra[key]
	return merged


static func moving(still: bool, anims: Array) -> Dictionary:
	return {} if still else {"anims": anims}


static func polygon(text: String) -> String:
	var data := ""
	var at := 0
	for pair in text.split(" ", false):
		var parts := pair.split(",")
		data += ("M" if at == 0 else " L") + "%s %s" % [parts[0], parts[1]]
		at += 1
	return data + " Z"


static func turned(x: float, y: float, degrees: float) -> Transform2D:
	return Transform2D(0.0, Vector2(x, y)) * Transform2D(deg_to_rad(degrees), Vector2.ZERO) * Transform2D(0.0, Vector2(-x, -y))


static func lamp(s: Scene, parent: Scene.Shape, x: float, still: bool) -> void:
	var hung := s.group(parent, {"transform": Transform2D(0.0, Vector2(x, 0))})
	var swing := s.group(hung, with({"origin": {"kind": "view", "at": Vector2.ZERO}}, moving(still, [Scene.forever("ohUpdSway", 5200.0, 0.0, SWAY)])))
	s.line(swing, 0, 0, 0, 54, {"stroke": INK, "width": 2.0})
	s.path(swing, polygon("-26,78 26,78 12,54 -12,54"), {"fill": INK})
	s.circle(swing, 0, 80, 7, with({"fill": LAMP}, moving(still, [Scene.forever("ohUpdPulse", 3100.0, 300.0, PULSE)])))


static func bubble(s: Scene, parent: Scene.Shape, x: float, y: float, width: float, flip: bool, colour: Color, delay: float, still: bool, lines := 3) -> void:
	var holder := s.group(parent, moving(still, [Scene.motion("ohUpdFade", 600.0, delay)]))
	var tall := lines * 12.0 + 16.0
	s.rect(holder, x, y, width, tall, {"fill": PAPER, "rx": 6})
	var tail := "%s,%s %s,%s %s,%s" % [x + width - 22, y + tall, x + width - 6, y + tall + 14, x + width - 38, y + tall] if flip else "%s,%s %s,%s %s,%s" % [x + 22, y + tall, x + 6, y + tall + 14, x + 38, y + tall]
	s.path(holder, polygon(tail), {"fill": PAPER})
	for at in range(lines):
		var cut := 34.0 if at == lines - 1 else float((at * 13) % 26)
		s.rect(holder, x + 14, y + 12 + at * 12, width - 28 - cut, 5, {"fill": colour, "opacity": 0.75, "rx": 2})


static func typing(s: Scene, parent: Scene.Shape, x: float, y: float, still: bool, delay: float) -> void:
	var holder := s.group(parent, moving(still, [Scene.motion("ohUpdFade", 400.0, delay)]))
	s.rect(holder, x, y, 46, 20, {"fill": WALL, "rx": 10, "stroke": RULE, "width": 1.0})
	for at in range(3):
		s.circle(holder, x + 12 + at * 11, y + 10, 3, with({"fill": PAPER_SOFT}, moving(still, [Scene.forever("ohUpdTwinkle", 1200.0, at * 200.0)])))


static func seal(s: Scene, parent: Scene.Shape, x: float, y: float) -> void:
	var holder := s.group(parent, {"transform": Transform2D(0.0, Vector2(x, y))})
	s.circle(holder, 0, 0, 21, {"fill": INK, "stroke": LAMP, "width": 2.0})
	s.path(holder, "M0 -11 L3.2 -3.5 L11 -3.3 L4.8 1.6 L7 9.3 L0 4.8 L-7 9.3 L-4.8 1.6 L-11 -3.3 L-3.2 -3.5 Z", {"fill": LAMP})


static func banner_flag(s: Scene, parent: Scene.Shape, x: float, y: float, colour: String) -> void:
	var holder := s.group(parent, {"transform": Transform2D(0.0, Vector2(x, y))})
	s.rect(holder, -21, -14, 42, 28, {"fill": colour})
	s.path(holder, polygon("-21,7 21,-7 21,0 -21,14"), {"fill": INK, "opacity": 0.55})
	s.rect(holder, -21, -14, 42, 28, {"fill": null, "stroke": INK, "width": 1.5})


static func talk(s: Scene, root: Scene.Shape, still: bool) -> void:
	s.rect(root, 0, 0, 800, 240, {"fill": WALL})
	for at in range(6):
		s.line(root, 0, at * 34 + 20, 800, at * 34 + 20, {"stroke": RULE, "width": 1.0})
	var pool := s.group(root, {"opacity": 0.16})
	s.ellipse(pool, 400, 206, 250, 34, with({"fill": LAMP}, moving(still, [Scene.forever("ohUpdPulse", 3100.0, 300.0, PULSE)])))
	s.path(root, polygon("130,240 670,240 610,196 190,196"), {"fill": INK})
	s.rect(root, 355, 198, 90, 22, {"fill": PAPER, "opacity": 0.85, "transform": turned(400, 206, -4)})
	s.line(root, 368, 206, 430, 212, {"stroke": STAMP, "width": 2.0, "dash": [5.0, 4.0]})
	lamp(s, root, 400, still)
	seal(s, root, 96, 70)
	bubble(s, root, 128, 40, 190, false, INK, 500.0, still)
	banner_flag(s, root, 704, 112, "#e11d48")
	bubble(s, root, 462, 84, 210, true, STAMP, 1500.0, still, 2)
	typing(s, root, 150, 128, still, 2300.0)


static func deals(s: Scene, root: Scene.Shape, still: bool) -> void:
	s.rect(root, 0, 0, 800, 240, {"fill": ROOM})
	s.ellipse(root, 560, 120, 300, 120, {"fill": LAMP, "opacity": 0.09})
	var dossier := s.group(root, with({"transform": turned(560, 120, -2)}, moving(still, [Scene.motion("ohUpdFade", 700.0, 200.0)])))
	s.rect(dossier, 400, 13, 320, 214, {"fill": PAPER})
	for at in range(11):
		s.rect(dossier, 428, 34 + at * 17, 170 if at % 3 == 2 else 260, 4, {"fill": INK, "opacity": 0.28})
	s.rect(dossier, 560, 20, 120, 12, {"fill": INK, "opacity": 0.8})
	for at in range(STAMPS.size()):
		var stamp: Dictionary = STAMPS[at]
		var placed := s.group(root, {"transform": Transform2D(0.0, Vector2(float(stamp["x"]), float(stamp["y"])))})
		var hit := s.group(placed, with({"origin": {"kind": "view", "at": Vector2.ZERO}}, moving(still, [Scene.motion("ohUpdStamp", 520.0, 800.0 + at * 520.0)])))
		var tilt := Transform2D(deg_to_rad(float(stamp["tilt"])), Vector2.ZERO)
		var tilted := s.group(hit, {"transform": tilt})
		s.rect(tilted, -35, -22, 70, 44, {"fill": null, "rx": 4, "stroke": stamp["colour"], "width": 3.0})
		s.rect(tilted, -35, -22, 70, 44, {"fill": stamp["colour"], "opacity": 0.14, "rx": 4})
		s.path(tilted, str(stamp["mark"]), {"fill": null, "stroke": stamp["colour"], "cap": "round", "width": 3.0})
	var pen := s.group(root, with({"transform": turned(300, 170, 24)}, moving(still, [Scene.motion("ohUpdFade", 600.0, 2900.0)])))
	s.rect(pen, 225, 166, 150, 8, {"fill": INK, "rx": 4})
	s.rect(pen, 345, 166, 18, 8, {"fill": LAMP})
	lamp(s, root, 160, still)


static func chart(s: Scene, root: Scene.Shape, still: bool) -> void:
	s.rect(root, 0, 0, 800, 240, {"fill": "#16222c"})
	var ids := LAND.keys()
	for at in range(ids.size()):
		var id: String = ids[at]
		s.path(root, polygon(LAND[id]), with({"fill": LAND_FILL[id], "opacity": 0.9, "stroke": INK, "join": "round", "width": 2.2}, moving(still, [Scene.motion("ohUpdFade", 700.0, 150.0 + at * 70.0)])))
	for area in AREAS:
		var shape := polygon(str(area["points"]))
		var delay: float = area["delay"]
		s.path(root, shape, with({"fill": area["colour"], "opacity": 0.55}, moving(still, [Scene.motion("ohUpdFade", 700.0, delay)])))
		var outline := {"fill": null, "stroke": area["colour"], "join": "round", "width": 3.2}
		if not still:
			outline["dash"] = [420.0]
			outline["anims"] = [Scene.motion("ohUpdDraw", 1500.0, delay, "cubic-bezier(0.2, 0.7, 0.2, 1)", {"length": 420.0})]
		s.path(root, shape, outline)
		s.path(root, shape, with({"fill": null, "stroke": PAPER, "stroke_opacity": 0.5, "join": "round", "width": 1.0}, moving(still, [Scene.forever("ohUpdPulse", 2600.0, delay)])))
	var card := s.group(root, {"transform": Transform2D(0.0, Vector2(18, 150))})
	var fade := s.group(card, moving(still, [Scene.motion("ohUpdFade", 700.0, 2100.0)]))
	s.rect(fade, 0, 0, 74, 72, {"fill": INK, "opacity": 0.92, "rx": 3, "stroke": LAMP, "stroke_opacity": 0.6, "width": 1.0})
	s.rect(fade, 8, 9, 34, 3, {"fill": LAMP, "opacity": 0.8})
	for at in range(AREAS.size()):
		var row := s.group(fade, {"transform": Transform2D(0.0, Vector2(8, 20 + at * 16))})
		s.rect(row, 0, 0, 10, 10, {"fill": AREAS[at]["colour"], "fill_opacity": 0.5, "stroke": AREAS[at]["colour"], "width": 2.0})
		s.rect(row, 16, 4, 40, 2, {"fill": PAPER_SOFT, "opacity": 0.5})


static func picture(scene: String, still: bool) -> Scene:
	var s := Scene.new(Rect2(0, 0, 800, 240), "slice", still)
	s.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	s.set_meta("back_channels_scene", scene if scene in ["talk", "deals", "map"] else "talk")
	match scene:
		"deals":
			deals(s, s.root, still)
		"map":
			chart(s, s.root, still)
		_:
			talk(s, s.root, still)
	return s


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var narrow: bool = ctx.get("narrow", false)
	var width: float = ctx.get("width", 1440.0)
	var plate := UpdateKit.plate({"background": ROOM, "border": RULE, "radius": 2.0}, still)
	UpdateKit.brackets(plate, LAMP, px(0.7), px(1.6), 1.5)
	var column := UpdateKit.vbox(0)
	var holder := UpdateKit.frame(px(10.5) if narrow else ShellFonts.clamp_vw(12.0, 25.0, 16.0, width), 2.0, LAMP)
	holder.add_child(picture(str(banner.get("scene", "talk")), still))
	column.add_child(UpdateKit.reveal(holder, 150.0, still))
	var body := UpdateKit.vbox(0)
	var head := UpdateKit.vbox(0)
	head.add_child(UpdateKit.text(UpdateKit.major_line(update), px(0.8), LAMP, FACE, 400, false, 0.22, true))
	head.add_child(UpdateKit.gap(px(0.25)))
	var title := UpdateKit.para(str(banner.get("title", "")), px(1.9) if narrow else ShellFonts.clamp_vw(2.1, 5.2, 3.0, width), PAPER, FACE, 700, false, 1.05, 0.02)
	head.add_child(UpdateKit.reveal(title, 380.0, still, "ohUpdFade", 500.0))
	if not str(banner.get("subtitle", "")).is_empty():
		head.add_child(UpdateKit.gap(px(0.35)))
		head.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(1.0), LAMP, FACE, 400))
	body.add_child(UpdateKit.reveal(head, 300.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.9)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(1.0), PAPER_SOFT, UpdateKit.BASE_FONT, 400, false, 1.6), 420.0, still))
	body.add_child(UpdateKit.rule(LAMP, UpdateKit.icon_rect("people", 18, LAMP)))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), LAMP, PAPER_SOFT, {"background": Color(235 / 255.0, 229 / 255.0, 214 / 255.0, 0.04), "border": RULE, "radius": 2.0}, FACE, true, 520.0, still))
	if narrow:
		column.add_child(UpdateKit.margins(body, px(1.1), px(1.2), px(1.1), px(1.3)))
	else:
		column.add_child(UpdateKit.margins(body, px(2.0), px(1.5), px(2.0), px(1.7)))
	plate.add_child(column)
	return UpdateKit.plate_reveal(plate, still)
