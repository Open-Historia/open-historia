extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const NIGHT := Color("#0c1420")
const MOON := Color("#e9e3cf")
const MOON_SOFT := Color(233 / 255.0, 227 / 255.0, 207 / 255.0, 0.74)
const FLAK := Color("#e9a23b")
const FACE := "\"Bahnschrift Condensed\", \"Bahnschrift\", \"DIN Condensed\", \"Oswald\", \"Arial Narrow\", sans-serif"
const ROOFS := Color("#05090f")
const WINDOWS := Color("#e9c46a")
const BEAM := Color(233 / 255.0, 227 / 255.0, 207 / 255.0, 0.09)
const BOMBER := Color("#1f2a38")
const FIGHTER := Color("#3c4f66")
const CROSS_MS := 9000.0
const CLIMB_MS := 4200.0
const BOMBER_PATH := "M0 -3 L16 -3 L20 0 L16 3 L0 3 Z M6 -14 L10 -14 L12 -3 L8 -3 Z M6 14 L10 14 L12 3 L8 3 Z M0 -6 L3 -6 L3 6 L0 6 Z"
const FIGHTER_PATH := "M0 -1.6 L10 -1.6 L12 0 L10 1.6 L0 1.6 Z M4 -7 L6.5 -7 L7.5 -1.6 L5 -1.6 Z M4 7 L6.5 7 L7.5 1.6 L5 1.6 Z"
const BEAMS := [[150.0, -14.0], [430.0, 10.0], [610.0, -6.0]]
const FORMATION := [[0, 70], [-30, 52], [-30, 88], [-60, 36], [-60, 104]]
const FIGHTERS := [[260.0, 1], [360.0, 0], [520.0, 2]]
const BURSTS := [[300.0, 64.0], [470.0, 40.0], [380.0, 98.0], [560.0, 76.0], [220.0, 44.0]]


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func chrome() -> Dictionary:
	return {
		"button": {"bg": FLAK, "border": FLAK, "radius": 3.0, "ink": NIGHT, "font": FACE, "weight": 700, "spacing": 0.08, "caps": true},
		"arrow": {"bg": Color(233 / 255.0, 227 / 255.0, 207 / 255.0, 0.06), "border": MOON, "ink": MOON},
		"dot": {"on": FLAK, "off": Color(233 / 255.0, 227 / 255.0, 207 / 255.0, 0.3)},
		"skip": {"ink": MOON, "font": FACE, "spacing": 0.06},
	}


static func sky(still: bool) -> Scene:
	var s := Scene.new(Rect2(0, 0, 800, 220), "slice", still)
	s.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var root: Scene.Shape = s.root
	s.rect(root, 0, 0, 800, 220, {"fill": NIGHT})
	for at in range(28):
		s.circle(root, float((at * 97) % 800), float(6 + ((at * 41) % 110)), 1.3 if at % 4 == 0 else 0.8, {"fill": MOON, "anims": [Scene.forever("ohUpdTwinkle", 2600.0 + float(at % 5) * 280.0, float(at) * 150.0, "cubic-bezier(0.4, 0, 0.6, 1)")]})
	s.circle(root, 664, 46, 22, {"fill": MOON})
	s.circle(root, 656, 40, 6, {"fill": NIGHT, "opacity": 0.12})
	for at in range(BEAMS.size()):
		var beam: Array = BEAMS[at]
		var light := s.group(root, {"css": [["translate", float(beam[0]), 214.0], ["rotate", float(beam[1])]], "origin": Vector2.ZERO})
		s.path(light, "M-4 0 L-46 -230 L46 -230 L4 0 Z", {"fill": BEAM, "origin": Vector2.ZERO, "anims": [Scene.forever("ohUpdSway", 5200.0 + float(at) * 900.0, float(at) * 600.0, "cubic-bezier(0.45, 0, 0.55, 1)")]})
	var raid := {"anims": [Scene.forever("ohUpdDrift", CROSS_MS, 0.0, "linear", {"from": -160.0, "to": 880.0})]}
	if still:
		raid["offset"] = Vector2(300, 0)
	var formation := s.group(root, raid)
	for spot in FORMATION:
		var x: int = spot[0]
		var y: int = spot[1]
		var plane := s.group(formation, {"offset": Vector2(x, y)})
		s.path(plane, BOMBER_PATH, {"fill": BOMBER, "stroke": MOON, "stroke_opacity": 0.4, "width": 0.6})
		s.circle(plane, 8, 10, 1.3, {"fill": MOON, "anims": [Scene.forever("ohUpdFall", 1800.0, float(((x + y) * 13) % 900), "cubic-bezier(0.5, 0, 1, 1)", {"fall": 120.0})]})
	for entry in FIGHTERS:
		var fighter: Array = entry
		var base := s.group(root, {"offset": Vector2(float(fighter[0]), 143.0)})
		var climb := {"anims": [Scene.forever("ohUpdDrift", CLIMB_MS, float(fighter[1]) * 700.0, "cubic-bezier(0.3, 0, 0.6, 1)", {"from": 0.0, "to": 140.0})]}
		if still:
			climb["offset"] = Vector2(70, 0)
		var mover := s.group(base, climb)
		var turned := s.group(mover, {"css": [["rotate", -38.0], ["translate", 0.0, 7.0]], "origin": {"kind": "view", "at": Vector2.ZERO}})
		s.path(turned, FIGHTER_PATH, {"fill": FIGHTER, "stroke": MOON, "stroke_opacity": 0.5, "width": 0.5})
	for at in range(BURSTS.size()):
		var burst: Array = BURSTS[at]
		var flak := s.group(root, {"offset": Vector2(float(burst[0]), float(burst[1]))})
		s.circle(flak, 0, 0, 9, {"fill": null, "stroke": FLAK, "width": 2.0, "origin": Vector2.ZERO, "anims": [Scene.forever("ohUpdRing", 1700.0, float(at) * 340.0, "cubic-bezier(0.2, 0.7, 0.2, 1)")]})
		s.circle(flak, 0, 0, 2.4, {"fill": FLAK, "anims": [Scene.forever("ohUpdPulse", 1700.0, float(at) * 340.0, "cubic-bezier(0.4, 0, 0.6, 1)")]})
	for at in range(26):
		var x := float(at * 31)
		var w := float(24 + ((at * 7) % 9))
		var h := float(20 + ((at * 37) % 46))
		s.rect(root, x, 220.0 - h, w, h, {"fill": ROOFS})
		if h > 40.0:
			s.rect(root, x + 6.0, 226.0 - h, 3, 3, {"fill": WINDOWS, "opacity": 0.7})
		if h > 52.0:
			s.rect(root, x + 14.0, 236.0 - h, 3, 3, {"fill": WINDOWS, "opacity": 0.5})
	return s


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var narrow: bool = ctx.get("narrow", false)
	var width: float = ctx.get("width", 1440.0)
	var plate := UpdateKit.plate({"background": NIGHT, "border": Color(233 / 255.0, 227 / 255.0, 207 / 255.0, 0.22), "radius": 6.0, "padding": Vector4(1, 1, 1, 1)}, still)
	UpdateKit.brackets(plate, FLAK, px(0.7), px(1.6), 1.5, true)
	var column := UpdateKit.vbox(0)
	var holder := UpdateKit.frame(px(11.0) if narrow else ShellFonts.clamp_vw(12.0, 25.0, 16.0, width), 3.0, FLAK)
	holder.add_child(sky(still))
	column.add_child(UpdateKit.reveal(holder, 150.0, still))
	var body := UpdateKit.vbox(0)
	var head := UpdateKit.vbox(0)
	head.add_child(UpdateKit.text(UpdateKit.major_line(update), px(0.8), FLAK, FACE, 400, false, 0.22, true))
	head.add_child(UpdateKit.gap(px(0.2)))
	var title := UpdateKit.para(str(banner.get("title", "")), px(2.2) if narrow else ShellFonts.clamp_vw(2.4, 6.0, 3.4, width), MOON, FACE, 700, false, 1.02, 0.02, true)
	head.add_child(UpdateKit.reveal(title, 380.0, still, "ohUpdFade", 500.0))
	if not str(banner.get("subtitle", "")).is_empty():
		head.add_child(UpdateKit.gap(px(0.25)))
		head.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(1.1), FLAK, FACE, 400, false, 0.06))
	body.add_child(UpdateKit.reveal(head, 300.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.9)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(1.0), MOON_SOFT, UpdateKit.BASE_FONT, 400, false, 1.6), 420.0, still))
	body.add_child(UpdateKit.rule(MOON, UpdateKit.icon_rect("plane", 18, FLAK)))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), FLAK, MOON_SOFT, {"background": Color(233 / 255.0, 227 / 255.0, 207 / 255.0, 0.05), "border": Color(233 / 255.0, 227 / 255.0, 207 / 255.0, 0.18), "radius": 4.0}, FACE, true, 520.0, still))
	if narrow:
		column.add_child(UpdateKit.margins(body, px(1.1), px(1.2), px(1.1), px(1.3)))
	else:
		column.add_child(UpdateKit.margins(body, px(2.0), px(1.5), px(2.0), px(1.7)))
	plate.add_child(column)
	return UpdateKit.plate_reveal(plate, still)
