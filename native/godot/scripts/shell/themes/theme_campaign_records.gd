extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const GROUND := Color("#25221d")
const PANEL := Color("#302c25")
const INK := Color("#30271d")
const PAPER := Color("#e9ddc5")
const SOFT := Color("#c9bca6")
const LINE := Color("#64533a")
const ACCENT := Color("#dfad69")
const RED := Color("#9d4a40")
const GREEN := Color("#638467")
const SERIF := "Georgia, 'Times New Roman', serif"
const VIEW := Vector2(720, 210)


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func chrome() -> Dictionary:
	return {
		"button": {"bg": ACCENT, "border": ACCENT, "radius": 2.0, "ink": INK, "font": SERIF, "weight": 800},
		"arrow": {"bg": PANEL, "border": LINE, "radius": 2.0, "ink": ACCENT},
		"dot": {"on": ACCENT, "off": LINE, "radius": 1.0},
		"skip": {"ink": SOFT, "font": SERIF},
	}


static func lines(s: Scene, parent: Scene.Shape, x: float, y: float, width := 140.0, count := 5) -> void:
	for index in range(count):
		s.line(parent, x, y + index * 12, x + width - (index % 3) * 19, y + index * 12, {"stroke": INK, "opacity": 0.45, "width": 2.0})


static func drawn(props: Dictionary, length: float, duration: float, delay: float, still: bool) -> Dictionary:
	if still:
		return props
	var out := props.duplicate()
	out["dash"] = [length]
	out["anims"] = [Scene.motion("ohUpdDraw", duration, delay, "cubic-bezier(0.2, 0.7, 0.2, 1)", {"length": length})]
	return out


static func illustration(scene: String, still: bool) -> Scene:
	var s := Scene.new(Rect2(Vector2.ZERO, VIEW), "meet", still)
	s.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var root: Scene.Shape = s.root
	s.rect(root, 0, 0, VIEW.x, VIEW.y, {"fill": PANEL})
	s.rect(root, 12, 12, 696, 186, {"fill": null, "stroke": LINE, "width": 1.0})
	for index in range(28):
		s.line(root, 20 + index * 25, 20, 20 + index * 25, 190, {"stroke": LINE, "opacity": 0.22, "width": 1.0})
	match scene:
		"history":
			s.path(root, "M93 45 Q223 20 360 54 Q493 20 627 45 V174 Q490 150 360 183 Q222 150 93 174 Z", {"fill": PAPER, "stroke": ACCENT, "width": 3.0})
			s.path(root, "M360 54 V183", {"fill": null, "stroke": INK, "width": 3.0})
			lines(s, root, 124, 76, 193, 7)
			lines(s, root, 389, 76, 185, 7)
			s.path(root, "M543 42 V111 L556 101 L569 111 V40", {"fill": RED} if still else {"fill": RED, "anims": [Scene.motion("ohUpdFade", 900.0, 200.0)]})
			s.circle(root, 360, 161, 8, {"fill": ACCENT, "stroke": INK, "width": 1.0})
		"speech":
			s.rect(root, 100, 35, 256, 142, {"fill": PAPER, "stroke": ACCENT, "width": 2.0, "rx": 2})
			lines(s, root, 125, 61, 182, 6)
			s.circle(root, 308, 151, 17, {"fill": RED})
			s.path(root, "M295 151 L305 161 L320 141", {"fill": null, "stroke": PAPER, "width": 3.0})
			s.path(root, "M356 105 H452 M440 94 L452 105 L440 116", drawn({"fill": null, "stroke": ACCENT, "width": 3.0}, 150.0, 900.0, 200.0, still))
			for index in range(3):
				var person := s.group(root, {"transform": Transform2D(0.0, Vector2(490 + index * 55, 105))})
				s.circle(person, 0, -24, 15, {"fill": SOFT})
				s.path(person, "M-20 23 V7 Q0 -17 20 7 V23 Z", {"fill": ACCENT})
		"finance":
			s.rect(root, 74, 33, 294, 144, {"fill": PAPER, "stroke": ACCENT, "width": 2.0})
			for index in range(5):
				s.path(root, "M92 %d H350" % (57 + index * 23), {"fill": null, "stroke": INK, "opacity": 0.35, "width": 1.0})
			s.path(root, "M220 40 V170 M294 40 V170", {"fill": null, "stroke": INK, "opacity": 0.35, "width": 1.0})
			lines(s, root, 102, 66, 95, 7)
			s.path(root, "M384 106 H443 M431 95 L443 106 L431 117", {"fill": null, "stroke": ACCENT, "width": 3.0})
			var bars := s.group(root, {} if still else {"anims": [Scene.motion("ohUpdRise", 650.0, 250.0)]})
			s.path(bars, "M474 166 V95 H517 V166 M524 166 V57 H568 V166 M575 166 V115 H620 V166", {"fill": GREEN, "stroke": ACCENT, "width": 2.0})
			s.path(bars, "M459 166 H639", {"fill": null, "stroke": PAPER, "width": 3.0})
			s.circle(bars, 545, 38, 16, {"fill": ACCENT, "stroke": INK, "width": 1.0})
		"scenario":
			var boxes := [[80, 62], [80, 143], [317, 102], [552, 60], [552, 144]]
			for index in range(boxes.size()):
				var x: float = boxes[index][0]
				var y: float = boxes[index][1]
				s.rect(root, x, y - 21, 88, 42, {"fill": ACCENT if index == 2 else PAPER, "stroke": LINE, "width": 2.0, "rx": 2})
				lines(s, root, x + 10, y - 6, 66, 2)
			s.path(root, "M168 62 H245 V102 H317 M168 143 H245 V102 M405 102 H478 V60 H552 M478 102 V144 H552", drawn({"fill": null, "stroke": ACCENT, "width": 3.0}, 750.0, 1100.0, 200.0, still))
	return s


class Picture extends Control:
	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		resized.connect(_follow)

	func _follow() -> void:
		var tall := roundf(size.x * VIEW.y / VIEW.x)
		if absf(custom_minimum_size.y - tall) > 0.5:
			custom_minimum_size = Vector2(0.0, tall)


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var width: float = ctx.get("width", 1440.0)
	var narrow: bool = width < 600.0
	var plate := UpdateKit.plate({"background": GROUND, "border": LINE, "radius": 4.0}, still)
	UpdateKit.brackets(plate, ACCENT, px(0.6), px(1.3), 2.0)
	var body := UpdateKit.vbox(0)
	var top := UpdateKit.hbox(10)
	var brand := UpdateKit.text("Open Historia", px(0.78), ACCENT, SERIF)
	top.add_child(brand)
	var dated := UpdateKit.text(str(update.get("dateText", "")), px(0.78), ACCENT, SERIF)
	dated.size_flags_horizontal = Control.SIZE_SHRINK_END
	dated.autowrap_mode = TextServer.AUTOWRAP_OFF
	dated.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	top.add_child(dated)
	body.add_child(UpdateKit.reveal(top, 80.0, still))
	body.add_child(UpdateKit.rule(ACCENT, null, Vector2(px(0.7), px(0.7))))
	var head := UpdateKit.vbox(0)
	head.add_child(UpdateKit.gap(px(0.35)))
	var size_px := ShellFonts.clamp_vw(1.7, 7.0, 2.3, width) if narrow else ShellFonts.clamp_vw(2.0, 4.0, 3.0, width)
	head.add_child(UpdateKit.para(str(banner.get("title", "")), size_px, PAPER, SERIF, 700, false, 1.1))
	head.add_child(UpdateKit.gap(px(0.35)))
	if not str(banner.get("subtitle", "")).is_empty():
		head.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(0.69), ACCENT, UpdateKit.BASE_FONT, 400, false, 0.13))
	head.add_child(UpdateKit.gap(px(0.8)))
	body.add_child(UpdateKit.reveal(head, 130.0, still))
	var picture := Picture.new()
	var framed := PanelContainer.new()
	framed.mouse_filter = Control.MOUSE_FILTER_IGNORE
	framed.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	framed.add_theme_stylebox_override("panel", UpdateKit.box(PANEL, LINE, 0.0, 1, Vector4(1, 1, 1, 1)))
	picture.add_child(illustration(str(banner.get("scene", "history")), still))
	framed.add_child(picture)
	body.add_child(framed)
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.85)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(1.0), SOFT, SERIF, 400, false, 1.45), 230.0, still))
		body.add_child(UpdateKit.gap(px(0.85)))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), ACCENT, SOFT, {"background": PANEL, "border": LINE, "radius": 2.0}, SERIF, false, 300.0, still, 100.0, 1 if narrow else 2))
	if narrow:
		plate.add_child(UpdateKit.margins(body, px(1.1), px(1.1), px(1.1), px(1.1)))
	else:
		plate.add_child(UpdateKit.margins(body, px(2.0), px(1.6), px(2.0), px(1.6)))
	return UpdateKit.plate_reveal(plate, still)
