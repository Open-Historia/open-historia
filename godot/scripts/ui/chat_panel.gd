class_name ChatPanel
extends PanelFrame

signal open_requested
signal unread_changed(count: int)
signal generating_changed(generating: bool)
signal active_chat_changed(chat_id: String)

const PANEL_MAX_WIDTH := 928.0
const PANEL_MAX_HEIGHT := 800.0
const PANEL_MIN_HEIGHT := 384.0
const PANEL_LEFT := 17.0
const PANEL_BOTTOM := 77.0
const PANEL_CLOSED_BOTTOM := -823.0
const INITIAL_WINDOW := 12
const WINDOW_STEP := 40
const SAFETY_POLL_SECONDS := 30.0
const INSTITUTIONS_VIEW := "res://scripts/ui/institutions_view.gd"
const INTELLIGENCE_VIEW := "res://scripts/ui/intelligence_view.gd"
const BLUE := Color("#3b82f6")
const BLUE_HOVER := Color("#2563eb")
const BLUE_SOFT := Color("#60a5fa")
const SKY := Color("#93c5fd")
const SKY_PALE := Color("#bfdbfe")
const RED_SOFT := Color("#fca5a5")
const RED_PALE := Color("#fecaca")
const GREY_TEXT := Color("#e7e7ea")
const GREY_RAISED := Color("#232327")
const GREY_SELECTED := Color("#0e0e10")
const GREY_BORDER := Color(1, 1, 1, 0.1)
const GREY_BORDER_STRONG := Color(1, 1, 1, 0.22)
const MD_ACCENT := Color("#d4d4d8")
const MONTHS := ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const MONTHS_SHORT := ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const ACCENTS := ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#94a3b8", "#ec4899"]
const DEMAND_STATUS_TEXT := {"accepted": "Accepted", "refused": "Refused", "settled": "Settled on the alternative", "superseded": "Replaced by a new demand"}
const PILL_TONES := {
	"neutral": [Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.58)],
	"live": [Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.12), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.28), Color("#fde68a")],
	"good": [Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.11), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.24), Color("#86efac")],
	"bad": [Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.1), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.22), Color("#fca5a5")],
}
const ICONS := {
	"back": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M19 12H5M12 5l-7 7 7 7'/></svg>",
	"trash": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 6h18'/><path d='M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2'/><path d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'/><path d='M10 11v6M14 11v6'/></svg>",
	"retry": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 12a9 9 0 1 1-2.64-6.36'/><path d='M21 3v6h-6'/></svg>",
	"send": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M22 2 11 13'/><path d='m22 2-7 20-4-9-9-4Z'/></svg>",
	"copy": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='9' y='9' width='13' height='13' rx='2'/><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/></svg>",
	"envelope": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='5' width='18' height='14' rx='2'/><path d='m3.5 6.5 8.5 6 8.5-6'/></svg>",
	"envelope_filled": "<svg viewBox='0 0 24 24' fill='#fff' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='5' width='18' height='14' rx='2'/><path d='m3.5 6.5 8.5 6 8.5-6' stroke='#18181b'/></svg>",
	"contacts": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z'/><path d='M8 9h8M8 13h5'/></svg>",
	"institutions": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M3 21h18'/><path d='M5 21V10h14v11'/><path d='M4 10 12 4l8 6'/><path d='M8 13v5M12 13v5M16 13v5'/></svg>",
	"intelligence": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z'/><circle cx='12' cy='12' r='2.5'/></svg>",
	"search": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='8'/><path d='m21 21-4.35-4.35'/></svg>",
}

static var _cache := {}

var engine: EngineLink
var context: Dictionary = {}
var chats: Array = []
var unseen: Dictionary = {}
var player := "your nation"
var game_date := ""
var game_id := ""
var espionage := true
var chat_dir := ""
var generating_now := false
var puppets: Dictionary = {}
var seen: Variant = null
var loaded := false
var load_failed := false
var save_failed := false
var retrying := false
var unread: Dictionary = {}
var display_order: Array = []
var snapshot_taken := false
var unread_only := false
var view_key := "chats"
var active: Dictionary = {}
var held_unread := ""
var draft := {}
var flags: Dictionary = {}
var roster: Array = []
var roster_loaded := false
var pickable: Array = []
var pickable_loading := false
var selector_open := false
var selected: Array = []
var list_hover := ""
var list_confirm := ""
var visible_council := ""
var councils: Dictionary = {}
var conversation: Conversation
var _flags_pending: Dictionary = {}
var _placed_inset := 0.0
var _loading_data := false
var _reload_again := false
var _local_edits := 0
var _last_badge := -1
var _last_generating := false
var _list_render_queued := false
var _dot_labels: Array = []
var _pulse_labels: Array = []
var _dots_phase := 0
var _pulse_phase := 1
var _content: VBoxContainer
var _header_margin: MarginContainer
var _header_rule: Control
var _tab_buttons: Dictionary = {}
var _notice: PanelContainer
var _notice_title: Label
var _notice_detail: Label
var _notice_retry: Button
var _workspace: VBoxContainer
var _filter_bar: PanelContainer
var _unread_chip: Button
var _mark_all: Button
var _list_scroll: ScrollContainer
var _list_box: VBoxContainer
var _footer: PanelContainer
var _institutions_host: VBoxContainer
var _intelligence_host: VBoxContainer
var _institutions_view: Control
var _intelligence_view: Control
var _modal: PanelContainer
var _modal_selected_label: Label
var _modal_selected_flow: HFlowContainer
var _modal_search: LineEdit
var _modal_scroll: ScrollContainer
var _modal_grid: GridContainer
var _modal_loading: Label
var _modal_start: Button
var _modal_tween: Tween


func _init() -> void:
	super._init("Diplomacy", "Conversations, institutions and statecraft", "bottom", PANEL_MAX_WIDTH)
	set_tint(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.95))
	radius = 16.0
	_material.set_shader_parameter("radius", 16.0)
	_material.set_shader_parameter("border_color", Color(1, 1, 1, 0.1))
	_material.set_shader_parameter("highlight", 0.06)
	_restyle_header()
	scroll.visible = false
	_content = VBoxContainer.new()
	_content.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_content.add_theme_constant_override("separation", 0)
	scroll.get_parent().add_child(_content)
	_build_notice()
	_build_workspace()
	conversation = Conversation.new(self, false)
	conversation.visible = false
	_content.add_child(conversation)
	_build_modal()
	var dots := Timer.new()
	dots.wait_time = 0.5
	dots.autostart = true
	dots.timeout.connect(_tick_dots)
	add_child(dots)
	var pulse := Timer.new()
	pulse.wait_time = 0.45
	pulse.autostart = true
	pulse.timeout.connect(_tick_pulse)
	add_child(pulse)
	var safety := Timer.new()
	safety.wait_time = SAFETY_POLL_SECONDS
	safety.autostart = true
	safety.timeout.connect(func() -> void:
		if engine:
			reload())
	add_child(safety)
	_place(false, false)
	_show_surface()


func _ready() -> void:
	get_viewport().size_changed.connect(func() -> void: _place(is_open(), false))
	_place(is_open(), false)


func setup(engine_link: EngineLink, setup_context: Dictionary = {}) -> void:
	engine = engine_link
	context = setup_context
	var game := d(context.get("game", {}))
	if not t(game.get("country", "")).is_empty():
		player = t(game.get("country", ""))
	if not t(game.get("gameDate", "")).is_empty():
		game_date = t(game.get("gameDate", ""))
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)
	_mount_tab_views()
	engine.request("chat.start")
	reload()


func open() -> void:
	if not is_open():
		set_open(true)


func close() -> void:
	if is_open():
		set_open(false)


func set_open(open_state: bool) -> void:
	var was_open := is_open()
	_open = open_state
	_place(open_state, true)
	mouse_filter = Control.MOUSE_FILTER_STOP if open_state else Control.MOUSE_FILTER_IGNORE
	if open_state and not was_open:
		_on_opened()
	elif not open_state and was_open:
		_on_closed()


func refresh() -> void:
	await reload()
	if _institutions_view and _institutions_view.has_method("refresh"):
		_institutions_view.call("refresh")
	if _intelligence_view and _intelligence_view.has_method("refresh"):
		_intelligence_view.call("refresh")


func unread_count() -> int:
	if is_open() or typeof(seen) != TYPE_DICTIONARY:
		return 0
	var count := 0
	for chat in all_open_chats():
		if is_unread(chat, seen):
			count += 1
	return count


func generating() -> bool:
	return generating_now


func active_chat_id() -> String:
	if not is_open():
		return ""
	if not active.is_empty() and t(active.get("institutionId", "")).is_empty():
		return t(active.get("id", ""))
	return visible_council


func open_chat(country: String, draft_text := "") -> void:
	await open_target({"targetType": "private", "country": country, "name": country}, draft_text)


func open_target(target: Dictionary, draft_text := "") -> void:
	var target_type := t(target.get("targetType", "private")).to_lower()
	var target_name := t(target.get("name", target.get("country", "")))
	var institution_id := t(target.get("institutionId", ""))
	var case_id := t(target.get("caseId", ""))
	var thread_id := t(target.get("threadId", ""))
	if target_type == "private" and target_name.is_empty():
		return
	if target_type == "institution-council" and institution_id.is_empty() and thread_id.is_empty():
		return
	if target_type == "institution-lifecycle" and thread_id.is_empty() and (institution_id.is_empty() or case_id.is_empty()):
		return
	if not is_open():
		open_requested.emit()
		set_open(true)
	var waited := 0
	while not loaded and waited < 900:
		waited += 1
		await get_tree().process_frame
	selector_open = false
	_modal.visible = false
	if target_type == "institution-council" or target_type == "institution-lifecycle":
		var wanted := institution_id.to_lower()
		var exact := {}
		for chat in chats:
			if not thread_id.is_empty() and t(chat.get("id", "")) == thread_id:
				exact = chat
				break
			if target_type == "institution-council":
				if t(chat.get("institutionId", "")).to_lower() == wanted and not is_lifecycle(chat):
					exact = chat
					break
			elif t(chat.get("lifecycleInstitutionId", "")).to_lower() == wanted and a(chat.get("lifecycleCaseIds", [])).any(func(value: Variant) -> bool: return t(value) == case_id):
				exact = chat
				break
		if not exact.is_empty():
			held_unread = ""
			set_read_state(shown_chat(exact), true)
			if not draft_text.is_empty():
				draft = {"chat_id": t(exact.get("id", "")), "text": draft_text}
			if target_type == "institution-council":
				active = {}
				conversation_unmounted()
				view_key = "institutions"
				_focus_institution(t(exact.get("institutionId", "")), "council")
			else:
				view_key = "chats"
				set_active(exact)
			render_all()
			return
		if not institution_id.is_empty():
			active = {}
			conversation_unmounted()
			view_key = "institutions"
			_focus_institution(institution_id, "council" if target_type == "institution-council" else "members")
			render_all()
		if engine:
			engine.request("chat.log", {"message": "Advisor draft target could not resolve an exact %s thread." % target_type, "detail": {"institutionId": t(target.get("institutionId", "")), "caseId": case_id, "threadId": thread_id}, "problem": true})
		return
	if not roster_loaded:
		await _load_roster()
	var code := t(target.get("code", ""))
	if code.is_empty():
		for entry in roster:
			if t(entry.get("name", "")).to_lower() == target_name.to_lower():
				code = t(entry.get("code", ""))
				break
	for chat in chats:
		var countries := a(chat.get("countries", []))
		if t(chat.get("status", "")) != "closed" and t(chat.get("institutionId", "")).is_empty() and t(chat.get("lifecycleInstitutionId", "")).is_empty() and countries.size() == 1 and t(d(countries[0]).get("name", "")).to_lower() == target_name.to_lower():
			view_key = "chats"
			if not draft_text.is_empty():
				draft = {"chat_id": t(chat.get("id", "")), "text": draft_text}
			set_active(chat)
			return
	var created := {"id": new_chat_id(), "countries": [{"name": target_name, "code": code}], "messages": [], "status": "open"}
	chats.push_front(created)
	persist("chat.create", {"chat": created})
	view_key = "chats"
	if not draft_text.is_empty():
		draft = {"chat_id": t(created.get("id", "")), "text": draft_text}
	set_active(created)


func open_thread(chat_id: String, draft_text := "") -> void:
	var id := chat_id.strip_edges()
	if id.is_empty():
		return
	if not is_open():
		open_requested.emit()
		set_open(true)
	var waited := 0
	while not loaded and waited < 900:
		waited += 1
		await get_tree().process_frame
	if draft_text.is_empty():
		for chat in open_chats():
			if t(chat.get("id", "")) == id:
				open_chat_from_list(chat)
				return
		return
	var found := find_chat(id)
	if found.is_empty():
		await reload()
		found = find_chat(id)
	if found.is_empty():
		return
	if not t(found.get("institutionId", "")).is_empty() and not is_lifecycle(found):
		await open_target({"targetType": "institution-council", "institutionId": t(found.get("institutionId", "")), "threadId": id}, draft_text)
		return
	if is_lifecycle(found):
		await open_target({"targetType": "institution-lifecycle", "institutionId": t(found.get("lifecycleInstitutionId", "")), "threadId": id}, draft_text)
		return
	held_unread = ""
	set_read_state(shown_chat(found), true)
	view_key = "chats"
	draft = {"chat_id": id, "text": draft_text}
	set_active(found)


func render_council(channel_id: String) -> Control:
	var id := channel_id.strip_edges()
	var view: Conversation = councils.get(id) if councils.has(id) and is_instance_valid(councils[id]) else null
	if view == null:
		view = Conversation.new(self, true)
		councils[id] = view
	var parent := view.get_parent()
	if parent:
		parent.remove_child(view)
	view.size_flags_vertical = Control.SIZE_EXPAND_FILL
	view.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var channel := find_chat(id)
	if channel.is_empty():
		reload()
		channel = {"id": id, "institutionId": "pending", "countries": [], "messages": []}
	view.show_chat(channel)
	if t(draft.get("chat_id", "")) == id:
		view.apply_draft(t(draft.get("text", "")))
		draft = {}
	return view


func _process(_delta: float) -> void:
	var inset := _right_inset()
	if not is_equal_approx(inset, _placed_inset):
		_placed_inset = inset
		var viewport := get_viewport_rect().size
		offset_right = PANEL_LEFT + minf(PANEL_MAX_WIDTH, viewport.x - 16.0 - inset)


func _right_inset() -> float:
	var offset: Variant = context.get("right_offset")
	if offset is Callable and (offset as Callable).is_valid():
		return float((offset as Callable).call())
	var host := get_parent()
	if host:
		var layer: Variant = host.get("_right_layer")
		if layer is Control:
			return maxf(0.0, -(layer as Control).position.x)
	return 0.0


func _place(open_state: bool, animate: bool) -> void:
	var viewport := get_viewport_rect().size if is_inside_tree() else Vector2(1440, 900)
	_placed_inset = _right_inset() if is_inside_tree() else 0.0
	var width := minf(PANEL_MAX_WIDTH, viewport.x - 16.0 - _placed_inset)
	var height := maxf(PANEL_MIN_HEIGHT, minf(PANEL_MAX_HEIGHT, viewport.y - 128.0))
	anchor_left = 0.0
	anchor_right = 0.0
	anchor_top = 1.0
	anchor_bottom = 1.0
	offset_left = PANEL_LEFT
	offset_right = PANEL_LEFT + width
	var bottom := PANEL_BOTTOM if open_state else PANEL_CLOSED_BOTTOM
	var target_top := -bottom - height
	var target_bottom := -bottom
	if not animate or not is_inside_tree():
		offset_top = target_top
		offset_bottom = target_bottom
		modulate.a = 1.0 if open_state else 0.0
		return
	var tween := create_tween().set_parallel(true)
	tween.tween_property(self, "offset_top", target_top, 0.35).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	tween.tween_property(self, "offset_bottom", target_bottom, 0.35).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	tween.tween_property(self, "modulate:a", 1.0 if open_state else 0.0, 0.35).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


func _on_opened() -> void:
	snapshot_taken = false
	unread_only = false
	_push_badge(true)
	active_chat_changed.emit(active_chat_id())
	if engine:
		await reload()
	_take_snapshot()
	render_all()


func _on_closed() -> void:
	snapshot_taken = false
	unread_only = false
	active_chat_changed.emit("")
	_recompute_badge(true)


func _on_engine_event(event_name: String, data: Variant) -> void:
	if event_name == "chat.changed":
		if t(d(data).get("reason", "")) == "game":
			_reset_for_game()
		reload()
	elif event_name == "chat.generating":
		var next: bool = d(data).get("generating", false) == true
		if next != generating_now:
			generating_now = next
			generating_changed.emit(generating_now)
			_push_badge(true)
			if is_open() and view_key == "chats" and not conversation_visible():
				render_list()


func _reset_for_game() -> void:
	if conversation:
		conversation.stop_reveal()
	active = {}
	conversation_unmounted()
	chats = []
	unread = {}
	display_order = []
	snapshot_taken = false
	loaded = false
	roster_loaded = false
	flags = {}
	visible_council = ""
	councils = {}
	_show_surface()


func reload() -> void:
	if not engine:
		return
	if _loading_data:
		_reload_again = true
		return
	_loading_data = true
	var edits_before := _local_edits
	var reply := await engine.request("chat.load")
	_loading_data = false
	if edits_before != _local_edits:
		_reload_again = true
	elif reply.get("ok", false):
		_apply_load(d(reply.get("result", {})))
	if _reload_again:
		_reload_again = false
		await reload()


func _apply_load(data: Dictionary) -> void:
	var next_player := t(data.get("player", ""))
	if not next_player.is_empty():
		player = next_player
	var next_date := t(data.get("gameDate", ""))
	if not next_date.is_empty():
		game_date = next_date
	game_id = t(data.get("gameId", ""))
	espionage = data.get("espionage", true) != false
	chat_dir = t(data.get("chatDir", ""))
	puppets = d(data.get("puppetMarkers", {}))
	var next_generating: bool = data.get("generating", false) == true
	if next_generating != generating_now:
		generating_now = next_generating
		generating_changed.emit(generating_now)
	var stored_seen: Variant = data.get("seen")
	if typeof(stored_seen) == TYPE_DICTIONARY:
		seen = stored_seen
	var next_unseen := {}
	for id in a(data.get("unseen", [])):
		next_unseen[t(id)] = true
	var unseen_changed := next_unseen.keys() != unseen.keys()
	unseen = next_unseen
	var stored: Variant = data.get("chats")
	if stored == null:
		if not loaded:
			load_failed = true
	elif load_failed:
		_adopt_recovered(a(stored))
	else:
		_sync(a(stored))
	loaded = true
	_update_tab_visibility()
	_fetch_flags()
	_after_data_change(unseen_changed)


func _sync(saved: Array) -> void:
	if loaded and _signature(saved) == _signature(chats):
		return
	if not active.is_empty():
		for chat in saved:
			if t(chat.get("id", "")) == t(active.get("id", "")) and a(chat.get("messages", [])).size() > a(active.get("messages", [])).size():
				active = chat
				break
	chats = saved


func _adopt_recovered(saved: Array) -> void:
	var begun: Array = []
	for chat in chats:
		var known := false
		for entry in saved:
			if t(entry.get("id", "")) == t(chat.get("id", "")):
				known = true
				break
		if not known:
			begun.append(chat)
	chats = begun + saved
	load_failed = false
	for chat in begun:
		persist("chat.create", {"chat": chat})


func _after_data_change(unseen_changed := false) -> void:
	if is_open() and snapshot_taken and typeof(seen) == TYPE_DICTIONARY:
		var active_id := t(active.get("id", ""))
		for chat in all_open_chats():
			var id := t(chat.get("id", ""))
			if id != active_id and is_unread(chat, seen):
				unread[id] = true
	_propagate_chats(unseen_changed)
	mark_active_read()
	_recompute_badge()
	_show_notice()
	_send_unread_to_institutions()
	if is_open():
		render_all()


func _propagate_chats(unseen_changed := false) -> void:
	if conversation_visible():
		conversation.show_chat(active)
		if unseen_changed:
			conversation.unseen_moved()
		conversation.world_changed()
	for id in councils.keys():
		var view: Conversation = councils[id]
		if not is_instance_valid(view):
			continue
		var channel := find_chat(t(id))
		if not channel.is_empty():
			view.show_chat(channel)
			if unseen_changed:
				view.unseen_moved()


func _recompute_badge(force := false) -> void:
	if not is_open() and loaded and not load_failed and typeof(seen) != TYPE_DICTIONARY:
		seen = seen_totals(all_open_chats())
		_write_seen()
	_push_badge(force)


func _push_badge(force := false) -> void:
	var count := unread_count()
	if force or count != _last_badge or generating_now != _last_generating:
		_last_badge = count
		_last_generating = generating_now
		unread_changed.emit(count)
		var hud: Variant = context.get("hud")
		if hud is Object and (hud as Object).has_method("set_chat_badge"):
			(hud as Object).call("set_chat_badge", count, generating_now)
		var setter: Variant = context.get("set_chat_badge")
		if setter is Callable and (setter as Callable).is_valid():
			(setter as Callable).call(count, generating_now)


func _take_snapshot() -> void:
	if not loaded:
		return
	var all_open := all_open_chats()
	if typeof(seen) != TYPE_DICTIONARY:
		seen = seen_totals(all_open)
		_write_seen()
		unread = {}
	else:
		unread = {}
		for chat in all_open:
			if is_unread(chat, seen):
				unread[t(chat.get("id", ""))] = true
	display_order = []
	for chat in sort_by_recency(open_chats()):
		display_order.append(t(chat.get("id", "")))
	snapshot_taken = true
	_send_unread_to_institutions()


func set_read_state(chat: Dictionary, read: bool) -> void:
	var id := t(chat.get("id", ""))
	var next: Dictionary = (seen as Dictionary).duplicate() if typeof(seen) == TYPE_DICTIONARY else {}
	if read:
		next[id] = a(chat.get("messages", [])).size()
	else:
		next.erase(id)
	seen = next
	_write_seen()
	if read:
		unread.erase(id)
	else:
		unread[id] = true
	_send_unread_to_institutions()


func _mark_all_read() -> void:
	var next: Dictionary = (seen as Dictionary).duplicate() if typeof(seen) == TYPE_DICTIONARY else {}
	for chat in open_chats():
		next[t(chat.get("id", ""))] = a(chat.get("messages", [])).size()
	seen = next
	_write_seen()
	unread = {}
	_send_unread_to_institutions()
	render_all()


func mark_active_read() -> void:
	if active.is_empty():
		return
	var id := t(active.get("id", ""))
	if held_unread == id:
		return
	var shown := shown_chat(active)
	var count := a(shown.get("messages", [])).size()
	if typeof(seen) == TYPE_DICTIONARY and (seen as Dictionary).has(id) and int((seen as Dictionary)[id]) == count and not unread.has(id):
		return
	set_read_state(shown, true)


func toggle_active_read(chat: Dictionary) -> void:
	var id := t(chat.get("id", ""))
	var was_unread := unread.has(id)
	held_unread = "" if was_unread else id
	set_read_state(shown_chat(chat), was_unread)
	_style_tabs()


func _write_seen() -> void:
	if engine:
		engine.request("chat.seen.set", {"seen": seen})


func persist(method: String, args: Dictionary) -> void:
	if not engine or load_failed:
		return
	_local_edits += 1
	var reply := await engine.request(method, args)
	var failed: bool = reply.get("ok", false) != true
	if failed != save_failed:
		save_failed = failed
		_show_notice()


func on_messages_update(chat_id: String, messages: Array) -> void:
	if not messages.is_empty() and t(d(messages.back()).get("role", "")) == "user" and engine:
		engine.request("chat.outgoing", {"id": chat_id})
	for index in range(chats.size()):
		if t(chats[index].get("id", "")) == chat_id:
			var updated: Dictionary = chats[index].duplicate()
			updated["messages"] = messages
			chats[index] = updated
	if t(active.get("id", "")) == chat_id:
		var updated_active: Dictionary = active.duplicate()
		updated_active["messages"] = messages
		active = updated_active
	persist("chat.patch", {"id": chat_id, "set": {"messages": messages}})
	_refresh_council_props(chat_id)
	mark_active_read()


func on_thread_update(chat_id: String, update: Dictionary, committed := false) -> void:
	_local_edits += 1
	var found := false
	for index in range(chats.size()):
		if t(chats[index].get("id", "")) == chat_id:
			chats[index] = _merge_thread(chats[index], update)
			found = true
			if t(active.get("id", "")) == chat_id:
				active = chats[index]
	if not found and t(active.get("id", "")) == chat_id:
		active = _merge_thread(active, update)
	if not committed:
		var set := {}
		for key in ["events", "countries", "title", "polls", "demands"]:
			if update.has(key) and update[key] != null:
				set[key] = update[key]
		if update.has("messages") and update["messages"] != null:
			set["messages"] = update["messages"]
		persist("chat.patch", {"id": chat_id, "set": set, "cursors": update.get("cursors")})
	else:
		reload()
	_refresh_council_props(chat_id)


func local_thread_update(chat_id: String, update: Dictionary) -> void:
	_local_edits += 1
	for index in range(chats.size()):
		if t(chats[index].get("id", "")) == chat_id:
			chats[index] = _merge_thread(chats[index], update)
			if t(active.get("id", "")) == chat_id:
				active = chats[index]
	if t(active.get("id", "")) == chat_id and conversation_visible() and conversation.chat_id == chat_id:
		conversation.show_chat(active)
	_refresh_council_props(chat_id)


func _refresh_council_props(chat_id: String) -> void:
	if councils.has(chat_id) and is_instance_valid(councils[chat_id]):
		var channel := find_chat(chat_id)
		if not channel.is_empty():
			(councils[chat_id] as Conversation).show_chat(channel)


func _merge_thread(chat: Dictionary, update: Dictionary) -> Dictionary:
	var merged: Dictionary = chat.duplicate()
	for key in ["events", "countries", "polls", "demands", "messages"]:
		if update.has(key) and update[key] != null:
			merged[key] = update[key]
	var title := t(update.get("title", ""))
	if not title.is_empty():
		merged["title"] = title
	return merged


func adopt_chat_result(reply: Dictionary, chat_id: String) -> void:
	if not reply.get("ok", false):
		return
	var result := d(reply.get("result", {}))
	var list: Variant = result.get("chats")
	if typeof(list) != TYPE_ARRAY:
		return
	for chat in list:
		var entry := d(chat)
		if t(entry.get("id", "")) != chat_id:
			continue
		local_thread_update(chat_id, {"events": entry.get("events"), "countries": entry.get("countries"), "title": entry.get("title", ""), "polls": entry.get("polls", []), "demands": entry.get("demands", [])})


func adopt_institutional_result(result: Dictionary) -> void:
	_local_edits += 1
	var list: Variant = result.get("chats")
	if typeof(list) == TYPE_ARRAY:
		chats = list
	elif typeof(result.get("channel")) == TYPE_DICTIONARY:
		var channel := d(result.get("channel"))
		var channel_id := t(channel.get("id", ""))
		if not channel_id.is_empty():
			var index := -1
			for position_index in range(chats.size()):
				if t(chats[position_index].get("id", "")) == channel_id:
					index = position_index
			if index < 0:
				chats.push_front(channel)
			else:
				chats[index] = channel
	if typeof(result.get("channel")) == TYPE_DICTIONARY:
		held_unread = ""
		set_read_state(shown_chat(d(result.get("channel"))), true)
	if typeof(result.get("createdChat")) == TYPE_DICTIONARY:
		var created := d(result.get("createdChat"))
		held_unread = ""
		set_read_state(shown_chat(created), true)
		view_key = "chats"
		set_active(created)
	reload()


func run_council_vote(institution_id: String, proposal_id: String, delay_ms: int) -> void:
	if not engine or institution_id.is_empty() or proposal_id.is_empty():
		return
	if delay_ms > 0:
		await get_tree().create_timer(float(delay_ms) / 1000.0).timeout
	await engine.request("institutions.councilTurn", {"institutionId": institution_id, "proposalId": proposal_id, "kind": "vote", "source": "lifecycle-acceptance"})
	reload()
	if _institutions_view and _institutions_view.has_method("refresh"):
		_institutions_view.call("refresh")


func navigate_institution(institution_id: String, section := "overview") -> void:
	var id := institution_id.strip_edges()
	active = {}
	conversation_unmounted()
	view_key = "institutions"
	if not id.is_empty():
		_focus_institution(id, section)
	render_all()


func _focus_institution(institution_id: String, section: String) -> void:
	if _institutions_view and _institutions_view.has_method("focus"):
		_institutions_view.call("focus", institution_id, section)


func shown_chats() -> Array:
	if unseen.is_empty():
		return chats
	var out: Array = []
	for chat in chats:
		if unseen.has(t(chat.get("linkedEventId", ""))):
			continue
		var messages := a(chat.get("messages", []))
		var shown := without_unseen(messages)
		if not messages.is_empty() and shown.is_empty():
			continue
		var log := a(chat.get("events", []))
		var shown_log: Array = []
		for entry in log:
			var event := d(entry)
			if not (t(event.get("kind", "")) == "message" and unseen.has(t(event.get("eventId", "")))):
				shown_log.append(entry)
		if shown.size() == messages.size() and shown_log.size() == log.size():
			out.append(chat)
			continue
		var partial: Dictionary = chat.duplicate()
		partial["messages"] = shown
		if not log.is_empty():
			partial["events"] = shown_log
		out.append(partial)
	return out


func shown_chat(chat: Dictionary) -> Dictionary:
	if unseen.is_empty() or chat.is_empty():
		return chat
	var partial: Dictionary = chat.duplicate()
	partial["messages"] = without_unseen(a(chat.get("messages", [])))
	return partial


func without_unseen(messages: Array) -> Array:
	if unseen.is_empty():
		return messages
	var out: Array = []
	for message in messages:
		if not unseen.has(t(d(message).get("eventId", ""))):
			out.append(message)
	return out


func all_open_chats() -> Array:
	var out: Array = []
	for chat in shown_chats():
		if t(chat.get("status", "")) != "closed" and not a(chat.get("countries", [])).is_empty():
			out.append(chat)
	return out


func open_chats() -> Array:
	var out: Array = []
	for chat in all_open_chats():
		if t(chat.get("institutionId", "")).is_empty() or is_lifecycle(chat):
			out.append(chat)
	return out


func find_chat(id: String) -> Dictionary:
	for chat in chats:
		if t(chat.get("id", "")) == id:
			return chat
	return {}


func is_unread(chat: Dictionary, baseline: Variant) -> bool:
	if typeof(baseline) != TYPE_DICTIONARY:
		return false
	var previous: Variant = (baseline as Dictionary).get(t(chat.get("id", "")))
	return previous == null or a(chat.get("messages", [])).size() > int(previous)


func seen_totals(list: Array) -> Dictionary:
	var totals := {}
	for chat in list:
		totals[t(chat.get("id", ""))] = a(chat.get("messages", [])).size()
	return totals


func _signature(list: Array) -> String:
	var parts: PackedStringArray = []
	for chat in list:
		parts.append("%s:%s:%d" % [t(chat.get("id", "")), t(chat.get("status", "")), a(chat.get("messages", [])).size()])
	return "|".join(parts)


func _restyle_header() -> void:
	var titles := header_title.get_parent() as VBoxContainer
	var row := titles.get_parent() as HBoxContainer
	_header_margin = row.get_parent() as MarginContainer
	var column := _header_margin.get_parent() as VBoxContainer
	_header_rule = column.get_child(_header_margin.get_index() + 1) as Control
	for side in [["margin_left", 14], ["margin_right", 14], ["margin_top", 11], ["margin_bottom", 10]]:
		_header_margin.add_theme_constant_override(side[0], side[1])
	header_title.add_theme_font_override("font", UI.font(800))
	header_title.add_theme_font_size_override("font_size", 16)
	header_subtitle.add_theme_font_size_override("font_size", 9)
	header_subtitle.add_theme_color_override("font_color", Color(1, 1, 1, 0.32))
	header_subtitle.autowrap_mode = TextServer.AUTOWRAP_OFF
	titles.add_theme_constant_override("separation", 2)
	titles.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 9)
	var frame_close := row.get_child(row.get_child_count() - 1) as Control
	frame_close.visible = false
	var badge := PanelContainer.new()
	badge.custom_minimum_size = Vector2(26, 26)
	badge.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	badge.add_theme_stylebox_override("panel", UI.box(GREY_RAISED, GREY_BORDER_STRONG, 7, 1))
	badge.add_child(icon_rect("contacts", 15, GREY_TEXT))
	row.add_child(badge)
	row.move_child(badge, 0)
	var close := text_button("✕", 18, Color(1, 1, 1, 0.5), UI.WHITE, 400, Color(1, 1, 1, 0.08))
	close.tooltip_text = "Close diplomacy panel"
	close.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	close.pressed.connect(func() -> void: closed.emit())
	row.add_child(close)
	_header_margin.remove_child(row)
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 9)
	stack.add_child(row)
	var tabs := HBoxContainer.new()
	tabs.add_theme_constant_override("separation", 6)
	for entry in [["chats", "contacts", "Contacts"], ["institutions", "institutions", "Institutions"], ["spy", "intelligence", "Intelligence"]]:
		var tab := _tab_button(entry[0], entry[1], entry[2])
		tabs.add_child(tab)
		_tab_buttons[entry[0]] = tab
	stack.add_child(tabs)
	_header_margin.add_child(stack)


func _tab_button(key: String, icon_key: String, caption_text: String) -> Button:
	var tab := Button.new()
	tab.focus_mode = Control.FOCUS_NONE
	tab.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var holder := MarginContainer.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in [["margin_left", 11], ["margin_right", 11], ["margin_top", 5], ["margin_bottom", 5]]:
		holder.add_theme_constant_override(side[0], side[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var glyph := icon_rect(icon_key, 13, Color(1, 1, 1, 0.38))
	glyph.name = "Glyph"
	row.add_child(glyph)
	var caption := UI.label(caption_text, 12, Color(1, 1, 1, 0.48), 750)
	caption.name = "Caption"
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(caption)
	var count := PanelContainer.new()
	count.name = "Count"
	count.custom_minimum_size = Vector2(17, 17)
	count.mouse_filter = Control.MOUSE_FILTER_IGNORE
	count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var count_label := UI.label("", 9, SKY, 800)
	count_label.name = "Value"
	count_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	count_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	count.add_child(count_label)
	count.visible = false
	row.add_child(count)
	holder.add_child(row)
	holder.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	tab.add_child(holder)
	tab.custom_minimum_size = Vector2(row.get_combined_minimum_size().x + 22, 29)
	tab.pressed.connect(func() -> void: _set_view(key))
	return tab


func _style_tabs() -> void:
	var counts := {"chats": 0, "institutions": 0, "spy": 0}
	for chat in open_chats():
		if unread.has(t(chat.get("id", ""))):
			counts["chats"] += 1
	for chat in all_open_chats():
		if not t(chat.get("institutionId", "")).is_empty() and unread.has(t(chat.get("id", ""))):
			counts["institutions"] += 1
	var current := current_view()
	for key in _tab_buttons:
		var tab: Button = _tab_buttons[key]
		var chosen: bool = key == current
		var style := UI.box(GREY_SELECTED if chosen else Color(1, 1, 1, 0.025), GREY_BORDER_STRONG if chosen else Color(1, 1, 1, 0.07), 8, 1)
		for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
			tab.add_theme_stylebox_override(state, style)
		var ink := UI.WHITE if chosen else Color(1, 1, 1, 0.48)
		var caption := tab.find_child("Caption", true, false) as Label
		caption.add_theme_color_override("font_color", ink)
		(tab.find_child("Glyph", true, false) as TextureRect).self_modulate = Color(ink.r, ink.g, ink.b, ink.a * 0.8)
		var count_holder := tab.find_child("Count", true, false) as PanelContainer
		var count_value := count_holder.find_child("Value", true, false) as Label
		var value: int = counts.get(key, 0)
		count_holder.visible = value > 0
		count_value.text = str(value)
		count_value.add_theme_color_override("font_color", UI.WHITE if chosen else SKY)
		count_holder.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.14) if chosen else Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.16), Color(0, 0, 0, 0), 999, 0, Vector4(4, 0, 4, 0)))
		var row := caption.get_parent() as HBoxContainer
		tab.custom_minimum_size.x = row.get_combined_minimum_size().x + 22


func _update_tab_visibility() -> void:
	var spy: Button = _tab_buttons["spy"]
	spy.visible = espionage


func current_view() -> String:
	if view_key == "spy" and not espionage:
		return "chats"
	return view_key


func _set_view(key: String) -> void:
	view_key = key
	if key == "institutions" and _institutions_view and _institutions_view.has_method("refresh"):
		_institutions_view.call("refresh")
	if key == "spy" and _intelligence_view and _intelligence_view.has_method("refresh"):
		_intelligence_view.call("refresh")
	render_all()


func _mount_tab_views() -> void:
	var view_context := context.duplicate()
	view_context["chat_panel"] = self
	view_context["render_council"] = Callable(self, "render_council")
	if not _institutions_view and ResourceLoader.exists(INSTITUTIONS_VIEW):
		var script := load(INSTITUTIONS_VIEW) as GDScript
		if script and script.can_instantiate():
			var made: Variant = script.new()
			if made is Control:
				_institutions_view = made as Control
				_institutions_view.size_flags_vertical = Control.SIZE_EXPAND_FILL
				_institutions_host.add_child(_institutions_view)
				if _institutions_view.has_method("setup"):
					_institutions_view.call("setup", engine, view_context)
				if _institutions_view.has_signal("lifecycle_chat_opened"):
					_institutions_view.connect("lifecycle_chat_opened", _open_lifecycle_chat)
				if _institutions_view.has_signal("council_opened"):
					_institutions_view.connect("council_opened", _on_council_opened)
				if _institutions_view.has_signal("council_visible_changed"):
					_institutions_view.connect("council_visible_changed", func(chat_id: String) -> void:
						visible_council = chat_id
						active_chat_changed.emit(active_chat_id()))
				if _institutions_view.has_signal("chats_changed"):
					_institutions_view.connect("chats_changed", func() -> void: reload())
	if not _intelligence_view and ResourceLoader.exists(INTELLIGENCE_VIEW):
		var script := load(INTELLIGENCE_VIEW) as GDScript
		if script and script.can_instantiate():
			var made: Variant = script.new()
			if made is Control:
				_intelligence_view = made as Control
				_intelligence_view.size_flags_vertical = Control.SIZE_EXPAND_FILL
				_intelligence_host.add_child(_intelligence_view)
				if _intelligence_view.has_method("setup"):
					_intelligence_view.call("setup", engine, view_context)


func _send_unread_to_institutions() -> void:
	if _institutions_view and _institutions_view.has_method("set_unread_ids"):
		_institutions_view.call("set_unread_ids", unread.keys())


func _open_lifecycle_chat(chat_id: String) -> void:
	var channel := find_chat(chat_id)
	if channel.is_empty():
		await reload()
		channel = find_chat(chat_id)
	if channel.is_empty():
		return
	held_unread = ""
	set_read_state(shown_chat(channel), true)
	view_key = "chats"
	set_active(channel)


func _on_council_opened(chat_id: String) -> void:
	var channel := find_chat(chat_id)
	if channel.is_empty():
		await reload()
		channel = find_chat(chat_id)
	if not channel.is_empty():
		held_unread = ""
		set_read_state(shown_chat(channel), true)
	active = {}
	conversation_unmounted()
	view_key = "institutions"
	render_all()


func _build_notice() -> void:
	_notice = PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.1)
	style.border_color = Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.35)
	style.border_width_bottom = 1
	style.content_margin_left = 14
	style.content_margin_right = 14
	style.content_margin_top = 8
	style.content_margin_bottom = 8
	_notice.add_theme_stylebox_override("panel", style)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	var texts := VBoxContainer.new()
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.add_theme_constant_override("separation", 2)
	_notice_title = UI.label("", 12, RED_PALE, 700)
	_notice_detail = UI.label("", 11, Color(254 / 255.0, 202 / 255.0, 202 / 255.0, 0.7))
	texts.add_child(_notice_title)
	texts.add_child(_notice_detail)
	row.add_child(texts)
	_notice_retry = icon_text_button("Retry", "retry", 11, Color(254 / 255.0, 202 / 255.0, 202 / 255.0, 0.95), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.14), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.4), 6, Vector4(10, 5, 10, 5))
	_notice_retry.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_notice_retry.pressed.connect(_retry_storage)
	row.add_child(_notice_retry)
	_notice.add_child(row)
	_notice.visible = false
	var column := scroll.get_parent() as VBoxContainer
	column.add_child(_notice)
	column.move_child(_notice, 0)


func _show_notice() -> void:
	if load_failed:
		_notice_title.text = "Could not load your conversations."
		_notice_detail.text = "Nothing new is saved until they load."
	elif save_failed:
		_notice_title.text = "Your latest messages were not saved."
		_notice_detail.text = "They are kept here until a save works."
	_notice.visible = load_failed or save_failed
	_notice_retry.text = "Retrying…" if retrying else "Retry"
	_notice_retry.disabled = retrying


func _retry_storage() -> void:
	retrying = true
	_show_notice()
	if load_failed:
		var reply := await engine.request("chat.load")
		if reply.get("ok", false):
			var stored: Variant = d(reply.get("result", {})).get("chats")
			if stored != null:
				_adopt_recovered(a(stored))
				render_all()
	elif save_failed:
		for chat in chats:
			await persist("chat.patch", {"id": t(chat.get("id", "")), "set": chat})
	retrying = false
	_show_notice()


func _build_workspace() -> void:
	_workspace = VBoxContainer.new()
	_workspace.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_workspace.add_theme_constant_override("separation", 0)
	_filter_bar = PanelContainer.new()
	var filter_style := StyleBoxFlat.new()
	filter_style.bg_color = Color(0, 0, 0, 0)
	filter_style.border_color = Color(1, 1, 1, 0.06)
	filter_style.border_width_bottom = 1
	filter_style.content_margin_left = 20
	filter_style.content_margin_right = 20
	filter_style.content_margin_top = 9
	filter_style.content_margin_bottom = 9
	_filter_bar.add_theme_stylebox_override("panel", filter_style)
	var filter_row := HBoxContainer.new()
	_unread_chip = Button.new()
	_unread_chip.focus_mode = Control.FOCUS_NONE
	_unread_chip.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_unread_chip.add_theme_font_override("font", UI.font(600))
	_unread_chip.add_theme_font_size_override("font_size", 12)
	_unread_chip.add_theme_constant_override("h_separation", 5)
	_unread_chip.pressed.connect(func() -> void:
		unread_only = not unread_only
		render_list())
	filter_row.add_child(_unread_chip)
	filter_row.add_child(UI.spacer())
	_mark_all = text_button("Mark all read", 12, Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.75), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 1.0), 600)
	_mark_all.pressed.connect(_mark_all_read)
	filter_row.add_child(_mark_all)
	_filter_bar.add_child(filter_row)
	_workspace.add_child(_filter_bar)
	_list_scroll = ScrollContainer.new()
	_list_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_list_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_list_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	var list_margin := MarginContainer.new()
	list_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list_margin.size_flags_vertical = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 16], ["margin_right", 16], ["margin_top", 12], ["margin_bottom", 12]]:
		list_margin.add_theme_constant_override(side[0], side[1])
	_list_box = VBoxContainer.new()
	_list_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list_box.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_list_box.add_theme_constant_override("separation", 6)
	list_margin.add_child(_list_box)
	_list_scroll.add_child(list_margin)
	_workspace.add_child(_list_scroll)
	_footer = PanelContainer.new()
	var footer_style := StyleBoxFlat.new()
	footer_style.bg_color = Color(0, 0, 0, 0)
	footer_style.border_color = Color(1, 1, 1, 0.07)
	footer_style.border_width_top = 1
	footer_style.content_margin_left = 16
	footer_style.content_margin_right = 16
	footer_style.content_margin_top = 12
	footer_style.content_margin_bottom = 12
	_footer.add_theme_stylebox_override("panel", footer_style)
	var start := solid_button("Start New Chat", 14, Color(1, 1, 1, 0.85), 500, Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.12), 10)
	start.custom_minimum_size.y = 43
	start.pressed.connect(_open_selector)
	_footer.add_child(start)
	_workspace.add_child(_footer)
	_institutions_host = VBoxContainer.new()
	_institutions_host.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_institutions_host.visible = false
	_workspace.add_child(_institutions_host)
	_intelligence_host = VBoxContainer.new()
	_intelligence_host.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_intelligence_host.visible = false
	_workspace.add_child(_intelligence_host)
	_content.add_child(_workspace)


func _show_surface() -> void:
	var showing := conversation_visible()
	_header_margin.visible = not showing
	_header_rule.visible = not showing
	_workspace.visible = not showing
	conversation.visible = showing


func conversation_visible() -> bool:
	if active.is_empty():
		return false
	if not t(active.get("institutionId", "")).is_empty() and not is_lifecycle(active):
		return false
	return not a(active.get("countries", [])).is_empty()


func render_all() -> void:
	_show_surface()
	_style_tabs()
	_show_notice()
	if conversation_visible():
		conversation.refresh_chrome()
		return
	var view := current_view()
	_filter_bar.visible = view == "chats" and not open_chats().is_empty()
	_list_scroll.visible = view == "chats"
	_footer.visible = view == "chats"
	_institutions_host.visible = view == "institutions"
	_intelligence_host.visible = view == "spy"
	if view == "chats":
		render_list()


func _ordered_chats() -> Array:
	var open := open_chats()
	var ordered_ids := {}
	for id in display_order:
		ordered_ids[id] = true
	var out: Array = []
	for chat in open:
		if not ordered_ids.has(t(chat.get("id", ""))):
			out.append(chat)
	for id in display_order:
		for chat in open:
			if t(chat.get("id", "")) == id:
				out.append(chat)
				break
	return out


func render_list() -> void:
	if not _list_box:
		return
	_style_tabs()
	var open := open_chats()
	_filter_bar.visible = current_view() == "chats" and not open.is_empty()
	var unread_total := unread.size()
	_unread_chip.text = "Unread" + (" (%d)" % unread_total if unread_total > 0 else "")
	_unread_chip.icon = _dot_texture() if unread_only else null
	var chip_style := UI.box(Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.18) if unread_only else Color(1, 1, 1, 0.05), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.5) if unread_only else Color(1, 1, 1, 0.12), 999, 1, Vector4(10, 4, 10, 4))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
		_unread_chip.add_theme_stylebox_override(state, chip_style)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		_unread_chip.add_theme_color_override(state, SKY if unread_only else Color(1, 1, 1, 0.6))
	_mark_all.visible = unread_total > 0
	clear(_list_box)
	_pulse_labels = _pulse_labels.filter(func(entry: Variant) -> bool: return is_instance_valid(entry))
	if generating_now:
		_list_box.add_child(_generating_banner())
	var ordered := _ordered_chats()
	var rows: Array = []
	for chat in ordered:
		if not unread_only or unread.has(t(chat.get("id", ""))):
			rows.append(chat)
	if open.is_empty():
		_list_box.add_child(_empty_list("No diplomatic conversations yet.\nStart one below."))
		return
	if rows.is_empty():
		_list_box.add_child(_empty_list("No unread chats — you're all caught up."))
		return
	var last_label := ""
	var first := true
	for chat in rows:
		var label := _group_label(chat)
		if first or label != last_label:
			_list_box.add_child(_group_header(label))
			last_label = label
			first = false
		_list_box.add_child(_chat_row(chat))


func _dot_texture() -> Texture2D:
	var key := "unread-dot"
	if _cache.has(key):
		return _cache[key]
	var image := Image.new()
	image.load_svg_from_string("<svg viewBox='0 0 8 8' xmlns='http://www.w3.org/2000/svg'><circle cx='4' cy='4' r='3.2' fill='#60a5fa'/></svg>", 1.0)
	var texture := ImageTexture.create_from_image(image)
	_cache[key] = texture
	return texture


func _empty_list(message: String) -> Control:
	var holder := CenterContainer.new()
	holder.size_flags_vertical = Control.SIZE_EXPAND_FILL
	holder.custom_minimum_size.y = 120
	var label := UI.label(message, 13, Color(1, 1, 1, 0.25), 400)
	label.add_theme_font_override("font", italic_font())
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	holder.add_child(label)
	return holder


func _group_header(label_text: String) -> Control:
	var margin := MarginContainer.new()
	for side in [["margin_left", 2], ["margin_right", 2], ["margin_top", 5], ["margin_bottom", 0]]:
		margin.add_theme_constant_override(side[0], side[1])
	margin.add_child(UI.label(label_text.to_upper(), 11, Color(1, 1, 1, 0.4), 700, "Arial", 1))
	return margin


func _generating_banner() -> Control:
	var banner := PanelContainer.new()
	banner.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.15), 10, 1, Vector4(13, 10, 13, 10)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 9)
	row.add_child(UI.label("🖊", 16, UI.WHITE))
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 0)
	line.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(UI.label("Diplomacy in progress", 12, Color("#f4f4f5"), 600))
	var dots := UI.label(".".repeat(_pulse_phase), 12, Color("#f4f4f5"), 600)
	dots.custom_minimum_size.x = UI.font(600).get_string_size("...", HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x
	_pulse_labels.append(dots)
	line.add_child(dots)
	line.add_child(UI.label(" — a country may be reaching out", 12, Color(1, 1, 1, 0.4), 400))
	row.add_child(line)
	banner.add_child(row)
	return banner


func _chat_row(chat: Dictionary) -> Control:
	var id := t(chat.get("id", ""))
	var is_new := unread.has(id)
	var counterparts := counterparts_of(a(chat.get("countries", [])))
	var preview_countries := counterparts.slice(0, 4)
	var title := t(chat.get("title", ""))
	if title.is_empty():
		title = summarize(counterparts)
	var messages := a(chat.get("messages", []))
	var last := d(messages.back()) if not messages.is_empty() else {}
	var raw_preview := collapse(t(last.get("text", "")).replace("**", ""))
	if raw_preview.is_empty():
		raw_preview = "No messages yet"
	var preview := raw_preview.left(96) + ("…" if raw_preview.length() > 96 else "")
	var speaker := ""
	if t(last.get("role", "")) == "leader" or (not t(last.get("speaker", "")).is_empty() and t(last.get("role", "")) != "user"):
		speaker = t(last.get("speaker", ""))
	var meta := "%d-party channel" % (counterparts.size() + (1 if not player.is_empty() else 0)) if counterparts.size() > 1 else "Direct channel"
	var marker := ""
	for country in counterparts:
		var found := d(puppets.get(t(d(country).get("name", "")), {}))
		if not t(found.get("label", "")).is_empty():
			marker = t(found.get("label", ""))
			break
	var hovered := list_hover == id
	var confirming := list_confirm == id
	var row := PanelContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_PASS
	row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var border := Color(1, 1, 1, 0.13) if hovered else (Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.15) if is_new else Color(1, 1, 1, 0.07))
	var bg := Color(1, 1, 1, 0.065) if hovered else (Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.035) if is_new else Color(1, 1, 1, 0.025))
	row.add_theme_stylebox_override("panel", UI.box(bg, border, 12, 1))
	var margin := MarginContainer.new()
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in [["margin_left", 14], ["margin_right", 48], ["margin_top", 12], ["margin_bottom", 12]]:
		margin.add_theme_constant_override(side[0], side[1])
	if hovered:
		margin.add_theme_constant_override("margin_top", 11)
		margin.add_theme_constant_override("margin_bottom", 13)
	var content := HBoxContainer.new()
	content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	content.add_theme_constant_override("separation", 12)
	var dot_column := CenterContainer.new()
	dot_column.custom_minimum_size.x = 8
	dot_column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if is_new:
		var dot := Panel.new()
		dot.custom_minimum_size = Vector2(7, 7)
		dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
		dot.add_theme_stylebox_override("panel", UI.box(BLUE_SOFT, Color(0, 0, 0, 0), 4, 0))
		dot_column.add_child(dot)
	content.add_child(dot_column)
	var stack := flag_stack(preview_countries, Vector2(23, 15), -6)
	var stack_holder := HBoxContainer.new()
	stack_holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	stack_holder.custom_minimum_size.x = 42 if preview_countries.size() > 1 else 23
	stack_holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	stack_holder.add_child(stack)
	content.add_child(stack_holder)
	var texts := VBoxContainer.new()
	texts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.add_theme_constant_override("separation", 3)
	var top := HBoxContainer.new()
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	top.add_theme_constant_override("separation", 8)
	var name_label := UI.label(title, 13, UI.WHITE if is_new else Color(1, 1, 1, 0.9), 740 if is_new else 650)
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_label.clip_text = true
	name_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	top.add_child(name_label)
	var meta_label := UI.label((marker if not marker.is_empty() else meta).to_upper(), 9, Color(234 / 255.0, 179 / 255.0, 8 / 255.0, 0.9) if not marker.is_empty() else Color(1, 1, 1, 0.25), 400, "Arial", 1)
	meta_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	top.add_child(meta_label)
	texts.add_child(top)
	var preview_label := RichTextLabel.new()
	preview_label.bbcode_enabled = true
	preview_label.fit_content = true
	preview_label.scroll_active = false
	preview_label.autowrap_mode = TextServer.AUTOWRAP_OFF
	preview_label.clip_contents = true
	preview_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	preview_label.add_theme_font_override("normal_font", UI.font(400))
	preview_label.add_theme_font_override("bold_font", UI.font(600))
	preview_label.add_theme_font_size_override("normal_font_size", 12)
	preview_label.add_theme_font_size_override("bold_font_size", 12)
	preview_label.add_theme_color_override("default_color", Color(1, 1, 1, 0.59) if is_new else Color(1, 1, 1, 0.38))
	var prefix := ""
	if not speaker.is_empty() and counterparts.size() > 1:
		prefix = "[color=#ffffff80][b]%s: [/b][/color]" % escape(speaker)
	preview_label.text = prefix + escape(preview)
	preview_label.custom_minimum_size.y = 16
	texts.add_child(preview_label)
	content.add_child(texts)
	margin.add_child(content)
	row.add_child(margin)
	var actions_margin := MarginContainer.new()
	actions_margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	actions_margin.add_theme_constant_override("margin_right", 12)
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_END
	actions.mouse_filter = Control.MOUSE_FILTER_IGNORE
	actions.add_theme_constant_override("separation", 4)
	if hovered:
		var envelope := icon_button("envelope_filled" if is_new else "envelope", 14, Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.78), Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.86), Color(1, 1, 1, 0.08))
		envelope.tooltip_text = "Mark as read" if is_new else "Mark as unread"
		envelope.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		envelope.pressed.connect(func() -> void:
			set_read_state(chat, is_new)
			render_list())
		actions.add_child(envelope)
		var trash: Button
		if confirming:
			trash = solid_button("Delete?", 11, RED_SOFT, 650, Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.18), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.55), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.18), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.55), 7, Vector4(8, 5, 8, 5))
			trash.tooltip_text = "Click again to delete this chat"
		else:
			trash = icon_button("trash", 14, Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.68), Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.86), Color(1, 1, 1, 0.08))
			trash.tooltip_text = "Delete chat"
		trash.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		trash.pressed.connect(func() -> void:
			if list_confirm == id:
				list_confirm = ""
				delete_chat(id)
			else:
				list_confirm = id
				render_list())
		actions.add_child(trash)
		for button in [envelope, trash]:
			(button as Control).mouse_exited.connect(func() -> void: _row_left(row, id))
	else:
		var chevron := UI.label("›", 16, Color(1, 1, 1, 0.2))
		chevron.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		actions.add_child(chevron)
	actions_margin.add_child(actions)
	row.add_child(actions_margin)
	row.mouse_entered.connect(func() -> void:
		if list_hover != id:
			list_hover = id
			_render_list_deferred())
	row.mouse_exited.connect(func() -> void: _row_left(row, id))
	row.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT and not (event as InputEventMouseButton).pressed:
			open_chat_from_list(chat))
	return row


func _row_left(row: Control, id: String) -> void:
	if not is_instance_valid(row) or not row.is_inside_tree():
		return
	if row.get_global_rect().has_point(row.get_global_mouse_position()):
		return
	if list_hover == id:
		list_hover = ""
		if list_confirm == id:
			list_confirm = ""
		_render_list_deferred()


func _render_list_deferred() -> void:
	if _list_render_queued:
		return
	_list_render_queued = true
	await get_tree().process_frame
	_list_render_queued = false
	var offset := _list_scroll.scroll_vertical
	render_list()
	await get_tree().process_frame
	_list_scroll.scroll_vertical = offset


func _group_label(chat: Dictionary) -> String:
	if a(chat.get("messages", [])).is_empty():
		return "New"
	var raw := _last_parsed_time(chat)
	if raw.is_empty():
		return "Undated"
	return js_local_date_label(raw)


func _last_parsed_time(chat: Dictionary) -> String:
	var messages := a(chat.get("messages", []))
	for index in range(messages.size() - 1, -1, -1):
		var raw := t(d(messages[index]).get("time", ""))
		if not raw.is_empty() and js_date_ms(raw) != null:
			return raw
	return ""


func sort_by_recency(list: Array) -> Array:
	var keyed: Array = []
	for index in range(list.size()):
		var chat: Dictionary = list[index]
		var kind := 0
		var ms := 0.0
		if not a(chat.get("messages", [])).is_empty():
			var raw := _last_parsed_time(chat)
			if raw.is_empty():
				kind = 2
			else:
				kind = 1
				ms = float(js_date_ms(raw))
		keyed.append({"chat": chat, "kind": kind, "ms": ms, "index": index})
	keyed.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		if int(left["kind"]) != int(right["kind"]):
			return int(left["kind"]) < int(right["kind"])
		if int(left["kind"]) == 1 and float(left["ms"]) != float(right["ms"]):
			return float(left["ms"]) > float(right["ms"])
		return int(left["index"]) < int(right["index"]))
	var out: Array = []
	for entry in keyed:
		out.append(entry["chat"])
	return out


func open_chat_from_list(chat: Dictionary) -> void:
	var stored := find_chat(t(chat.get("id", "")))
	held_unread = ""
	set_read_state(chat, true)
	set_active(stored if not stored.is_empty() else chat)


func set_active(chat: Dictionary) -> void:
	active = chat
	if conversation_visible():
		conversation.show_chat(active)
		if t(draft.get("chat_id", "")) == t(active.get("id", "")):
			conversation.apply_draft(t(draft.get("text", "")))
			draft = {}
	else:
		conversation_unmounted()
	mark_active_read()
	active_chat_changed.emit(active_chat_id())
	render_all()


func conversation_unmounted() -> void:
	if conversation:
		conversation.leave()


func delete_chat(id: String) -> void:
	for index in range(chats.size()):
		if t(chats[index].get("id", "")) == id:
			var closed_chat: Dictionary = chats[index].duplicate()
			closed_chat["status"] = "closed"
			chats[index] = closed_chat
	persist("chat.close", {"id": id})
	if t(active.get("id", "")) == id:
		active = {}
		conversation_unmounted()
		held_unread = ""
		active_chat_changed.emit(active_chat_id())
	render_all()


func leave_active() -> void:
	if active.is_empty():
		return
	var terminal := false
	if is_lifecycle(active):
		var leaving_hearing := t(active.get("id", ""))
		await conversation.world_changed()
		if active.is_empty() or t(active.get("id", "")) != leaving_hearing:
			return
		terminal = conversation.lifecycle_terminal_for_leave()
	var institution_id := t(active.get("institutionId", ""))
	var leaving_id := t(active.get("id", ""))
	if terminal:
		delete_chat(leaving_id)
	else:
		active = {}
		conversation_unmounted()
		active_chat_changed.emit(active_chat_id())
	held_unread = ""
	if not institution_id.is_empty():
		navigate_institution(institution_id, "overview")
		return
	render_all()


func _open_selector() -> void:
	selector_open = true
	selected = []
	_modal_search.text = ""
	_modal.visible = true
	_animate_modal(true)
	pickable_loading = true
	_render_modal()
	if not roster_loaded:
		_load_roster()
	var reply := await engine.request("chat.countries", {"player": player})
	pickable_loading = false
	if reply.get("ok", false):
		pickable = a(d(reply.get("result", {})).get("countries", []))
		for entry in pickable:
			var entry_name := t(entry.get("name", ""))
			if not flags.has(entry_name) and not t(entry.get("flag", "")).is_empty():
				flags[entry_name] = {"flag": t(entry.get("flag", "")), "accent": ""}
	if selector_open:
		_render_modal()


func _load_roster() -> void:
	var reply := await engine.request("chat.countries", {"player": ""})
	if reply.get("ok", false):
		roster = a(d(reply.get("result", {})).get("all", []))
		roster_loaded = true


func _close_selector() -> void:
	selector_open = false
	_animate_modal(false)


func _animate_modal(showing: bool) -> void:
	if _modal_tween and _modal_tween.is_valid():
		_modal_tween.kill()
	if not is_inside_tree():
		_modal.visible = showing
		_modal.modulate.a = 1.0
		return
	_modal_tween = create_tween().set_parallel(true)
	if showing:
		_modal.modulate.a = 0.0
		_modal.scale = Vector2.ONE
		_modal.position.y = 0.0
		_modal_tween.tween_property(_modal, "modulate:a", 1.0, 0.16).set_ease(Tween.EASE_OUT)
	else:
		_modal.pivot_offset = _modal.size * 0.5
		_modal_tween.tween_property(_modal, "modulate:a", 0.0, 0.15).set_ease(Tween.EASE_IN)
		_modal_tween.tween_property(_modal, "scale", Vector2(0.985, 0.985), 0.15).set_ease(Tween.EASE_IN)
		_modal_tween.chain().tween_callback(func() -> void:
			_modal.visible = false
			_modal.scale = Vector2.ONE
			_modal.modulate.a = 1.0)


func _start_chat(chosen: Array) -> void:
	var countries: Array = []
	for entry in chosen:
		countries.append({"name": t(entry.get("name", "")), "code": t(entry.get("code", ""))})
	var created := {"id": new_chat_id(), "countries": countries, "messages": [], "status": "open"}
	chats.push_front(created)
	persist("chat.create", {"chat": created})
	selector_open = false
	_modal.visible = false
	set_active(created)


func _build_modal() -> void:
	_modal = PanelContainer.new()
	_modal.add_theme_stylebox_override("panel", UI.box(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.98), Color(0, 0, 0, 0), 16, 0))
	_modal.mouse_filter = Control.MOUSE_FILTER_STOP
	_modal.visible = false
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var head := MarginContainer.new()
	for side in [["margin_left", 20], ["margin_right", 20], ["margin_top", 18], ["margin_bottom", 10]]:
		head.add_theme_constant_override(side[0], side[1])
	var head_column := VBoxContainer.new()
	head_column.add_theme_constant_override("separation", 0)
	var title_row := HBoxContainer.new()
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.add_theme_constant_override("separation", 3)
	titles.add_child(UI.label("Start New Diplomatic Chat", 17, UI.WHITE, 700))
	titles.add_child(UI.label("Select countries to invite to the conversation", 12, Color(1, 1, 1, 0.4)))
	title_row.add_child(titles)
	var close := text_button("✕", 18, Color(1, 1, 1, 0.5), UI.WHITE, 400, Color(1, 1, 1, 0.08))
	close.tooltip_text = "Close"
	close.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	close.pressed.connect(_close_selector)
	title_row.add_child(close)
	head_column.add_child(title_row)
	head_column.add_child(gap(14))
	var selected_box := PanelContainer.new()
	selected_box.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.1), 10, 1, Vector4(14, 10, 14, 10)))
	var selected_column := VBoxContainer.new()
	selected_column.add_theme_constant_override("separation", 3)
	_modal_selected_label = UI.label("Selected Countries (0):", 13, Color(1, 1, 1, 0.8), 600)
	selected_column.add_child(_modal_selected_label)
	_modal_selected_flow = HFlowContainer.new()
	_modal_selected_flow.add_theme_constant_override("h_separation", 6)
	_modal_selected_flow.add_theme_constant_override("v_separation", 3)
	selected_column.add_child(_modal_selected_flow)
	selected_box.add_child(selected_column)
	head_column.add_child(selected_box)
	head_column.add_child(gap(12))
	_modal_search = LineEdit.new()
	_modal_search.placeholder_text = "Search countries..."
	_modal_search.custom_minimum_size.y = 36
	_modal_search.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.12), 10, 1, Vector4(35, 0, 14, 0)))
	_modal_search.add_theme_stylebox_override("focus", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.25), 10, 1, Vector4(35, 0, 14, 0)))
	_modal_search.add_theme_font_override("font", UI.font(400))
	_modal_search.add_theme_font_size_override("font_size", 13)
	_modal_search.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.35))
	_modal_search.text_changed.connect(func(_text: String) -> void: _render_modal_grid())
	var search_icon := icon_rect("search", 13, Color(1, 1, 1, 0.35))
	search_icon.position = Vector2(12, 11)
	_modal_search.add_child(search_icon)
	head_column.add_child(_modal_search)
	head.add_child(head_column)
	column.add_child(head)
	_modal_scroll = ScrollContainer.new()
	_modal_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_modal_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_modal_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	var grid_margin := MarginContainer.new()
	grid_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 16], ["margin_right", 16], ["margin_top", 8], ["margin_bottom", 8]]:
		grid_margin.add_theme_constant_override(side[0], side[1])
	var grid_column := VBoxContainer.new()
	grid_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_modal_loading = UI.label("Loading countries…", 13, Color(1, 1, 1, 0.35))
	_modal_loading.add_theme_font_override("font", italic_font())
	_modal_loading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	grid_column.add_child(_modal_loading)
	_modal_grid = GridContainer.new()
	_modal_grid.columns = 3
	_modal_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_modal_grid.add_theme_constant_override("h_separation", 8)
	_modal_grid.add_theme_constant_override("v_separation", 8)
	grid_column.add_child(_modal_grid)
	grid_margin.add_child(grid_column)
	_modal_scroll.add_child(grid_margin)
	column.add_child(_modal_scroll)
	var foot := PanelContainer.new()
	var foot_style := StyleBoxFlat.new()
	foot_style.bg_color = Color(0, 0, 0, 0)
	foot_style.border_color = Color(1, 1, 1, 0.07)
	foot_style.border_width_top = 1
	foot_style.content_margin_left = 16
	foot_style.content_margin_right = 16
	foot_style.content_margin_top = 12
	foot_style.content_margin_bottom = 12
	foot.add_theme_stylebox_override("panel", foot_style)
	var foot_row := HBoxContainer.new()
	foot_row.add_theme_constant_override("separation", 8)
	var cancel := solid_button("Cancel", 14, Color(1, 1, 1, 0.8), 500, Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.12), 10)
	cancel.custom_minimum_size.y = 42
	cancel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cancel.size_flags_stretch_ratio = 1.0
	cancel.pressed.connect(_close_selector)
	foot_row.add_child(cancel)
	_modal_start = Button.new()
	_modal_start.focus_mode = Control.FOCUS_NONE
	_modal_start.custom_minimum_size.y = 42
	_modal_start.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_modal_start.size_flags_stretch_ratio = 2.0
	_modal_start.add_theme_font_override("font", UI.font(600))
	_modal_start.add_theme_font_size_override("font_size", 14)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_disabled_color", "font_hover_pressed_color", "font_focus_color"]:
		_modal_start.add_theme_color_override(state, UI.WHITE)
	_modal_start.pressed.connect(func() -> void:
		if not selected.is_empty():
			_start_chat(selected))
	foot_row.add_child(_modal_start)
	foot.add_child(foot_row)
	column.add_child(foot)
	_modal.add_child(column)
	add_child(_modal)


func _render_modal() -> void:
	_modal_selected_label.text = "Selected Countries (%d):" % selected.size()
	clear(_modal_selected_flow)
	if selected.is_empty():
		_modal_selected_flow.add_child(UI.label("No countries selected yet", 12, Color(1, 1, 1, 0.35)))
	else:
		for index in range(selected.size()):
			var entry: Dictionary = selected[index]
			var chip := HBoxContainer.new()
			chip.add_theme_constant_override("separation", 4)
			chip.add_child(flag_box(t(entry.get("name", "")), Vector2(12, 12)))
			chip.add_child(UI.label(t(entry.get("name", "")) + ("," if index < selected.size() - 1 else ""), 12, Color(1, 1, 1, 0.35)))
			_modal_selected_flow.add_child(chip)
	var count := selected.size()
	_modal_start.text = "Chat with %d %s" % [count, "country" if count == 1 else "countries"]
	var enabled := count > 0
	_modal_start.disabled = not enabled
	_modal_start.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if enabled else Control.CURSOR_FORBIDDEN
	var normal := UI.box(Color(1, 1, 1, 0.28) if enabled else Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.3), Color(0, 0, 0, 0), 10, 0)
	var hover := UI.box(BLUE_HOVER if enabled else Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.3), Color(0, 0, 0, 0), 10, 0)
	_modal_start.add_theme_stylebox_override("normal", normal)
	_modal_start.add_theme_stylebox_override("focus", normal)
	_modal_start.add_theme_stylebox_override("disabled", normal)
	_modal_start.add_theme_stylebox_override("hover", hover)
	_modal_start.add_theme_stylebox_override("pressed", hover)
	_modal_start.add_theme_stylebox_override("hover_pressed", hover)
	_render_modal_grid()


func _render_modal_grid() -> void:
	_modal_loading.visible = pickable_loading
	clear(_modal_grid)
	var query := _modal_search.text.to_lower()
	var names_seen := {}
	for entry in pickable:
		var entry_name := t(entry.get("name", ""))
		if entry_name.is_empty() or names_seen.has(entry_name.to_lower()):
			continue
		names_seen[entry_name.to_lower()] = true
		if not query.is_empty() and not entry_name.to_lower().contains(query):
			continue
		_modal_grid.add_child(_country_tile(entry))


func _country_tile(entry: Dictionary) -> Control:
	var entry_name := t(entry.get("name", ""))
	var chosen := false
	for item in selected:
		if t(item.get("name", "")) == entry_name:
			chosen = true
	var tile := Button.new()
	tile.focus_mode = Control.FOCUS_NONE
	tile.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	tile.custom_minimum_size = Vector2(0, 88)
	tile.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var normal := UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.18) if chosen else Color(1, 1, 1, 0.04), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.6) if chosen else Color(1, 1, 1, 0.07), 10, 1)
	var hover := UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.18) if chosen else Color(1, 1, 1, 0.07), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.6) if chosen else Color(1, 1, 1, 0.15), 10, 1)
	for state in ["normal", "focus", "disabled"]:
		tile.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		tile.add_theme_stylebox_override(state, hover)
	var stack := VBoxContainer.new()
	stack.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	stack.alignment = BoxContainer.ALIGNMENT_CENTER
	stack.add_theme_constant_override("separation", 6)
	stack.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var flag_holder := CenterContainer.new()
	flag_holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	flag_holder.add_child(flag_box(entry_name, Vector2(37, 26), t(entry.get("flag", ""))))
	stack.add_child(flag_holder)
	var short_name := entry_name.left(11) + "…" if entry_name.length() > 12 else entry_name
	var caption := UI.label(short_name, 12, Color(1, 1, 1, 0.8))
	caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(caption)
	tile.add_child(stack)
	if chosen:
		var check := PanelContainer.new()
		check.add_theme_stylebox_override("panel", UI.box(BLUE, Color(0, 0, 0, 0), 7, 0))
		check.custom_minimum_size = Vector2(14, 14)
		check.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var mark := UI.label("✓", 9, UI.WHITE, 700)
		mark.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		mark.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		check.add_child(mark)
		check.anchor_left = 1.0
		check.anchor_right = 1.0
		check.offset_left = -19
		check.offset_right = -5
		check.offset_top = 5
		check.offset_bottom = 19
		tile.add_child(check)
	tile.pressed.connect(func() -> void:
		var kept: Array = []
		var removed := false
		for item in selected:
			if t(item.get("name", "")) == entry_name:
				removed = true
			else:
				kept.append(item)
		if not removed:
			kept.append({"name": entry_name, "code": t(entry.get("code", ""))})
		selected = kept
		var offset := _modal_scroll.scroll_vertical
		_render_modal()
		await get_tree().process_frame
		_modal_scroll.scroll_vertical = offset)
	return tile


func _fetch_flags() -> void:
	if not engine:
		return
	var wanted: Array = []
	var names := {}
	var add := func(country: Dictionary) -> void:
		var entry_name := t(country.get("name", ""))
		if entry_name.is_empty() or flags.has(entry_name) or _flags_pending.has(entry_name) or names.has(entry_name):
			return
		names[entry_name] = true
		wanted.append({"name": entry_name, "code": t(country.get("code", ""))})
	for chat in chats:
		for country in a(chat.get("countries", [])):
			add.call(d(country))
		for message in a(chat.get("messages", [])):
			var entry := d(message)
			var role := t(entry.get("role", ""))
			if role != "user" and role != "error" and role != "system":
				add.call({"name": t(entry.get("speaker", "")), "code": t(entry.get("code", ""))})
			var reactions := d(entry.get("reactions", {}))
			for key in reactions:
				var value := d(reactions[key])
				var who := t(value.get("country", ""))
				add.call({"name": who if not who.is_empty() else t(key), "code": t(value.get("code", ""))})
	if not player.is_empty():
		add.call({"name": player, "code": ""})
	if wanted.is_empty():
		return
	for entry in wanted:
		_flags_pending[entry["name"]] = true
	var reply := await engine.request("chat.flags", {"countries": wanted})
	for entry in wanted:
		_flags_pending.erase(entry["name"])
	if not reply.get("ok", false):
		return
	var result := d(reply.get("result", {}))
	for entry_name in result:
		var previous := d(flags.get(entry_name, {}))
		var value := d(result[entry_name])
		if t(value.get("flag", "")).is_empty() and not t(previous.get("flag", "")).is_empty():
			value["flag"] = previous["flag"]
		flags[entry_name] = value
	if is_open():
		if conversation_visible():
			conversation.refresh_chrome()
			conversation.render_messages(false)
		elif current_view() == "chats":
			render_list()
	for id in councils.keys():
		if is_instance_valid(councils[id]):
			(councils[id] as Conversation).render_messages(false)


func accent_for(speaker: String, code: String) -> Color:
	var value := t(d(flags.get(speaker, {})).get("accent", ""))
	if value.begins_with("rgb("):
		var parts := value.trim_prefix("rgb(").trim_suffix(")").split(",")
		if parts.size() >= 3:
			return Color8(int(parts[0]), int(parts[1]), int(parts[2]))
	if value.begins_with("#"):
		return Color(value)
	if code.length() >= 3:
		var alpha := "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
		return Color8(64 + alpha.find(code[0]) * 5, 64 + alpha.find(code[2]) * 5, 64 + alpha.find(code[1]) * 5)
	var code_sum := 0
	for index in range(speaker.length()):
		code_sum = (code_sum * 31 + speaker.unicode_at(index)) & 0xFFFFFFFF
	return Color(ACCENTS[code_sum % ACCENTS.size()])


func flag_box(country_name: String, box_size: Vector2, path := "") -> Control:
	var file := path if not path.is_empty() else t(d(flags.get(country_name, {})).get("flag", ""))
	var texture: Texture2D = null
	if not file.is_empty():
		texture = flag_texture(file, int(ceil(box_size.y * 2.0)))
	if texture == null:
		var fallback := UI.label("🏳", maxi(8, int(box_size.y * 0.95)), UI.WHITE)
		fallback.custom_minimum_size = box_size
		fallback.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		fallback.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		return fallback
	var frame := PanelContainer.new()
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.12), Color(0, 0, 0, 0), 2, 0, Vector4(1, 1, 1, 1)))
	frame.custom_minimum_size = box_size
	frame.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var rect := TextureRect.new()
	rect.texture = texture
	rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_child(rect)
	return frame


func flag_stack(countries: Array, box_size: Vector2, overlap: int) -> Control:
	var stack := HBoxContainer.new()
	stack.mouse_filter = Control.MOUSE_FILTER_IGNORE
	stack.add_theme_constant_override("separation", overlap)
	stack.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	for index in range(countries.size()):
		var flag := flag_box(t(d(countries[index]).get("name", "")), box_size)
		flag.z_index = countries.size() - index
		stack.add_child(flag)
	return stack


func counterparts_of(countries: Array) -> Array:
	var valid: Array = []
	for country in countries:
		var entry := d(country)
		if not t(entry.get("name", "")).is_empty() or not t(entry.get("code", "")).is_empty():
			valid.append(entry)
	var others: Array = []
	for entry in valid:
		if not matches_player(entry):
			others.append(entry)
	return others if not others.is_empty() else valid


func matches_player(country: Dictionary) -> bool:
	var me := player.strip_edges().to_lower()
	if me.is_empty():
		return false
	return t(country.get("name", "")).to_lower() == me or t(country.get("code", "")).to_lower() == me


func _tick_dots() -> void:
	_dots_phase = (_dots_phase + 1) % 4
	_dot_labels = _dot_labels.filter(func(entry: Variant) -> bool: return is_instance_valid(entry))
	for label in _dot_labels:
		apply_dots(label as Label)


func register_dots(label: Label) -> void:
	_dot_labels.append(label)
	apply_dots(label)


func apply_dots(label: Label) -> void:
	label.text = t(label.get_meta("base", "")) + ".".repeat(_dots_phase) + " "


func _tick_pulse() -> void:
	_pulse_phase = _pulse_phase % 3 + 1
	for label in _pulse_labels:
		if is_instance_valid(label):
			(label as Label).text = ".".repeat(_pulse_phase)


static func summarize(countries: Array) -> String:
	var names: Array = []
	for country in countries:
		var entry_name := t(d(country).get("name", ""))
		if not entry_name.is_empty():
			names.append(entry_name)
	if names.is_empty():
		return "Unknown participant"
	if names.size() == 1:
		return names[0]
	if names.size() == 2:
		return "%s & %s" % [names[0], names[1]]
	return "%s, %s + %d" % [names[0], names[1], names.size() - 2]


static func is_lifecycle(chat: Dictionary) -> bool:
	return not t(chat.get("lifecycleInstitutionId", "")).is_empty() and not a(chat.get("lifecycleCaseIds", [])).is_empty()


static func flag_texture(path: String, height: int) -> Texture2D:
	if path.to_lower().ends_with(".svg"):
		return UI.flag(path, height)
	var key := "raster:%s" % path
	if _cache.has(key):
		return _cache[key]
	var texture := ImageLoader.texture_from_file(path)
	if texture == null:
		return null
	_cache[key] = texture
	return texture


static func new_chat_id() -> String:
	return "chat-%s-%s" % [base36(int(Time.get_unix_time_from_system() * 1000.0)), random36(5)]


static func thread_id(prefix: String) -> String:
	return "%s-%s-%s" % [prefix, base36(int(Time.get_unix_time_from_system() * 1000.0)), random36(5)]


static func base36(value: int) -> String:
	var digits := "0123456789abcdefghijklmnopqrstuvwxyz"
	if value <= 0:
		return "0"
	var out := ""
	var rest := value
	while rest > 0:
		out = digits[rest % 36] + out
		rest = floori(rest / 36.0)
	return out


static func random36(count: int) -> String:
	var digits := "0123456789abcdefghijklmnopqrstuvwxyz"
	var out := ""
	for i in range(count):
		out += digits[randi() % 36]
	return out


static func parse_date(value: String) -> Dictionary:
	var raw := value.strip_edges()
	if raw.is_empty():
		return {}
	var bc := false
	var era := RegEx.create_from_string("\\s*(BCE|BC|CE|AD)$")
	var era_match := era.search(raw.to_upper())
	if era_match:
		bc = era_match.get_string(1).begins_with("BC")
		raw = raw.substr(0, era_match.get_start()).strip_edges()
	var date_part := raw.split("T")[0].split(" ")[0]
	var pattern := RegEx.create_from_string("^([+-]?)(\\d{1,6})-(\\d{1,2})-(\\d{1,2})$")
	var found := pattern.search(date_part)
	if not found:
		return {}
	var year := int(found.get_string(2))
	var month := int(found.get_string(3))
	var day := int(found.get_string(4))
	if found.get_string(1) == "-" or bc:
		year = -year
	if year == 0 or month < 1 or month > 12 or day < 1 or day > _days_in_month(year, month):
		return {}
	return {"year": year, "month": month, "day": day}


static func _days_in_month(year: int, month: int) -> int:
	var astronomical := year + 1 if year < 0 else year
	var leap := astronomical % 4 == 0 and (astronomical % 100 != 0 or astronomical % 400 == 0)
	var lengths := [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
	return lengths[month - 1]


static func civil_days(year: int, month: int, day: int) -> int:
	var shifted := year - (1 if month <= 2 else 0)
	var era := floori(shifted / 400.0)
	var year_of_era := shifted - era * 400
	var month_index := (month + 9) % 12
	var day_of_year := floori((153.0 * month_index + 2.0) / 5.0) + day - 1
	var day_of_era := year_of_era * 365 + floori(year_of_era / 4.0) - floori(year_of_era / 100.0) + day_of_year
	return era * 146097 + day_of_era - 719468


static func js_date_ms(value: String) -> Variant:
	var raw := value.strip_edges()
	var iso := RegEx.create_from_string("^(\\d{4})-(\\d{2})-(\\d{2})(?:T(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,3}))?)?(Z|[+-]\\d{2}:\\d{2})?)?$")
	var found := iso.search(raw)
	if found:
		var year := int(found.get_string(1))
		var month := int(found.get_string(2))
		var day := int(found.get_string(3))
		if month < 1 or month > 12 or day < 1 or day > 31:
			return null
		var days := civil_days(year, month, day)
		var seconds := float(days) * 86400.0
		if not found.get_string(4).is_empty():
			seconds += int(found.get_string(4)) * 3600 + int(found.get_string(5)) * 60 + int(found.get_string(6) if not found.get_string(6).is_empty() else "0")
			var zone := found.get_string(8)
			if zone.is_empty():
				seconds -= float(Time.get_time_zone_from_system().get("bias", 0)) * 60.0
			elif zone != "Z":
				var sign := -1.0 if zone.begins_with("-") else 1.0
				seconds -= sign * (int(zone.substr(1, 2)) * 3600 + int(zone.substr(4, 2)) * 60)
		return seconds * 1000.0
	var expanded := RegEx.create_from_string("^([+-]\\d{6})-(\\d{2})-(\\d{2})$")
	var long_year := expanded.search(raw)
	if long_year:
		var year_value := int(long_year.get_string(1))
		if long_year.get_string(1) == "-000000":
			return null
		return float(civil_days(year_value, int(long_year.get_string(2)), int(long_year.get_string(3)))) * 86400000.0
	return null


static func js_local_date_label(value: String) -> String:
	var ms: Variant = js_date_ms(value)
	if ms == null:
		return ""
	var local_seconds := float(ms) / 1000.0 + float(Time.get_time_zone_from_system().get("bias", 0)) * 60.0
	var days := floori(local_seconds / 86400.0)
	var z := days + 719468
	var era := floori(z / 146097.0)
	var day_of_era := z - era * 146097
	var year_of_era := floori((day_of_era - floori(day_of_era / 1460.0) + floori(day_of_era / 36524.0) - floori(day_of_era / 146096.0)) / 365.0)
	var year := year_of_era + era * 400
	var day_of_year := day_of_era - (365 * year_of_era + floori(year_of_era / 4.0) - floori(year_of_era / 100.0))
	var month_index := floori((5.0 * day_of_year + 2.0) / 153.0)
	var day := day_of_year - floori((153.0 * month_index + 2.0) / 5.0) + 1
	var month := month_index + 3 if month_index < 10 else month_index - 9
	if month <= 2:
		year += 1
	var year_text := str(year) if year > 0 else "%d" % (1 - year)
	return "%s %d, %s" % [MONTHS[month - 1], day, year_text]


static func date_key(value: String) -> String:
	var parts := parse_date(value)
	if parts.is_empty():
		return value.strip_edges()
	var year: int = parts["year"]
	return "%s%04d-%02d-%02d" % ["-" if year < 0 else "", absi(year), parts["month"], parts["day"]]


static func year_text(year: int) -> String:
	return "%d BC" % -year if year < 0 else str(year)


static func long_date(value: String) -> String:
	var parts := parse_date(value)
	if parts.is_empty():
		return ""
	return "%s %d, %s" % [MONTHS[int(parts["month"]) - 1], parts["day"], year_text(parts["year"])]


static func short_date(value: String) -> String:
	var parts := parse_date(value)
	if parts.is_empty():
		return ""
	return "%s %d, %s" % [MONTHS_SHORT[int(parts["month"]) - 1], parts["day"], year_text(parts["year"])]


static func collapse(text: String) -> String:
	var spaces := RegEx.create_from_string("\\s+")
	return spaces.sub(text, " ", true).strip_edges()


static func escape(text: String) -> String:
	return text.replace("[", "[lb]")


static func clear(node: Node) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()


static func gap(height: float) -> Control:
	var node := Control.new()
	node.custom_minimum_size.y = height
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func spaced(control: Control, top: int) -> Control:
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_top", top)
	margin.add_child(control)
	return margin


static func spaced_bottom(control: Control, bottom: int) -> Control:
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_bottom", bottom)
	margin.add_child(control)
	return margin


static func italic_font(weight := 400) -> Font:
	var key := "italic:%d" % weight
	if _cache.has(key):
		return _cache[key]
	var system := SystemFont.new()
	system.font_names = PackedStringArray(["Arial", "Segoe UI", "Helvetica", "Liberation Sans", "Segoe UI Emoji", "Segoe UI Symbol", "sans-serif"])
	system.font_italic = true
	system.font_weight = weight
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	system.hinting = TextServer.HINTING_LIGHT
	_cache[key] = system
	return system


static func mono_font() -> Font:
	var key := "mono"
	if _cache.has(key):
		return _cache[key]
	var system := SystemFont.new()
	system.font_names = PackedStringArray(["Consolas", "Cascadia Mono", "Courier New", "monospace"])
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	_cache[key] = system
	return system


static func icon(icon_key: String, px: int) -> Texture2D:
	var key := "icon:%s:%d" % [icon_key, px]
	if _cache.has(key):
		return _cache[key]
	var svg: String = ICONS.get(icon_key, "")
	if svg.is_empty():
		return null
	var image := Image.new()
	if image.load_svg_from_string(svg, float(px) / 24.0) != OK:
		return null
	var texture := ImageTexture.create_from_image(image)
	_cache[key] = texture
	return texture


static func icon_rect(icon_key: String, px: int, color: Color) -> TextureRect:
	var rect := TextureRect.new()
	rect.texture = icon(icon_key, px)
	rect.custom_minimum_size = Vector2(px, px)
	rect.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	rect.self_modulate = color
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rect.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return rect


static func style_flat(button: Button, bg: Color, border: Color, corner: int, pad: Vector4, hover_bg := Color(1, 1, 1, 0.08), hover_border := Color(-1, -1, -1, -1)) -> void:
	var normal := UI.box(bg, border, corner, 1, pad)
	var hover := UI.box(hover_bg, border if hover_border.r < 0.0 else hover_border, corner, 1, pad)
	for state in ["normal", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)


static func icon_button(icon_key: String, px: int, color: Color, bg: Color, border: Color) -> Button:
	var button := Button.new()
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.icon = icon(icon_key, px)
	button.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	for state in ["icon_normal_color", "icon_hover_color", "icon_pressed_color", "icon_hover_pressed_color", "icon_focus_color", "icon_disabled_color"]:
		button.add_theme_color_override(state, color)
	style_flat(button, bg, border, 7, Vector4(5, 5, 5, 5), Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.06)) if bg.a > 0.0 else Color(1, 1, 1, 0.08))
	return button


static func icon_text_button(caption: String, icon_key: String, px: int, color: Color, bg: Color, border: Color, corner: int, pad: Vector4) -> Button:
	var button := solid_button(caption, px, color, 600, bg, border, Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.1)), Color(border.r, border.g, border.b, minf(1.0, border.a + 0.25)), corner, pad)
	button.icon = icon(icon_key, 12)
	for state in ["icon_normal_color", "icon_hover_color", "icon_pressed_color", "icon_hover_pressed_color", "icon_focus_color", "icon_disabled_color"]:
		button.add_theme_color_override(state, color)
	button.add_theme_constant_override("h_separation", 5)
	return button


static func solid_button(caption: String, px: int, color: Color, weight: int, bg: Color, border: Color, hover_bg: Color, hover_border: Color, corner: int, pad := Vector4(12, 6, 12, 6)) -> Button:
	var button := Button.new()
	button.text = caption
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_override("font", UI.font(weight))
	button.add_theme_font_size_override("font_size", px)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		button.add_theme_color_override(state, color)
	button.add_theme_color_override("font_disabled_color", Color(color, color.a * 0.6))
	var normal := UI.box(bg, border, corner, 1, pad)
	var hover := UI.box(hover_bg, hover_border, corner, 1, pad)
	for state in ["normal", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	return button


static func text_button(caption: String, px: int, color: Color, hover_color: Color, weight := 600, hover_bg := Color(0, 0, 0, 0)) -> Button:
	var button := Button.new()
	button.text = caption
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_override("font", UI.font(weight))
	button.add_theme_font_size_override("font_size", px)
	for state in ["font_color", "font_focus_color"]:
		button.add_theme_color_override(state, color)
	for state in ["font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
		button.add_theme_color_override(state, hover_color)
	var empty := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 6, 0, Vector4(5, 2, 5, 2))
	var hover := UI.box(hover_bg, Color(0, 0, 0, 0), 6, 0, Vector4(5, 2, 5, 2))
	for state in ["normal", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, empty)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	return button


static func pill(caption: String, tone: String) -> PanelContainer:
	var colors: Array = PILL_TONES.get(tone, PILL_TONES["neutral"])
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(colors[0], colors[1], 999, 1, Vector4(7, 2, 7, 3)))
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.add_child(UI.label(caption, 10, colors[2], 750))
	return holder


static func style_input(input: LineEdit, px: int, bg := Color(0, 0, 0, 0.28), border := Color(1, 1, 1, 0.14), corner := 8) -> void:
	input.custom_minimum_size.y = maxf(26.0, float(px) * 2.4)
	input.add_theme_stylebox_override("normal", UI.box(bg, border, corner, 1, Vector4(9, 0, 9, 0)))
	input.add_theme_stylebox_override("focus", UI.box(bg, Color(1, 1, 1, minf(1.0, border.a + 0.12)), corner, 1, Vector4(9, 0, 9, 0)))
	input.add_theme_stylebox_override("read_only", UI.box(bg, border, corner, 1, Vector4(9, 0, 9, 0)))
	input.add_theme_font_override("font", UI.font(400))
	input.add_theme_font_size_override("font_size", px)
	input.add_theme_color_override("font_color", UI.WHITE)
	input.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.35))


static func style_text_edit(edit: TextEdit, px: int, bg: Color, border: Color, focus_border: Color, corner: int, pad: Vector4) -> void:
	edit.add_theme_stylebox_override("normal", UI.box(bg, border, corner, 1, pad))
	edit.add_theme_stylebox_override("focus", UI.box(bg, focus_border, corner, 1, pad))
	edit.add_theme_stylebox_override("read_only", UI.box(bg, border, corner, 1, pad))
	edit.add_theme_font_override("font", UI.font(400))
	edit.add_theme_font_size_override("font_size", px)
	edit.add_theme_color_override("font_color", UI.WHITE)
	edit.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.35))
	edit.add_theme_color_override("background_color", Color(0, 0, 0, 0))
	edit.add_theme_constant_override("line_spacing", 5)


static func set_direction(root: Control, rtl: bool) -> void:
	_direct_tree(root, rtl)
	root.tree_entered.connect(func() -> void:
		(func() -> void:
			if is_instance_valid(root):
				_direct_tree.call_deferred(root, rtl)).call_deferred(), CONNECT_ONE_SHOT)


static func _direct_tree(node: Node, rtl: bool) -> void:
	if not is_instance_valid(node):
		return
	if node is Control:
		(node as Control).layout_direction = Control.LAYOUT_DIRECTION_RTL if rtl else Control.LAYOUT_DIRECTION_LTR
	if node is Label:
		(node as Label).text_direction = Control.TEXT_DIRECTION_RTL if rtl else Control.TEXT_DIRECTION_LTR
	elif node is RichTextLabel:
		(node as RichTextLabel).text_direction = Control.TEXT_DIRECTION_RTL if rtl else Control.TEXT_DIRECTION_LTR
	for child in node.get_children():
		_direct_tree(child, rtl)


static func normalize_markdown(source: String) -> String:
	if source.is_empty():
		return ""
	var out: PackedStringArray = []
	var buffer: PackedStringArray = []
	var in_fence := false
	var fence := RegEx.create_from_string("^\\s{0,3}(?:`{3,}|~{3,})")
	for line in source.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
		if fence.search(line):
			if in_fence:
				out.append("\n".join(buffer) + "\n" + line)
				buffer = PackedStringArray()
			else:
				if not buffer.is_empty():
					out.append(_normalize_segment("\n".join(buffer)))
				buffer = PackedStringArray([line])
			in_fence = not in_fence
			continue
		buffer.append(line)
	if in_fence:
		out.append("\n".join(buffer))
	elif not buffer.is_empty():
		out.append(_normalize_segment("\n".join(buffer)))
	return "\n".join(out)


static func _normalize_segment(segment: String) -> String:
	var spans: Array = []
	var span_pattern := RegEx.create_from_string("`+[^`\\n]*`+")
	var held := ""
	var cursor := 0
	for found in span_pattern.search_all(segment):
		held += segment.substr(cursor, found.get_start() - cursor) + _mark(0, spans.size())
		spans.append(found.get_string())
		cursor = found.get_end()
	held += segment.substr(cursor)
	var replacements := [
		["(?i)<br\\s*/?>", "\n"],
		["(?i)<hr\\s*/?>", "\n\n---\n\n"],
		["(?i)</?(?:p|div|section)(?:\\s[^>]*)?>", "\n\n"],
		["(?i)<li(?:\\s[^>]*)?>", "\n- "],
		["(?i)</li>", ""],
		["(?i)</?(?:ul|ol)(?:\\s[^>]*)?>", "\n\n"],
		["(?i)</?(?:b|strong)(?:\\s[^>]*)?>", "**"],
		["(?i)</?(?:i|em)(?:\\s[^>]*)?>", "*"],
		["(?i)</?(?:code|tt|kbd)(?:\\s[^>]*)?>", "`"],
		["(?i)</?(?:u|span|small|sup|sub|font)(?:\\s[^>]*)?>", ""],
	]
	var text := held
	for entry in replacements:
		text = RegEx.create_from_string(entry[0]).sub(text, entry[1], true)
	text = _decode_entities(text)
	text = RegEx.create_from_string("\\n{3,}").sub(text, "\n\n", true)
	var heading_fix := RegEx.create_from_string("^(\\s{0,3})(#{1,6})([^#\\s])")
	var lines: Array = []
	for line in text.split("\n"):
		lines.append(heading_fix.sub(line, "$1$2 $3"))
	lines = _space_out_tables(lines)
	var joined := "\n".join(PackedStringArray(lines))
	for index in range(spans.size()):
		joined = joined.replace(_mark(0, index), spans[index])
	return joined


static func _mark(kind: int, number: int) -> String:
	return char(0xE000 + kind) + str(number) + char(0xE000 + kind)


static func _decode_entities(text: String) -> String:
	var named := {"nbsp": " ", "amp": "&", "quot": "\"", "apos": "'", "lt": "<", "gt": ">", "ndash": "–", "mdash": "—", "hellip": "…", "lsquo": "‘", "rsquo": "’", "ldquo": "“", "rdquo": "”", "bull": "•", "middot": "·", "deg": "°", "times": "×", "pound": "£", "euro": "€", "trade": "™", "copy": "©", "laquo": "«", "raquo": "»", "rarr": "→", "larr": "←"}
	var pattern := RegEx.create_from_string("&([a-zA-Z]+);|&#(x[0-9a-fA-F]+|\\d+);")
	var out := ""
	var cursor := 0
	for found in pattern.search_all(text):
		out += text.substr(cursor, found.get_start() - cursor)
		var whole := found.get_string()
		if not found.get_string(1).is_empty():
			out += named.get(found.get_string(1).to_lower(), whole)
		else:
			var code := found.get_string(2)
			var point := code.substr(1).hex_to_int() if code.to_lower().begins_with("x") else code.to_int()
			out += whole if point < 32 or point == 38 or point == 60 or point == 62 else char(point)
		cursor = found.get_end()
	out += text.substr(cursor)
	return out


static func _is_table_row(line: String) -> bool:
	return line.contains("|") and not line.strip_edges().is_empty()


static func _is_delimiter_row(line: String) -> bool:
	return RegEx.create_from_string("^\\s{0,3}\\|?[\\s:-]*-[\\s:|-]*\\|?\\s*$").search(line) != null and line.contains("-") and line.contains("|")


static func _space_out_tables(lines: Array) -> Array:
	var out: Array = []
	var in_table := false
	for index in range(lines.size()):
		var line: String = lines[index]
		var has_next := index + 1 < lines.size()
		var next_line: String = lines[index + 1] if has_next else ""
		var starts := not in_table and _is_table_row(line) and has_next and _is_delimiter_row(next_line)
		if starts:
			if not out.is_empty() and not String(out.back()).strip_edges().is_empty():
				out.append("")
			in_table = true
		elif in_table and (line.strip_edges().is_empty() or not _is_table_row(line)):
			in_table = false
		out.append(line)
		if in_table and has_next and not next_line.strip_edges().is_empty() and not _is_table_row(next_line):
			out.append("")
			in_table = false
	return out


static func split_cells(line: String) -> Array:
	var inner := line.strip_edges()
	if inner.begins_with("|"):
		inner = inner.substr(1)
	if inner.ends_with("|"):
		inner = inner.substr(0, inner.length() - 1)
	var cells: Array = []
	var current := ""
	var index := 0
	while index < inner.length():
		if inner[index] == "\\" and index + 1 < inner.length() and inner[index + 1] == "|":
			current += "|"
			index += 2
			continue
		if inner[index] == "|":
			cells.append(current.strip_edges())
			current = ""
			index += 1
			continue
		current += inner[index]
		index += 1
	cells.append(current.strip_edges())
	return cells


static func inline_bbcode(text: String, accent := MD_ACCENT) -> String:
	var line := text
	var codes: Array = []
	var code_pattern := RegEx.create_from_string("`([^`]+)`")
	var held := ""
	var cursor := 0
	for found in code_pattern.search_all(line):
		held += line.substr(cursor, found.get_start() - cursor) + _mark(1, codes.size())
		codes.append(found.get_string(1))
		cursor = found.get_end()
	held += line.substr(cursor)
	line = held
	var links: Array = []
	var link_pattern := RegEx.create_from_string("!?\\[([^\\]]*)\\]\\(([^)\\s]+)(?:\\s+\"[^\"]*\")?\\)")
	held = ""
	cursor = 0
	for found in link_pattern.search_all(line):
		held += line.substr(cursor, found.get_start() - cursor) + _mark(2, links.size())
		var label_text := found.get_string(1)
		links.append([label_text if not label_text.is_empty() else found.get_string(2), found.get_string(2)])
		cursor = found.get_end()
	held += line.substr(cursor)
	line = escape(held)
	var auto := RegEx.create_from_string("(?<![\\w/])(https?://[^\\s<]+[^\\s<.,;:!?)\\]'\"])")
	line = auto.sub(line, "[url=$1][color=#%s]$1[/color][/url]" % accent.to_html(false), true)
	line = RegEx.create_from_string("\\*\\*(.+?)\\*\\*|__(.+?)__").sub(line, "[b][color=#fffffff7]$1$2[/color][/b]", true)
	line = RegEx.create_from_string("(?<![\\*\\w])\\*(?!\\s)(.+?)(?<!\\s)\\*(?![\\*\\w])|(?<![_\\w])_(?!\\s)(.+?)(?<!\\s)_(?![_\\w])").sub(line, "[i][color=#ffffffc7]$1$2[/color][/i]", true)
	line = RegEx.create_from_string("~~(.+?)~~").sub(line, "[s][color=#ffffff66]$1[/color][/s]", true)
	for index in range(links.size()):
		var entry: Array = links[index]
		line = line.replace(_mark(2, index), "[url=%s][color=#%s]%s[/color][/url]" % [String(entry[1]).replace("]", ""), accent.to_html(false), escape(String(entry[0]))])
	for index in range(codes.size()):
		line = line.replace(_mark(1, index), "[bgcolor=#00000052][code]%s[/code][/bgcolor]" % escape(String(codes[index])))
	return line


static func plain_inline(text: String) -> String:
	var line := RegEx.create_from_string("!?\\[([^\\]]*)\\]\\(([^)\\s]+)[^)]*\\)").sub(text, "$1", true)
	return line.replace("**", "").replace("__", "").replace("`", "").replace("~~", "")


static func rich_block(bbcode: String, px: int, color: Color, weight := 400) -> RichTextLabel:
	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.scroll_active = false
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.mouse_filter = Control.MOUSE_FILTER_PASS
	label.selection_enabled = false
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.add_theme_font_override("normal_font", UI.font(weight))
	label.add_theme_font_override("bold_font", UI.font(700))
	label.add_theme_font_override("italics_font", italic_font(weight))
	label.add_theme_font_override("bold_italics_font", italic_font(700))
	label.add_theme_font_override("mono_font", mono_font())
	for slot in ["normal_font_size", "bold_font_size", "italics_font_size", "bold_italics_font_size"]:
		label.add_theme_font_size_override(slot, px)
	label.add_theme_font_size_override("mono_font_size", int(round(px * 0.8)))
	label.add_theme_color_override("default_color", color)
	label.add_theme_constant_override("line_separation", int(round(px * 0.5)))
	label.text = bbcode
	label.meta_clicked.connect(func(meta: Variant) -> void:
		var target := str(meta)
		if target.begins_with("http://") or target.begins_with("https://"):
			OS.shell_open(target))
	return label


static func markdown_view(source: String, px: int, color := UI.WHITE) -> Control:
	var text := normalize_markdown(source)
	var lines := text.split("\n")
	var blocks: Array = []
	var index := 0
	var fence := RegEx.create_from_string("^\\s{0,3}(`{3,}|~{3,})")
	var heading := RegEx.create_from_string("^\\s{0,3}(#{1,6})\\s+(.*?)\\s*#*\\s*$")
	var rule := RegEx.create_from_string("^\\s{0,3}([-*_])(\\s*\\1){2,}\\s*$")
	var bullet := RegEx.create_from_string("^(\\s*)([-*+]|\\d{1,9}[.)])\\s+(.*)$")
	var quote := RegEx.create_from_string("^\\s{0,3}>\\s?(.*)$")
	while index < lines.size():
		var line: String = lines[index]
		if line.strip_edges().is_empty():
			index += 1
			continue
		var fence_match := fence.search(line)
		if fence_match:
			var code_lines: PackedStringArray = []
			index += 1
			while index < lines.size() and not fence.search(lines[index]):
				code_lines.append(lines[index])
				index += 1
			index += 1
			blocks.append({"kind": "pre", "text": "\n".join(code_lines)})
			continue
		if _is_table_row(line) and index + 1 < lines.size() and _is_delimiter_row(lines[index + 1]):
			var rows: Array = [split_cells(line)]
			index += 2
			while index < lines.size() and _is_table_row(lines[index]) and not _is_delimiter_row(lines[index]):
				rows.append(split_cells(lines[index]))
				index += 1
			blocks.append({"kind": "table", "rows": rows})
			continue
		var heading_match := heading.search(line)
		if heading_match:
			blocks.append({"kind": "heading", "level": heading_match.get_string(1).length(), "text": heading_match.get_string(2)})
			index += 1
			continue
		if rule.search(line):
			blocks.append({"kind": "hr"})
			index += 1
			continue
		if quote.search(line):
			var quoted: PackedStringArray = []
			while index < lines.size() and quote.search(lines[index]):
				quoted.append(quote.search(lines[index]).get_string(1))
				index += 1
			blocks.append({"kind": "quote", "text": "\n".join(quoted)})
			continue
		if bullet.search(line):
			var items: Array = []
			while index < lines.size():
				var item_line: String = lines[index]
				var item_match := bullet.search(item_line)
				if item_match:
					items.append({"indent": item_match.get_string(1).replace("\t", "    ").length(), "marker": item_match.get_string(2), "text": item_match.get_string(3)})
					index += 1
					continue
				if item_line.strip_edges().is_empty():
					if index + 1 < lines.size() and bullet.search(lines[index + 1]):
						index += 1
						continue
					break
				if not items.is_empty() and (item_line.begins_with("  ") or item_line.begins_with("\t")):
					items.back()["text"] = String(items.back()["text"]) + "\n" + item_line.strip_edges()
					index += 1
					continue
				break
			blocks.append({"kind": "list", "items": items})
			continue
		var paragraph: PackedStringArray = []
		while index < lines.size():
			var para_line: String = lines[index]
			if para_line.strip_edges().is_empty() or fence.search(para_line) or heading.search(para_line) or quote.search(para_line) or bullet.search(para_line) or rule.search(para_line):
				break
			if _is_table_row(para_line) and index + 1 < lines.size() and _is_delimiter_row(lines[index + 1]):
				break
			paragraph.append(para_line.strip_edges())
			index += 1
		blocks.append({"kind": "p", "text": "\n".join(paragraph)})
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var natural := 0.0
	var previous_bottom := -1.0
	var margins := {"p": [0.0, 8.0], "heading": [14.4, 6.4], "list": [4.8, 9.6], "quote": [8.8, 8.8], "hr": [13.6, 13.6], "pre": [8.0, 8.0], "table": [8.8, 8.8]}
	for block in blocks:
		var kind: String = block["kind"]
		var pair: Array = margins.get(kind, [0.0, 0.0])
		if previous_bottom >= 0.0:
			column.add_child(gap(maxf(previous_bottom, float(pair[0]))))
		previous_bottom = float(pair[1])
		var node: Control
		if kind == "p":
			node = rich_block(inline_bbcode(String(block["text"])), px, color)
			natural = maxf(natural, _measure_lines(plain_inline(String(block["text"])), px))
		elif kind == "heading":
			var level: int = block["level"]
			var sizes := {1: 16, 2: 15, 3: 14}
			var heading_px: int = sizes.get(level, 12)
			var heading_text := inline_bbcode(String(block["text"]))
			var heading_color := Color(1, 1, 1, 0.95)
			if level >= 4:
				heading_text = inline_bbcode(String(block["text"]).to_upper())
				heading_color = Color(MD_ACCENT.r * 0.65 + 0.35, MD_ACCENT.g * 0.65 + 0.35, MD_ACCENT.b * 0.65 + 0.35, 0.9)
			var heading_label := rich_block("[b]%s[/b]" % heading_text, heading_px, heading_color, 700)
			if level <= 2:
				var underline := VBoxContainer.new()
				underline.add_theme_constant_override("separation", 4 if level == 1 else 3)
				underline.add_child(heading_label)
				var line_rect := ColorRect.new()
				line_rect.color = Color(1, 1, 1, 0.14) if level == 1 else Color(1, 1, 1, 0.09)
				line_rect.custom_minimum_size.y = 1
				underline.add_child(line_rect)
				node = underline
			else:
				node = heading_label
			natural = maxf(natural, _measure_lines(plain_inline(String(block["text"])), heading_px) * 1.08)
		elif kind == "hr":
			var hr := ColorRect.new()
			hr.color = Color(1, 1, 1, 0.14)
			hr.custom_minimum_size.y = 1
			node = hr
		elif kind == "pre":
			var pre := PanelContainer.new()
			pre.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.32), Color(1, 1, 1, 0.08), 8, 1, Vector4(12, 10, 12, 10)))
			var code_label := UI.label(String(block["text"]), int(round(px * 0.8)), color)
			code_label.add_theme_font_override("font", mono_font())
			pre.add_child(code_label)
			node = pre
			natural = maxf(natural, _measure_lines(String(block["text"]), int(round(px * 0.8))) + 26.0)
		elif kind == "quote":
			var quote_box := PanelContainer.new()
			var quote_style := UI.box(Color(MD_ACCENT, 0.07), Color(0, 0, 0, 0), 6, 0, Vector4(11, 6, 11, 6))
			quote_style.corner_radius_top_left = 0
			quote_style.corner_radius_bottom_left = 0
			quote_style.border_width_left = 2
			quote_style.border_color = MD_ACCENT
			quote_box.add_theme_stylebox_override("panel", quote_style)
			quote_box.add_child(rich_block(inline_bbcode(String(block["text"])), px, Color(1, 1, 1, 0.82)))
			node = quote_box
			natural = maxf(natural, _measure_lines(plain_inline(String(block["text"])), px) + 24.0)
		elif kind == "list":
			var list_column := VBoxContainer.new()
			list_column.add_theme_constant_override("separation", 3)
			var ordinal := 0
			var base_indent := -1
			for item in block["items"]:
				var entry: Dictionary = item
				if base_indent < 0:
					base_indent = int(entry["indent"])
				var depth := maxi(0, floori((int(entry["indent"]) - base_indent) / 2.0))
				var marker_text := String(entry["marker"])
				var ordered := not ["-", "*", "+"].has(marker_text)
				if ordered:
					ordinal += 1
				var item_row := HBoxContainer.new()
				item_row.add_theme_constant_override("separation", 6)
				var marker := UI.label(("%d." % ordinal if marker_text.ends_with(".") or marker_text.ends_with(")") else marker_text) if ordered else "•", px, Color(MD_ACCENT, 0.7), 600 if ordered else 400)
				marker.custom_minimum_size.x = 12.0 + 18.0 * depth
				marker.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
				marker.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
				item_row.add_child(marker)
				item_row.add_child(rich_block(inline_bbcode(String(entry["text"])), px, color))
				list_column.add_child(item_row)
				natural = maxf(natural, _measure_lines(plain_inline(String(entry["text"])), px) + 18.0 + 18.0 * depth)
			node = list_column
		else:
			var rows: Array = block["rows"]
			var width := 0
			for row in rows:
				width = maxi(width, (row as Array).size())
			var grid := GridContainer.new()
			grid.columns = maxi(1, width)
			grid.add_theme_constant_override("h_separation", -1)
			grid.add_theme_constant_override("v_separation", -1)
			var table_px := int(round(12.5))
			var column_widths: Array = []
			column_widths.resize(width)
			column_widths.fill(0.0)
			for row_index in range(rows.size()):
				var cells: Array = rows[row_index]
				for column_index in range(width):
					var cell_text: String = cells[column_index] if column_index < cells.size() else ""
					var cell := PanelContainer.new()
					var cell_bg := Color(1, 1, 1, 0.0)
					if row_index == 0:
						cell_bg = Color(MD_ACCENT.r * 0.16 + 0.04, MD_ACCENT.g * 0.16 + 0.04, MD_ACCENT.b * 0.16 + 0.04, 0.2)
					elif row_index % 2 == 0:
						cell_bg = Color(1, 1, 1, 0.04)
					cell.add_theme_stylebox_override("panel", UI.box(cell_bg, Color(1, 1, 1, 0.1), 0, 1, Vector4(8, 5, 8, 5)))
					cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
					var cell_color := Color(1, 1, 1, 0.95) if row_index == 0 else (Color(1, 1, 1, 0.9) if column_index == 0 else color)
					var cell_weight := 700 if row_index == 0 else (600 if column_index == 0 else 400)
					cell.add_child(rich_block(inline_bbcode(cell_text), table_px, cell_color, cell_weight))
					cell.custom_minimum_size.x = 88.0 if column_index == 0 else 52.0
					grid.add_child(cell)
					column_widths[column_index] = maxf(float(column_widths[column_index]), _measure_lines(plain_inline(cell_text), table_px) + 18.0)
			var total := 0.0
			for value in column_widths:
				total += float(value)
			natural = maxf(natural, total)
			node = grid
		column.add_child(node)
	column.set_meta("natural_width", natural)
	return column


static func _measure_lines(text: String, px: int) -> float:
	var widest := 0.0
	for line in text.split("\n"):
		widest = maxf(widest, UI.font(400).get_string_size(line, HORIZONTAL_ALIGNMENT_LEFT, -1, px).x)
	return widest


static func t(value: Variant) -> String:
	if value == null:
		return ""
	return str(value).strip_edges()


static func d(value: Variant) -> Dictionary:
	return value if typeof(value) == TYPE_DICTIONARY else {}


static func a(value: Variant) -> Array:
	return value if typeof(value) == TYPE_ARRAY else []


class Conversation extends VBoxContainer:
	var panel: ChatPanel
	var embedded := false
	var chat: Dictionary = {}
	var chat_id := ""
	var messages: Array = []
	var messages_ref: Array = []
	var loading := false
	var speaking: Dictionary = {}
	var typing_next: Dictionary = {}
	var visible_limit := ChatPanel.INITIAL_WINDOW
	var poll_open := false
	var poll_error := ""
	var make_demand := false
	var demand_busy := false
	var confirm_delete := false
	var reveal: Dictionary = {}
	var action_feedback := ""
	var lifecycle_base: Dictionary = {}
	var lifecycle_overrides: Dictionary = {}
	var lifecycle_reveal := false
	var staged_speaker: Dictionary = {}
	var lifecycle_token := 0
	var _last_thread_signature := ""
	var _rendered_signature := ""
	var _header: PanelContainer
	var _header_flags: HBoxContainer
	var _title: Label
	var _subtitle: Label
	var _envelope: Button
	var _trash: Button
	var _scroll: ScrollContainer
	var _box: VBoxContainer
	var _terminal: PanelContainer
	var _composer_panel: PanelContainer
	var _council_bar: HBoxContainer
	var _lifecycle_outcome: VBoxContainer
	var _lifecycle_box: PanelContainer
	var _poll_holder: MarginContainer
	var _poll_box: PanelContainer
	var _poll_question: LineEdit
	var _poll_options: TextEdit
	var _poll_error_label: Label
	var _vote_button: Button
	var _demand_button: Button
	var _composer: TextEdit
	var _send: Button
	var _hint: Label


	func _init(owner_panel: ChatPanel, is_embedded: bool) -> void:
		panel = owner_panel
		embedded = is_embedded
		size_flags_vertical = Control.SIZE_EXPAND_FILL
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		add_theme_constant_override("separation", 0)
		_build_header()
		_scroll = ScrollContainer.new()
		_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
		_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
		var margin := MarginContainer.new()
		margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var pad := 12 if embedded else 18
		for side in [["margin_left", pad], ["margin_right", pad], ["margin_top", 12 if embedded else 16], ["margin_bottom", 12 if embedded else 16]]:
			margin.add_theme_constant_override(side[0], side[1])
		_box = VBoxContainer.new()
		_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_box.add_theme_constant_override("separation", 16 if embedded else 14)
		margin.add_child(_box)
		_scroll.add_child(margin)
		add_child(_scroll)
		_terminal = PanelContainer.new()
		var terminal_style := StyleBoxFlat.new()
		terminal_style.bg_color = Color(13 / 255.0, 13 / 255.0, 16 / 255.0, 0.46)
		terminal_style.border_color = Color(1, 1, 1, 0.08)
		terminal_style.border_width_top = 1
		terminal_style.corner_radius_bottom_left = 16
		terminal_style.corner_radius_bottom_right = 16
		terminal_style.content_margin_left = 16
		terminal_style.content_margin_right = 16
		terminal_style.content_margin_top = 10
		terminal_style.content_margin_bottom = 12
		_terminal.add_theme_stylebox_override("panel", terminal_style)
		_terminal.visible = false
		add_child(_terminal)
		_build_composer()


	func _build_header() -> void:
		_header = PanelContainer.new()
		var style := StyleBoxFlat.new()
		style.bg_color = Color(15 / 255.0, 15 / 255.0, 18 / 255.0, 0.26)
		style.border_color = Color(1, 1, 1, 0.07)
		style.border_width_bottom = 1
		style.corner_radius_top_left = 16
		style.corner_radius_top_right = 16
		style.content_margin_left = 16
		style.content_margin_right = 16
		style.content_margin_top = 11
		style.content_margin_bottom = 11
		_header.add_theme_stylebox_override("panel", style)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 11)
		var back := ChatPanel.icon_button("back", 14, Color(1, 1, 1, 0.58), Color(0, 0, 0, 0), Color(0, 0, 0, 0))
		back.tooltip_text = "Back to diplomacy"
		back.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		back.pressed.connect(func() -> void: panel.leave_active())
		row.add_child(back)
		_header_flags = HBoxContainer.new()
		_header_flags.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(_header_flags)
		var titles := VBoxContainer.new()
		titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		titles.add_theme_constant_override("separation", 2)
		_title = UI.label("", 15, Color(1, 1, 1, 0.95), 750)
		_title.clip_text = true
		_title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		titles.add_child(_title)
		_subtitle = UI.label("", 10, Color(1, 1, 1, 0.34))
		_subtitle.clip_text = true
		_subtitle.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		titles.add_child(_subtitle)
		row.add_child(titles)
		_envelope = ChatPanel.icon_button("envelope", 14, Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.7), Color(0, 0, 0, 0), Color(0, 0, 0, 0))
		_envelope.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_envelope.pressed.connect(func() -> void:
			panel.toggle_active_read(chat)
			refresh_chrome())
		row.add_child(_envelope)
		_trash = ChatPanel.icon_button("trash", 14, Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.62), Color(0, 0, 0, 0), Color(0, 0, 0, 0))
		_trash.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_trash.pressed.connect(func() -> void:
			if confirm_delete:
				confirm_delete = false
				panel.delete_chat(chat_id)
			else:
				confirm_delete = true
				refresh_chrome())
		row.add_child(_trash)
		var close := ChatPanel.text_button("✕", 16, Color(1, 1, 1, 0.4), UI.WHITE, 400, Color(1, 1, 1, 0.08))
		close.tooltip_text = "Close conversation"
		close.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		close.pressed.connect(func() -> void: panel.leave_active())
		row.add_child(close)
		_header.add_child(row)
		_header.visible = not embedded
		add_child(_header)


	func _build_composer() -> void:
		_composer_panel = PanelContainer.new()
		var style := StyleBoxFlat.new()
		style.bg_color = Color(0, 0, 0, 0) if embedded else Color(13 / 255.0, 13 / 255.0, 16 / 255.0, 0.56)
		style.border_color = Color(1, 1, 1, 0.08)
		style.border_width_top = 1
		if not embedded:
			style.corner_radius_bottom_left = 16
			style.corner_radius_bottom_right = 16
		style.content_margin_left = 16
		style.content_margin_right = 16
		style.content_margin_top = 10 if embedded else 12
		style.content_margin_bottom = 13
		_composer_panel.add_theme_stylebox_override("panel", style)
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 0)
		_council_bar = HBoxContainer.new()
		_council_bar.add_child(UI.label("COUNCIL MESSAGE", 8, Color(1, 1, 1, 0.4), 850, "Arial", 1))
		_council_bar.add_child(UI.spacer())
		var formal := ChatPanel.text_button("Formal business →", 9, Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.72), ChatPanel.GREY_TEXT, 800)
		formal.pressed.connect(func() -> void: panel.navigate_institution(_institution_id(), "agenda"))
		_council_bar.add_child(formal)
		_council_bar.visible = false
		column.add_child(ChatPanel.spaced_bottom(_council_bar, 6))
		(_council_bar.get_parent() as Control).visible = false
		_lifecycle_outcome = VBoxContainer.new()
		_lifecycle_outcome.visible = false
		column.add_child(_lifecycle_outcome)
		_lifecycle_box = PanelContainer.new()
		_lifecycle_box.visible = false
		column.add_child(ChatPanel.spaced_bottom(_lifecycle_box, 7))
		_poll_box = PanelContainer.new()
		_poll_box.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.1), 10, 1, Vector4(10, 9, 10, 9)))
		var poll_column := VBoxContainer.new()
		poll_column.add_theme_constant_override("separation", 0)
		poll_column.add_child(UI.label("Call a conversational vote", 9, ChatPanel.GREY_TEXT, 820))
		poll_column.add_child(ChatPanel.spaced(UI.wrapped("Recorded in this diplomatic thread. This does not create institutional law or a formal institution ballot.", 8, Color(1, 1, 1, 0.38)), 2))
		_poll_question = LineEdit.new()
		_poll_question.placeholder_text = "What should this group decide?"
		_poll_question.max_length = 500
		ChatPanel.style_input(_poll_question, 11, Color(0, 0, 0, 0.2), Color(1, 1, 1, 0.12))
		_poll_question.text_changed.connect(func(_text: String) -> void:
			poll_error = ""
			_poll_error_label.visible = false)
		poll_column.add_child(ChatPanel.spaced(_poll_question, 7))
		_poll_options = TextEdit.new()
		_poll_options.placeholder_text = "One option per line\nYes\nNo"
		_poll_options.text = "Yes\nNo\nAbstain"
		_poll_options.custom_minimum_size.y = 62
		ChatPanel.style_text_edit(_poll_options, 10, Color(0, 0, 0, 0.2), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.2), 8, Vector4(8, 6, 8, 6))
		_poll_options.text_changed.connect(func() -> void:
			if _poll_options.text.length() > 1200:
				_poll_options.text = _poll_options.text.left(1200)
			poll_error = ""
			_poll_error_label.visible = false)
		poll_column.add_child(ChatPanel.spaced(_poll_options, 6))
		_poll_error_label = UI.label("", 9, ChatPanel.RED_SOFT)
		_poll_error_label.visible = false
		poll_column.add_child(ChatPanel.spaced(_poll_error_label, 5))
		var poll_buttons := HBoxContainer.new()
		poll_buttons.alignment = BoxContainer.ALIGNMENT_END
		poll_buttons.add_theme_constant_override("separation", 6)
		var poll_cancel := ChatPanel.solid_button("Cancel", 9, Color(1, 1, 1, 0.58), 400, Color(0, 0, 0, 0), Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.16), 8, Vector4(8, 5, 8, 5))
		poll_cancel.pressed.connect(func() -> void:
			poll_open = false
			poll_error = ""
			update_composer())
		poll_buttons.add_child(poll_cancel)
		var poll_submit := ChatPanel.solid_button("Open vote", 9, ChatPanel.SKY_PALE, 780, Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.13), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.35), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.2), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.5), 8, Vector4(8, 5, 8, 5))
		poll_submit.pressed.connect(create_poll)
		poll_buttons.add_child(poll_submit)
		poll_column.add_child(ChatPanel.spaced(poll_buttons, 7))
		_poll_box.add_child(poll_column)
		_poll_holder = MarginContainer.new()
		_poll_holder.add_theme_constant_override("margin_bottom", 8)
		_poll_holder.add_child(_poll_box)
		_poll_holder.visible = false
		column.add_child(_poll_holder)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		_vote_button = Button.new()
		_vote_button.text = "Vote"
		_vote_button.focus_mode = Control.FOCUS_NONE
		_vote_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		_vote_button.tooltip_text = "Call a binding conversational vote in this group chat"
		_vote_button.custom_minimum_size = Vector2(0, 40)
		_vote_button.size_flags_vertical = Control.SIZE_SHRINK_END
		_vote_button.add_theme_font_override("font", UI.font(760))
		_vote_button.add_theme_font_size_override("font_size", 11)
		_vote_button.pressed.connect(func() -> void:
			poll_open = not poll_open
			poll_error = ""
			update_composer())
		row.add_child(_vote_button)
		_demand_button = Button.new()
		_demand_button.focus_mode = Control.FOCUS_NONE
		_demand_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		_demand_button.custom_minimum_size = Vector2(0, 40)
		_demand_button.size_flags_vertical = Control.SIZE_SHRINK_END
		_demand_button.add_theme_font_override("font", UI.font(700))
		_demand_button.add_theme_font_size_override("font_size", 12)
		_demand_button.pressed.connect(func() -> void:
			make_demand = not make_demand
			update_composer())
		row.add_child(_demand_button)
		_composer = TextEdit.new()
		_composer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_composer.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
		_composer.custom_minimum_size.y = 42
		_composer.scroll_fit_content_height = false
		if embedded:
			ChatPanel.style_text_edit(_composer, 14, Color(0, 0, 0, 0.2), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.42), 12, Vector4(12, 9, 12, 9))
		else:
			ChatPanel.style_text_edit(_composer, 14, Color(9 / 255.0, 9 / 255.0, 12 / 255.0, 0.58), Color(1, 1, 1, 0.12), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.6), 12, Vector4(12, 9, 12, 9))
		_composer.text_changed.connect(fit_composer)
		_composer.gui_input.connect(_on_composer_input)
		row.add_child(_composer)
		_send = Button.new()
		_send.focus_mode = Control.FOCUS_NONE
		_send.tooltip_text = "Send message"
		_send.custom_minimum_size = Vector2(69 if embedded else 40, 40)
		_send.size_flags_vertical = Control.SIZE_SHRINK_END
		if embedded:
			_send.text = "Send ↗"
			_send.add_theme_font_override("font", UI.font(800))
			_send.add_theme_font_size_override("font_size", 11)
			for state in ["font_color", "font_hover_color", "font_pressed_color", "font_disabled_color", "font_hover_pressed_color", "font_focus_color"]:
				_send.add_theme_color_override(state, UI.WHITE)
		else:
			_send.icon = ChatPanel.icon("send", 15)
			_send.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
			for state in ["icon_normal_color", "icon_hover_color", "icon_pressed_color", "icon_disabled_color", "icon_hover_pressed_color", "icon_focus_color"]:
				_send.add_theme_color_override(state, UI.WHITE)
		_send.pressed.connect(submit_from_composer)
		row.add_child(_send)
		column.add_child(row)
		_hint = UI.label("Enter to send · Shift+Enter for a new line", 8 if embedded else 9, Color(1, 1, 1, 0.26))
		column.add_child(ChatPanel.spaced(_hint, 4))
		_composer_panel.add_child(column)
		add_child(_composer_panel)
		_update_send()


	func _input(event: InputEvent) -> void:
		if not confirm_delete or not is_visible_in_tree():
			return
		if event is InputEventMouseButton and (event as InputEventMouseButton).pressed:
			if not _trash.get_global_rect().has_point((event as InputEventMouseButton).global_position):
				confirm_delete = false
				refresh_chrome()


	func show_chat(next: Dictionary) -> void:
		var next_id := ChatPanel.t(next.get("id", ""))
		if next_id != chat_id:
			_mount(next)
			return
		chat = next
		var signature := _thread_signature(next)
		var thread_changed := signature != _last_thread_signature
		_last_thread_signature = signature
		var rendered := false
		if not loading and not lifecycle_reveal and reveal.is_empty():
			var saved := panel.without_unseen(ChatPanel.a(next.get("messages", [])))
			var changed := saved.size() != messages_ref.size() or _messages_signature(saved) != _messages_signature(messages_ref)
			var grew := saved.size() > messages_ref.size()
			messages_ref = saved
			if not embedded and changed:
				messages = saved
			if changed:
				render_messages(grew or embedded)
				rendered = true
		if not rendered and _messages_signature(presented()) != _rendered_signature:
			render_messages(true)
			rendered = true
		if thread_changed and not rendered:
			render_messages(false)
		refresh_chrome()


	func _thread_signature(source: Dictionary) -> String:
		return JSON.stringify([ChatPanel.a(source.get("polls", [])), ChatPanel.a(source.get("demands", [])), ChatPanel.t(source.get("title", "")), ChatPanel.a(source.get("countries", [])).size()])


	func _mount(next: Dictionary) -> void:
		stop_reveal()
		chat = next
		chat_id = ChatPanel.t(next.get("id", ""))
		_last_thread_signature = _thread_signature(next)
		var saved := ChatPanel.a(next.get("messages", []))
		messages_ref = saved
		messages = saved
		loading = false
		speaking = {}
		typing_next = {}
		visible_limit = ChatPanel.INITIAL_WINDOW
		poll_open = false
		poll_error = ""
		_poll_question.text = ""
		_poll_options.text = "Yes\nNo\nAbstain"
		make_demand = false
		demand_busy = false
		confirm_delete = false
		action_feedback = ""
		lifecycle_overrides = {}
		lifecycle_reveal = false
		staged_speaker = {}
		lifecycle_token += 1
		lifecycle_base = {}
		_composer.text = ""
		fit_composer()
		_load_history(true)
		refresh_chrome()
		render_messages(true)
		world_changed()


	func leave() -> void:
		var current := reveal
		var rest := stop_reveal()
		if not rest.is_empty():
			var events: Array = []
			for step in rest:
				events.append_array(ChatPanel.a(ChatPanel.d(step).get("events", [])))
			add_turn_events(current, events, null, false)
		chat_id = ""
		chat = {}


	func unseen_moved() -> void:
		if loading:
			return
		_load_history()


	func world_changed() -> void:
		if not ChatPanel.is_lifecycle(chat) or panel.engine == null:
			return
		var asked_for := chat_id
		var reply := await panel.engine.request("chat.lifecycle", {"institutionId": ChatPanel.t(chat.get("lifecycleInstitutionId", "")), "caseIds": ChatPanel.a(chat.get("lifecycleCaseIds", [])), "player": panel.player})
		if asked_for != chat_id or not reply.get("ok", false):
			return
		lifecycle_base = ChatPanel.d(reply.get("result", {}))
		refresh_chrome()


	func _load_history(announce := false) -> void:
		if panel.engine == null or chat_id.is_empty():
			return
		var args := {"messages": panel.without_unseen(messages_ref)}
		if announce:
			var names: Array = []
			for country in countries():
				names.append(ChatPanel.t(country.get("name", "")))
			args["chatId"] = chat_id
			args["names"] = names
			args["saved"] = messages_ref.size()
		panel.engine.request("chat.history", args)


	func apply_draft(text: String) -> void:
		_composer.text = text
		fit_composer()
		if not is_inside_tree():
			return
		await get_tree().process_frame
		_composer.grab_focus()
		_composer.set_caret_line(_composer.get_line_count() - 1)
		_composer.set_caret_column(_composer.get_line(_composer.get_line_count() - 1).length())
		_composer.scroll_vertical = 0


	func presented() -> Array:
		if embedded:
			return panel.without_unseen(ChatPanel.a(chat.get("messages", [])))
		return messages


	func _messages_signature(list: Array) -> String:
		var parts: PackedStringArray = []
		for message in list:
			var entry := ChatPanel.d(message)
			parts.append("%s:%s:%d:%d" % [ChatPanel.t(entry.get("id", "")), ChatPanel.t(entry.get("role", "")), ChatPanel.t(entry.get("text", "")).length(), ChatPanel.d(entry.get("reactions", {})).size()])
		return "|".join(parts)


	func countries() -> Array:
		var out: Array = []
		for country in ChatPanel.a(chat.get("countries", [])):
			var entry := ChatPanel.d(country)
			if not ChatPanel.t(entry.get("name", "")).is_empty() or not ChatPanel.t(entry.get("code", "")).is_empty():
				out.append(entry)
		return out


	func is_group() -> bool:
		return panel.counterparts_of(countries()).size() > 1


	func is_institutional() -> bool:
		return not ChatPanel.t(chat.get("institutionId", "")).is_empty()


	func is_lifecycle_conversation() -> bool:
		return ChatPanel.is_lifecycle(chat)


	func is_council() -> bool:
		return is_institutional() and not is_lifecycle_conversation()


	func one_on_one() -> bool:
		return not is_group() and not is_institutional() and not is_lifecycle_conversation()


	func they_are() -> String:
		if not one_on_one():
			return ""
		var list := countries()
		if list.is_empty():
			return ""
		return ChatPanel.t(ChatPanel.d(panel.puppets.get(ChatPanel.t(ChatPanel.d(list[0]).get("name", "")), {})).get("theyAre", ""))


	func can_call_vote() -> bool:
		return is_group() and not is_institutional() and not is_lifecycle_conversation()


	func _institution_id() -> String:
		var id := ChatPanel.t(chat.get("institutionId", ""))
		return id if not id.is_empty() else ChatPanel.t(chat.get("lifecycleInstitutionId", ""))


	func lifecycle_state() -> Dictionary:
		var base_cases := ChatPanel.a(lifecycle_base.get("cases", []))
		var cases: Array = []
		for entry in base_cases:
			var item := ChatPanel.d(entry)
			var override := ChatPanel.d(lifecycle_overrides.get(ChatPanel.t(item.get("id", "")), {}))
			var base_status := ChatPanel.t(item.get("status", "pending")).to_lower()
			cases.append(override if not override.is_empty() and (base_status == "pending" or base_status == "negotiating") else item)
		var response: Array = []
		var awaiting: Array = []
		var resolved: Array = []
		for entry in cases:
			var status := ChatPanel.t(ChatPanel.d(entry).get("status", "")).to_lower()
			if lifecycle_overrides.is_empty():
				if ChatPanel.a(lifecycle_base.get("responseCaseIds", [])).has(ChatPanel.t(ChatPanel.d(entry).get("id", ""))):
					response.append(entry)
			elif status == "pending" or status == "negotiating":
				response.append(entry)
			if status == "pending-approval":
				awaiting.append(entry)
			if not ["pending", "negotiating", "pending-approval"].has(status):
				resolved.append(entry)
		return {"institution": ChatPanel.d(lifecycle_base.get("institution", {})), "cases": cases, "response": response, "awaiting": awaiting, "resolved": resolved, "complete": not cases.is_empty() and response.is_empty()}


	func lifecycle_terminal() -> bool:
		if not is_lifecycle_conversation():
			return false
		var state := lifecycle_state()
		var cases := ChatPanel.a(state["cases"])
		return not cases.is_empty() and ChatPanel.a(state["resolved"]).size() == cases.size() and not lifecycle_reveal


	func lifecycle_concluded() -> bool:
		if not is_lifecycle_conversation():
			return false
		var state := lifecycle_state()
		return not ChatPanel.a(state["cases"]).is_empty() and state["complete"] == true and not lifecycle_reveal


	func lifecycle_terminal_for_leave() -> bool:
		var cases := ChatPanel.a(lifecycle_base.get("cases", []))
		if cases.is_empty():
			return false
		for entry in cases:
			var status := ChatPanel.t(ChatPanel.d(entry).get("status", "")).to_lower()
			if ["pending", "negotiating", "pending-approval"].has(status):
				return false
		return true


	func player_case() -> Dictionary:
		return ChatPanel.d(lifecycle_base.get("playerCase", {}))


	func refresh_chrome() -> void:
		if chat_id.is_empty():
			return
		if not embedded:
			var counterparts := panel.counterparts_of(countries())
			var shown := counterparts.slice(0, 4)
			ChatPanel.clear(_header_flags)
			_header_flags.add_child(panel.flag_stack(shown, Vector2(24, 16), -6))
			_header_flags.custom_minimum_size.x = 40 if shown.size() > 1 else 25
			var title := ChatPanel.t(chat.get("title", ""))
			_title.text = title if not title.is_empty() else ChatPanel.summarize(counterparts)
			if is_lifecycle_conversation():
				_subtitle.text = "Institution membership negotiation · concluded" if lifecycle_concluded() else "Institution membership negotiation"
			elif counterparts.size() > 1:
				_subtitle.text = "%d-party diplomatic channel" % (counterparts.size() + (1 if not panel.player.is_empty() else 0))
			else:
				_subtitle.text = "Direct diplomatic channel"
			var is_new := panel.unread.has(chat_id)
			_envelope.icon = ChatPanel.icon("envelope_filled" if is_new else "envelope", 14)
			_envelope.tooltip_text = "Mark as read" if is_new else "Mark as unread"
			if confirm_delete:
				_trash.icon = null
				_trash.text = "Delete?"
				_trash.tooltip_text = "Click again to delete this chat"
				ChatPanel.style_flat(_trash, Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.18), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.55), 7, Vector4(8, 4, 8, 4), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.22), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.55))
				for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
					_trash.add_theme_color_override(state, ChatPanel.RED_SOFT)
				_trash.add_theme_font_override("font", UI.font(600))
				_trash.add_theme_font_size_override("font_size", 12)
			else:
				_trash.text = ""
				_trash.icon = ChatPanel.icon("trash", 14)
				_trash.tooltip_text = "Delete chat"
				ChatPanel.style_flat(_trash, Color(0, 0, 0, 0), Color(0, 0, 0, 0), 7, Vector4(5, 5, 5, 5))
		update_composer()


	func update_composer() -> void:
		var terminal := lifecycle_terminal()
		_terminal.visible = terminal
		if terminal:
			ChatPanel.clear(_terminal)
			_terminal.add_child(_lifecycle_outcome_panel(true))
		_composer_panel.visible = not terminal and not loading
		var council := is_council()
		(_council_bar.get_parent() as Control).visible = council
		_council_bar.visible = council
		ChatPanel.clear(_lifecycle_outcome)
		var state := lifecycle_state() if is_lifecycle_conversation() else {}
		var has_response := false
		for entry in ChatPanel.a(state.get("cases", [])):
			var item := ChatPanel.d(entry)
			if not ChatPanel.t(item.get("decision", "")).is_empty() or ChatPanel.t(item.get("status", "pending")).to_lower() != "pending":
				has_response = true
		_lifecycle_outcome.visible = is_lifecycle_conversation() and not lifecycle_reveal and has_response and not ChatPanel.a(state.get("cases", [])).is_empty()
		if _lifecycle_outcome.visible:
			_lifecycle_outcome.add_child(_lifecycle_outcome_panel(terminal or lifecycle_concluded()))
		_build_lifecycle_box(terminal)
		var can_vote := can_call_vote()
		var can_demand := they_are() == "puppet"
		_vote_button.visible = can_vote
		ChatPanel.style_flat(_vote_button, Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.2) if poll_open else Color(1, 1, 1, 0.05), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.6) if poll_open else Color(1, 1, 1, 0.15), 10, Vector4(10, 0, 10, 0), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.2) if poll_open else Color(1, 1, 1, 0.05), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.6) if poll_open else Color(1, 1, 1, 0.15))
		for state_name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
			_vote_button.add_theme_color_override(state_name, ChatPanel.SKY_PALE if poll_open else Color(1, 1, 1, 0.7))
		_poll_holder.visible = can_vote and poll_open
		_poll_error_label.text = poll_error
		_poll_error_label.visible = not poll_error.is_empty()
		_demand_button.visible = can_demand
		_demand_button.text = "⚑ Demand" if make_demand else "⚑"
		var first_name := ""
		var list := countries()
		if not list.is_empty():
			first_name = ChatPanel.t(ChatPanel.d(list[0]).get("name", ""))
		_demand_button.tooltip_text = "This message is a demand. Click to send it as an ordinary message." if make_demand else "Make this message a demand of %s" % first_name
		ChatPanel.style_flat(_demand_button, Color(234 / 255.0, 179 / 255.0, 8 / 255.0, 0.22) if make_demand else Color(1, 1, 1, 0.05), Color(234 / 255.0, 179 / 255.0, 8 / 255.0, 0.7) if make_demand else Color(1, 1, 1, 0.15), 10, Vector4(10, 0, 10, 0), Color(234 / 255.0, 179 / 255.0, 8 / 255.0, 0.22) if make_demand else Color(1, 1, 1, 0.05), Color(234 / 255.0, 179 / 255.0, 8 / 255.0, 0.7) if make_demand else Color(1, 1, 1, 0.15))
		for state_name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
			_demand_button.add_theme_color_override(state_name, Color(250 / 255.0, 204 / 255.0, 21 / 255.0) if make_demand else Color(1, 1, 1, 0.7))
		if can_demand and make_demand:
			_composer.placeholder_text = "Your demand of %s…" % first_name
		elif council:
			_composer.placeholder_text = "Address the council…"
		elif is_lifecycle_conversation():
			_composer.placeholder_text = "Address the accession table…"
		else:
			_composer.placeholder_text = "Send a diplomatic message…"
		_update_send()


	func _lifecycle_outcome_panel(concluded: bool) -> Control:
		var state := lifecycle_state()
		var cases := ChatPanel.a(state.get("cases", []))
		var holder := VBoxContainer.new()
		if cases.is_empty():
			return holder
		var box := PanelContainer.new()
		box.add_theme_stylebox_override("panel", UI.box(Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.045) if concluded else Color(1, 1, 1, 0.025), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.2) if concluded else ChatPanel.GREY_BORDER, 9, 1, Vector4(10, 9, 10, 9)))
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 7)
		var top := HBoxContainer.new()
		top.add_theme_constant_override("separation", 9)
		var texts := VBoxContainer.new()
		texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		texts.add_theme_constant_override("separation", 2)
		texts.add_child(UI.label("Membership negotiation concluded" if concluded else "Membership responses", 9, Color("#bbf7d0") if concluded else ChatPanel.GREY_TEXT, 850))
		var institution := ChatPanel.d(state.get("institution", {}))
		if concluded and not ChatPanel.t(institution.get("status", "")).is_empty():
			var institution_name := ChatPanel.t(institution.get("name", ""))
			texts.add_child(UI.label("%s is now %s." % [institution_name if not institution_name.is_empty() else "Institution", ChatPanel.t(institution.get("status", "")).replace("-", " ").replace("_", " ")], 8, Color(1, 1, 1, 0.4)))
		top.add_child(texts)
		if concluded:
			var view_button := ChatPanel.solid_button("View institution →", 9, ChatPanel.GREY_TEXT, 760, Color(1, 1, 1, 0.055), ChatPanel.GREY_BORDER, Color(1, 1, 1, 0.09), ChatPanel.GREY_BORDER_STRONG, 8, Vector4(7, 4, 7, 4))
			view_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			view_button.pressed.connect(func() -> void: panel.navigate_institution(_institution_id(), "members"))
			top.add_child(view_button)
		column.add_child(top)
		for entry in cases:
			var item := ChatPanel.d(entry)
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 7)
			var polity := ChatPanel.t(item.get("polity", ""))
			var polity_label := UI.label(polity if not polity.is_empty() else "Government", 9, Color(1, 1, 1, 0.62))
			polity_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			polity_label.clip_text = true
			polity_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			row.add_child(polity_label)
			var presentation := _outcome_presentation(item)
			row.add_child(ChatPanel.pill(presentation[0], presentation[1]))
			column.add_child(row)
		box.add_child(column)
		holder.add_child(ChatPanel.spaced_bottom(box, 7))
		return holder


	func _outcome_presentation(entry: Dictionary) -> Array:
		var status := ChatPanel.t(entry.get("status", "pending")).to_lower()
		if status.is_empty():
			status = "pending"
		if status == "accepted":
			return ["Observer accepted" if ChatPanel.t(entry.get("requestedStatus", "")) == "observer" else "Accepted", "good"]
		if status == "rejected":
			return ["Declined", "bad"]
		if status == "pending-approval":
			return ["Awaiting member approval", "live"]
		if status == "negotiating":
			return ["Decision delayed" if ChatPanel.t(entry.get("decision", "")) == "delay" else "Negotiating terms", "neutral"]
		if status == "resolved":
			return ["Resolved", "good"]
		return ["Awaiting response", "neutral"]


	func _build_lifecycle_box(terminal: bool) -> void:
		ChatPanel.clear(_lifecycle_box)
		var showing := is_lifecycle_conversation() and not terminal
		(_lifecycle_box.get_parent() as Control).visible = showing
		_lifecycle_box.visible = showing
		if not showing:
			return
		_lifecycle_box.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), ChatPanel.GREY_BORDER, 9, 1, Vector4(9, 8, 9, 8)))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 9)
		var texts := VBoxContainer.new()
		texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		texts.add_theme_constant_override("separation", 2)
		var institutional := is_institutional()
		var mine := player_case()
		texts.add_child(UI.label("Institution accession hearing" if institutional else "Institution membership negotiation", 9, ChatPanel.GREY_TEXT, 820))
		var detail := "The invited government decides from current PWv2, relations, strategic fit and the institution's charter. A diplomatic invitation is not membership."
		if not mine.is_empty():
			detail = "This invitation requires your government's explicit decision. The AI cannot accept, reject or alter membership for you."
		elif institutional:
			detail = "The application is now before the institution's canonical voters. Their positions should follow current PWv2, relations, charter obligations and political fit; native governance records every formal ballot."
		texts.add_child(UI.wrapped(detail, 8, Color(1, 1, 1, 0.38)))
		row.add_child(texts)
		var state := lifecycle_state()
		var can_request := not institutional and (ChatPanel.a(state["cases"]).is_empty() or not ChatPanel.a(state["response"]).is_empty())
		if not mine.is_empty():
			var buttons := HBoxContainer.new()
			buttons.add_theme_constant_override("separation", 4)
			buttons.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			for spec in [["Accept", "accept", Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.09), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.25), Color("#bbf7d0"), 760], ["Observer instead", "seek-observer", Color(1, 1, 1, 0.055), ChatPanel.GREY_BORDER, ChatPanel.GREY_TEXT, 400], ["Later", "delay", Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.07), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.2), Color("#fde68a"), 400], ["Reject", "reject", Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.07), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.2), ChatPanel.RED_SOFT, 400]]:
				var decision: String = spec[1]
				var choice := ChatPanel.solid_button(spec[0], 9, spec[4], spec[5], spec[2], spec[3], Color((spec[2] as Color).r, (spec[2] as Color).g, (spec[2] as Color).b, (spec[2] as Color).a + 0.06), spec[3], 8, Vector4(7, 5, 7, 5))
				choice.disabled = loading
				choice.pressed.connect(func() -> void: lifecycle_decision(decision))
				buttons.add_child(choice)
			row.add_child(buttons)
		elif institutional or can_request:
			var request := ChatPanel.solid_button("Continue hearing →" if institutional else "Request response →", 9, ChatPanel.GREY_TEXT, 760, ChatPanel.GREY_RAISED, ChatPanel.GREY_BORDER_STRONG, ChatPanel.GREY_RAISED, Color(1, 1, 1, 0.3), 8, Vector4(8, 5, 8, 5))
			request.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			request.disabled = loading
			request.pressed.connect(lifecycle_continue)
			row.add_child(request)
		_lifecycle_box.add_child(row)


	func _update_send() -> void:
		var has_text := not _composer.text.strip_edges().is_empty()
		var style: StyleBoxFlat
		if embedded:
			style = UI.box(ChatPanel.GREY_RAISED if has_text else Color(1, 1, 1, 0.04), ChatPanel.GREY_BORDER_STRONG, 10, 1, Vector4(11, 0, 11, 0))
		else:
			style = UI.box(ChatPanel.BLUE if has_text else Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.3), Color(0, 0, 0, 0), 10, 0)
		for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
			_send.add_theme_stylebox_override(state, style)
		_send.disabled = not has_text
		_send.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if has_text else Control.CURSOR_FORBIDDEN


	func fit_composer() -> void:
		var lines := maxi(1, _composer.get_total_visible_line_count())
		var height := clampf(float(lines) * _composer.get_line_height() + 20.0, 42.0, 192.0)
		_composer.custom_minimum_size.y = height
		_update_send()


	func _on_composer_input(event: InputEvent) -> void:
		if event is InputEventKey:
			var key := event as InputEventKey
			if key.pressed and not key.echo and (key.keycode == KEY_ENTER or key.keycode == KEY_KP_ENTER) and not key.shift_pressed and not _composer.has_ime_text():
				_composer.accept_event()
				submit_from_composer()


	func submit_from_composer() -> void:
		var text := _composer.text.strip_edges()
		if text.is_empty() or loading:
			return
		_composer.text = ""
		fit_composer()
		var as_demand := they_are() == "puppet" and make_demand
		make_demand = false
		update_composer()
		if as_demand:
			var target := ChatPanel.t(ChatPanel.d(countries()[0]).get("name", ""))
			var id := chat_id
			await submit_player_text(text, func(message_id: String, time: String) -> void:
				var reply := await panel.engine.request("chat.demandMake", {"id": id, "player": panel.player, "target": target, "text": text, "useOpen": true, "messageId": message_id, "time": time, "messages": messages_ref})
				panel.adopt_chat_result(reply, id)
				render_messages(false))
		else:
			await submit_player_text(text)


	func submit_player_text(text: String, on_sent := Callable()) -> void:
		if text.is_empty() or loading:
			return
		await cut_in()
		var id := chat_id
		var reply := await panel.engine.request("chat.catchup", {"chat": chat, "messages": messages_ref, "player": panel.player, "gameDate": panel.game_date})
		var catch_up := ChatPanel.d(reply.get("result", {})) if reply.get("ok", false) else {}
		if id != chat_id:
			return
		var date := ChatPanel.t(catch_up.get("date", ""))
		if date.is_empty():
			date = panel.game_date
		var message_id := ChatPanel.thread_id("msg")
		var message := {"id": message_id, "role": "user", "speaker": panel.player, "text": text, "time": date}
		if not ChatPanel.t(catch_up.get("text", "")).is_empty():
			message["catchUp"] = ChatPanel.t(catch_up.get("text", ""))
			message["catchUpLabel"] = ChatPanel.t(catch_up.get("label", ""))
		var next := messages_ref.duplicate()
		next.append(message)
		push_messages(next)
		if on_sent.is_valid():
			await on_sent.call(message_id, date)
		if is_group() or is_institutional() or is_lifecycle_conversation():
			await run_group_turn(text, next)
			return
		var counterpart := {}
		for country in countries():
			if not panel.matches_player(country):
				counterpart = country
				break
		if counterpart.is_empty():
			var failed := next.duplicate()
			failed.append({"role": "error", "speaker": "System", "text": "This chat has no valid counterpart.", "time": panel.game_date})
			push_messages(failed)
			return
		await fetch_leader_response(counterpart, text)


	func push_messages(updated: Array) -> void:
		messages_ref = updated
		messages = updated
		render_messages(true)
		panel.on_messages_update(chat_id, updated)


	func fetch_leader_response(country: Dictionary, player_message: String) -> void:
		if panel.matches_player(country):
			return
		var id := chat_id
		loading = true
		speaking = country
		update_composer()
		render_messages(true)
		var asked := {}
		for index in range(messages_ref.size() - 1, -1, -1):
			var entry := ChatPanel.d(messages_ref[index])
			if ChatPanel.t(entry.get("role", "")) == "user" and ChatPanel.t(entry.get("text", "")) == player_message:
				asked = entry
				break
		var replied_on := ChatPanel.t(asked.get("time", ""))
		if replied_on.is_empty():
			replied_on = panel.game_date
		var reply := await panel.engine.request("chat.reply", {"chatId": id, "text": player_message, "counterpart": ChatPanel.t(country.get("name", "")), "countries": countries(), "catchUp": ChatPanel.t(asked.get("catchUp", ""))})
		if id != chat_id:
			return
		if reply.get("ok", false):
			var answer := ChatPanel.d(reply.get("result", {}))
			var leader := {"id": ChatPanel.thread_id("msg"), "role": "leader", "speaker": ChatPanel.t(country.get("name", "")), "code": ChatPanel.t(country.get("code", "")), "text": str(answer.get("reply", "")), "time": replied_on}
			if not ChatPanel.t(answer.get("memorySummary", "")).is_empty():
				leader["memorySummary"] = ChatPanel.t(answer.get("memorySummary", ""))
			var updated := messages_ref.duplicate()
			var reaction := ChatPanel.t(answer.get("reaction", "")) if answer.get("reaction") != null else ""
			if not reaction.is_empty():
				for index in range(updated.size() - 1, -1, -1):
					if ChatPanel.t(ChatPanel.d(updated[index]).get("role", "")) == "user":
						var tagged: Dictionary = ChatPanel.d(updated[index]).duplicate()
						var reactions: Dictionary = ChatPanel.d(tagged.get("reactions", {})).duplicate()
						reactions[ChatPanel.t(country.get("name", ""))] = {"emoji": reaction, "code": ChatPanel.t(country.get("code", ""))}
						tagged["reactions"] = reactions
						updated[index] = tagged
						break
			updated.append(leader)
			push_messages(updated)
			loading = false
			speaking = {}
			update_composer()
			render_messages(true)
			if not is_group() and not they_are().is_empty():
				var check_chat: Dictionary = chat.duplicate()
				check_chat["messages"] = messages_ref
				var check := await panel.engine.request("chat.demandCheck", {"id": id, "chat": check_chat, "speaker": ChatPanel.t(country.get("name", "")), "reply": ChatPanel.t(leader.get("text", "")), "answering": player_message, "messageId": ChatPanel.t(leader.get("id", "")), "time": replied_on})
				panel.adopt_chat_result(check, id)
				render_messages(false)
		else:
			var failed := messages_ref.duplicate()
			failed.append({"role": "error", "speaker": ChatPanel.t(country.get("name", "")), "code": ChatPanel.t(country.get("code", "")), "text": str(reply.get("error", "")), "time": replied_on, "retry": {"country": {"name": ChatPanel.t(country.get("name", "")), "code": ChatPanel.t(country.get("code", ""))}, "playerMessage": player_message}})
			push_messages(failed)
			loading = false
			speaking = {}
			update_composer()
			render_messages(true)


	func run_group_turn(text: String, next_messages: Array, options: Dictionary = {}) -> bool:
		var id := chat_id
		var lifecycle_response: bool = options.get("lifecycle_response", false) == true
		var override := ChatPanel.d(options.get("chat_override", {}))
		loading = true
		update_composer()
		render_messages(true)
		var asked := ChatPanel.d(next_messages.back()) if not next_messages.is_empty() else {}
		var asked_time := ChatPanel.t(asked.get("time", ""))
		if asked_time.is_empty():
			asked_time = panel.game_date
		var source := override if not override.is_empty() else chat
		var reply := await panel.engine.request("chat.group", {"chat": source, "messages": next_messages, "text": text, "player": panel.player, "catchUp": ChatPanel.t(asked.get("catchUp", "")), "time": ChatPanel.t(asked.get("time", "")), "actionFeedback": action_feedback, "lifecycleResponseRequested": lifecycle_response})
		if id != chat_id:
			return true
		if not reply.get("ok", false):
			var message := ChatPanel.t(reply.get("error", ""))
			if message.is_empty():
				message = "The group response could not be generated."
			var failed := next_messages.duplicate()
			var bubble := {"role": "error", "speaker": "System", "text": message, "time": asked_time}
			if not text.is_empty():
				bubble["retry"] = {"group": true, "text": text}
			failed.append(bubble)
			push_messages(failed)
			_finish_loading()
			return true
		var outcome := ChatPanel.d(reply.get("result", {}))
		var new_events := ChatPanel.a(outcome.get("newEvents", []))
		var lifecycle_entries := ChatPanel.a(outcome.get("lifecycle", []))
		action_feedback = ChatPanel.t(outcome.get("feedback", ""))
		if new_events.is_empty() and lifecycle_entries.is_empty():
			var refused := int(outcome.get("refused", 0))
			var why := "Nobody at the table chose to answer."
			if outcome.get("unreachable", false) == true:
				why = "The AI could not be reached, so nobody at the table answered."
			elif refused == 1:
				why = "Nobody at the table answered: the AI's action was refused."
			elif refused > 1:
				why = "Nobody at the table answered: %d of the AI's actions were refused." % refused
			var silent := messages_ref.duplicate()
			var bubble := {"role": "error", "speaker": "System", "text": why, "time": asked_time}
			if not text.is_empty():
				bubble["retry"] = {"group": true, "text": text}
			silent.append(bubble)
			push_messages(silent)
			_finish_loading()
			return false
		for entry in lifecycle_entries:
			var lifecycle_case := ChatPanel.d(ChatPanel.d(entry).get("lifecycleCase", {}))
			if not ChatPanel.t(lifecycle_case.get("id", "")).is_empty():
				lifecycle_overrides[ChatPanel.t(lifecycle_case.get("id", ""))] = lifecycle_case
		var committed: bool = outcome.get("committed", false) == true
		var projected := ChatPanel.d(outcome.get("projected", {}))
		if is_lifecycle_conversation() and lifecycle_response and committed:
			panel.on_thread_update(id, {"events": outcome.get("events"), "countries": projected.get("countries"), "title": projected.get("title", ""), "polls": projected.get("polls"), "demands": projected.get("demands")}, true)
			await _present_lifecycle_replies(ChatPanel.a(projected.get("messages", [])), ChatPanel.a(outcome.get("revealPlan", [])))
			for entry in lifecycle_entries:
				var proposal := ChatPanel.d(ChatPanel.d(entry).get("proposal", {}))
				if not ChatPanel.t(proposal.get("id", "")).is_empty() and ChatPanel.t(proposal.get("status", "")).to_lower() == "voting":
					panel.run_council_vote(ChatPanel.t(chat.get("lifecycleInstitutionId", "")), ChatPanel.t(proposal.get("id", "")), 1000 + randi() % 2001)
					break
			_finish_loading()
			world_changed()
			return true
		if committed:
			panel.on_thread_update(id, {"events": outcome.get("events"), "countries": projected.get("countries"), "title": projected.get("title", ""), "polls": projected.get("polls"), "demands": projected.get("demands")}, true)
			messages_ref = ChatPanel.a(projected.get("messages", []))
		var steps := ChatPanel.a(outcome.get("steps", []))
		if steps.is_empty():
			_finish_loading()
			world_changed()
			return true
		var turn := {"chat_id": id, "campaign_id": ChatPanel.t(outcome.get("campaignId", "")), "events": ChatPanel.a(outcome.get("baseEvents", [])), "written": false, "committed": committed, "running": true, "left": [], "first": true}
		var first := ChatPanel.d(steps[0])
		var wrote: bool = await add_turn_events(turn, ChatPanel.a(first.get("events", [])), null if committed else outcome.get("cursors"), true)
		_finish_loading()
		world_changed()
		if not wrote:
			return true
		if steps.size() > 1:
			say_later(turn, steps.slice(1))
		return true


	func _finish_loading() -> void:
		loading = false
		speaking = {}
		refresh_chrome()
		render_messages(true)


	func _present_lifecycle_replies(full: Array, plan: Array) -> void:
		messages_ref = full
		if plan.size() < 2:
			messages = full
			render_messages(true)
			return
		lifecycle_token += 1
		var token := lifecycle_token
		var by_id := {}
		for message in full:
			by_id[ChatPanel.t(ChatPanel.d(message).get("id", ""))] = message
		var reply_ids := {}
		for row in plan:
			reply_ids[ChatPanel.t(ChatPanel.d(row).get("id", ""))] = true
		var base: Array = []
		for message in full:
			if not reply_ids.has(ChatPanel.t(ChatPanel.d(message).get("id", ""))):
				base.append(message)
		lifecycle_reveal = true
		staged_speaker = {}
		var shown := base.duplicate()
		shown.append(by_id.get(ChatPanel.t(ChatPanel.d(plan[0]).get("id", "")), {}))
		messages = shown
		refresh_chrome()
		render_messages(true)
		for index in range(1, plan.size()):
			var row := ChatPanel.d(plan[index])
			if lifecycle_token != token:
				return
			var message := ChatPanel.d(by_id.get(ChatPanel.t(row.get("id", "")), {}))
			var speaker_name := ChatPanel.t(message.get("speaker", ""))
			staged_speaker = {"name": speaker_name if not speaker_name.is_empty() else "Government", "code": ChatPanel.t(message.get("code", ""))}
			render_messages(true)
			await get_tree().create_timer(float(row.get("gapMs", 1000)) / 1000.0).timeout
			if lifecycle_token != token:
				return
			var step := base.duplicate()
			for earlier in range(index + 1):
				step.append(by_id.get(ChatPanel.t(ChatPanel.d(plan[earlier]).get("id", "")), {}))
			messages = step
			render_messages(true)
		if lifecycle_token != token:
			return
		messages = full
		staged_speaker = {}
		lifecycle_reveal = false
		refresh_chrome()
		render_messages(true)


	func lifecycle_continue() -> void:
		if not is_lifecycle_conversation() or loading or not player_case().is_empty():
			return
		var state := lifecycle_state()
		if not is_institutional() and not ChatPanel.a(state["cases"]).is_empty() and ChatPanel.a(state["response"]).is_empty():
			return
		await run_group_turn("", messages_ref, {"lifecycle_response": true})


	func lifecycle_decision(decision: String) -> void:
		var mine := player_case()
		if mine.is_empty() or loading:
			return
		loading = true
		update_composer()
		render_messages(true)
		var reply := await panel.engine.request("chat.lifecycleDecision", {"chatId": chat_id, "institutionId": ChatPanel.t(chat.get("lifecycleInstitutionId", "")), "caseId": ChatPanel.t(mine.get("id", "")), "decision": decision, "player": panel.player, "date": panel.game_date})
		if reply.get("ok", false):
			var result := ChatPanel.d(reply.get("result", {}))
			panel.adopt_institutional_result(result)
			var proposal := ChatPanel.d(result.get("proposal", {}))
			if not ChatPanel.t(proposal.get("id", "")).is_empty() and ChatPanel.t(proposal.get("status", "")).to_lower() == "voting":
				panel.run_council_vote(ChatPanel.t(chat.get("lifecycleInstitutionId", "")), ChatPanel.t(proposal.get("id", "")), 1000 + randi() % 2001)
		else:
			var failed := messages_ref.duplicate()
			var error_text := ChatPanel.t(reply.get("error", ""))
			failed.append({"role": "error", "speaker": "System", "text": error_text if not error_text.is_empty() else "The institution response could not be recorded.", "time": panel.game_date})
			push_messages(failed)
		loading = false
		update_composer()
		render_messages(true)
		world_changed()


	func add_turn_events(turn: Dictionary, events: Array, cursors: Variant = null, on_screen := true) -> bool:
		if turn.is_empty() or panel.engine == null:
			return false
		var reply := await panel.engine.request("chat.step", {"chatId": turn["chat_id"], "campaignId": turn["campaign_id"], "turnLog": turn["events"], "wroteAny": turn["written"], "events": events, "cursors": cursors, "committed": turn["committed"], "first": turn.get("first", false) == true})
		turn["first"] = false
		if not reply.get("ok", false):
			return false
		var result := ChatPanel.d(reply.get("result", {}))
		if result.get("written", false) != true:
			return false
		turn["events"] = ChatPanel.a(result.get("events", []))
		turn["written"] = true
		var turn_chat := ChatPanel.t(turn["chat_id"])
		var shown := ChatPanel.a(result.get("messages", []))
		if turn["committed"] == true:
			if on_screen and turn_chat == chat_id:
				messages = shown
				render_messages(true)
			return true
		panel.local_thread_update(turn_chat, {"messages": shown, "events": result.get("events"), "countries": result.get("countries"), "title": result.get("title", ""), "polls": result.get("polls"), "demands": result.get("demands")})
		if on_screen and turn_chat == chat_id:
			messages_ref = shown
			messages = shown
			render_messages(true)
			refresh_chrome()
		panel.mark_active_read()
		return true


	func say_later(turn: Dictionary, steps: Array) -> void:
		reveal = turn
		turn["left"] = steps.duplicate()
		while turn["running"]:
			var left: Array = turn["left"]
			if left.is_empty():
				break
			var step := ChatPanel.d(left[0])
			var speaker_name := ChatPanel.t(step.get("speaker", ""))
			var code := ""
			for country in countries():
				if ChatPanel.t(country.get("name", "")).to_lower() == speaker_name.to_lower():
					code = ChatPanel.t(country.get("code", ""))
			typing_next = {"speaker": speaker_name, "code": code}
			if chat_id == ChatPanel.t(turn["chat_id"]):
				render_messages(true)
			var pause := float(1000 + randi() % 2001) / 1000.0
			await get_tree().create_timer(pause).timeout
			if not turn["running"]:
				return
			left.pop_front()
			var said: bool = await add_turn_events(turn, ChatPanel.a(step.get("events", [])))
			if not said:
				left.clear()
				break
		_end_reveal(turn)


	func _end_reveal(turn: Dictionary) -> void:
		turn["running"] = false
		if reveal == turn:
			reveal = {}
			typing_next = {}
			render_messages(true)


	func stop_reveal() -> Array:
		if reveal.is_empty() or reveal.get("running", false) != true:
			return []
		var turn := reveal
		var left: Array = turn["left"]
		var rest := left.duplicate()
		left.clear()
		_end_reveal(turn)
		return rest


	func cut_in() -> void:
		var turn := reveal
		var unsaid := stop_reveal()
		if unsaid.is_empty():
			return
		if turn.get("committed", false) == true:
			var events: Array = []
			for step in unsaid:
				events.append_array(ChatPanel.a(ChatPanel.d(step).get("events", [])))
			await add_turn_events(turn, events)
			return
		var reply := await panel.engine.request("chat.cutin", {"chatId": ChatPanel.t(turn.get("chat_id", "")), "player": panel.player, "steps": unsaid})
		var note := ChatPanel.t(reply.get("result", "")) if reply.get("ok", false) else ""
		if not note.is_empty():
			action_feedback = note if action_feedback.is_empty() else "%s\n\n%s" % [action_feedback, note]


	func create_poll() -> void:
		if not can_call_vote() or loading:
			return
		var question := _poll_question.text.strip_edges()
		var labels := {}
		for part in _poll_options.text.replace("\r", "").replace(",", "\n").split("\n"):
			var label := part.strip_edges()
			if not label.is_empty():
				labels[label.left(120).to_lower()] = true
		if question.is_empty() or labels.size() < 2 or panel.player.strip_edges().is_empty():
			poll_error = "Enter a question and at least two distinct options."
			update_composer()
			return
		poll_error = ""
		await cut_in()
		var id := chat_id
		var reply := await panel.engine.request("chat.pollCreate", {"id": id, "player": panel.player, "question": question, "optionsText": _poll_options.text, "time": panel.game_date, "messages": messages_ref})
		if id != chat_id:
			return
		var result := ChatPanel.d(reply.get("result", {})) if reply.get("ok", false) else {}
		if result.get("invalid", false) == true or not reply.get("ok", false):
			poll_error = "Enter a question and at least two distinct options."
			update_composer()
			return
		var updated := ChatPanel.d(result.get("chat", {}))
		var projected := ChatPanel.a(result.get("messages", []))
		panel.local_thread_update(id, {"events": updated.get("events"), "countries": updated.get("countries"), "title": updated.get("title", ""), "polls": updated.get("polls"), "demands": updated.get("demands")})
		messages_ref = projected
		messages = projected
		poll_open = false
		_poll_question.text = ""
		_poll_options.text = "Yes\nNo\nAbstain"
		update_composer()
		render_messages(true)
		var snapshot: Dictionary = panel.find_chat(id).duplicate() if not panel.find_chat(id).is_empty() else chat.duplicate()
		snapshot["messages"] = projected
		await run_group_turn(ChatPanel.t(result.get("line", "")), projected, {"chat_override": snapshot})


	func vote(poll: Dictionary, option_id: String) -> void:
		var id := chat_id
		var reply := await panel.engine.request("chat.vote", {"id": id, "poll": poll, "optionId": option_id, "player": panel.player, "time": panel.game_date, "messages": messages_ref})
		panel.adopt_chat_result(reply, id)
		render_messages(false)


	func answer_demand(demand: Dictionary, answer: String, text := "") -> void:
		demand_busy = true
		render_messages(false)
		var id := chat_id
		var reply := await panel.engine.request("chat.demandAnswer", {"id": id, "demand": demand, "player": panel.player, "answer": answer, "text": text, "time": panel.game_date, "messages": messages_ref})
		var result := ChatPanel.d(reply.get("result", {})) if reply.get("ok", false) else {}
		if not reply.get("ok", false) or result.get("refused", false) == true:
			demand_busy = false
			render_messages(false)
			return
		panel.adopt_chat_result(reply, id)
		var reconsidered := ChatPanel.t(demand.get("status", "")) == "refused"
		var summary := ChatPanel.t(demand.get("summary", ""))
		var line := ""
		if answer == "accepted":
			line = ("We have reconsidered. We accept: %s." % summary) if reconsidered else ("We accept: %s." % summary)
		elif answer == "refused":
			line = "We refuse this demand."
		else:
			line = ("We have reconsidered. %s" % text) if reconsidered else text
		await submit_player_text(line)
		demand_busy = false
		render_messages(false)


	func accept_alternative(demand: Dictionary) -> void:
		demand_busy = true
		render_messages(false)
		var id := chat_id
		var reply := await panel.engine.request("chat.demandAnswer", {"id": id, "demand": demand, "player": panel.player, "answer": "alternative_accepted", "time": panel.game_date, "messages": messages_ref})
		var result := ChatPanel.d(reply.get("result", {})) if reply.get("ok", false) else {}
		if not reply.get("ok", false) or result.get("refused", false) == true:
			demand_busy = false
			render_messages(false)
			return
		panel.adopt_chat_result(reply, id)
		await submit_player_text("We accept your alternative: %s." % ChatPanel.t(demand.get("alternative", "")))
		demand_busy = false
		render_messages(false)


	func reject_alternative(demand: Dictionary, revised: String) -> void:
		demand_busy = true
		render_messages(false)
		var id := chat_id
		var line := revised if not revised.is_empty() else "No. The demand stands: %s." % ChatPanel.t(demand.get("summary", ""))
		await submit_player_text(line, func(message_id: String, time: String) -> void:
			var reply := await panel.engine.request("chat.demandMake", {"id": id, "player": panel.player, "target": ChatPanel.t(demand.get("target", "")), "text": revised, "openDemand": demand, "messageId": message_id, "time": time, "messages": messages_ref})
			panel.adopt_chat_result(reply, id))
		demand_busy = false
		render_messages(false)


	func retry(index: int) -> void:
		if loading or index < 0 or index >= messages_ref.size():
			return
		var plan := ChatPanel.d(ChatPanel.d(messages_ref[index]).get("retry", {}))
		if plan.is_empty():
			return
		var rest: Array = []
		for at in range(messages_ref.size()):
			if at != index:
				rest.append(messages_ref[at])
		if plan.get("group", false) == true:
			panel.engine.request("chat.log", {"message": "Retrying the table's turn in chat #%s." % chat_id, "verbose": true})
			push_messages(rest)
			await run_group_turn(ChatPanel.t(plan.get("text", "")), rest)
			return
		var leader_name := ChatPanel.t(ChatPanel.d(plan.get("country", {})).get("name", ""))
		panel.engine.request("chat.log", {"message": "Retrying %s's reply in chat #%s." % [leader_name if not leader_name.is_empty() else "a leader", chat_id], "verbose": true})
		push_messages(rest)
		await fetch_leader_response(ChatPanel.d(plan.get("country", {})), ChatPanel.t(plan.get("playerMessage", "")))


	func render_messages(scroll_down: bool) -> void:
		if chat_id.is_empty() or _box == null:
			return
		ChatPanel.clear(_box)
		var source := presented()
		_rendered_signature = _messages_signature(source)
		var entries: Array = []
		for index in range(source.size()):
			var message := ChatPanel.d(source[index])
			if not panel.unseen.has(ChatPanel.t(message.get("eventId", ""))):
				entries.append({"msg": message, "index": index})
		var window_entries := entries.slice(entries.size() - visible_limit) if entries.size() > visible_limit else entries
		var hidden := entries.size() - window_entries.size()
		if messages.is_empty() and not loading:
			var empty_text := "Begin the diplomatic conversation."
			if is_council():
				empty_text = "The council floor is quiet. Address the institution when you are ready."
			elif is_lifecycle_conversation():
				empty_text = "The accession table is open."
			var empty := UI.wrapped(empty_text, 14, Color(1, 1, 1, 0.35))
			empty.add_theme_font_override("font", ChatPanel.italic_font())
			empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			_box.add_child(ChatPanel.spaced(empty, 32))
		if hidden > 0:
			var step := mini(hidden, ChatPanel.WINDOW_STEP)
			var more := ChatPanel.solid_button("Show %d earlier message%s (%d hidden)" % [step, "" if step == 1 else "s", hidden], 11, Color(1, 1, 1, 0.58), 400, Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.09), Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.14), 999, Vector4(10, 6, 10, 6))
			more.pressed.connect(func() -> void:
				visible_limit += ChatPanel.WINDOW_STEP
				render_messages(false))
			var holder := CenterContainer.new()
			holder.add_child(more)
			_box.add_child(holder)
		var by_message := {}
		var stranded: Array = []
		if not is_group():
			var on_screen := {}
			for entry in window_entries:
				var id := ChatPanel.t(ChatPanel.d(entry["msg"]).get("id", ""))
				if not id.is_empty():
					on_screen[id] = true
			for demand in ChatPanel.a(chat.get("demands", [])):
				var record := ChatPanel.d(demand)
				var status := ChatPanel.t(record.get("status", ""))
				if status == "superseded":
					continue
				var message_id := ChatPanel.t(record.get("messageId", ""))
				if not message_id.is_empty() and on_screen.has(message_id):
					var placed: Array = by_message.get(message_id, [])
					placed.append(record)
					by_message[message_id] = placed
				elif status == "open" or status == "countered":
					stranded.append(record)
		var area := _area_width()
		for i in range(window_entries.size()):
			var message := ChatPanel.d(window_entries[i]["msg"])
			var index: int = window_entries[i]["index"]
			var key := ChatPanel.date_key(ChatPanel.t(message.get("time", "")))
			var previous := ChatPanel.d(window_entries[i - 1]["msg"]) if i > 0 else {}
			var following := ChatPanel.d(window_entries[i + 1]["msg"]) if i + 1 < window_entries.size() else {}
			var show_separator := not key.is_empty() and (i == 0 or key != ChatPanel.date_key(ChatPanel.t(previous.get("time", ""))))
			var speaker_key := "%s::%s" % [ChatPanel.t(message.get("role", "")), ChatPanel.t(message.get("speaker", "")).to_lower()]
			var previous_key := "%s::%s" % [ChatPanel.t(previous.get("role", "")), ChatPanel.t(previous.get("speaker", "")).to_lower()]
			var following_key := "%s::%s" % [ChatPanel.t(following.get("role", "")), ChatPanel.t(following.get("speaker", "")).to_lower()]
			var compact := not show_separator and ChatPanel.t(message.get("role", "")) != "system" and speaker_key == previous_key
			var grouped := ChatPanel.t(message.get("role", "")) != "system" and speaker_key == following_key and key == ChatPanel.date_key(ChatPanel.t(following.get("time", "")))
			if show_separator:
				_box.add_child(_date_separator(ChatPanel.t(message.get("time", ""))))
			if is_institutional() and (ChatPanel.t(message.get("role", "")) == "system" or ChatPanel.t(message.get("speaker", "")).to_lower() == "system"):
				var record := _institution_record(message)
				if record:
					_box.add_child(record)
			else:
				var can_retry := not ChatPanel.d(message.get("retry", {})).is_empty() and not loading and index == messages.size() - 1
				var bubble := _bubble(message, index, compact, not grouped, can_retry, area)
				if compact:
					var tighter := MarginContainer.new()
					tighter.add_theme_constant_override("margin_top", -9)
					tighter.add_child(bubble)
					_box.add_child(tighter)
				else:
					_box.add_child(bubble)
			for demand in ChatPanel.a(by_message.get(ChatPanel.t(message.get("id", "")), [])):
				_box.add_child(_demand_card(ChatPanel.d(demand)))
		for poll in ChatPanel.a(chat.get("polls", [])):
			_box.add_child(_poll_card(ChatPanel.d(poll)))
		for demand in stranded:
			_box.add_child(_demand_card(ChatPanel.d(demand)))
		var list := countries()
		var lifecycle_thinking := is_lifecycle_conversation() and loading and speaking.is_empty() and staged_speaker.is_empty() and list.size() > 1
		var group_thinking := is_group() and not is_lifecycle_conversation() and loading and speaking.is_empty()
		if loading and lifecycle_thinking:
			var state := lifecycle_state()
			var count := ChatPanel.a(state["response"]).size()
			_box.add_child(_thinking_group(count if count > 0 else list.size(), true))
		elif loading and group_thinking:
			_box.add_child(_thinking_group(list.size(), false))
		elif loading:
			var typing := staged_speaker
			if typing.is_empty():
				typing = speaking
			if typing.is_empty() and not list.is_empty():
				typing = ChatPanel.d(list[0])
			if not typing.is_empty():
				_box.add_child(_typing_bubble(ChatPanel.t(typing.get("name", "")), "Thinking", ""))
		if not loading and not typing_next.is_empty():
			_box.add_child(_typing_bubble(ChatPanel.t(typing_next.get("speaker", "")), "Typing", "Send a message now to cut in: what is still to come will not be said."))
		if scroll_down:
			_scroll_to_end()


	func _scroll_to_end() -> void:
		if not is_inside_tree():
			return
		await get_tree().process_frame
		await get_tree().process_frame
		if is_instance_valid(_scroll):
			_scroll.scroll_vertical = int(_scroll.get_v_scroll_bar().max_value)


	func _area_width() -> float:
		var width := _scroll.size.x - (24.0 if embedded else 36.0)
		if width <= 0.0:
			var viewport := get_viewport_rect().size if is_inside_tree() else Vector2(1440, 900)
			width = minf(ChatPanel.PANEL_MAX_WIDTH, viewport.x - 16.0) - 36.0
		return width


	func _institution_record(message: Dictionary) -> Control:
		var raw := ChatPanel.t(message.get("text", ""))
		if raw.is_empty():
			return null
		var established := RegEx.create_from_string("(?i)\\s+institutional channel established\\.?$")
		var text := established.sub(raw, " council opened.") if established.search(raw) else raw
		var holder := CenterContainer.new()
		var box := PanelContainer.new()
		box.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.035), ChatPanel.GREY_BORDER, 8, 1, Vector4(9, 5, 9, 5)))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 7)
		row.add_child(UI.label("◇", 12, Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.72)))
		var tag := UI.label("INSTITUTION RECORD", 8, Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.72), 800, "Arial", 1)
		tag.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(tag)
		var body := UI.wrapped(text, 10, Color(1, 1, 1, 0.58))
		body.custom_minimum_size.x = minf(_area_width() * 0.76 - 140.0, maxf(60.0, UI.font(400).get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 10).x + 4.0))
		row.add_child(body)
		box.add_child(row)
		holder.add_child(box)
		return holder


	func _bubble(message: Dictionary, index: int, compact: bool, show_time: bool, can_retry: bool, area: float) -> Control:
		var role := ChatPanel.t(message.get("role", ""))
		var is_player := role == "user"
		var is_error := role == "error"
		var speaker_name := ChatPanel.t(message.get("speaker", ""))
		var text := str(message.get("text", ""))
		var max_width := area * (0.82 if is_error else 0.7)
		if not is_error:
			max_width = minf(max_width, 672.0)
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_END if is_player else BoxContainer.ALIGNMENT_BEGIN
		row.add_theme_constant_override("separation", 6)
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 0)
		column.size_flags_horizontal = Control.SIZE_SHRINK_END if is_player else Control.SIZE_SHRINK_BEGIN
		var label_width := 0.0
		if not is_player and not compact:
			var header := HBoxContainer.new()
			header.add_theme_constant_override("separation", 5)
			if is_error:
				header.add_child(UI.label("⚠️ Error", 11, Color(1, 1, 1, 0.46)))
			else:
				header.add_child(panel.flag_box(speaker_name, Vector2(11, 11)))
				header.add_child(UI.label(speaker_name, 11, Color(1, 1, 1, 0.58), 650))
			label_width = header.get_combined_minimum_size().x
			column.add_child(ChatPanel.spaced_bottom(header, 4))
		if is_player and not ChatPanel.t(message.get("catchUpLabel", "")).is_empty():
			var catch_label := UI.label("⏳ " + ChatPanel.t(message.get("catchUpLabel", "")), 10, Color(1, 1, 1, 0.42))
			catch_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			catch_label.tooltip_text = ChatPanel.t(message.get("catchUp", ""))
			catch_label.mouse_filter = Control.MOUSE_FILTER_PASS
			label_width = maxf(label_width, catch_label.get_combined_minimum_size().x)
			column.add_child(ChatPanel.spaced_bottom(catch_label, 4))
		var bubble := PanelContainer.new()
		bubble.mouse_filter = Control.MOUSE_FILTER_PASS
		var accent := panel.accent_for(speaker_name, ChatPanel.t(message.get("code", "")))
		var bg := Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.92)
		var border := Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.2)
		if is_error:
			bg = Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.16)
			border = Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.3)
		elif not is_player:
			var base := Color(35 / 255.0, 35 / 255.0, 39 / 255.0, 0.96)
			var alpha := 0.04 + 0.96 * base.a
			bg = Color((accent.r * 0.04 + base.r * 0.96 * base.a) / alpha, (accent.g * 0.04 + base.g * 0.96 * base.a) / alpha, (accent.b * 0.04 + base.b * 0.96 * base.a) / alpha, alpha)
			border = Color(1, 1, 1, 0.08)
		var style := UI.box(bg, border, 13, 1, Vector4(0, 0, 0, 0))
		if is_player:
			style.corner_radius_bottom_right = 3
		else:
			style.corner_radius_bottom_left = 3
		bubble.add_theme_stylebox_override("panel", style)
		var inner := MarginContainer.new()
		inner.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var leader := not is_player and not is_error
		for side in [["margin_left", 14 if leader else 13], ["margin_right", 13], ["margin_top", 10], ["margin_bottom", 10]]:
			inner.add_theme_constant_override(side[0], side[1])
		if leader:
			var stripe := Panel.new()
			stripe.mouse_filter = Control.MOUSE_FILTER_IGNORE
			var stripe_style := StyleBoxFlat.new()
			stripe_style.draw_center = false
			stripe_style.border_width_left = 2
			stripe_style.border_color = Color(accent.r * 0.9 + 0.1, accent.g * 0.9 + 0.1, accent.b * 0.9 + 0.1, 0.8)
			stripe_style.corner_radius_top_left = 13
			stripe_style.corner_radius_top_right = 13
			stripe_style.corner_radius_bottom_right = 13
			stripe_style.corner_radius_bottom_left = 3
			stripe_style.anti_aliasing = true
			stripe.add_theme_stylebox_override("panel", stripe_style)
			bubble.add_child(stripe)
		var natural := 0.0
		if is_player:
			var body := UI.label(text, 14, UI.WHITE)
			body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			body.add_theme_constant_override("line_spacing", 5)
			body.mouse_filter = Control.MOUSE_FILTER_IGNORE
			inner.add_child(body)
			for line in text.split("\n"):
				natural = maxf(natural, UI.font(400).get_string_size(line, HORIZONTAL_ALIGNMENT_LEFT, -1, 14).x)
		else:
			var rendered := ChatPanel.markdown_view(text, 14)
			natural = float(rendered.get_meta("natural_width", 0.0)) * (1.04 if text.contains("**") else 1.0)
			inner.add_child(rendered)
			if not is_error and not panel.chat_dir.is_empty():
				ChatPanel.set_direction(inner, panel.chat_dir == "rtl")
		bubble.add_child(inner)
		var bubble_width := clampf(maxf(natural + 32.0, label_width), 40.0, max_width)
		column.custom_minimum_size.x = bubble_width
		var copy := ChatPanel.icon_button("copy", 12, Color(1, 1, 1, 0.46), Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.94), Color(1, 1, 1, 0.09))
		copy.custom_minimum_size = Vector2(26, 26)
		copy.tooltip_text = "Copy message"
		copy.modulate.a = 0.0
		copy.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		copy.pressed.connect(func() -> void:
			DisplayServer.clipboard_set(text)
			copy.tooltip_text = "Copied"
			for state in ["icon_normal_color", "icon_hover_color", "icon_pressed_color", "icon_hover_pressed_color"]:
				copy.add_theme_color_override(state, Color("#86efac"))
			await copy.get_tree().create_timer(0.9).timeout
			if is_instance_valid(copy):
				copy.tooltip_text = "Copy message"
				for state in ["icon_normal_color", "icon_hover_color", "icon_pressed_color", "icon_hover_pressed_color"]:
					copy.add_theme_color_override(state, Color(1, 1, 1, 0.46)))
		if not is_error:
			var reveal_copy := func(on: bool) -> void:
				if is_instance_valid(copy):
					copy.modulate.a = 1.0 if on else 0.0
			bubble.mouse_entered.connect(func() -> void: reveal_copy.call(true))
			bubble.mouse_exited.connect(func() -> void:
				if not bubble.get_global_rect().has_point(bubble.get_global_mouse_position()) and not copy.get_global_rect().has_point(copy.get_global_mouse_position()):
					reveal_copy.call(false))
			copy.mouse_entered.connect(func() -> void: reveal_copy.call(true))
			copy.mouse_exited.connect(func() -> void:
				if not bubble.get_global_rect().has_point(bubble.get_global_mouse_position()):
					reveal_copy.call(false))
		column.add_child(bubble)
		var reactions := _reaction_strip(ChatPanel.d(message.get("reactions", {})), is_player)
		if reactions:
			column.add_child(ChatPanel.spaced(reactions, 4))
		if is_error and can_retry:
			var retry_button := ChatPanel.icon_text_button("Retry", "retry", 12, ChatPanel.RED_SOFT, Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.12), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.35), 8, Vector4(10, 5, 10, 5))
			retry_button.add_theme_color_override("font_hover_color", ChatPanel.RED_PALE)
			retry_button.add_theme_color_override("icon_hover_color", ChatPanel.RED_PALE)
			retry_button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
			retry_button.pressed.connect(func() -> void: retry(index))
			column.add_child(ChatPanel.spaced(retry_button, 6))
		if not is_player and show_time and not ChatPanel.t(message.get("time", "")).is_empty():
			var stamp := ChatPanel.short_date(ChatPanel.t(message.get("time", "")))
			column.add_child(ChatPanel.spaced(UI.label(stamp if not stamp.is_empty() else ChatPanel.t(message.get("time", "")), 10, Color(1, 1, 1, 0.27)), 4))
		var copy_holder := VBoxContainer.new()
		copy_holder.add_theme_constant_override("separation", 0)
		if not is_player and not compact:
			copy_holder.add_child(ChatPanel.gap(20))
		if not is_error:
			copy_holder.add_child(copy)
		if is_player:
			row.add_child(copy_holder)
			row.add_child(column)
		else:
			row.add_child(column)
			row.add_child(copy_holder)
		return row


	func _reaction_strip(reactions: Dictionary, align_right: bool) -> Control:
		var groups: Array = []
		for key in reactions:
			var value := ChatPanel.d(reactions[key])
			var emoji := ChatPanel.t(value.get("emoji", ""))
			if emoji.is_empty():
				continue
			var country := ChatPanel.t(value.get("country", ""))
			if country.is_empty():
				country = ChatPanel.t(key)
			var found := {}
			for group in groups:
				if group["emoji"] == emoji:
					found = group
			if found.is_empty():
				found = {"emoji": emoji, "members": []}
				groups.append(found)
			(found["members"] as Array).append({"name": country, "code": ChatPanel.t(value.get("code", ""))})
		if groups.is_empty():
			return null
		var strip := HFlowContainer.new()
		strip.alignment = FlowContainer.ALIGNMENT_END if align_right else FlowContainer.ALIGNMENT_BEGIN
		strip.add_theme_constant_override("h_separation", 4)
		strip.add_theme_constant_override("v_separation", 4)
		for group in groups:
			var members: Array = group["members"]
			var chip := PanelContainer.new()
			chip.mouse_filter = Control.MOUSE_FILTER_PASS
			chip.custom_minimum_size.y = 25
			chip.add_theme_stylebox_override("panel", UI.box(Color(31 / 255.0, 31 / 255.0, 35 / 255.0, 0.94), Color(1, 1, 1, 0.12), 999, 1, Vector4(7, 3, 7, 3)))
			var names: PackedStringArray = []
			for member in members:
				names.append(ChatPanel.t(member["name"]))
			chip.tooltip_text = ", ".join(names)
			chip.mouse_entered.connect(_show_reactors.bind(chip, members))
			chip.mouse_exited.connect(_hide_reactors.bind(chip))
			chip.tree_exiting.connect(_hide_reactors.bind(chip))
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 4)
			row.mouse_filter = Control.MOUSE_FILTER_IGNORE
			row.add_child(UI.label(ChatPanel.t(group["emoji"]), 12, UI.WHITE))
			if members.size() > 1:
				var count := UI.label(str(members.size()), 10, Color(1, 1, 1, 0.62), 750)
				count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
				row.add_child(count)
			var stack := panel.flag_stack(members.slice(0, 3), Vector2(12, 9), -3)
			stack.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(stack)
			chip.add_child(row)
			strip.add_child(chip)
		return strip


	func _show_reactors(chip: Control, members: Array) -> void:
		_hide_reactors(chip)
		var tip := PanelContainer.new()
		tip.top_level = true
		tip.z_index = 4000
		tip.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var tip_style := UI.box(Color(18 / 255.0, 18 / 255.0, 21 / 255.0, 0.98), Color(1, 1, 1, 0.12), 8, 1, Vector4(8, 5, 8, 5))
		tip_style.shadow_color = Color(0, 0, 0, 0.35)
		tip_style.shadow_size = 12
		tip_style.shadow_offset = Vector2(0, 8)
		tip.add_theme_stylebox_override("panel", tip_style)
		var list := VBoxContainer.new()
		list.add_theme_constant_override("separation", 3)
		list.mouse_filter = Control.MOUSE_FILTER_IGNORE
		for member in members:
			var line := HBoxContainer.new()
			line.add_theme_constant_override("separation", 5)
			line.mouse_filter = Control.MOUSE_FILTER_IGNORE
			line.add_child(panel.flag_box(ChatPanel.t(member["name"]), Vector2(10, 10)))
			line.add_child(UI.label(ChatPanel.t(member["name"]), 11, Color(1, 1, 1, 0.82)))
			list.add_child(line)
		tip.add_child(list)
		chip.add_child(tip)
		chip.set_meta("reactors", tip)
		var wide := tip.get_combined_minimum_size()
		tip.size = wide
		var anchor := chip.get_global_rect()
		var room := chip.get_viewport_rect().size.x
		var centre := clampf(anchor.get_center().x, 8.0 + wide.x * 0.5, room - 8.0 - wide.x * 0.5)
		tip.global_position = Vector2(centre - wide.x * 0.5, anchor.position.y - 5.0 - wide.y)


	func _hide_reactors(chip: Control) -> void:
		if not is_instance_valid(chip) or not chip.has_meta("reactors"):
			return
		var tip: Variant = chip.get_meta("reactors")
		chip.remove_meta("reactors")
		if is_instance_valid(tip):
			(tip as Node).queue_free()


	func _date_separator(value: String) -> Control:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		var left := ColorRect.new()
		left.color = Color(1, 1, 1, 0.08)
		left.custom_minimum_size.y = 1
		left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		left.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(left)
		var label := ChatPanel.long_date(value)
		row.add_child(UI.label(label if not label.is_empty() else value, 11, Color(1, 1, 1, 0.32), 600))
		var right := ColorRect.new()
		right.color = Color(1, 1, 1, 0.08)
		right.custom_minimum_size.y = 1
		right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		right.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(right)
		var margin := MarginContainer.new()
		margin.add_theme_constant_override("margin_top", 2)
		margin.add_child(row)
		return margin


	func _typing_bubble(speaker_name: String, label_text: String, hint: String) -> Control:
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 0)
		var header := HBoxContainer.new()
		header.add_theme_constant_override("separation", 5)
		header.add_child(panel.flag_box(speaker_name, Vector2(11, 11)))
		header.add_child(UI.label(speaker_name, 11, Color(1, 1, 1, 0.4)))
		column.add_child(ChatPanel.spaced_bottom(header, 4))
		var bubble := PanelContainer.new()
		var style := UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 12, 0, Vector4(14, 10, 14, 10))
		style.corner_radius_bottom_left = 4
		bubble.add_theme_stylebox_override("panel", style)
		bubble.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		var dots := UI.label(label_text, 14, Color(1, 1, 1, 0.6))
		dots.set_meta("base", label_text)
		dots.custom_minimum_size.x = UI.font(400).get_string_size(label_text + "...", HORIZONTAL_ALIGNMENT_LEFT, -1, 14).x + 6
		panel.register_dots(dots)
		bubble.add_child(dots)
		column.add_child(bubble)
		if not hint.is_empty():
			column.add_child(ChatPanel.spaced(UI.label(hint, 10, Color(1, 1, 1, 0.32)), 5))
		return column


	func _thinking_group(count: int, lifecycle_kind: bool) -> Control:
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 0)
		var heading := ("%d invited governments" % count if count > 1 else "Invited government") if lifecycle_kind else ("%d governments" % count if count > 1 else "Government")
		column.add_child(ChatPanel.spaced_bottom(UI.label(heading, 11, Color(1, 1, 1, 0.42)), 4))
		var bubble := PanelContainer.new()
		var style := UI.box(Color(1, 1, 1, 0.035) if lifecycle_kind else Color(1, 1, 1, 0.08), ChatPanel.GREY_BORDER if lifecycle_kind else Color(0, 0, 0, 0), 12, 1 if lifecycle_kind else 0, Vector4(14, 10, 14, 10))
		style.corner_radius_bottom_left = 4
		bubble.add_theme_stylebox_override("panel", style)
		bubble.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 9)
		row.add_child(UI.label("Considering membership" if lifecycle_kind else "Considering the reply", 12, Color(1, 1, 1, 0.58)))
		var dots := UI.label("Thinking", 12, Color(1, 1, 1, 0.35))
		dots.set_meta("base", "Thinking")
		dots.custom_minimum_size.x = UI.font(400).get_string_size("Thinking...", HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + 6
		panel.register_dots(dots)
		row.add_child(dots)
		bubble.add_child(row)
		column.add_child(bubble)
		return column


	func _poll_card(poll: Dictionary) -> Control:
		var votes := ChatPanel.d(poll.get("votes", {}))
		var mine := ""
		for voter in votes:
			if ChatPanel.t(voter).to_lower() == panel.player.to_lower():
				mine = ChatPanel.t(votes[voter])
		var total := votes.size()
		var card := PanelContainer.new()
		card.add_theme_stylebox_override("panel", UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.08), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.3), 12, 1, Vector4(14, 11, 14, 11)))
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 7)
		var opened_by := ChatPanel.t(poll.get("openedBy", ""))
		column.add_child(UI.label(("Vote" + (" · called by %s" % opened_by if not opened_by.is_empty() else "")).to_upper(), 11, Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.9), 400, "Arial", 0))
		column.add_child(UI.wrapped(ChatPanel.t(poll.get("question", "")), 14, UI.WHITE, 700))
		for option_value in ChatPanel.a(poll.get("tally", [])):
			var option := ChatPanel.d(option_value)
			var option_id := ChatPanel.t(option.get("id", ""))
			var chosen := mine == option_id
			var share := float(int(option.get("votes", 0))) / float(total) if total > 0 else 0.0
			var voters: PackedStringArray = []
			for voter in votes:
				if ChatPanel.t(votes[voter]) == option_id:
					voters.append(ChatPanel.t(voter))
			var button := Button.new()
			button.focus_mode = Control.FOCUS_NONE
			button.custom_minimum_size.y = 31
			button.tooltip_text = ", ".join(voters) if not voters.is_empty() else "No vote yet"
			var base_style := UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.28) if chosen else Color(1, 1, 1, 0.12), 8, 1)
			for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
				button.add_theme_stylebox_override(state, base_style)
			var can_vote := mine.is_empty()
			button.disabled = not can_vote
			button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if can_vote else Control.CURSOR_ARROW
			if share > 0.0:
				var fill := Panel.new()
				fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
				var fill_style := UI.box(Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.28), Color(0, 0, 0, 0), 8, 0)
				if share < 0.98:
					fill_style.corner_radius_top_right = 0
					fill_style.corner_radius_bottom_right = 0
				fill.add_theme_stylebox_override("panel", fill_style)
				fill.anchor_bottom = 1.0
				fill.anchor_right = share
				fill.offset_left = 1
				fill.offset_top = 1
				fill.offset_bottom = -1
				button.add_child(fill)
			var row := HBoxContainer.new()
			row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
			row.offset_left = 10
			row.offset_right = -10
			row.mouse_filter = Control.MOUSE_FILTER_IGNORE
			var option_label := UI.label(ChatPanel.t(option.get("label", "")) + (" ✓" if chosen else ""), 12, UI.WHITE)
			option_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			option_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(option_label)
			var count := UI.label(str(int(option.get("votes", 0))), 12, Color(1, 1, 1, 0.55))
			count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(count)
			button.add_child(row)
			button.pressed.connect(func() -> void: vote(poll, option_id))
			column.add_child(button)
		var footer := ("Nobody has voted yet" if total == 0 else "%d vote%s cast" % [total, "" if total == 1 else "s"]) + ("" if not mine.is_empty() else " · your vote is yours to cast")
		column.add_child(UI.label(footer, 11, Color(1, 1, 1, 0.4)))
		card.add_child(column)
		return card


	func _demand_card(demand: Dictionary) -> Control:
		var me := panel.player.strip_edges().to_lower()
		var status := ChatPanel.t(demand.get("status", ""))
		var i_am_puppet := ChatPanel.t(demand.get("target", "")).to_lower() == me
		var i_am_overlord := ChatPanel.t(demand.get("by", "")).to_lower() == me
		var reconsidering := i_am_puppet and status == "refused"
		var my_move_puppet := i_am_puppet and (status == "open" or reconsidering)
		var my_move_overlord := i_am_overlord and status == "countered"
		var settled := "" if my_move_puppet else ChatPanel.t(ChatPanel.DEMAND_STATUS_TEXT.get(status, ""))
		var standing := "Refused" if reconsidering else ""
		var busy := demand_busy or loading
		var card := PanelContainer.new()
		card.add_theme_stylebox_override("panel", UI.box(Color(234 / 255.0, 179 / 255.0, 8 / 255.0, 0.08), Color(234 / 255.0, 179 / 255.0, 8 / 255.0, 0.35), 12, 1, Vector4(14, 11, 14, 11)))
		if not settled.is_empty():
			card.modulate.a = 0.7
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 7)
		var heading := ("Your demand · of %s" % ChatPanel.t(demand.get("target", ""))) if i_am_overlord else ("Demand · from %s" % ChatPanel.t(demand.get("by", "")))
		if not settled.is_empty() or not standing.is_empty():
			heading += " · %s" % (settled if not settled.is_empty() else standing)
		column.add_child(UI.label(heading.to_upper(), 11, Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.9)))
		column.add_child(UI.wrapped(ChatPanel.t(demand.get("summary", "")), 14, UI.WHITE, 700))
		if not ChatPanel.t(demand.get("alternative", "")).is_empty():
			var prefix := "You offered instead: " if i_am_puppet else "%s offers instead: " % ChatPanel.t(demand.get("target", ""))
			column.add_child(UI.wrapped(prefix + ChatPanel.t(demand.get("alternative", "")), 12, Color(1, 1, 1, 0.75)))
		if reconsidering:
			column.add_child(UI.wrapped("You refused this. You can still change your mind.", 11, Color(1, 1, 1, 0.6)))
		if my_move_puppet:
			var first := HBoxContainer.new()
			first.add_theme_constant_override("separation", 6)
			var accept := _demand_choice(("Accept after all" if reconsidering else "Accept"), "go", busy)
			accept.pressed.connect(func() -> void: answer_demand(demand, "accepted"))
			first.add_child(accept)
			if not reconsidering:
				var refuse := _demand_choice("Refuse", "danger", busy)
				refuse.pressed.connect(func() -> void: answer_demand(demand, "refused"))
				first.add_child(refuse)
			column.add_child(first)
			var second := HBoxContainer.new()
			second.add_theme_constant_override("separation", 6)
			var input := LineEdit.new()
			input.placeholder_text = "Or offer an alternative…"
			input.editable = not busy
			input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			ChatPanel.style_input(input, 12)
			second.add_child(input)
			var offer := _demand_choice("Offer", "neutral", busy)
			offer.size_flags_horizontal = Control.SIZE_FILL
			offer.pressed.connect(func() -> void:
				var value := input.text.strip_edges()
				if not value.is_empty():
					answer_demand(demand, "alternative", value))
			second.add_child(offer)
			column.add_child(second)
		if my_move_overlord:
			var revise := LineEdit.new()
			var first := HBoxContainer.new()
			first.add_theme_constant_override("separation", 6)
			var accept_alt := _demand_choice("Accept alternative", "go", busy)
			accept_alt.pressed.connect(func() -> void: accept_alternative(demand))
			first.add_child(accept_alt)
			var reject := _demand_choice("Reject", "danger", busy)
			reject.pressed.connect(func() -> void: reject_alternative(demand, revise.text.strip_edges()))
			first.add_child(reject)
			column.add_child(first)
			revise.placeholder_text = "Revise your demand (or leave empty to insist on it)…"
			revise.editable = not busy
			ChatPanel.style_input(revise, 12)
			column.add_child(revise)
		if settled.is_empty() and not my_move_puppet and not my_move_overlord:
			var waiting := ("Waiting for %s to consider the alternative" % ChatPanel.t(demand.get("by", ""))) if status == "countered" else ("Waiting for %s's answer" % ChatPanel.t(demand.get("target", "")))
			column.add_child(UI.label(waiting, 11, Color(1, 1, 1, 0.45)))
		card.add_child(column)
		return card


	func _demand_choice(caption: String, tone: String, busy: bool) -> Button:
		var bg := Color(1, 1, 1, 0.06)
		var border := Color(1, 1, 1, 0.16)
		if tone == "danger":
			bg = Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.14)
			border = Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.45)
		elif tone == "go":
			bg = Color(74 / 255.0, 222 / 255.0, 128 / 255.0, 0.14)
			border = Color(74 / 255.0, 222 / 255.0, 128 / 255.0, 0.45)
		var button := ChatPanel.solid_button(caption, 12, UI.WHITE, 700, bg, border, bg, border, 8, Vector4(10, 6, 10, 6))
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.disabled = busy
		button.mouse_default_cursor_shape = Control.CURSOR_ARROW if busy else Control.CURSOR_POINTING_HAND
		if busy:
			button.modulate.a = 0.6
		return button
