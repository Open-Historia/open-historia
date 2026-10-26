extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const STENCIL := "\"Bahnschrift Condensed\", \"Bahnschrift\", \"DIN Condensed\", \"DIN Alternate\", \"Oswald\", \"Arial Narrow\", sans-serif"
const SERIF := "Georgia, \"Times New Roman\", serif"
const STEEL_PLATE := Color("#2c2f34")
const STEEL_SEAM := Color("#0a0b0d")
const STEEL_LIP := Color(1, 1, 1, 0.1)
const STEEL_SUNK := Color(0, 0, 0, 0.34)
const STEEL_SUNK_LINE := Color(0, 0, 0, 0.66)
const STEEL_RAISED := Color("#3d4249")
const STEEL_RAISED_TOP := Color("#5f666f")
const STEEL_RAISED_SIDE := Color("#4a5058")
const BONE := Color("#ece7da")
const BONE_SOFT := Color(236 / 255.0, 231 / 255.0, 218 / 255.0, 0.64)
const BRASS := Color("#c9a54c")
const AMBER := Color("#e9b949")
const RED := Color("#b3212a")
const RED_BRIGHT := Color("#d2353d")
const BLUE := Color("#3c6e9e")
const RED_UNIT := Color("#9a3a34")
const LAND := Color("#2b3024")
const SEA := Color("#142230")
const GRID := Color(236 / 255.0, 231 / 255.0, 218 / 255.0, 0.07)
const DRAW := "cubic-bezier(0.45, 0, 0.2, 1)"
const WAVE := "cubic-bezier(0.4, 0, 0.6, 1)"
const PLANS := [[420.0, 26.0], [470.0, 70.0], [455.0, 118.0], [380.0, 160.0], [300.0, 20.0], [520.0, 150.0], [360.0, 96.0]]


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func tray() -> Dictionary:
	return {"top": STEEL_SUNK_LINE, "left": STEEL_SUNK_LINE, "right": STEEL_LIP, "bottom": STEEL_LIP, "radius": 3.0}


static func chrome() -> Dictionary:
	return {
		"button": {"bg": RED, "border": RED_BRIGHT, "radius": 3.0, "ink": BONE, "font": STENCIL, "spacing": 0.14, "caps": true},
		"arrow": {"bg": STEEL_RAISED, "radius": 3.0, "ink": BRASS, "bevel": {"bottom": STEEL_SEAM, "left": STEEL_RAISED_SIDE, "right": STEEL_SEAM, "top": STEEL_RAISED_TOP}},
		"dot": {"on": BRASS, "off": Color(201 / 255.0, 165 / 255.0, 76 / 255.0, 0.3), "radius": 1.0},
		"skip": {"ink": BRASS, "font": STENCIL, "spacing": 0.12, "caps": true},
	}


static func drawn(still: bool, length: float, duration: float, delay: float) -> Dictionary:
	if still:
		return {}
	return {"dash": [length], "anims": [Scene.motion("ohUpdDraw", duration, delay, DRAW, {"length": length})]}


static func carried(still: bool, from: float, to: float, duration: float, delay: float, again := false) -> Dictionary:
	if still:
		return {}
	if again:
		return {"anims": [Scene.forever("ohUpdDrift", duration, delay, "linear", {"from": from, "to": to})]}
	return {"anims": [Scene.motion("ohUpdDrift", duration, delay, UpdateKit.RISE, {"from": from, "to": to})]}


static func with(base: Dictionary, extra: Dictionary) -> Dictionary:
	var merged := base.duplicate()
	for key in extra.keys():
		merged[key] = extra[key]
	return merged


static func counter(s: Scene, parent: Scene.Shape, x: float, y: float, fill: Color, props := {}) -> void:
	var holder := s.group(parent, props)
	s.rect(holder, x, y, 26, 16, {"fill": fill, "stroke": BONE, "width": 1.2})
	s.path(holder, "M%s %s L%s %s M%s %s L%s %s" % [x, y, x + 26, y + 16, x + 26, y, x, y + 16], {"stroke": BONE, "width": 1.0})


static func front(still: bool) -> Scene:
	var s := Scene.new(Rect2(0, 0, 800, 180), "slice", still)
	var root: Scene.Shape = s.root
	s.rect(root, 0, 0, 800, 180, {"fill": LAND})
	s.path(root, "M0 150 C120 140 220 160 330 152 S560 140 800 150 V180 H0 Z", {"fill": SEA})
	for at in range(21):
		s.line(root, at * 40, 0, at * 40, 180, {"stroke": GRID})
	for at in range(5):
		s.line(root, 0, at * 40, 800, at * 40, {"stroke": GRID})
	for hill in [[140.0, 60.0, 70.0, 26.0], [620.0, 50.0, 90.0, 30.0], [560.0, 120.0, 60.0, 18.0]]:
		s.ellipse(root, hill[0], hill[1], hill[2], hill[3], {"fill": null, "stroke": Color(236 / 255.0, 231 / 255.0, 218 / 255.0, 0.09)})
		s.ellipse(root, hill[0], hill[1], hill[2] * 0.6, hill[3] * 0.6, {"fill": null, "stroke": Color(236 / 255.0, 231 / 255.0, 218 / 255.0, 0.09)})
	s.path(root, "M190 8 C196 50 180 90 192 140", {"fill": null, "stroke": BRASS, "width": 2.5, "opacity": 0.8})
	for y in [16.0, 34.0, 52.0, 70.0, 88.0, 106.0, 124.0]:
		s.rect(root, 186.0 + sin(y / 20.0) * 5.0, y, 7, 5, {"fill": BRASS, "opacity": 0.8})
	for at in range(18):
		s.circle(root, 12 + ((at * 37) % 110), 8 + ((at * 23) % 46), 1.6 if at % 3 == 0 else 1.0, with({"fill": BONE}, {} if still else {"anims": [Scene.forever("ohUpdTwinkle", 2400.0 + (at % 5) * 300.0, at * 170.0, WAVE)]}))
	s.path(root, "M430 0 C405 35 455 55 432 88 S385 125 415 156", with({"fill": null, "stroke": RED, "cap": "round", "width": 4.0}, drawn(still, 220.0, 1500.0, 450.0)))
	s.path(root, "M250 92 C330 92 420 78 512 64", with({"fill": null, "stroke": BRASS, "cap": "round", "width": 7.0}, drawn(still, 280.0, 1100.0, 1700.0)))
	s.path(root, "M512 52 L536 62 L514 78 Z", with({"fill": BRASS}, {} if still else {"anims": [Scene.motion("ohUpdFade", 300.0, 2700.0)]}))
	var blues := [[300.0, 28.0], [330.0, 62.0], [312.0, 98.0], [290.0, 126.0]]
	for at in range(blues.size()):
		counter(s, root, blues[at][0], blues[at][1], BLUE, carried(still, 0.0, 26.0, 2200.0, 1900.0 + at * 120.0))
	for spot in [[468.0, 22.0], [486.0, 70.0], [455.0, 110.0]]:
		counter(s, root, spot[0], spot[1], RED_UNIT)
	var guns := [[440.0, 40.0], [420.0, 100.0], [452.0, 132.0]]
	for at in range(guns.size()):
		s.circle(root, guns[at][0], guns[at][1], 4, with({"fill": AMBER}, {} if still else {"anims": [Scene.forever("ohUpdPulse", 1200.0, at * 400.0, WAVE)]}))
	var delays := [0.0, 3000.0, 6000.0]
	for at in range(delays.size()):
		var plane := s.group(root, carried(still, -60.0, 860.0, 9000.0, delays[at], true))
		var y := 20.0 + at * 9.0
		s.path(plane, "M0 %s l14 -2 6 -9 h3 l-3 9 10 -1.5 3 -3 h2.5 l-1.5 5 1.5 5 h-2.5 l-3 -3 -10 -1.5 3 9 h-3 l-6 -9 z" % y, {"fill": BONE, "opacity": 0.85, "css": [["scale", -1.0, 1.0]]})
	var ship := s.group(root, carried(still, 860.0, -80.0, 26000.0, 0.0, true))
	s.path(ship, "M0 164 h40 l-6 8 h-28 z M18 164 v-12 l12 10 h-12", {"fill": BONE, "opacity": 0.75})
	return s


static func commander(still: bool) -> Scene:
	var s := Scene.new(Rect2(0, 0, 800, 180), "slice", still)
	var root: Scene.Shape = s.root
	s.rect(root, 0, 0, 800, 180, {"fill": Color("#1c2026")})
	for col in range(10):
		for row in range(5):
			if (col + row) % 2 == 0:
				s.rect(root, col * 80, row * 36, 80, 36, {"fill": Color(236 / 255.0, 231 / 255.0, 218 / 255.0, 0.035)})
	s.path(root, "M660 160 h70 v-12 h-8 c0 -26 -6 -46 -18 -62 l6 -16 -14 4 c-14 -6 -30 2 -36 18 l-14 22 10 8 14 -10 c4 10 -6 22 -12 34 h-8 z", {"fill": null, "stroke": BRASS, "width": 2.0, "opacity": 0.35})
	s.circle(root, 150, 90, 22, with({"fill": null, "stroke": BRASS, "width": 1.5}, {} if still else {"anims": [Scene.forever("ohUpdPulse", 1600.0, 0.0, WAVE)]}))
	s.circle(root, 150, 90, 34, with({"fill": null, "stroke": BRASS, "width": 1.0, "opacity": 0.5}, {} if still else {"anims": [Scene.forever("ohUpdPulse", 1600.0, 400.0, WAVE)]}))
	s.path(root, "M150 74 L155 86 L168 90 L155 94 L150 106 L145 94 L132 90 L145 86 Z", {"fill": BRASS})
	for at in range(PLANS.size()):
		var x: float = PLANS[at][0]
		var y: float = PLANS[at][1]
		var props := {"fill": null, "stroke": BONE, "width": 1.4, "opacity": 0.32}
		if still:
			props["dash"] = [4, 5]
		s.path(root, "M150 90 Q%s %s %s %s" % [(150.0 + x) / 2.0, y - 10.0 if y < 90.0 else y + 10.0, x, y], with(props, drawn(still, 420.0, 700.0, 300.0 + at * 260.0)))
	for at in range(PLANS.size()):
		s.circle(root, PLANS[at][0], PLANS[at][1], 3, with({"fill": BONE, "opacity": 0.4}, {} if still else {"anims": [Scene.motion("ohUpdFade", 300.0, 900.0 + at * 260.0)]}))
	var chosen := 300.0 + PLANS.size() * 260.0
	s.path(root, "M150 90 C260 60 400 50 560 70", with({"fill": null, "stroke": BRASS, "cap": "round", "width": 6.0}, drawn(still, 440.0, 900.0, chosen)))
	s.path(root, "M556 56 L586 72 L556 86 Z", with({"fill": BRASS}, {} if still else {"anims": [Scene.motion("ohUpdFade", 300.0, 1200.0 + PLANS.size() * 260.0)]}))
	s.circle(root, 590, 72, 14, with({"fill": null, "stroke": RED_BRIGHT, "width": 2.0}, {} if still else {"anims": [Scene.forever("ohUpdPulse", 1400.0, 1400.0 + PLANS.size() * 260.0, WAVE)]}))
	return s


class StampRow extends Container:
	var row: Control
	var stamp: Control
	var pad_right := 0.0
	var pad_top := 0.0
	var stamp_top := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_horizontal = Control.SIZE_EXPAND_FILL

	func _notification(what: int) -> void:
		if what == NOTIFICATION_SORT_CHILDREN:
			if row:
				fit_child_in_rect(row, Rect2(Vector2(0.0, pad_top), Vector2(maxf(0.0, size.x - pad_right), row.get_combined_minimum_size().y)))
			if stamp:
				var want := stamp.get_combined_minimum_size()
				stamp.size = want
				stamp.position = Vector2(size.x - want.x, stamp_top)
				stamp.pivot_offset = want * 0.5
			update_minimum_size()

	func _get_minimum_size() -> Vector2:
		if not row:
			return Vector2.ZERO
		return Vector2(0.0, row.get_combined_minimum_size().y + pad_top)


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var narrow: bool = ctx.get("narrow", false)
	var width: float = ctx.get("width", 1440.0)
	var metal: Dictionary = ctx.get("metal", {})
	var stamped := str(banner.get("scene", "")) == "front"
	var surface := {"background": STEEL_PLATE, "border": STEEL_SEAM, "border_width": 2, "radius": 6.0}
	if metal.has("rough"):
		surface["texture"] = metal["rough"]
	var plate := UpdateKit.plate(surface, still)
	plate.decor.items.append({"kind": "rivets", "size": px(0.62), "inset": px(0.45), "texture": metal.get("rivet")})
	UpdateKit.brackets(plate, BRASS)
	var body := UpdateKit.vbox(0)
	var head := StampRow.new()
	var row := UpdateKit.hbox(roundi(px(0.7) if narrow else px(1.0)))
	row.alignment = BoxContainer.ALIGNMENT_BEGIN
	row.add_child(UpdateKit.emblem(BRASS, 180.0, 48.0 if narrow else 70.0, still, STEEL_SEAM))
	var words := UpdateKit.vbox(0)
	words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	words.add_child(UpdateKit.text(UpdateKit.major_line(update), px(0.68) if narrow else px(0.8), BRASS, STENCIL, 700, false, 0.12 if narrow else 0.22, true))
	words.add_child(UpdateKit.para(str(banner.get("title", "")), ShellFonts.clamp_vw(1.7, 5.4, 2.8, width), BONE, STENCIL, 800, false, 1.02, 0.05, true))
	if not str(banner.get("subtitle", "")).is_empty():
		var subtitle_size := px(0.88) if narrow else px(1.05)
		words.add_child(UpdateKit.text(str(banner.get("subtitle", "")), subtitle_size, BRASS, STENCIL, 400, false, 0.18 if narrow else 0.32, true))
	row.add_child(words)
	head.row = row
	head.add_child(row)
	if stamped:
		head.pad_right = 0.0 if narrow else px(6.5)
		head.pad_top = px(1.3) if narrow else 0.0
		head.stamp_top = -px(0.5) if narrow else px(0.2)
		var mark := PanelContainer.new()
		mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var pad := Vector2(px(0.4), px(0.15)) if narrow else Vector2(px(0.55), px(0.25))
		mark.add_theme_stylebox_override("panel", UpdateKit.box(Color(0, 0, 0, 0), RED_BRIGHT, 0.0, 3, Vector4(pad.x + 3.0, pad.y + 3.0, pad.x + 3.0, pad.y + 3.0)))
		var words_stamp := UpdateKit.text("Major update", px(0.66) if narrow else px(0.9), RED_BRIGHT, STENCIL, 800, false, 0.18, true)
		words_stamp.autowrap_mode = TextServer.AUTOWRAP_OFF
		mark.add_child(words_stamp)
		head.stamp = mark
		head.add_child(mark)
		UpdateKit.stamp(mark, 700.0, 900.0, still)
	body.add_child(UpdateKit.reveal(head, 120.0, still))
	body.add_child(UpdateKit.gap(px(1.1)))
	var holder := UpdateKit.frame(ShellFonts.clamp_vw(7.0, 22.0, 11.0, width), 0.0, Color(0, 0, 0, 0), STEEL_SUNK, tray())
	holder.add_child(commander(still) if str(banner.get("scene", "")) == "commander" else front(still))
	body.add_child(UpdateKit.reveal(holder, 260.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(1.0)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(0.98), BONE_SOFT, SERIF, 400, true, 1.55), 420.0, still))
	body.add_child(UpdateKit.rule(BRASS, UpdateKit.diamond(RED, px(0.6))))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), BRASS, BONE_SOFT, {"background": STEEL_SUNK, "bevel": tray(), "radius": 3.0}, STENCIL, true, 520.0, still))
	if narrow:
		plate.add_child(UpdateKit.margins(body, px(1.1), px(1.6), px(1.1), px(1.2)))
	else:
		plate.add_child(UpdateKit.margins(body, px(1.9), px(1.9), px(1.9), px(1.6)))
	return UpdateKit.plate_reveal(plate, still)
