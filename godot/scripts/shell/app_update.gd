class_name AppUpdate
extends CanvasLayer

signal launch_step

const LAYER := 55
const CHECK_INTERVAL := 180.0
const INSTALL_DELAY := 0.6
const PAGE := Color("#131315")
const INK := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 1.0)
const SOFT := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.62)
const FAINT := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.6)
const LINE := Color(1, 1, 1, 0.14)
const TRACK := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.12)
const CARD_WIDTH := 472.0
const SETTLED := ["ready", "error", "none"]
const COVER_TITLE := "Updating Open Historia"
const LEDE_VERSION := "Version %s of the super-experimental native build is downloading. The game opens on it as soon as it is installed — your games are kept."
const LEDE_BUILD := "A new super-experimental native build is downloading. The game opens on it as soon as it is installed — your games are kept."
const PLAY_NOW := "Or play on this version now: the update then installs when you close the game."
const OPEN_NOW := "Open the game now"
const OPENING := "Opening the game…"
const FAILED_OPENING := "The update did not download. Opening the game…"
const NOT_INSTALLED_OPENING := "The update did not install. Opening the game…"
const INSTALLING := "Installing — the game reopens by itself in a few seconds."
const HEADLINE := "A new super-experimental native build of Open Historia is ready."

var engine: EngineLink
var state := {}
var launching := false
var cover: Control
var banner: PanelContainer
var _cover_title: Label
var _cover_lede: Label
var _cover_bar: Bar
var _cover_pct: Label
var _cover_update: VBoxContainer
var _cover_later: Button
var _banner_head: Label
var _banner_sub: Label
var _banner_button: Button
var _banner_close: Button
var _timer: Timer
var _later := false
var _tracking := false
var _opening := false
var _checks_started := false
var _launch_build := ""
var _restart_ready := false


class Bar extends Control:
	var fraction := 0.0
	var _tween: Tween

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(0, 10)
		size_flags_horizontal = Control.SIZE_EXPAND_FILL

	func show_fraction(value: float) -> void:
		var goal := clampf(value, 0.0, 1.0)
		if _tween:
			_tween.kill()
		_tween = create_tween()
		_tween.tween_method(func(t: float) -> void:
			fraction = t
			queue_redraw(), fraction, goal, 0.25)

	func _draw() -> void:
		var track := StyleBoxFlat.new()
		track.bg_color = TRACK
		track.border_color = LINE
		track.set_border_width_all(1)
		track.set_corner_radius_all(99)
		track.anti_aliasing = true
		draw_style_box(track, Rect2(Vector2.ZERO, size))
		if fraction <= 0.0:
			return
		var fill := StyleBoxFlat.new()
		fill.bg_color = UI.ACCENT
		fill.set_corner_radius_all(99)
		fill.anti_aliasing = true
		draw_style_box(fill, Rect2(Vector2.ZERO, Vector2(maxf(size.y, size.x * fraction), size.y)))


func _init() -> void:
	layer = LAYER
	_build_cover()
	_build_banner()
	_timer = Timer.new()
	_timer.wait_time = CHECK_INTERVAL
	_timer.timeout.connect(_probe)
	add_child(_timer)


func setup(link: EngineLink) -> void:
	engine = link
	if engine and not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)


func _build_cover() -> void:
	cover = Control.new()
	cover.name = "UpdateCover"
	cover.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	cover.mouse_filter = Control.MOUSE_FILTER_STOP
	cover.visible = false
	add_child(cover)
	var page := ColorRect.new()
	page.color = PAGE
	page.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cover.add_child(page)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cover.add_child(centre)
	var card := VBoxContainer.new()
	card.custom_minimum_size = Vector2(CARD_WIDTH, 0)
	card.add_theme_constant_override("separation", 0)
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	centre.add_child(card)
	_cover_title = UI.label(COVER_TITLE, 18, INK, 700)
	card.add_child(_cover_title)
	card.add_child(_gap(6))
	_cover_lede = UI.wrapped(LEDE_BUILD, 14, SOFT)
	_cover_lede.custom_minimum_size.x = CARD_WIDTH
	card.add_child(_cover_lede)
	card.add_child(_gap(22))
	_cover_bar = Bar.new()
	card.add_child(_cover_bar)
	card.add_child(_gap(10))
	_cover_pct = UI.label("Starting…", 14, INK, 700)
	card.add_child(_cover_pct)
	_cover_update = VBoxContainer.new()
	_cover_update.add_theme_constant_override("separation", 14)
	_cover_update.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_cover_update.visible = false
	card.add_child(_gap(14))
	card.add_child(_cover_update)
	var play_now := UI.wrapped(PLAY_NOW, 14, SOFT)
	play_now.custom_minimum_size.x = CARD_WIDTH
	_cover_update.add_child(play_now)
	var actions := HBoxContainer.new()
	actions.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_cover_update.add_child(actions)
	_cover_later = _quiet_button(OPEN_NOW)
	_cover_later.pressed.connect(_on_later)
	actions.add_child(_cover_later)


func _build_banner() -> void:
	banner = PanelContainer.new()
	banner.name = "UpdateBanner"
	banner.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	banner.mouse_filter = Control.MOUSE_FILTER_STOP
	var style := UI.box(PAGE, Color(0, 0, 0, 0), 0, 0, Vector4(14, 9, 14, 9))
	style.border_color = LINE
	style.border_width_bottom = 1
	banner.add_theme_stylebox_override("panel", style)
	banner.visible = false
	add_child(banner)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	banner.add_child(row)
	var texts := VBoxContainer.new()
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	texts.add_theme_constant_override("separation", 1)
	texts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(texts)
	_banner_head = UI.label(HEADLINE, 14, INK, 600)
	_banner_head.clip_text = true
	texts.add_child(_banner_head)
	_banner_sub = UI.label("", 12, FAINT, 400)
	_banner_sub.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_banner_sub.clip_text = true
	_banner_sub.mouse_filter = Control.MOUSE_FILTER_PASS
	texts.add_child(_banner_sub)
	_banner_button = UI.button("Update now", "accent")
	_banner_button.add_theme_font_size_override("font_size", 13)
	_banner_button.custom_minimum_size = Vector2(0, 31)
	_banner_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_banner_button.pressed.connect(_on_banner_button)
	row.add_child(_banner_button)
	_banner_close = UI.button("×", "plain")
	_banner_close.add_theme_font_size_override("font_size", 18)
	_banner_close.add_theme_font_override("font", UI.font(400))
	_banner_close.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_banner_close.tooltip_text = "Dismiss update notice"
	_banner_close.pressed.connect(_on_dismiss)
	row.add_child(_banner_close)


func _gap(height: float) -> Control:
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, height)
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return gap


func _quiet_button(text: String) -> Button:
	var button := UI.button(text, "small")
	var normal := UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.22), 8, 1, Vector4(14, 0, 14, 0))
	var hover := UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.32), 8, 1, Vector4(14, 0, 14, 0))
	for name in ["normal", "focus", "disabled"]:
		button.add_theme_stylebox_override(name, normal)
	for name in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(name, hover)
	button.add_theme_font_override("font", UI.font(700))
	button.add_theme_font_size_override("font_size", 13)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		button.add_theme_color_override(name, INK)
	button.custom_minimum_size.y = 34
	return button


func _on_engine_event(event_name: String, data: Variant) -> void:
	if event_name != "update.state" or not (data is Dictionary):
		return
	state = data
	var phase := str(state.get("state", ""))
	if not launching and not _tracking and phase in ["downloading", "ready"]:
		_tracking = true
	if launching:
		_refresh_cover()
	_refresh_banner()
	launch_step.emit()


func run_launch() -> bool:
	if engine == null:
		return false
	var reply: Dictionary = await engine.request("update.launch")
	var result: Dictionary = {}
	if bool(reply.get("ok", false)) and reply.get("result") is Dictionary:
		result = reply["result"]
	if not bool(result.get("update", false)):
		_start_checks()
		return false
	launching = true
	_later = false
	_launch_build = str(result.get("build", ""))
	var current: Dictionary = result.get("current", {}) if result.get("current") is Dictionary else {}
	var version := str(result.get("version", ""))
	_cover_title.text = COVER_TITLE
	_cover_lede.text = LEDE_VERSION % version if not version.is_empty() and version != str(current.get("version", "")) else LEDE_BUILD
	_cover_pct.text = "0%"
	_cover_bar.fraction = 0.0
	_cover_bar.queue_redraw()
	_cover_update.visible = true
	_cover_later.disabled = false
	cover.visible = true
	banner.visible = false
	var started: Dictionary = await engine.request("update.download", {"launch": true})
	if not bool(started.get("ok", false)):
		return await _open_game(FAILED_OPENING)
	while true:
		if _later:
			return await _open_game(OPENING)
		var phase := str(state.get("state", ""))
		if phase == "ready" and str(state.get("build", "")) == _launch_build:
			break
		if phase == "error":
			return await _open_game(FAILED_OPENING)
		await launch_step
	_cover_update.visible = false
	_cover_bar.show_fraction(1.0)
	_cover_pct.text = INSTALLING
	await get_tree().create_timer(INSTALL_DELAY).timeout
	var installed: Dictionary = await engine.request("update.install", {"launch": true})
	if not bool(installed.get("ok", false)):
		return await _open_game(NOT_INSTALLED_OPENING)
	_quit_for_update()
	return true


func _refresh_cover() -> void:
	if not cover.visible or _later:
		return
	var phase := str(state.get("state", ""))
	if phase == "downloading" or phase == "available" or phase == "checking":
		var percent := clampi(int(state.get("percent", 0)), 0, 100)
		_cover_bar.show_fraction(percent / 100.0)
		_cover_pct.text = "%d%%" % percent


func _on_later() -> void:
	if not launching or _later:
		return
	_later = true
	_cover_later.disabled = true
	_cover_pct.text = OPENING
	if engine:
		engine.request("update.later")
	launch_step.emit()


func _open_game(message: String) -> bool:
	_cover_update.visible = false
	_cover_pct.text = message
	await get_tree().create_timer(0.9 if message != OPENING else 0.35).timeout
	cover.visible = false
	launching = false
	_tracking = str(state.get("state", "")) in ["checking", "available", "downloading", "ready"]
	_start_checks()
	return false


func _quit_for_update() -> void:
	if engine:
		engine.stop()
	get_tree().quit()


func install_on_quit() -> void:
	if engine == null or not engine.is_ready():
		return
	if str(state.get("state", "")) != "ready" or not bool(state.get("canInstall", false)):
		return
	await engine.request("update.install", {"relaunch": false})


func _start_checks() -> void:
	if _checks_started:
		_refresh_banner()
		return
	_checks_started = true
	_timer.start()
	await _probe()


func _probe() -> void:
	if engine == null or not engine.is_ready() or launching:
		return
	var reply: Dictionary = await engine.request("update.check")
	if not bool(reply.get("ok", false)):
		return
	var answer: Dictionary = await engine.request("update.state")
	if bool(answer.get("ok", false)) and answer.get("result") is Dictionary:
		_on_engine_event("update.state", answer["result"])
		if not bool(state.get("supported", false)):
			_timer.stop()


func _offer() -> Dictionary:
	if not bool(state.get("supported", false)) or not bool(state.get("available", false)):
		return {}
	var latest: Variant = state.get("latest")
	return latest if latest is Dictionary else {}


static func describe_failure(error: String) -> String:
	var spaces := RegEx.create_from_string("\\s+")
	var reason := spaces.sub(error, " ", true).strip_edges()
	while not reason.is_empty() and (reason.ends_with(".") or reason.ends_with(" ")):
		reason = reason.left(reason.length() - 1)
	if reason.length() > 160:
		reason = reason.left(159) + "…"
	return "The app could not update itself: %s." % reason if not reason.is_empty() else "The app could not update itself."


func _phase() -> String:
	return str(state.get("state", "idle")) if _tracking else ""


func _status_line(auto: bool, phase: String, matches: bool) -> String:
	if not auto or phase == "error":
		if _opening:
			return "Opening the download…"
		var failure := describe_failure(str(state.get("error", ""))) + " " if phase == "error" else ""
		return failure + "Download the new version and run it — your games are kept."
	if phase == "ready" and matches:
		return "Downloaded. Restart to finish — your games are kept."
	if phase == "ready":
		return "A newer update is available. Download it before restarting."
	if phase == "downloading":
		return "Downloading the update… %d%%" % int(state.get("percent", 0))
	if phase == "checking" or phase == "available":
		return "Fetching the update…"
	return "Installs itself in the background — your games are kept."


func is_banner_ready() -> bool:
	return banner.visible and _restart_ready


func _refresh_banner() -> void:
	var offer := _offer()
	var build := str(offer.get("build", ""))
	var shown := not launching and not offer.is_empty() and str(state.get("dismissed", "")) != build
	banner.visible = shown
	_restart_ready = false
	if not shown:
		return
	var auto := bool(state.get("canInstall", false))
	var phase := _phase()
	var matches := str(state.get("build", "")) == build
	var ready := auto and phase == "ready" and matches
	var busy := auto and _tracking and not (phase in SETTLED)
	_banner_head.text = HEADLINE
	var line := _status_line(auto, phase, matches)
	_banner_sub.text = line
	_banner_sub.tooltip_text = line if phase == "error" else ""
	_restart_ready = ready
	if ready:
		_banner_button.text = "Restart now"
		_banner_button.disabled = false
	elif busy:
		_banner_button.text = "%d%%" % int(state.get("percent", 0))
		_banner_button.disabled = true
	else:
		_banner_button.text = "Opening…" if _opening else "Update now"
		_banner_button.disabled = _opening


func _on_banner_button() -> void:
	if _restart_ready:
		await _on_restart()
		return
	var offer := _offer()
	if offer.is_empty() or engine == null:
		return
	var auto := bool(state.get("canInstall", false))
	if auto and not (_tracking and str(state.get("state", "")) == "error"):
		_tracking = true
		state["state"] = "checking"
		state["percent"] = 0
		_refresh_banner()
		var reply: Dictionary = await engine.request("update.download")
		if bool(reply.get("ok", false)):
			var result: Variant = reply.get("result")
			if result is Dictionary and bool((result as Dictionary).get("started", false)):
				return
		state["state"] = "error"
		state["error"] = "the app's update service did not answer"
	_opening = true
	_refresh_banner()
	OS.shell_open(str(state.get("downloadUrl", offer.get("url", ""))))


func _on_restart() -> void:
	if engine == null:
		return
	_banner_button.disabled = true
	var reply: Dictionary = await engine.request("update.install")
	if bool(reply.get("ok", false)):
		_quit_for_update()
		return
	state["state"] = "error"
	state["error"] = str(reply.get("error", "")) if not str(reply.get("error", "")).is_empty() else "the downloaded update could not be started"
	_refresh_banner()


func _on_dismiss() -> void:
	var build := str(_offer().get("build", ""))
	state["dismissed"] = build
	_refresh_banner()
	if engine:
		engine.request("update.dismiss", {"build": build})
