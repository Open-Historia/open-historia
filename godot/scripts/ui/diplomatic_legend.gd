class_name DiplomaticLegend
extends GlassPanel

signal closed
signal colors_ready(colors: Dictionary)

const ITEMS := [
	["You", Color8(37, 99, 235)],
	["Puppets", Color8(20, 184, 166)],
	["Allies", Color8(56, 189, 248)],
	["Friendly / Trade", Color8(34, 197, 94)],
	["Hostile", Color8(249, 115, 22)],
	["At War", Color8(239, 68, 68)],
	["Neutral", Color8(100, 116, 139)],
]

var engine: EngineLink
var context: Dictionary = {}
var neutral_land := Color8(88, 98, 110)
var _rows: VBoxContainer


func _init() -> void:
	super._init(UI.HUD_BG, 10.0, Vector4(10, 7, 10, 8))
	anchor_left = 1.0
	anchor_right = 1.0
	anchor_top = 1.0
	anchor_bottom = 1.0
	offset_right = -80.0
	offset_bottom = -50.0
	offset_left = -80.0 - 125.0
	offset_top = -50.0 - 180.0
	grow_horizontal = Control.GROW_DIRECTION_BEGIN
	grow_vertical = Control.GROW_DIRECTION_BEGIN
	custom_minimum_size.x = 125
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 5)
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 8)
	var title := UI.label("DIPLOMACY", 10, Color(1, 1, 1, 0.75), 700, "Arial", 1)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	header.add_child(title)
	var shut := Button.new()
	shut.text = "✕"
	shut.flat = true
	shut.focus_mode = Control.FOCUS_NONE
	shut.tooltip_text = "Close legend"
	shut.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	shut.add_theme_font_size_override("font_size", 12)
	shut.add_theme_color_override("font_color", Color(1, 1, 1, 0.5))
	shut.add_theme_color_override("font_hover_color", Color(1, 1, 1, 0.8))
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		shut.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	shut.pressed.connect(func() -> void:
		visible = false
		closed.emit())
	header.add_child(shut)
	column.add_child(header)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.1)
	rule.custom_minimum_size.y = 1
	column.add_child(rule)
	_rows = VBoxContainer.new()
	_rows.add_theme_constant_override("separation", 5)
	column.add_child(_rows)
	add_child(column)
	_fill(ITEMS)


func setup(link: EngineLink, setup_context: Dictionary = {}) -> void:
	engine = link
	context = setup_context


func show_legend() -> void:
	visible = true


func hide_legend() -> void:
	visible = false


func _fill(items: Array) -> void:
	for child in _rows.get_children():
		child.queue_free()
	for item in items:
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 7)
		var dot := LegendDot.new()
		dot.color = item[1]
		dot.custom_minimum_size = Vector2(9, 9)
		dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(dot)
		line.add_child(UI.label(str(item[0]), 11, Color(1, 1, 1, 0.9)))
		_rows.add_child(line)


func stance_colors() -> Dictionary:
	if not engine:
		return {}
	var reply: Dictionary = await engine.request("mapcards.stances")
	if not reply.get("ok", false):
		return {}
	var result: Dictionary = reply.get("result", {})
	var land: Array = result.get("neutralLand", [88, 98, 110])
	if land.size() >= 3:
		neutral_land = Color8(int(land[0]), int(land[1]), int(land[2]))
	var colors: Dictionary = result.get("colors", {})
	colors_ready.emit(colors)
	return colors


static func recolor(state: Dictionary, colors: Dictionary) -> Dictionary:
	var next := state.duplicate()
	var names: Array = state.get("ownerNames", [])
	var shades: Array = []
	for name in names:
		var rgb: Array = colors.get(str(name), [100, 116, 139])
		shades.append([int(rgb[0]), int(rgb[1]), int(rgb[2])])
	next["ownerColors"] = shades
	return next


class LegendDot extends Control:
	var color := Color.WHITE

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		draw_circle(size * 0.5, min(size.x, size.y) * 0.5, color, true, -1.0, true)
