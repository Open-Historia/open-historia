extends SceneTree

var main: Node
var shots := ""
var started := 0
var frame: PanelFrame
var column: VBoxContainer
var intel: IntelligenceView
var institutions: InstitutionsView
var failures: PackedStringArray = []
var opened_chats: PackedStringArray = []
var opened_councils: PackedStringArray = []


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.mouse_passthrough = true
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[intelligence_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["PASS" if ok else "FAIL", label, "" if detail.is_empty() else "  (" + detail + ")"])
	if not ok:
		failures.append(label)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _view_scroll() -> ScrollContainer:
	if intel and is_instance_valid(intel) and intel.is_inside_tree():
		return intel._scroll
	if institutions and is_instance_valid(institutions) and institutions.is_inside_tree():
		return institutions._scroll
	return null


func _shoot(name: String, scroll_to_end := false) -> void:
	await _frames(4)
	var scroll := _view_scroll()
	if scroll and is_instance_valid(scroll):
		scroll.scroll_vertical = int(scroll.get_v_scroll_bar().max_value) if scroll_to_end else 0
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _texts(node: Node, out: PackedStringArray) -> void:
	if node is Label:
		out.append((node as Label).text)
	elif node is Button:
		out.append((node as Button).text)
	elif node is RichTextLabel:
		out.append((node as RichTextLabel).get_parsed_text())
	elif node is LineEdit:
		out.append((node as LineEdit).placeholder_text)
	elif node is TextEdit:
		out.append((node as TextEdit).placeholder_text)
	for child in node.get_children():
		_texts(child, out)


func _shows(node: Node, text: String) -> bool:
	var found: PackedStringArray = []
	_texts(node, found)
	if node == intel and intel._overlay and is_instance_valid(intel._overlay):
		_texts(intel._overlay, found)
	for entry in found:
		if entry.find(text) >= 0:
			return true
	return false


func _host(view: Control) -> void:
	for child in column.get_children():
		if child is IntelligenceView or child is InstitutionsView:
			column.remove_child(child)
	column.add_child(view)



func _idle() -> void:
	var idle_by := Time.get_ticks_msec() + 90000
	while Time.get_ticks_msec() < idle_by:
		var busy: Dictionary = await main.engine.request("invoke", {"module": "simulationStatus", "fn": "isSimulationBusy", "args": []})
		if busy.get("result", false) != true:
			return
		await _wait(0.5)


func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell == null:
		return
	var deadline := Time.get_ticks_msec() + 30000
	while shell.door_state == "deciding" and Time.get_ticks_msec() < deadline:
		await process_frame
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
	if not shell.notice_updates.is_empty():
		deadline = Time.get_ticks_msec() + 5000
		while not (shell.notice != null and is_instance_valid(shell.notice)) and Time.get_ticks_msec() < deadline:
			await process_frame
		for i in range(5):
			await process_frame
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
	for i in range(3):
		await process_frame

func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 120000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	await main._start_scenario("default")
	await _wait(0.4)
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	_say("game open")
	await _wait(1.0)
	await _idle()
	frame = PanelFrame.new("Diplomacy", "Conversations, institutions and statecraft", "bottom", 928.0)
	frame.scroll.visible = false
	column = frame.scroll.get_parent() as VBoxContainer
	main.hud.add_child(frame)
	frame.set_open(true)
	await _wait(0.5)
	var viewport := root.get_viewport().get_visible_rect().size
	var height := maxf(384.0, minf(800.0, viewport.y - 128.0))
	frame.offset_top = -78.0 - height
	frame.offset_bottom = -78.0
	intel = IntelligenceView.new()
	intel.setup(main.engine, {"chat_panel": frame})
	_host(intel)
	await intel.refresh()
	await _wait(0.3)
	_check("intelligence view loads", not intel._model.is_empty(), intel._load_error)
	_check("the overview reads as React's", _shows(intel, "SERVICE CAPABILITY") and _shows(intel, "Strategic warnings") and _shows(intel, "Recent intelligence") and _shows(intel, "field slots available"))
	_check("the overview empty states", _shows(intel, "No immediate intelligence warnings. This does not imply the absence of undiscovered activity.") and _shows(intel, "No private reporting has been collected yet. Deploy a network to begin receiving intelligence."))
	await _shoot("intel-01-overview")
	intel.show_section("countries")
	_check("countries show the public dossier", _shows(intel, "No active network · public sources only") and _shows(intel, "PUBLIC POLITICAL PICTURE"))
	await _shoot("intel-02-countries")
	intel.show_section("operations")
	_check("operations empty state", _shows(intel, "No networks are currently in the field.") and _shows(intel, "No operations have been carried out yet. Give a network an order and it acts during the next time skip.") and _shows(intel, "No detected foreign agents currently require action."))
	await _shoot("intel-03-operations-empty")
	await intel._start_choosing()
	await _wait(1.5)
	_check("the deploy picker lists countries", intel._candidates.size() > 10, "%d candidates" % intel._candidates.size())
	_check("the picker reads as React's", _shows(intel, "Deploy a Network") and _shows(intel, "Choose a target") and _shows(intel, "No target chosen yet") and _shows(intel, "Search countries..."))
	await _shoot("intel-04-picker")
	intel._pick_query = "Germ"
	intel._pick = "Germany"
	for entry: Variant in intel._candidates:
		if str((entry as Dictionary).get("name", "")) == "Germany":
			intel._pick_flag = str((entry as Dictionary).get("flag", ""))
	intel._render_picker()
	await _wait(0.4)
	_check("choosing a target arms Deploy the network", _shows(intel, "Deploy the network"))
	await _shoot("intel-05-picker-chosen")
	await intel._confirm_deploy()
	await _wait(0.3)
	_check("the network is deployed", int(intel._model.get("activeNetworks", 0)) == 1, intel._error)
	_check("the dossier opens on Germany", intel._section == "countries" and str(intel._model.get("selected", "")) == "Germany")
	_check("the dossier says Active network", _shows(intel, "Active network · since"))
	await _shoot("intel-06-dossier")
	var seeded_flag: Dictionary = await main.engine.request("mapcards.flags.apply", {"polity": {"name": "Germany"}, "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="})
	await intel.refresh()
	await _wait(0.4)
	var dossier_flag := str((intel._model.get("dossier", {}) as Dictionary).get("flag", ""))
	_check("a flag chosen in this game reaches the dossier, as React resolves it", bool((seeded_flag.get("result", {}) as Dictionary).get("ok", false)) and dossier_flag.ends_with(".png") and FileAccess.file_exists(dossier_flag), "%s %s" % [str(seeded_flag), dossier_flag])
	_check("and is drawn, not the white flag", ChatPanel.flag_texture(dossier_flag, 28) != null)
	await _shoot("intel-06b-dossier-custom-flag")
	intel.show_section("operations")
	var networks: Array = intel._model.get("networks", [])
	var spy_id := str((networks[0] as Dictionary).get("id", "")) if not networks.is_empty() else ""
	intel._order_draft[spy_id] = {"kind": "sabotage", "text": "the naval yards at Kiel"}
	intel._render()
	await _shoot("intel-07-operations-draft")
	await _idle()
	await intel._give_order(spy_id)
	var mission: Variant = null
	var waited := Time.get_ticks_msec()
	while Time.get_ticks_msec() - waited < 60000:
		networks = intel._model.get("networks", [])
		mission = (networks[0] as Dictionary).get("mission") if not networks.is_empty() else null
		if typeof(mission) == TYPE_DICTIONARY:
			break
		await _wait(0.25)
	await _wait(0.3)
	_check("the order is given", typeof(mission) == TYPE_DICTIONARY and str((mission as Dictionary).get("kind", "")) == "sabotage", intel._error)
	_check("the pending order reads as React's", _shows(intel, "Carried out during the next time skip.") and _shows(intel, "Cancel order"))
	await _shoot("intel-08-operations-ordered")
	var gathered: Dictionary = await main.engine.request("invoke", {"module": "gameplay", "fn": "maybeGatherIntelligence", "args": [{"chance": 1}]})
	_check("the agent reports (stand-in model)", gathered.get("ok", false) and str(gathered.get("result", "")) == "Germany", str(gathered))
	await intel.refresh()
	intel.show_section("overview")
	_check("the report counts as current", int(intel._model.get("currentReports", 0)) >= 1)
	await _shoot("intel-09-overview-report")
	intel.show_section("reports")
	_check("reports list the intercept", _shows(intel, "Germany ↔ Poland") and _shows(intel, "POLITICAL ASSESSMENTS") and _shows(intel, "INTERCEPTED TRAFFIC") and _shows(intel, "DOCUMENTS ON FILE"))
	await _shoot("intel-10-reports")
	var model_text := JSON.stringify(intel._model)
	_check("Godot never receives the seal or a cipher", model_text.find("spySeal") < 0 and model_text.find("cipher") < 0)
	var intercepts: Array = intel._model.get("intercepts", [])
	if not intercepts.is_empty():
		var first: Dictionary = intercepts[0]
		await intel._open_intercept(first, true)
		var messages: Array = intel._intercept.get("messages", [])
		var redacted := false
		for entry: Variant in messages:
			if str((entry as Dictionary).get("text", "")).find("█") >= 0:
				redacted = true
		_check("the intercept opens redacted", not messages.is_empty() and redacted, "%d messages, clarity %s" % [messages.size(), str(intel._intercept.get("clarity", ""))])
		_check("the intercept reads as React's", _shows(intel, "Signal clarity") and _shows(intel, "Improve your intelligence service to decode more of this exchange.") and _shows(intel, "🕵 Germany ↔ Poland"))
		_check("the opened intercept carries no seal", JSON.stringify(intel._intercept).find("cipher") < 0)
		await _shoot("intel-11-intercept")
	intel._intercept = {}
	intel.show_section("countries")
	await _shoot("intel-12-dossier-after-report")
	root.get_window().size = Vector2i(680, 900)
	await _wait(0.8)
	intel._render()
	await _wait(0.4)
	_check("a narrow window uses React's mobile layout", intel._mobile())
	await _shoot("intel-13-mobile-countries")
	intel.show_section("overview")
	await _shoot("intel-14-mobile-overview")
	root.get_window().size = Vector2i(1440, 900)
	await _wait(0.8)
	frame.offset_top = -78.0 - height
	frame.offset_bottom = -78.0
	institutions = InstitutionsView.new()
	institutions.setup(main.engine, {"chat_panel": frame})
	institutions.lifecycle_chat_opened.connect(func(chat_id: String) -> void: opened_chats.append(chat_id))
	institutions.council_opened.connect(func(chat_id: String) -> void: opened_councils.append(chat_id))
	_host(institutions)
	await institutions.refresh()
	_check("institutions load", institutions._loaded, institutions._load_error)
	_check("the empty state reads as React's", _shows(institutions, "Your government is not part of any institution and has no pending invitation or application.") and _shows(institutions, "Your institutions (0)") and _shows(institutions, "＋ Found institution"))
	await _shoot("inst-01-empty")
	institutions._show_all = true
	institutions._render()
	_check("the default scenario has no institutions", _shows(institutions, "No institutions exist in this world yet."))
	await _shoot("inst-02-view-all-empty")
	institutions._show_all = false
	institutions._founding_open = true
	institutions._render()
	_check("the founding form opens", _shows(institutions, "Create the institution first. Let diplomacy decide who joins it.") and _shows(institutions, "Invite founding governments"))
	await _shoot("inst-03-found-form")
	institutions._founding["name"] = "Baltic Union"
	institutions._founding["purpose"] = "Mutual defence of the Baltic"
	institutions._founding["invitees"] = "Germany; Poland"
	institutions._founding["minimumFoundingMembers"] = "1"
	institutions._advanced = true
	institutions._render()
	_check("advanced settings read as React's", _shows(institutions, "ADVANCED IDENTITY & GOVERNANCE") and _shows(institutions, "MEMBERSHIP CONSTITUTION") and _shows(institutions, "Withdrawal notice"))
	await _shoot("inst-04-found-advanced")
	await _shoot("inst-05-found-advanced-bottom", true)
	await institutions._found_institution()
	_check("the institution is founded", institutions._selected_id == "baltic-union", institutions._error)
	_check("founding opens its negotiation thread", opened_chats.size() == 1, ", ".join(opened_chats))
	await _shoot("inst-06-overview")
	institutions._section = "members"
	institutions._render()
	_check("members show the founding invitations", _shows(institutions, "PENDING MEMBERSHIP BUSINESS") and _shows(institutions, "Open negotiation →") and _shows(institutions, "Retract") and _shows(institutions, "Current members"))
	await _shoot("inst-07-members")
	await _shoot("inst-08-members-bottom", true)
	institutions._section = "agenda"
	institutions._render()
	_check("the agenda offers Table a matter", _shows(institutions, "Table a matter") and _shows(institutions, "Open for debate") and _shows(institutions, "Put to vote now"))
	await _shoot("inst-09-agenda-form")
	institutions._proposal_title = "Joint naval patrols"
	institutions._proposal_summary = "Members patrol the Baltic together from the spring."
	await institutions._create_proposal("baltic-union", "debate")
	_check("the proposal is tabled and the Council opens", institutions._section == "council" and institutions._error.is_empty(), institutions._error)
	await _shoot("inst-10-council")
	institutions._proposal_title = "Common defence fund"
	institutions._proposal_summary = "Each member pays one percent of its defence budget into a shared fund."
	institutions._section = "agenda"
	await institutions._create_proposal("baltic-union", "vote")
	institutions._section = "agenda"
	institutions._render()
	_check("the agenda asks for the player's vote", _shows(institutions, "Your vote") and _shows(institutions, "Yes") and _shows(institutions, "Abstain") and _shows(institutions, "Joint naval patrols"), institutions._error)
	await _shoot("inst-11-agenda-vote")
	var proposals: Array = (institutions._model.get("selected", {}) as Dictionary).get("proposals", [])
	var ballot_id := ""
	for entry: Variant in proposals:
		if bool((entry as Dictionary).get("needsVote", false)):
			ballot_id = str((entry as Dictionary).get("id", ""))
	await institutions._run("vote:" + ballot_id, "institutions.vote", {"institutionId": "baltic-union", "proposalId": ballot_id, "choice": "yes"})
	institutions._section = "decisions"
	institutions._render()
	_check("the vote is recorded as a formal decision", _shows(institutions, "FORMAL DECISION") and _shows(institutions, "Common defence fund"), institutions._error)
	var decisions: Array = (institutions._model.get("selected", {}) as Dictionary).get("decisions", [])
	if not decisions.is_empty():
		institutions._positions_open[str((decisions[0] as Dictionary).get("id", ""))] = true
		institutions._render()
	await _shoot("inst-12-decisions")
	institutions._section = "charter"
	institutions._render()
	_check("the charter reads as React's", _shows(institutions, "DECISION FRAMEWORK") and _shows(institutions, "Membership constitution") and _shows(institutions, "Accession"))
	await _shoot("inst-13-charter")
	institutions._section = "documents"
	institutions._render()
	_check("documents empty state", _shows(institutions, "No institution-related documents currently readable by your government."))
	await _shoot("inst-14-documents")
	institutions._section = "members"
	institutions._discipline_open = true
	institutions._invite_target = "Italy"
	institutions._render()
	await _shoot("inst-15-members-discipline")
	await institutions._invite("baltic-union")
	_check("an invitation opens its negotiation thread", opened_chats.size() == 2, ", ".join(opened_chats))
	institutions._section = "overview"
	institutions._render()
	_check("the overview shows current business", _shows(institutions, "CURRENT BUSINESS") and _shows(institutions, "Recent activity"))
	await _shoot("inst-16-overview-after")
	institutions._selected_id = ""
	await institutions.refresh()
	_check("the list shows the new institution", _shows(institutions, "Baltic Union") and _shows(institutions, "Your institutions (1)"))
	await _shoot("inst-17-list")
	_say("lifecycle chats opened: %s; councils opened: %s" % [", ".join(opened_chats), ", ".join(opened_councils)])
	await _hosted_in_chat_panel()
	_finish(0 if failures.is_empty() else 1)


func _hosted_in_chat_panel() -> void:
	var panels: Variant = main.hud.get("panels")
	if typeof(panels) != TYPE_DICTIONARY or not (panels as Dictionary).has("chat"):
		_say("the Diplomacy panel is not mounted; skipping the hosted views")
		return
	var chat: Control = (panels as Dictionary)["chat"]
	frame.visible = false
	chat.call("open")
	await _wait(0.8)
	chat.call("_set_view", "spy")
	await _wait(2.5)
	var hosted_intel: Control = null
	var hosted_institutions: Control = null
	for node: Node in chat.find_children("*", "VBoxContainer", true, false):
		if node is IntelligenceView:
			hosted_intel = node as Control
		elif node is InstitutionsView:
			hosted_institutions = node as Control
	_check("the Diplomacy panel hosts the Intelligence view", hosted_intel != null and hosted_intel.is_visible_in_tree())
	if hosted_intel:
		await _shoot_plain("host-01-intelligence")
		(hosted_intel as IntelligenceView).show_section("operations")
		await _shoot_plain("host-02-operations")
	chat.call("navigate_institution", "baltic-union", "council")
	await _wait(3.0)
	_check("the Diplomacy panel hosts the Institutions view on the Council", hosted_institutions != null and hosted_institutions.is_visible_in_tree() and (hosted_institutions as InstitutionsView)._section == "council")
	if hosted_institutions:
		_check("the Council embeds the Diplomacy panel's conversation", (hosted_institutions as InstitutionsView)._embedded != null)
		await _shoot_plain("host-03-council")
		chat.call("navigate_institution", "baltic-union", "overview")
		await _wait(2.0)
		await _shoot_plain("host-04-institution")


func _shoot_plain(name: String) -> void:
	await _frames(6)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _finish(code: int) -> void:
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	main.engine.stop()
	await _frames(2)
	quit(code)
