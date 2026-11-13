class_name FirstSetup
extends Control

signal finished

const GREETING_SECONDS := 4.4
const GREETING_FADE := 0.6
const ORIGINAL_COLORS := {"background": "#131315", "surface": "#232327", "accent": "#D4D4D8"}
const GREETINGS := [
	["en", "Hello", "Welcome"], ["es", "Hola", "Bienvenido"], ["fr", "Bonjour", "Bienvenue"], ["de", "Hallo", "Willkommen"],
	["zh", "你好", "欢迎"], ["ar", "مرحبا", "أهلاً وسهلاً"], ["pt", "Olá", "Bem-vindo"], ["ru", "Привет", "Добро пожаловать"],
	["ja", "こんにちは", "ようこそ"], ["hi", "नमस्ते", "स्वागत है"], ["it", "Ciao", "Benvenuto"], ["ko", "안녕하세요", "환영합니다"],
	["tr", "Merhaba", "Hoş geldiniz"], ["nl", "Hoi", "Welkom"], ["pl", "Cześć", "Witamy"], ["fa", "سلام", "خوش آمدید"],
	["id", "Halo", "Selamat datang"], ["uk", "Привіт", "Ласкаво просимо"], ["vi", "Xin chào", "Chào mừng"], ["th", "สวัสดี", "ยินดีต้อนรับ"],
	["sv", "Hej", "Välkommen"], ["bn", "নমস্কার", "স্বাগতম"], ["ro", "Salut", "Bun venit"], ["hu", "Szia", "Üdvözöljük"],
	["ur", "آداب", "خوش آمدید"], ["da", "Goddag", "Velkommen"], ["cs", "Ahoj", "Vítejte"], ["fi", "Hei", "Tervetuloa"],
	["el", "Γεια σας", "Καλώς ήρθατε"], ["he", "שלום", "ברוכים הבאים"], ["sk", "Ahoj", "Vitajte"], ["lt", "Labas", "Sveiki atvykę"],
	["lv", "Sveiki", "Laipni lūdzam"], ["et", "Tere", "Tere tulemast"], ["ga", "Dia duit", "Fáilte"], ["mt", "Bonġu", "Merħba"],
]
const RTL_GREETINGS := ["ar", "he", "fa", "ur"]
const BG := Color("#0f0f11")
const INK := Color("#f4f4f5")
const MUTED := Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.62)
const SOFT := Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.72)
const NAME_INK := Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.55)
const SURFACE := Color("#1b1b1e")
const HOVER := Color("#232327")
const RAISED := Color("#26262b")
const LINE := Color(1, 1, 1, 0.1)

var engine: EngineLink
var choose_language: Callable
var still := false
var step := 0

var _backdrop: ColorRect
var _scroll: ScrollContainer
var _page_holder: CenterContainer
var _steps: HBoxContainer
var _greeting: Control
var _greeting_at := 0
var _greeting_timer: Timer
var _options: Array = []
var _current := "en"
var _busy := ""
var _leaving := false
var _phone := false
var _scroll_body: VBoxContainer


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	_backdrop = ColorRect.new()
	_backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_backdrop.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_backdrop)
	_phone = UI.phone()
	var safe := UI.safe_insets()
	var frame := MarginContainer.new()
	frame.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in [["margin_left", 16 + safe.x], ["margin_right", 16 + safe.z], ["margin_top", 24 + safe.y], ["margin_bottom", 19 + safe.w]]:
		frame.add_theme_constant_override(side[0], roundi(side[1]))
	add_child(frame)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	frame.add_child(column)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(_scroll)
	_page_holder = CenterContainer.new()
	_page_holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_page_holder.size_flags_vertical = Control.SIZE_EXPAND_FILL
	if _phone:
		_scroll_body = VBoxContainer.new()
		_scroll_body.add_theme_constant_override("separation", 0)
		_scroll_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_scroll.add_child(_scroll_body)
		_scroll_body.add_child(_page_holder)
	else:
		_scroll.add_child(_page_holder)
	_scroll.resized.connect(_fit_holder)
	var steps_margin := MarginContainer.new()
	steps_margin.add_theme_constant_override("margin_top", 19)
	_steps = HBoxContainer.new()
	_steps.alignment = BoxContainer.ALIGNMENT_CENTER
	_steps.add_theme_constant_override("separation", 7)
	steps_margin.add_child(_steps)
	if _phone:
		_scroll_body.add_child(steps_margin)
	else:
		column.add_child(steps_margin)
	_greeting_timer = Timer.new()
	_greeting_timer.wait_time = GREETING_SECONDS
	_greeting_timer.timeout.connect(_next_greeting)
	add_child(_greeting_timer)
	UiTheme.events().changed.connect(_render)


func open(link: EngineLink, language_switch: Callable, reduce_motion := false) -> void:
	engine = link
	choose_language = language_switch
	still = reduce_motion
	var reply: Dictionary = await engine.request("look.languages")
	if reply.get("ok", false):
		var result: Dictionary = reply["result"]
		_options = result.get("options", [])
		_current = str(result.get("current", "en"))
	if _options.is_empty():
		_options = [{"code": "en", "name": "English", "native": "English"}]
	step = 0
	_render()
	if not still:
		_greeting_timer.start()


func _fit_holder() -> void:
	if _phone:
		_scroll_body.custom_minimum_size = Vector2(_scroll.size.x, _scroll.size.y)
		return
	_page_holder.custom_minimum_size = Vector2(_scroll.size.x, _scroll.size.y)


func _page_width() -> float:
	return minf(992.0, maxf(240.0, _scroll.size.x if _scroll.size.x > 0.0 else get_viewport_rect().size.x - 32.0))


func _render() -> void:
	if not is_instance_valid(_page_holder):
		return
	_backdrop.color = UiTheme.pick("bg", BG)
	for child in _page_holder.get_children():
		_page_holder.remove_child(child)
		child.queue_free()
	var page := _language_page() if step == 0 else _theme_page()
	_page_holder.add_child(page)
	_render_steps()
	if not still:
		page.modulate.a = 0.0
		var tween := create_tween().set_parallel(true)
		tween.tween_property(page, "modulate:a", 1.0, 0.45).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)


func _render_steps() -> void:
	for child in _steps.get_children():
		_steps.remove_child(child)
		child.queue_free()
	for index in range(2):
		var dot := Panel.new()
		var on := index == step
		dot.custom_minimum_size = Vector2(22.4 if on else 7.2, 7.2)
		dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
		dot.add_theme_stylebox_override("panel", UI.box(UiTheme.pick("text", INK) if on else UiTheme.pick("line", Color(1, 1, 1, 0.2)), Color(0, 0, 0, 0), 999, 0))
		dot.set_meta("on", on)
		_steps.add_child(dot)


func _page() -> VBoxContainer:
	var page := VBoxContainer.new()
	page.add_theme_constant_override("separation", 18 if _phone else 22)
	page.custom_minimum_size.x = _page_width()
	page.alignment = BoxContainer.ALIGNMENT_CENTER
	return page


func _title(value: String, large: bool) -> Label:
	var label := UI.label(value, (24 if _phone else 34) if large else 15, UiTheme.pick("text", INK) if large else UiTheme.pick("muted", MUTED), 800 if large else 600, "Arial", -1 if large else 0)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.set_meta("setup_title", true)
	return label


func _language_page() -> VBoxContainer:
	var page := _page()
	_greeting = Control.new()
	_greeting.custom_minimum_size = Vector2(0, 112.0 if _phone else 137.6)
	_greeting.clip_contents = true
	_greeting.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_greeting.resized.connect(_place_greeting)
	page.add_child(_greeting)
	_show_greeting()
	page.add_child(_title("Choose your language", false))
	var grid := GridContainer.new()
	var wide := _page_width()
	grid.columns = 2 if _phone else maxi(1, int(floor((wide + 8.8) / (153.6 + 8.8))))
	grid.add_theme_constant_override("h_separation", 9)
	grid.add_theme_constant_override("v_separation", 9)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for item in _options:
		grid.add_child(_language_button(item))
	page.add_child(grid)
	return page


func _greeting_words(index: int) -> VBoxContainer:
	var entry: Array = GREETINGS[index % GREETINGS.size()]
	var words := VBoxContainer.new()
	words.add_theme_constant_override("separation", 6)
	words.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var direction := Control.TEXT_DIRECTION_RTL if str(entry[0]) in RTL_GREETINGS else Control.TEXT_DIRECTION_LTR
	var hello := UI.label(str(entry[1]), 45 if _phone else 74, UiTheme.pick("text", INK), 800, "Arial", -2)
	hello.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hello.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	hello.text_direction = direction
	hello.language = str(entry[0])
	words.add_child(hello)
	var welcome := UI.label(str(entry[2]), 17 if _phone else 22, UiTheme.pick("muted", SOFT), 600)
	welcome.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	welcome.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	welcome.text_direction = direction
	welcome.language = str(entry[0])
	words.add_child(welcome)
	words.set_meta("greeting", str(entry[0]))
	return words


func _show_greeting() -> void:
	if not is_instance_valid(_greeting):
		return
	var leaving := false
	for child in _greeting.get_children():
		var old := child as Control
		if still or old == null or old.modulate.a <= 0.01:
			_greeting.remove_child(child)
			child.queue_free()
			continue
		leaving = true
		old.set_meta("leaving", true)
		var from := old.position.y
		var out := old.create_tween().set_parallel(true)
		out.tween_property(old, "modulate:a", 0.0, GREETING_FADE).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
		out.tween_property(old, "position:y", from - 12.0, GREETING_FADE).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
		out.chain().tween_callback(old.queue_free)
	var words := _greeting_words(_greeting_at)
	_greeting.add_child(words)
	if not still:
		words.modulate.a = 0.0
		words.set_meta("lift", 18.0)
	_place_greeting.call_deferred()
	if still:
		return
	var rise := func(value: float) -> void:
		if is_instance_valid(words):
			words.set_meta("lift", value)
			_place_greeting()
	var tween := words.create_tween()
	if leaving:
		tween.tween_interval(GREETING_FADE)
	tween.tween_property(words, "modulate:a", 1.0, GREETING_FADE).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	tween.parallel().tween_method(rise, 18.0, 0.0, GREETING_FADE).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)


func _place_greeting() -> void:
	if not is_instance_valid(_greeting) or _greeting.get_child_count() == 0:
		return
	var words := _greeting.get_child(_greeting.get_child_count() - 1) as Control
	if words == null or words.has_meta("leaving"):
		return
	var natural := words.get_combined_minimum_size()
	words.size = Vector2(_greeting.size.x, natural.y)
	words.position = Vector2(0, (_greeting.size.y - natural.y) * 0.5 + float(words.get_meta("lift", 0.0)))


func _next_greeting() -> void:
	if step != 0:
		return
	_greeting_at = (_greeting_at + 1) % GREETINGS.size()
	_show_greeting()


func _card_styles(pressed: bool, radius := 12) -> Array:
	var rest := UI.box(UiTheme.pick("raised", RAISED) if pressed else UiTheme.pick("surface", SURFACE), UiTheme.pick("text", INK) if pressed else UiTheme.pick("line", LINE), radius, 2 if pressed else 1)
	var over := UI.box(UiTheme.pick("raised", RAISED) if pressed else UiTheme.pick("hover", HOVER), UiTheme.pick("text", INK) if pressed else UiTheme.pick("line", Color(1, 1, 1, 0.22)), radius, 2 if pressed else 1)
	return [rest, over]


func _language_button(item: Dictionary) -> Choice:
	var code := str(item.get("code", ""))
	var pressed := code == _current
	var styles := _card_styles(pressed)
	var button := Choice.new(styles[0], styles[1], Vector4(12.8, 9.6, 12.8, 9.6))
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	button.custom_minimum_size.y = 54.4
	button.set_meta("language", code)
	button.set_meta("pressed", pressed)
	button.disabled = not _busy.is_empty() and _busy != code
	if button.disabled:
		button.modulate.a = 0.45
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 2)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.alignment = BoxContainer.ALIGNMENT_BEGIN
	var native := str(item.get("native", code))
	var english := str(item.get("name", code))
	var first := UI.wrapped(native, 16, UiTheme.pick("text", INK), 700)
	first.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	first.add_theme_constant_override("line_spacing", 0)
	first.custom_minimum_size.x = 1
	column.add_child(first)
	if native != english:
		var second := UI.wrapped(english, 12, UiTheme.pick("muted", NAME_INK))
		second.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		second.add_theme_constant_override("line_spacing", 0)
		second.custom_minimum_size.x = 1
		column.add_child(second)
	button.body.add_child(column)
	button.pressed.connect(_choose.bind(code))
	return button


func _choose(code: String) -> void:
	if not _busy.is_empty():
		return
	_busy = code
	_render()
	var shown := code
	if choose_language.is_valid():
		shown = str(await choose_language.call(code))
	_current = shown
	_busy = ""
	if shown == code:
		step = 1
		_greeting_timer.stop()
	_render()


func _theme_page() -> VBoxContainer:
	var page := _page()
	page.add_child(_title("Choose your theme", true))
	var grid := GridContainer.new()
	var wide := _page_width()
	grid.columns = 2 if _phone else maxi(1, int(floor((wide + 12.8) / (208.0 + 12.8))))
	grid.add_theme_constant_override("h_separation", 13)
	grid.add_theme_constant_override("v_separation", 13)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.add_child(_theme_button(UiTheme.DEFAULT, "Default (Original)", ORIGINAL_COLORS))
	for item in UiTheme.PRESETS:
		grid.add_child(_theme_button(str(item["id"]), str(item["name"]), item["colors"]))
	page.add_child(grid)
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	actions.add_theme_constant_override("separation", 11)
	var back := _action("Back", false)
	if _phone:
		actions.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	back.pressed.connect(func() -> void:
		step = 0
		_render()
		if not still:
			_greeting_timer.start())
	actions.add_child(back)
	var go := _action("Continue", true)
	if _phone:
		for button in [back, go]:
			button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			button.custom_minimum_size.x = 0
	go.pressed.connect(_finish)
	actions.add_child(go)
	page.add_child(actions)
	return page


func _theme_button(id: String, label: String, colors: Dictionary) -> Choice:
	var pressed := UiTheme.preset == id
	var styles := _card_styles(pressed)
	var button := Choice.new(styles[0], styles[1], Vector4(9.6, 9.6, 9.6, 9.6))
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	button.set_meta("theme_id", id)
	button.set_meta("pressed", pressed)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 10)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sample := SetupSample.new()
	sample.colors = colors
	sample.custom_minimum_size.y = 76.8 if _phone else 102.4
	sample.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(sample)
	var name_margin := MarginContainer.new()
	for side in [["margin_left", 3], ["margin_right", 3], ["margin_bottom", 2]]:
		name_margin.add_theme_constant_override(side[0], side[1])
	var named := UI.label(label, 14, UiTheme.pick("text", INK), 700)
	named.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED if not UiTheme.preset_named(id).is_empty() else Node.AUTO_TRANSLATE_MODE_INHERIT
	name_margin.add_child(named)
	column.add_child(name_margin)
	button.body.add_child(column)
	button.pressed.connect(func() -> void: UiTheme.select(id))
	return button


func _action(value: String, primary: bool) -> Button:
	var button := Button.new()
	button.text = value
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.custom_minimum_size = Vector2(144 if primary else 0, 44)
	button.add_theme_font_override("font", UI.font(700))
	button.add_theme_font_size_override("font_size", 15)
	var ink := UiTheme.pick("bg", Color("#0b0b0d")) if primary else UiTheme.pick("text", INK)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		button.add_theme_color_override(name, ink)
	var face := UI.box(UiTheme.pick("text", INK), UiTheme.pick("text", INK), 10, 1, Vector4(22.4, 0, 22.4, 0)) if primary else UI.box(Color(0, 0, 0, 0), UiTheme.pick("line", Color(1, 1, 1, 0.18)), 10, 1, Vector4(22.4, 0, 22.4, 0))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
		button.add_theme_stylebox_override(state, face)
	return button


func _finish() -> void:
	if _leaving:
		return
	_leaving = true
	_greeting_timer.stop()
	if engine:
		engine.request("look.setup.done")
	if still:
		finished.emit()
		return
	var tween := create_tween()
	tween.tween_property(self, "modulate:a", 0.0, 0.32).set_trans(Tween.TRANS_CUBIC)
	tween.finished.connect(func() -> void: finished.emit())


class Choice:
	extends PanelContainer

	signal pressed

	var disabled := false
	var body: MarginContainer
	var _rest: StyleBox
	var _over: StyleBox

	func _init(rest: StyleBox, over: StyleBox, pad: Vector4) -> void:
		_rest = rest
		_over = over
		add_theme_stylebox_override("panel", _rest)
		mouse_filter = Control.MOUSE_FILTER_STOP
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		body = MarginContainer.new()
		body.mouse_filter = Control.MOUSE_FILTER_IGNORE
		body.add_theme_constant_override("margin_left", int(round(pad.x)))
		body.add_theme_constant_override("margin_top", int(round(pad.y)))
		body.add_theme_constant_override("margin_right", int(round(pad.z)))
		body.add_theme_constant_override("margin_bottom", int(round(pad.w)))
		add_child(body)
		mouse_entered.connect(func() -> void:
			if not disabled:
				add_theme_stylebox_override("panel", _over))
		mouse_exited.connect(func() -> void: add_theme_stylebox_override("panel", _rest))

	func _gui_input(event: InputEvent) -> void:
		if disabled:
			return
		var click := event as InputEventMouseButton
		if click and click.button_index == MOUSE_BUTTON_LEFT and not click.pressed:
			pressed.emit()
			accept_event()


class SetupSample:
	extends Control

	var colors := {}

	func _draw() -> void:
		var bg := Color(str(colors.get("background", "#131315")))
		var surface := Color(str(colors.get("surface", "#232327")))
		var accent := Color(str(colors.get("accent", "#D4D4D8")))
		var frame := UI.box(bg, Color(1, 1, 1, 0.12), 8, 1)
		draw_style_box(frame, Rect2(Vector2.ZERO, size))
		var inner := Rect2(6.4, 6.4, size.x - 12.8, size.y - 12.8)
		var rail_w := inner.size.x * 0.18
		var rail := Rect2(inner.position, Vector2(rail_w, inner.size.y))
		draw_style_box(UI.box(surface, Color(0, 0, 0, 0), 5, 0), rail)
		var chip_w := rail_w - 9.6
		for index in range(3):
			var chip := Rect2(rail.position.x + 4.8, rail.position.y + 4.8 + index * (8.8 + 4.8), chip_w, 8.8)
			draw_style_box(UI.box(accent if index == 0 else Color(1, 1, 1, 0.2), Color(0, 0, 0, 0), 3, 0), chip)
		var main_x := rail.end.x + 5.6
		var main_w := inner.end.x - main_x
		var bar := Rect2(main_x, inner.position.y, main_w, 14.4)
		draw_style_box(UI.box(surface, Color(0, 0, 0, 0), 4, 0), bar)
		var button_h := 12.0
		var cards_top := bar.end.y + 5.6
		var cards_h := inner.end.y - button_h - 5.6 - cards_top
		var card_w := (main_w - 5.6) * 0.5
		for index in range(2):
			draw_style_box(UI.box(surface, Color(0, 0, 0, 0), 5, 0), Rect2(main_x + index * (card_w + 5.6), cards_top, card_w, cards_h))
		var button_w := main_w * 0.36
		draw_style_box(UI.box(accent, Color(0, 0, 0, 0), 4, 0), Rect2(inner.end.x - button_w, inner.end.y - button_h, button_w, button_h))
