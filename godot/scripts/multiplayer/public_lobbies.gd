class_name PublicLobbies
extends PanelContainer

const CARD_BG := Color("#12141a")
const CARD_BORDER := Color(1, 1, 1, 0.09)
const FIELD_BG := Color(1, 1, 1, 0.04)
const FIELD_BORDER := Color(1, 1, 1, 0.1)
const FIELD_INK := Color("#f8fafc")
const CELL_INK := Color(1, 1, 1, 0.82)
const HEAD_INK := Color(1, 1, 1, 0.55)
const RULE := Color(1, 1, 1, 0.06)
const SAMPLE := [
	{"name": "The Baltic Question", "scenario": "Fault Lines", "players": 4, "seats": 8, "minutes": 20, "language": "en", "cheats": "off", "password": false},
	{"name": "Weltpolitik 1914", "scenario": "The Great War", "players": 6, "seats": 8, "minutes": 45, "language": "de", "cheats": "vote", "password": false},
	{"name": "Cold War, slow rounds", "scenario": "Modern Day", "players": 2, "seats": 6, "minutes": 1440, "language": "en", "cheats": "off", "password": true},
]
const FILTERS := [
	[["Any language", ""], ["English", "en"], ["German", "de"], ["French", "fr"], ["Spanish", "es"], ["Russian", "ru"]],
	[["Cheats: any", ""], ["Cheats off", "off"], ["Cheats by vote", "vote"], ["Host's cheats", "host"]],
	[["Any open seats", ""], ["1+ open", "1"], ["2+ open", "2"], ["4+ open", "4"]],
	[["Password: any", ""], ["No password", "no"], ["Password", "yes"]],
]
const COLUMNS := ["Lobby", "Scenario", "Players", "Rounds", "Language", "Cheats", ""]
const VEIL_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D screen_texture : hint_screen_texture, filter_linear;
uniform float blur_px = 2.0;
uniform float saturation = 0.6;
void fragment() {
	vec3 sum = vec3(0.0);
	float total = 0.0;
	for (int x = -2; x <= 2; x++) {
		for (int y = -2; y <= 2; y++) {
			float w = exp(-float(x * x + y * y) / 4.0);
			sum += texture(screen_texture, SCREEN_UV + vec2(float(x), float(y)) * SCREEN_PIXEL_SIZE * blur_px * 0.5).rgb * w;
			total += w;
		}
	}
	vec3 colour = sum / total;
	float grey = dot(colour, vec3(0.2126, 0.7152, 0.0722));
	COLOR = vec4(mix(vec3(grey), colour, saturation), 1.0);
}
"""

static var _veil_shader: Shader

var _content: VBoxContainer
var _veil: ColorRect
var _copy: BackBufferCopy


func _init() -> void:
	add_theme_stylebox_override("panel", UI.box(CARD_BG, CARD_BORDER, 18, 1, Vector4(21, 19, 21, 19)))
	clip_contents = true
	var stack := Control.new()
	stack.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(stack)
	_content = VBoxContainer.new()
	_content.add_theme_constant_override("separation", 0)
	_content.modulate.a = 0.5
	_content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	stack.add_child(_content)
	_build_list()
	_copy = BackBufferCopy.new()
	_copy.copy_mode = BackBufferCopy.COPY_MODE_RECT
	stack.add_child(_copy)
	if not _veil_shader:
		_veil_shader = Shader.new()
		_veil_shader.code = VEIL_SHADER
	_veil = ColorRect.new()
	var material := ShaderMaterial.new()
	material.shader = _veil_shader
	_veil.material = material
	_veil.mouse_filter = Control.MOUSE_FILTER_STOP
	stack.add_child(_veil)
	var cover := CenterContainer.new()
	cover.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cover.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var words := VBoxContainer.new()
	words.add_theme_constant_override("separation", 8)
	words.alignment = BoxContainer.ALIGNMENT_CENTER
	var title := UI.label("Coming soon", 54, Color(1, 1, 1), 900, "Arial", -2)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	words.add_child(title)
	var line := UI.wrapped("Public lobbies need a server of our own. Until then, join a private lobby with its invite code, or host one.", 14, Color(1, 1, 1, 0.75))
	line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	line.custom_minimum_size.x = 416
	CommunityKit.leading(line, 14, 1.3)
	words.add_child(line)
	cover.add_child(words)
	stack.add_child(cover)
	stack.resized.connect(func() -> void:
		_content.size = Vector2(stack.size.x, _content.get_combined_minimum_size().y)
		_veil.position = Vector2.ZERO
		_veil.size = stack.size
		_copy.rect = Rect2(Vector2.ZERO, stack.size)
		cover.size = stack.size)
	_content.minimum_size_changed.connect(func() -> void: stack.custom_minimum_size.y = _content.get_combined_minimum_size().y)
	stack.custom_minimum_size.y = _content.get_combined_minimum_size().y


func _field_style() -> StyleBoxFlat:
	return UI.box(FIELD_BG, FIELD_BORDER, 9, 1, Vector4(11, 8, 11, 8))


func _build_list() -> void:
	var heading := UI.label("Public lobbies", 18, Color(1, 1, 1), 800)
	_content.add_child(CommunityKit.margin_below(heading, 13))
	var filters := CommunityKit.flow(8, 8)
	var search := LineEdit.new()
	search.placeholder_text = "Search names and scenarios"
	search.max_length = 60
	search.custom_minimum_size = Vector2(192, 34)
	search.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	search.add_theme_stylebox_override("normal", _field_style())
	search.add_theme_stylebox_override("focus", _field_style())
	search.add_theme_font_override("font", UI.font(400))
	search.add_theme_font_size_override("font_size", 13)
	search.add_theme_color_override("font_color", FIELD_INK)
	search.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.42))
	search.editable = false
	filters.add_child(search)
	for options in FILTERS:
		var select := OptionButton.new()
		for option in options:
			select.add_item(str(option[0]))
		select.selected = 0
		select.focus_mode = Control.FOCUS_NONE
		select.custom_minimum_size.y = 34
		for state in ["normal", "hover", "pressed", "focus", "disabled"]:
			select.add_theme_stylebox_override(state, _field_style())
		select.add_theme_font_override("font", UI.font(400))
		select.add_theme_font_size_override("font_size", 13)
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_disabled_color"]:
			select.add_theme_color_override(name, FIELD_INK)
		select.disabled = true
		filters.add_child(select)
	_content.add_child(CommunityKit.margin_below(filters, 13))
	var table := GridContainer.new()
	table.columns = COLUMNS.size()
	table.add_theme_constant_override("h_separation", 0)
	table.add_theme_constant_override("v_separation", 0)
	for title in COLUMNS:
		table.add_child(_cell(str(title).to_upper(), true, false))
	for room in SAMPLE:
		var entry: Dictionary = room
		table.add_child(_cell(str(entry["name"]) + (" 🔒" if entry["password"] else ""), false, true))
		table.add_child(_cell(str(entry["scenario"]), false, true))
		table.add_child(_cell("%d / %d" % [int(entry["players"]), int(entry["seats"])], false, true))
		var minutes := int(entry["minutes"])
		table.add_child(_cell("%d h" % int(round(minutes / 60.0)) if minutes >= 60 else "%d min" % minutes, false, true))
		table.add_child(_cell(str(entry["language"]), false, true))
		table.add_child(_cell(str(entry["cheats"]), false, true))
		var join_cell := _cell("", false, true)
		var join := Button.new()
		join.text = "Join"
		join.disabled = true
		join.focus_mode = Control.FOCUS_NONE
		for state in ["normal", "hover", "pressed", "focus", "disabled"]:
			join.add_theme_stylebox_override(state, _field_style())
		join.add_theme_font_override("font", UI.font(400))
		join.add_theme_font_size_override("font_size", 13)
		join.add_theme_color_override("font_disabled_color", FIELD_INK)
		join.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		(join_cell.get_child(0) as Control).queue_free()
		join_cell.add_child(join)
		table.add_child(join_cell)
	_content.add_child(table)


func _cell(value: String, head: bool, ruled: bool) -> PanelContainer:
	var cell := PanelContainer.new()
	var style := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(8, 9, 8, 9))
	if ruled:
		style.border_color = RULE
		style.border_width_top = 1
	cell.add_theme_stylebox_override("panel", style)
	cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var words := UI.label(value, 11 if head else 13, HEAD_INK if head else CELL_INK, 700 if head else 400)
	cell.add_child(words)
	return cell
