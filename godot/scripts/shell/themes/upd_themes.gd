extends RefCounted

const Chronicle := preload("res://scripts/shell/themes/theme_chronicle.gd")
const WarsAndFronts2 := preload("res://scripts/shell/themes/theme_wars.gd")
const Music := preload("res://scripts/shell/themes/theme_music.gd")
const Seasons := preload("res://scripts/shell/themes/theme_seasons.gd")
const Swarms := preload("res://scripts/shell/themes/theme_swarms.gd")
const Espionage2 := preload("res://scripts/shell/themes/theme_espionage.gd")

const REGISTERED := ["espionage2", "swarms", "warsAndFronts2", "seasonsAndWeather", "music", "chronicle"]


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func registered(banner: Dictionary) -> bool:
	return REGISTERED.has(str(banner.get("theme", "")))


static func palette_colour(palette: Dictionary, key: String, fallback: Color) -> Color:
	var raw := str(palette.get(key, ""))
	if raw.is_empty():
		return fallback
	return UpdateKit.Scene.color(raw)


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	if str(update.get("kind", "")) != "major":
		return minor_banner(banner, update, ctx)
	match str(banner.get("theme", "")):
		"chronicle":
			return Chronicle.page(banner, update, ctx)
		"warsAndFronts2":
			return WarsAndFronts2.page(banner, update, ctx)
		"music":
			return Music.page(banner, update, ctx)
		"seasonsAndWeather":
			return Seasons.page(banner, update, ctx)
		"swarms":
			return Swarms.page(banner, update, ctx)
		"espionage2":
			return Espionage2.page(banner, update, ctx)
	return default_banner(banner, update, ctx)


static func chrome(banner: Dictionary, update: Dictionary) -> Dictionary:
	if str(update.get("kind", "")) != "major":
		return {
			"button": {"bg": Color(1, 1, 1, 0.1), "border": Color(1, 1, 1, 0.16), "ink": UpdateKit.INK},
			"arrow": {},
			"dot": {"on": Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.85), "off": Color(1, 1, 1, 0.22)},
			"skip": {},
		}
	match str(banner.get("theme", "")):
		"chronicle":
			return Chronicle.chrome(banner)
		"warsAndFronts2":
			return WarsAndFronts2.chrome()
		"music":
			return Music.chrome()
		"seasonsAndWeather":
			return Seasons.chrome()
		"swarms":
			return Swarms.chrome()
		"espionage2":
			return Espionage2.chrome()
	var palette: Dictionary = banner.get("palette", {})
	var accent := palette_colour(palette, "accent", UpdateKit.ACCENT)
	return {
		"button": {"bg": accent, "border": accent, "ink": palette_colour(palette, "buttonInk", Color("#06121a"))},
		"arrow": {"ink": accent},
		"dot": {"on": accent, "off": Color(1, 1, 1, 0.25)},
		"skip": {},
	}


static func minor_banner(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var plate := UpdateKit.plate({"background": Color("#1c1e22"), "radius": 14.0, "padding": Vector4(px(1.3), px(1.2), px(1.3), px(1.2))}, still)
	var column := UpdateKit.vbox(0)
	var heading := "Update"
	if not str(update.get("date", "")).is_empty():
		heading = "Update" + " · " + str(update.get("dateText", ""))
	column.add_child(UpdateKit.text(heading, px(0.68), UpdateKit.FAINT, UpdateKit.BASE_FONT, 700, false, 0.08, true))
	column.add_child(UpdateKit.gap(px(0.3)))
	column.add_child(UpdateKit.text(str(banner.get("title", "")), px(1.05), UpdateKit.INK, UpdateKit.BASE_FONT, 800))
	var items: Array = banner.get("items", [])
	if not items.is_empty():
		column.add_child(UpdateKit.gap(px(0.6)))
		for item in items:
			column.add_child(UpdateKit.list_item(str(item), px(0.82), UpdateKit.SOFT, UpdateKit.BASE_FONT, 1.5, px(1.1)))
	plate.add_child(column)
	return UpdateKit.plate_reveal(plate, still)


static func default_banner(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var width: float = ctx.get("width", 1440.0)
	var palette: Dictionary = banner.get("palette", {})
	var accent := palette_colour(palette, "accent", UpdateKit.ACCENT)
	var ink := palette_colour(palette, "ink", UpdateKit.INK)
	var soft := palette_colour(palette, "soft", UpdateKit.SOFT)
	var surface := {}
	if palette.has("ground") and not str(palette.get("ground", "")).is_empty():
		surface["background"] = palette_colour(palette, "ground", Color("#15181d"))
	var plate := UpdateKit.plate(surface, still)
	UpdateKit.brackets(plate, accent)
	var body := UpdateKit.vbox(0)
	var row := UpdateKit.hbox(roundi(px(1.0)))
	row.alignment = BoxContainer.ALIGNMENT_BEGIN
	row.add_child(UpdateKit.emblem(accent, 200.0, 68.0, still))
	var words := UpdateKit.vbox(0)
	words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	words.add_child(UpdateKit.text(UpdateKit.major_line(update), px(0.74), accent, UpdateKit.BASE_FONT, 800, false, 0.2, true))
	words.add_child(UpdateKit.para(str(banner.get("title", "")), ShellFonts.clamp_vw(1.6, 5.0, 2.4, width), ink, UpdateKit.BASE_FONT, 900, false, 1.08))
	if not str(banner.get("subtitle", "")).is_empty():
		words.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(0.95), accent, UpdateKit.BASE_FONT, 700, false, 0.04))
	row.add_child(words)
	body.add_child(UpdateKit.reveal(row, 150.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(1.0)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(0.95), soft, UpdateKit.BASE_FONT, 400, false, 1.55), 350.0, still))
	body.add_child(UpdateKit.rule(accent))
	var card := {}
	if palette.has("card") and not str(palette.get("card", "")).is_empty():
		card["background"] = palette_colour(palette, "card", Color(1, 1, 1, 0.04))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), accent, soft, card, UpdateKit.BASE_FONT, true, 450.0, still))
	plate.add_child(UpdateKit.margins(body, px(2.0), px(2.0), px(2.0), px(1.6)))
	return UpdateKit.plate_reveal(plate, still)
