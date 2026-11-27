extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const DESK := Color("#151c1e")
const STAGE := Color("#1d292b")
const PAPER := Color("#e8dcc2")
const PAPER_SOFT := Color("#f4e9d3")
const INK := Color("#213332")
const BRASS := Color("#dfb775")
const MUTED := Color(244 / 255.0, 236 / 255.0, 217 / 255.0, 0.68)
const LINE := Color(223 / 255.0, 183 / 255.0, 117 / 255.0, 0.32)
const GREEN := Color("#47746a")
const WATER := Color("#9bb6b0")
const SERIF := "Georgia, 'Times New Roman', serif"
const MONO := "'Consolas', 'Courier New', monospace"
const SCENES := {
	"draft": {"number": "01 / 03", "kicker": "THE CARTOGRAPHER'S TABLE", "side": "A NEW WORKSHOP", "stamp": "SURVEY / EDIT / DRAW"},
	"polities": {"number": "02 / 03", "kicker": "THE POLITICAL ATLAS", "side": "NAMES & IDENTITIES", "stamp": "IDENTITY / GOVERNMENT"},
	"publish": {"number": "03 / 03", "kicker": "THE WORLD ARCHIVE", "side": "PRESERVE & CREATE", "stamp": "RECOVER / PUBLISH / PLAY"},
}
const BORDER_EDITED := "M270 60 L285 112 L335 133 L353 177 L336 238"
const BORDER_ORIGINAL := "M296 36 L296 111 L313 154 L303 235"


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func chrome() -> Dictionary:
	return {
		"button": {"bg": BRASS, "border": BRASS, "radius": 3.0, "ink": INK, "font": SERIF, "weight": 800, "spacing": 0.02},
		"arrow": {"bg": STAGE, "border": LINE, "radius": 3.0, "ink": BRASS},
		"dot": {"on": BRASS, "off": Color(223 / 255.0, 183 / 255.0, 117 / 255.0, 0.24), "radius": 1.0},
		"skip": {"ink": MUTED, "font": SERIF},
	}


static func at(x: float, y: float, scale := 1.0) -> Dictionary:
	return {"transform": Transform2D(0.0, Vector2(scale, scale), 0.0, Vector2(x, y))}


static func cartography(s: Scene, parent: Scene.Shape, edited: bool, still: bool) -> void:
	var g := s.group(parent)
	s.rect(g, 0, 0, 650, 250, {"fill": PAPER, "rx": 2})
	s.rect(g, 9, 9, 632, 232, {"fill": null, "stroke": Color("#aa9269"), "width": 1.5})
	for i in range(11):
		s.line(g, 36 + i * 57, 10, 36 + i * 57, 240, {"stroke": Color("#bba786"), "width": 0.75, "opacity": 0.44})
	for i in range(4):
		s.line(g, 11, 45 + i * 51, 639, 45 + i * 51, {"stroke": Color("#cbb997"), "width": 1.0, "opacity": 0.45})
	s.path(g, "M10 54 C71 23 103 24 158 43 C220 59 267 45 297 14 L638 14 L638 238 L10 238 Z", {"fill": Color("#a4bbb2"), "opacity": 0.85})
	s.path(g, "M16 168 L41 157 L59 110 L97 113 L136 73 L181 85 L211 51 L259 62 L293 34 L339 73 L381 57 L413 85 L457 79 L483 108 L516 116 L559 158 L603 147 L635 189 L635 238 L16 238 Z", {"fill": Color("#789c8e"), "stroke": Color("#304f49"), "width": 3.0})
	s.path(g, "M38 190 L103 151 L160 168 L198 119 L258 131 L292 95 L357 117 L384 171 L348 234 L38 234 Z", {"fill": Color("#a8ac7f"), "stroke": Color("#3f5847"), "width": 1.5})
	s.path(g, "M389 117 L451 98 L517 132 L566 175 L599 229 L409 231 L366 182 Z", {"fill": Color("#cdac77"), "stroke": Color("#586651"), "width": 1.5})
	s.path(g, "M90 130 L133 103 L153 129 L129 151 L89 151 Z M236 80 L278 75 L292 98 L266 114 L222 107 Z M458 137 L484 126 L513 157 L480 185 L447 168 Z", {"fill": Color("#5c8073")})
	var border := BORDER_EDITED if edited else BORDER_ORIGINAL
	s.path(g, border, {"fill": null, "stroke": Color("#f3e3c6"), "width": 4.5})
	s.path(g, border, {"fill": null, "stroke": Color("#2d4e45"), "width": 1.75})
	var roads := "M91 152 L158 170 L207 157 L260 182 L300 192 M383 170 L434 178 L485 193 L524 224"
	s.path(g, roads, {"fill": null, "stroke": Color("#f3e3c6"), "width": 4.0})
	s.path(g, roads, {"fill": null, "stroke": Color("#476058"), "width": 1.5})
	s.text(g, 153, 204, "NORTHLAND", {"fill": INK, "family": SERIF, "weight": 700, "size": 15, "anchor": "middle"})
	s.text(g, 440, 211, "NEW UNION" if edited else "EASTERN MARCH", {"fill": INK, "family": SERIF, "weight": 700, "size": 14, "anchor": "middle"})
	for spot in [[182, 147, 6.0], [445, 167, 6.0], [317, 116, 4.5]]:
		s.circle(g, spot[0], spot[1], spot[2], {"fill": PAPER_SOFT, "stroke": Color("#3d5a53"), "width": 1.4})
	s.text(g, 185, 135, "CAPITAL", {"fill": INK, "family": MONO, "size": 9.5})
	s.text(g, 457, 153, "CITY", {"fill": INK, "family": MONO, "size": 9.5})
	s.path(g, "M69 42 L69 81 M49 61 L89 61 M57 49 L81 73 M81 49 L57 73", {"fill": null, "stroke": INK, "width": 1.6})
	s.circle(g, 69, 61, 24, {"fill": null, "stroke": INK, "width": 1.0, "opacity": 0.6})
	s.text(g, 69, 29, "N", {"fill": INK, "family": SERIF, "size": 11, "anchor": "middle"})
	s.text(g, 570, 37, "ATLAS // 02", {"fill": INK, "family": MONO, "size": 9, "anchor": "middle"})
	s.path(g, "M409 28 L609 28", {"fill": null, "stroke": INK, "width": 1.0, "opacity": 0.35, "dash": [2.0, 6.0]})
	if edited:
		var drawn := {"fill": null, "stroke": BRASS, "width": 3.0}
		if not still:
			drawn["dash"] = [1100.0]
			drawn["anims"] = [Scene.motion("ohUpdDraw", 1700.0, 100.0, "cubic-bezier(0.2, 0.7, 0.2, 1)", {"length": 1100.0})]
		s.path(g, "M270 60 L285 112 L335 133 L353 177", drawn)
		for point in [[270, 60], [285, 112], [335, 133], [353, 177]]:
			s.circle(g, point[0], point[1], 8, {"fill": BRASS, "stroke": INK, "width": 2.0})
			s.circle(g, point[0], point[1], 2, {"fill": INK})


static func compass(s: Scene, parent: Scene.Shape, still: bool) -> void:
	var g := s.group(parent, at(847, 156))
	s.circle(g, 0, 0, 70, {"fill": Color("#243335"), "stroke": Color("#a18b64"), "width": 2.0})
	s.circle(g, 0, 0, 61, {"fill": null, "stroke": BRASS, "width": 1.0, "dash": [3.0, 7.0]})
	var needle := s.group(g, {} if still else {"anims": [Scene.forever("ohUpdSpin", 24000.0)]})
	s.path(needle, "M0 -49 L8 -8 L48 0 L8 8 L0 49 L-8 8 L-48 0 L-8 -8 Z", {"fill": BRASS})
	s.path(needle, "M0 -49 L8 -8 L0 0 L-8 -8 Z M48 0 L8 8 L0 0 L8 -8 Z", {"fill": PAPER})
	s.circle(needle, 0, 0, 5, {"fill": INK, "stroke": PAPER, "width": 1.6})
	for mark in [[0, -56, "N"], [0, 66, "S"], [-59, 4, "W"], [59, 4, "E"]]:
		s.text(g, mark[0], mark[1], mark[2], {"fill": PAPER, "family": MONO, "size": 11, "anchor": "middle"})


static func draft(s: Scene, root: Scene.Shape, still: bool) -> void:
	s.rect(root, 58, 18, 706, 278, {"fill": Color("#11181a"), "stroke": BRASS, "width": 1.0, "opacity": 0.55, "rx": 3})
	cartography(s, s.group(root, at(72, 30)), false, still)
	var side := s.group(root, at(752, 33))
	s.text(side, 0, 0, "DRAWING", {"fill": PAPER_SOFT, "family": MONO, "size": 10})
	s.text(side, 0, 17, "INSTRUMENTS", {"fill": PAPER_SOFT, "family": MONO, "size": 10})
	var tools := ["01   BORDER", "02   REGION", "03   PLACE", "04   POLITY"]
	for i in range(tools.size()):
		s.text(side, 0, 41 + i * 18, tools[i], {"fill": BRASS if i == 1 else MUTED, "family": MONO, "size": 10})
	compass(s, root, still)
	s.path(root, "M767 267 L887 267", {"fill": null, "stroke": BRASS, "width": 2.0})
	for i in range(11):
		s.line(root, 771 + i * 11, 257, 771 + i * 11, 274 if i % 5 == 0 else 269, {"stroke": BRASS, "width": 1.0})
	s.text(root, 830, 291, "SCALE / 50 KM", {"fill": MUTED, "family": MONO, "size": 9, "anchor": "middle"})


static func polities(s: Scene, root: Scene.Shape, edited: bool, still: bool) -> void:
	s.rect(root, 49, 23, 679, 272, {"fill": PAPER, "stroke": Color("#c59d68"), "width": 2.0, "rx": 3})
	cartography(s, s.group(root, at(60, 35, 1.01)), edited, still)
	s.rect(root, 707, 49, 213, 207, {"fill": Color("#172527"), "stroke": BRASS, "width": 1.5, "rx": 3})
	s.path(root, "M721 76 H902", {"fill": null, "stroke": BRASS, "width": 1.0, "opacity": 0.6})
	s.text(root, 723, 67, "POLITY RECORD / 014", {"fill": BRASS, "family": MONO, "size": 10})
	s.text(root, 724, 101, "New Union" if edited else "Eastern March", {"fill": PAPER_SOFT, "family": SERIF, "weight": 700, "size": 17})
	s.text(root, 724, 120, "STABLE COUNTRY RECORD", {"fill": MUTED, "family": MONO, "size": 10})
	s.path(root, "M723 132 H901", {"fill": null, "stroke": LINE, "width": 1.0})
	var rows := [[153, "COUNTRY NAME", "Edited" if edited else "Original"], [181, "GOVERNMENT", "Editable"], [209, "TERRITORY", "Linked"]]
	for row in rows:
		s.text(root, 723, row[0], row[1], {"fill": MUTED, "family": MONO, "size": 10})
		s.text(root, 902, row[0], row[2], {"fill": PAPER_SOFT, "family": MONO, "size": 10, "anchor": "end"})
	s.path(root, "M723 221 H901", {"fill": null, "stroke": LINE, "width": 1.0})
	s.circle(root, 734, 238, 5, {"fill": BRASS if edited else GREEN})
	s.text(root, 747, 242, "CHANGE PREVIEW" if edited else "SOURCE RECORD", {"fill": PAPER_SOFT, "family": MONO, "size": 10})


static func archive_map(s: Scene, g: Scene.Shape, new_world: bool) -> void:
	s.rect(g, 22, 52, 340, 168, {"fill": Color("#a4bbb2"), "stroke": Color("#9e8b6d"), "width": 1.0})
	for i in range(5):
		s.line(g, 55 + i * 61, 53, 55 + i * 61, 219, {"stroke": PAPER, "width": 1.0, "opacity": 0.43})
	for i in range(3):
		s.line(g, 23, 91 + i * 42, 361, 91 + i * 42, {"stroke": PAPER, "width": 1.0, "opacity": 0.43})
	s.path(g, "M23 149 L42 138 L56 101 L96 107 L122 77 L153 89 L188 63 L221 89 L255 83 L283 107 L320 131 L361 150 L361 219 L23 219 Z", {"fill": Color("#6d9687") if new_world else Color("#819d90"), "stroke": INK, "width": 2.0})
	s.path(g, "M25 169 L93 148 L134 169 L185 143 L214 171 L208 219 L25 219 Z" if new_world else "M25 169 L94 147 L145 173 L189 142 L187 219 L25 219 Z", {"fill": Color("#a6aa7e"), "stroke": Color("#45594a"), "width": 1.0})
	s.path(g, "M220 148 L270 127 L320 158 L356 215 L225 218 Z", {"fill": Color("#d0aa76"), "stroke": Color("#586452"), "width": 1.0})
	var border := "M187 64 L193 120 L214 171 L208 219" if new_world else "M188 63 L188 121 L187 169 L187 219"
	s.path(g, border, {"fill": null, "stroke": PAPER_SOFT, "width": 3.5})
	s.path(g, border, {"fill": null, "stroke": INK, "width": 1.5})
	s.circle(g, 114, 160, 4, {"fill": PAPER_SOFT, "stroke": INK, "width": 1.0})
	s.circle(g, 291, 160, 4, {"fill": PAPER_SOFT, "stroke": INK, "width": 1.0})
	if new_world:
		for point in [[187, 64], [193, 120], [214, 171]]:
			s.circle(g, point[0], point[1], 4.5, {"fill": BRASS, "stroke": INK, "width": 1.0})
	s.text(g, 66, 199, "NORTHLAND", {"fill": INK, "family": SERIF, "weight": 700, "size": 10})
	s.text(g, 245, 199, "NEW UNION" if new_world else "EASTERN MARCH", {"fill": INK, "family": SERIF, "weight": 700, "size": 10})


static func mini_archive(s: Scene, root: Scene.Shape, x: float, title: String, stamp: String, new_world: bool) -> void:
	var g := s.group(root, at(x, 26))
	s.rect(g, 0, 0, 384, 265, {"fill": Color("#293638"), "stroke": BRASS if new_world else Color("#6c8b86"), "width": 2.0, "rx": 4})
	s.rect(g, 14, 16, 356, 233, {"fill": PAPER, "rx": 2})
	archive_map(s, g, new_world)
	s.rect(g, 14, 16, 356, 29, {"fill": INK})
	s.text(g, 27, 35, title, {"fill": PAPER_SOFT, "family": MONO, "weight": 700, "size": 12})
	s.rect(g, 23, 225, 338, 16, {"fill": Color("#d5b075") if new_world else Color("#9cb6ac")})
	s.text(g, 31, 237, stamp, {"fill": INK, "family": MONO, "size": 10})
	s.circle(g, 353, 35, 5, {"fill": BRASS if new_world else WATER})


static func publish(s: Scene, root: Scene.Shape, still: bool) -> void:
	mini_archive(s, root, 32, "01  ORIGINAL SCENARIO", "HISTORY PRESERVED", false)
	mini_archive(s, root, 540, "02  NEW SCENARIO", "A WORLD OF ITS OWN", true)
	s.rect(root, 421, 129, 115, 56, {"fill": INK, "stroke": BRASS, "width": 1.5, "rx": 2})
	var arrow := {"fill": null, "stroke": BRASS, "width": 3.0, "cap": "square"}
	if not still:
		arrow["dash"] = [150.0]
		arrow["anims"] = [Scene.motion("ohUpdDraw", 1200.0, 350.0, "cubic-bezier(0.2, 0.7, 0.2, 1)", {"length": 150.0})]
	s.path(root, "M432 156 H518 M507 147 L518 156 L507 165", arrow)
	s.circle(root, 479, 198, 15, {"fill": Color("#293638"), "stroke": BRASS, "width": 1.0})
	s.path(root, "M471 197 l6 6 11 -14", {"fill": null, "stroke": BRASS, "width": 2.6})
	s.text(root, 479, 229, "SAFE COPY", {"fill": PAPER_SOFT, "family": MONO, "size": 10, "anchor": "middle"})


static func view_of(scene: String, narrow: bool) -> Rect2:
	if not narrow:
		return Rect2(0, 0, 960, 315)
	match scene:
		"draft":
			return Rect2(105, 0, 590, 315)
		"polities":
			return Rect2(315, 0, 590, 315)
	return Rect2(185, 0, 590, 315)


static func illustration(scene: String, narrow: bool, edited: bool, still: bool) -> Scene:
	var view := view_of(scene, narrow)
	var s := Scene.new(view, "meet", still)
	s.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var root: Scene.Shape = s.root
	s.rect(root, 0, 0, 960, 315, {"fill": STAGE})
	for i in range(16):
		s.line(root, 0, 11 + i * 19, 960, 11 + i * 19, {"stroke": PAPER_SOFT, "width": 1.0, "opacity": 0.035})
	match scene:
		"draft":
			draft(s, root, still)
		"polities":
			polities(s, root, edited, still)
		_:
			publish(s, root, still)
	s.path(root, "M0 1 H960 M0 314 H960", {"fill": null, "stroke": BRASS, "width": 1.0, "opacity": 0.55})
	return s


class Picture extends Control:
	var aspect := 315.0 / 960.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		resized.connect(_follow)

	func _follow() -> void:
		var tall := roundf(size.x * aspect)
		if absf(custom_minimum_size.y - tall) > 0.5:
			custom_minimum_size = Vector2(0.0, tall)


class Atlas extends PanelContainer:
	var scene := "draft"
	var narrow := false
	var still := false
	var edited := false
	var picture: Picture
	var toggle: Button
	var maker: Callable
	var aspect := 315.0 / 960.0

	func build() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		add_theme_stylebox_override("panel", UpdateKit.box(STAGE, LINE, 0.0, 1, Vector4(1, 1, 1, 1)))
		picture = Picture.new()
		picture.aspect = aspect
		add_child(picture)
		var stamp := PanelContainer.new()
		stamp.mouse_filter = Control.MOUSE_FILTER_IGNORE
		stamp.size_flags_horizontal = Control.SIZE_SHRINK_END
		stamp.size_flags_vertical = Control.SIZE_SHRINK_END
		stamp.add_theme_stylebox_override("panel", UpdateKit.box(Color(20 / 255.0, 28 / 255.0, 30 / 255.0, 0.86), LINE, 0.0, 1, Vector4(7, 4, 7, 4)))
		var stamp_text := UpdateKit.text(str(SCENES[scene]["stamp"]), 9.0, BRASS, MONO, 400, false, 0.1)
		stamp_text.autowrap_mode = TextServer.AUTOWRAP_OFF
		stamp_text.size_flags_horizontal = Control.SIZE_SHRINK_END
		stamp.add_child(stamp_text)
		var corner := MarginContainer.new()
		corner.mouse_filter = Control.MOUSE_FILTER_IGNORE
		corner.add_theme_constant_override("margin_right", 10)
		corner.add_theme_constant_override("margin_bottom", 8)
		corner.add_child(stamp)
		add_child(corner)
		draw_scene()

	func draw_scene() -> void:
		for child in picture.get_children():
			child.queue_free()
		picture.add_child(maker.call(scene, narrow, edited, still))

	func flip() -> void:
		edited = not edited
		draw_scene()
		if toggle:
			toggle.text = "VIEW ORIGINAL  ↺" if edited else "PREVIEW AN EDIT  ↗"
			toggle.tooltip_text = "View original borders and polity name" if edited else "Preview edited borders and polity name"


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var width: float = ctx.get("width", 1440.0)
	var narrow: bool = width < 600.0
	var scene := str(banner.get("scene", "draft"))
	if not SCENES.has(scene):
		scene = "draft"
	var info: Dictionary = SCENES[scene]
	var plate := UpdateKit.plate({"background": DESK, "border": LINE, "radius": 5.0}, still)
	UpdateKit.brackets(plate, BRASS, px(0.6), px(1.35), 1.5)
	var body := UpdateKit.vbox(0)
	var top := UpdateKit.hbox(10)
	var brand := UpdateKit.text("OPENHISTORIA  /  CARTOGRAPHER'S EDITION", px(0.65), BRASS, MONO, 700, false, 0.16)
	top.add_child(brand)
	var dated := UpdateKit.text("BETA  /  " + str(update.get("dateText", "")), px(0.64), MUTED, MONO, 400, false, 0.1)
	dated.size_flags_horizontal = Control.SIZE_SHRINK_END
	dated.autowrap_mode = TextServer.AUTOWRAP_OFF
	dated.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	top.add_child(dated)
	body.add_child(UpdateKit.reveal(top, 100.0, still))
	body.add_child(UpdateKit.rule(BRASS, null, Vector2(px(0.75), px(0.9))))
	var head_row := UpdateKit.hbox(12)
	var head := UpdateKit.vbox(0)
	head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(UpdateKit.text(str(info["kicker"]), px(0.69), BRASS, MONO, 700, false, 0.18))
	head.add_child(UpdateKit.gap(px(0.4)))
	var title_px := ShellFonts.clamp_vw(1.65, 8.0, 2.45, width) if narrow else ShellFonts.clamp_vw(2.1, 4.2, 3.05, width)
	head.add_child(UpdateKit.para(str(banner.get("title", "")), title_px, PAPER_SOFT, SERIF, 700, false, 1.08))
	head.add_child(UpdateKit.gap(px(0.25)))
	if not str(banner.get("subtitle", "")).is_empty():
		head.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(0.65 if narrow else 0.74), BRASS, MONO, 400, false, 0.12))
	head_row.add_child(head)
	var side := UpdateKit.vbox(0)
	side.size_flags_horizontal = Control.SIZE_SHRINK_END
	var number := UpdateKit.text(str(info["number"]), px(0.66 if narrow else 0.76), MUTED, MONO, 400, false, 0.06)
	number.autowrap_mode = TextServer.AUTOWRAP_OFF
	number.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	side.add_child(number)
	if not narrow:
		side.add_child(UpdateKit.gap(9.0))
		var side_text := UpdateKit.text(str(info["side"]), px(0.6), BRASS, MONO, 400, false, 0.14)
		side_text.autowrap_mode = TextServer.AUTOWRAP_OFF
		side_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		side.add_child(side_text)
	head_row.add_child(side)
	body.add_child(UpdateKit.reveal(head_row, 185.0, still))
	body.add_child(UpdateKit.gap(px(1.1)))
	var atlas := Atlas.new()
	atlas.scene = scene
	atlas.narrow = narrow
	atlas.still = still
	atlas.maker = illustration
	var view := view_of(scene, narrow)
	atlas.aspect = view.size.y / view.size.x
	atlas.build()
	body.add_child(atlas)
	if scene == "polities":
		body.add_child(UpdateKit.gap(px(0.55)))
		var row := UpdateKit.hbox(0)
		row.alignment = BoxContainer.ALIGNMENT_END
		var toggle := Button.new()
		toggle.text = "PREVIEW AN EDIT  ↗"
		toggle.tooltip_text = "Preview edited borders and polity name"
		toggle.focus_mode = Control.FOCUS_NONE
		toggle.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var face := UpdateKit.box(STAGE, BRASS, 0.0, 1, Vector4(px(0.8), px(0.55), px(0.8), px(0.55)))
		for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			toggle.add_theme_stylebox_override(state, face)
		toggle.add_theme_font_override("font", UpdateKit.font(MONO, 400, false, px(0.68) * 0.08))
		toggle.add_theme_font_size_override("font_size", roundi(px(0.68)))
		for colour in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			toggle.add_theme_color_override(colour, BRASS)
		atlas.toggle = toggle
		toggle.pressed.connect(atlas.flip)
		row.add_child(toggle)
		body.add_child(UpdateKit.reveal(row, 350.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.9)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(0.92 if narrow else 1.04), MUTED, SERIF, 400, false, 1.45), 260.0, still))
		body.add_child(UpdateKit.gap(px(1.0)))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), BRASS, MUTED, {"background": Color("#202d2e"), "border": LINE, "radius": 2.0}, SERIF, false, 380.0, still, 120.0, 1 if narrow else 2))
	body.add_child(UpdateKit.gap(px(1.1)))
	var foot := PanelContainer.new()
	foot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var foot_style := StyleBoxFlat.new()
	foot_style.bg_color = Color(0, 0, 0, 0)
	foot_style.border_color = LINE
	foot_style.border_width_top = 1
	foot_style.content_margin_top = px(0.7)
	foot.add_theme_stylebox_override("panel", foot_style)
	var foot_row := UpdateKit.hbox(6)
	foot_row.add_child(UpdateKit.text("A NEW WAY TO DRAW YOUR WORLD", px(0.59), MUTED, MONO, 400, false, 0.1))
	var foot_number := UpdateKit.text(str(info["number"]), px(0.59), BRASS, MONO, 400, false, 0.1)
	foot_number.size_flags_horizontal = Control.SIZE_SHRINK_END
	foot_number.autowrap_mode = TextServer.AUTOWRAP_OFF
	foot_row.add_child(foot_number)
	foot.add_child(foot_row)
	body.add_child(UpdateKit.reveal(foot, 570.0, still))
	if narrow:
		plate.add_child(UpdateKit.margins(body, px(1.15), px(1.3), px(1.15), px(1.2)))
	else:
		plate.add_child(UpdateKit.margins(body, px(2.2), px(1.6), px(2.2), px(1.9)))
	return UpdateKit.plate_reveal(plate, still)
