extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const INK := Color("#10171e")
const SEA := Color("#16222c")
const IVORY := Color("#f6f1e3")
const IVORY_SOFT := Color(246 / 255.0, 241 / 255.0, 227 / 255.0, 0.74)
const BRASS := Color("#c9a45a")
const RULE := Color(246 / 255.0, 241 / 255.0, 227 / 255.0, 0.18)
const FACE := "Georgia, \"Palatino Linotype\", \"Book Antiqua\", serif"
const UNKNOWN := "#45423b"
const RELATION := {"self": "#f6f1e3", "war": "#a51c1c", "ceasefire": "#c86a5a", "alliance": "#1d4f91", "guarantee": "#5a74a6", "trade": "#d6c48a", "hostile": "#b5612b", "unknown": UNKNOWN}
const WAR_SIDES := [["#c8501e", "#2563a8"], ["#c99a52", "#3c8a8a"]]
const BLOC := {"member": "#1f5a7a", "associate": "#4d86a3", "candidate": "#a7c3cf", "observer": "#c8c3ad", "suspended": "#9a5b3c"}
const REGIME := {"democratic": "#2f6fa6", "hybrid": "#7aa6a1", "authoritarian": "#c47a3a", "totalitarian": "#7a1f1f", "theocratic": "#c9b46a", "military": "#5f6b3a"}
const LINES := {"ally": "#f6f1e3", "war": "#e05a3a", "ceasefire": "#e8b0a0"}
const LAND := {
	"a": "60,46 190,32 230,90 170,140 82,122",
	"b": "190,32 330,40 350,100 230,90",
	"c": "230,90 350,100 360,170 250,190 170,140",
	"d": "82,122 170,140 250,190 205,228 70,214",
	"e": "330,40 470,30 500,110 350,100",
	"f": "350,100 500,110 520,180 360,170",
	"g": "250,190 360,170 520,180 548,226 205,228",
	"h": "470,30 620,40 640,120 500,110",
	"i": "500,110 640,120 662,200 520,180",
	"j": "620,40 752,52 760,150 640,120",
	"k": "640,120 760,150 742,214 662,200",
}
const MIDDLE := {"a": [146, 86], "b": [272, 66], "c": [276, 140], "d": [158, 186], "e": [412, 72], "f": [432, 140], "g": [380, 204], "h": [560, 74], "i": [584, 154], "j": [700, 96], "k": [708, 176]}
const OUTLINE := "60,46 190,32 330,40 470,30 500,110 350,100 360,170 250,190 205,228 70,214 82,122"
const FRONTS := ["230,90 350,100", "230,90 170,140", "330,40 350,100", "500,110 640,120", "620,40 640,120"]
const PULSE := "cubic-bezier(0.4, 0, 0.6, 1)"


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func chrome() -> Dictionary:
	return {
		"button": {"bg": IVORY, "border": IVORY, "radius": 3.0, "ink": INK, "font": FACE, "weight": 700, "spacing": 0.06},
		"arrow": {"bg": Color(201 / 255.0, 164 / 255.0, 90 / 255.0, 0.08), "border": BRASS, "radius": 3.0, "ink": BRASS},
		"dot": {"on": BRASS, "off": Color(246 / 255.0, 241 / 255.0, 227 / 255.0, 0.26), "radius": 1.0},
		"skip": {"ink": IVORY_SOFT, "font": FACE, "spacing": 0.04},
	}


static func puppet_shade(hex: String) -> String:
	var from := Color(hex)
	var toward := Color(RELATION["self"])
	return "#" + from.lerp(toward, 0.42).to_html(false)


static func scenes() -> Dictionary:
	return {
		"relations": {
			"fill": {"a": RELATION["trade"], "b": RELATION["alliance"], "c": RELATION["self"], "d": RELATION["guarantee"], "e": RELATION["hostile"], "f": RELATION["alliance"], "g": RELATION["unknown"], "h": RELATION["war"], "i": RELATION["war"], "j": RELATION["ceasefire"], "k": RELATION["unknown"]},
			"hatch": ["j"],
			"lines": [["b", "ally"], ["f", "ally"], ["d", "ally"], ["h", "war"], ["i", "war"], ["j", "ceasefire"]],
			"from": "c",
			"legend": [[RELATION["self"], "1"], [RELATION["alliance"], "2"], [RELATION["war"], "2"], [RELATION["ceasefire"], "1", true], [RELATION["unknown"], "2"]],
		},
		"wars": {
			"fill": {"a": WAR_SIDES[0][0], "b": WAR_SIDES[0][0], "c": WAR_SIDES[0][1], "d": UNKNOWN, "e": UNKNOWN, "f": WAR_SIDES[0][1], "g": UNKNOWN, "h": WAR_SIDES[1][0], "i": WAR_SIDES[1][1], "j": WAR_SIDES[1][1], "k": UNKNOWN},
			"hatch": ["h", "i", "j"],
			"fronts": FRONTS,
			"legend": [[WAR_SIDES[0][0], "2"], [WAR_SIDES[0][1], "2"], [WAR_SIDES[1][0], "1", true], [WAR_SIDES[1][1], "2", true], [UNKNOWN, "4"]],
		},
		"blocs": {
			"fill": {"a": BLOC["member"], "b": BLOC["member"], "c": BLOC["member"], "d": BLOC["member"], "e": BLOC["associate"], "f": BLOC["candidate"], "g": BLOC["observer"], "h": UNKNOWN, "i": UNKNOWN, "j": BLOC["suspended"], "k": UNKNOWN},
			"hatch": ["f", "j"],
			"outline": OUTLINE,
			"legend": [[BLOC["member"], "4"], [BLOC["associate"], "1"], [BLOC["candidate"], "1", true], [BLOC["observer"], "1"], [UNKNOWN, "3"]],
		},
		"government": {
			"fill": {"a": REGIME["democratic"], "b": REGIME["democratic"], "c": REGIME["hybrid"], "d": puppet_shade(REGIME["democratic"]), "e": REGIME["authoritarian"], "f": REGIME["authoritarian"], "g": REGIME["military"], "h": REGIME["totalitarian"], "i": puppet_shade(REGIME["totalitarian"]), "j": REGIME["theocratic"], "k": REGIME["democratic"]},
			"hatch": ["d", "i"],
			"legend": [[REGIME["democratic"], "4"], [REGIME["hybrid"], "1"], [REGIME["authoritarian"], "2"], [REGIME["totalitarian"], "2"], [REGIME["military"], "1"]],
		},
	}


static func points(text: String) -> PackedVector2Array:
	var out := PackedVector2Array()
	for pair in text.split(" ", false):
		var parts := pair.split(",")
		out.append(Vector2(float(parts[0]), float(parts[1])))
	return out


static func polygon_path(text: String) -> String:
	var spots := points(text)
	var data := ""
	for at in range(spots.size()):
		data += ("M" if at == 0 else " L") + "%s %s" % [spots[at].x, spots[at].y]
	return data + " Z"


static func polyline_path(text: String) -> String:
	var spots := points(text)
	var data := ""
	for at in range(spots.size()):
		data += ("M" if at == 0 else " L") + "%s %s" % [spots[at].x, spots[at].y]
	return data


static func hatch(s: Scene, parent: Scene.Shape, area: PackedVector2Array, box: Rect2, opacity: float) -> void:
	var holder := s.group(parent, {"opacity": opacity})
	holder.clip = area
	var step := 8.0 * sqrt(2.0)
	var reach := box.size.x + box.size.y
	var c := box.position.x + box.position.y - step
	while c <= box.end.x + box.end.y + step:
		s.line(holder, c - box.position.y + reach, box.position.y - reach, c - box.end.y - reach, box.end.y + reach, {"stroke": IVORY, "width": 2.0, "opacity": 0.8})
		c += step


static func arc(from: Array, to: Array) -> String:
	var x1 := float(from[0])
	var y1 := float(from[1])
	var x2 := float(to[0])
	var y2 := float(to[1])
	var mx := (x1 + x2) / 2.0
	var my := (y1 + y2) / 2.0 - Vector2(x2 - x1, y2 - y1).length() * 0.22
	return "M%s %s Q%s %s %s %s" % [x1, y1, mx, my, x2, y2]


static func with(base: Dictionary, extra: Dictionary) -> Dictionary:
	var merged := base.duplicate()
	for key in extra.keys():
		merged[key] = extra[key]
	return merged


static func chart(scene: String, still: bool) -> Scene:
	var all := scenes()
	var shown: Dictionary = all.get(scene, all["relations"])
	var s := Scene.new(Rect2(0, 0, 800, 240), "slice", still)
	s.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var root: Scene.Shape = s.root
	s.rect(root, 0, 0, 800, 240, {"fill": SEA})
	for at in range(9):
		s.line(root, at * 100, 0, at * 100, 240, {"stroke": RULE, "width": 0.6})
	for at in range(4):
		s.line(root, 0, at * 60 + 30, 800, at * 60 + 30, {"stroke": RULE, "width": 0.6})
	var fills: Dictionary = shown["fill"]
	var hatched: Array = shown.get("hatch", [])
	var ids := LAND.keys()
	for at in range(ids.size()):
		var id: String = ids[at]
		var country := s.group(root, {} if still else {"anims": [Scene.motion("ohUpdFade", 700.0, 200.0 + at * 70.0)]})
		s.path(country, polygon_path(LAND[id]), {"fill": fills[id], "opacity": 0.92, "stroke": INK, "join": "round", "width": 2.2})
		if hatched.has(id):
			var area := points(LAND[id])
			var box := Rect2(area[0], Vector2.ZERO)
			for spot in area:
				box = box.expand(spot)
			hatch(s, country, area, box, 0.65)
	if shown.has("from"):
		var from: String = shown["from"]
		s.path(root, polygon_path(LAND[from]), with({"fill": null, "stroke": IVORY, "width": 2.4}, {} if still else {"anims": [Scene.forever("ohUpdPulse", 2400.0, 0.0, PULSE)]}))
		var lines: Array = shown["lines"]
		for at in range(lines.size()):
			var to: String = lines[at][0]
			var kind: String = lines[at][1]
			var props := {"fill": null, "stroke": LINES[kind], "cap": "round", "width": 2.2}
			if kind == "ally":
				if not still:
					props["dash"] = [400.0]
					props["anims"] = [Scene.motion("ohUpdDraw", 1400.0, 700.0 + at * 220.0, "cubic-bezier(0.2, 0.7, 0.2, 1)", {"length": 400.0})]
			else:
				props["dash"] = [9.0, 6.0] if kind == "war" else [2.0, 6.0]
				if not still:
					props["anims"] = [Scene.motion("ohUpdFade", 900.0, 700.0 + at * 220.0)]
			s.path(root, arc(MIDDLE[from], MIDDLE[to]), props)
		var seat := s.group(root, {"offset": Vector2(float(MIDDLE[from][0]), float(MIDDLE[from][1]))})
		s.circle(seat, 0, 0, 6, {"fill": IVORY, "stroke": INK, "width": 2.0})
		s.circle(seat, 0, 0, 9, with({"fill": null, "stroke": IVORY, "width": 1.6, "origin": Vector2.ZERO}, {} if still else {"anims": [Scene.forever("ohUpdRing", 2200.0, 400.0, "cubic-bezier(0.2, 0.7, 0.2, 1)")]}))
	var fronts: Array = shown.get("fronts", [])
	for at in range(fronts.size()):
		s.path(root, polyline_path(fronts[at]), with({"fill": null, "stroke": LINES["war"], "cap": "round", "width": 4.0}, {} if still else {"anims": [Scene.forever("ohUpdPulse", 1600.0, at * 260.0, PULSE)]}))
	if shown.has("outline"):
		var props := {"fill": null, "stroke": IVORY, "join": "round", "width": 3.0}
		if not still:
			props["dash"] = [1600.0]
			props["anims"] = [Scene.motion("ohUpdDraw", 2600.0, 600.0, "cubic-bezier(0.45, 0, 0.3, 1)", {"length": 1600.0})]
		s.path(root, polygon_path(shown["outline"]), props)
	var legend: Array = shown["legend"]
	var card := s.group(root, {"transform": Transform2D(0.0, Vector2(18, 128))})
	var fade := s.group(card, {} if still else {"anims": [Scene.motion("ohUpdFade", 700.0, 900.0)]})
	s.rect(fade, 0, -legend.size() * 15.0 + 66.0, 58, legend.size() * 15.0 + 12.0, {"fill": INK, "opacity": 0.92, "rx": 5, "stroke": BRASS, "stroke_opacity": 0.6})
	for at in range(legend.size()):
		var entry: Array = legend[at]
		var row := s.group(fade, {"transform": Transform2D(0.0, Vector2(8, 72 - (legend.size() - at) * 15))})
		s.rect(row, 0, 0, 10, 10, {"fill": entry[0], "rx": 2})
		if entry.size() > 2 and bool(entry[2]):
			hatch(s, row, PackedVector2Array([Vector2(0, 0), Vector2(10, 0), Vector2(10, 10), Vector2(0, 10)]), Rect2(0, 0, 10, 10), 1.0)
		s.text(row, 18, 9, str(entry[1]), {"fill": IVORY_SOFT, "family": FACE, "size": 9})
		s.rect(row, 28, 5, 16, 2, {"fill": IVORY_SOFT, "opacity": 0.5})
	return s


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var narrow: bool = ctx.get("narrow", false)
	var width: float = ctx.get("width", 1440.0)
	var plate := UpdateKit.plate({"background": INK, "border": RULE, "radius": 4.0}, still)
	UpdateKit.brackets(plate, BRASS, px(0.7), px(1.7), 1.5)
	var column := UpdateKit.vbox(0)
	var holder := UpdateKit.frame(px(10.5) if narrow else ShellFonts.clamp_vw(12.0, 25.0, 16.0, width), 2.0, BRASS)
	holder.add_child(chart(str(banner.get("scene", "relations")), still))
	column.add_child(UpdateKit.reveal(holder, 150.0, still))
	var body := UpdateKit.vbox(0)
	var head := UpdateKit.vbox(0)
	head.add_child(UpdateKit.text(UpdateKit.major_line(update), px(0.8), BRASS, FACE, 400, false, 0.22, true))
	head.add_child(UpdateKit.gap(px(0.2)))
	var title := UpdateKit.para(str(banner.get("title", "")), px(2.0) if narrow else ShellFonts.clamp_vw(2.2, 5.5, 3.2, width), IVORY, FACE, 700, false, 1.05, 0.01)
	head.add_child(UpdateKit.reveal(title, 380.0, still, "ohUpdFade", 500.0))
	if not str(banner.get("subtitle", "")).is_empty():
		head.add_child(UpdateKit.gap(px(0.3)))
		head.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(1.1), BRASS, FACE, 400, true))
	body.add_child(UpdateKit.reveal(head, 300.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.9)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(1.0), IVORY_SOFT, UpdateKit.BASE_FONT, 400, false, 1.6), 420.0, still))
	body.add_child(UpdateKit.rule(BRASS, UpdateKit.icon_rect("map", 18, BRASS)))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), BRASS, IVORY_SOFT, {"background": Color(246 / 255.0, 241 / 255.0, 227 / 255.0, 0.04), "border": RULE, "radius": 3.0}, FACE, true, 520.0, still))
	if narrow:
		column.add_child(UpdateKit.margins(body, px(1.1), px(1.2), px(1.1), px(1.3)))
	else:
		column.add_child(UpdateKit.margins(body, px(2.0), px(1.5), px(2.0), px(1.7)))
	plate.add_child(column)
	return UpdateKit.plate_reveal(plate, still)
