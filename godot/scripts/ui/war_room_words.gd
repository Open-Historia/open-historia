class_name WarRoomWords
extends RefCounted


static func order_word(order: String) -> String:
	match order:
		"advance":
			return "Advance"
		"blitz":
			return "Blitz"
		"spearhead":
			return "Spearhead"
		"flank":
			return "Flank"
		"encircle":
			return "Encircle"
		"hold":
			return "Hold"
		"dig in":
			return "Dig in"
		"fall back":
			return "Fall back"
		"withdraw":
			return "Withdraw"
	return "Order"


static func doing_word(doing: String) -> String:
	match doing:
		"advancing", "advance":
			return "advancing"
		"dug-in":
			return "dug in"
		"cut-off":
			return "cut off"
		"on-route":
			return "following a route"
		"closing":
			return "closing on a pocket"
		"assaulting":
			return "assaulting"
		"falling-back":
			return "falling back"
		"withdrawing":
			return "withdrawing"
		"breaking-out":
			return "breaking out"
		"pursuing":
			return "pursuing"
		"spearhead":
			return "driving a spearhead"
		"encircle":
			return "encircling"
		"flank":
			return "turning a flank"
		"blitz":
			return "massing to attack"
	return "holding the line"


static func way_refusal(code: String) -> String:
	match code:
		"no-coast":
			return "no sea is near where it would set out"
		"no-shore":
			return "no shore is near that place"
		"no-sea-way":
			return "no sea leads there"
		"no-ground":
			return "it has no land of your side's to start on"
		"no-troops":
			return "its troops were gone"
		"no-war":
			return "you are fighting no war"
		"railhead":
			return "its line ends before that place"
		"too-far", "off-map":
			return "that place cannot be reached"
	return "no way was found"


static func medium_word(medium: String) -> String:
	if medium == "sea":
		return "by sea"
	if medium == "land":
		return "by rail"
	return "by air"


static func carrier_word(medium: String) -> String:
	if medium == "sea":
		return "By sea"
	if medium == "land":
		return "By rail"
	return "By air"


static func project_status(status: String) -> String:
	match status:
		"active":
			return "under way"
		"proposed":
			return "proposed"
		"paused":
			return "paused"
		"stalled":
			return "stalled"
	return ""


static func staff_plan_word(plan: String) -> String:
	match plan:
		"push":
			return "an attack along the whole line"
		"dig in":
			return "to dig in along the whole line"
		"the weakest place":
			return "a blow at the weakest point of your line"
		"the second weakest place", "the third weakest place":
			return "a blow at a weak point of your line"
		"everyone on the weakest place":
			return "everything at the weakest point of your line"
		"a pincer":
			return "a pincer"
		"the towns":
			return "to take the towns"
		"the walls":
			return "to break through the walls"
		"net, digging in":
			return "its own judgement troop by troop, digging in where it holds"
		"net, resting the worn":
			return "its own judgement troop by troop, resting its worn troops"
	return "its own judgement, troop by troop"


static func weather_word(state: String) -> String:
	match state:
		"clear":
			return "Clear skies"
		"rain":
			return "Rain"
		"storm":
			return "Storm"
		"mud":
			return "Mud"
		"snow":
			return "Snow"
		"blizzard":
			return "Blizzard"
		"frost":
			return "Frost"
		"heat":
			return "Heat"
		"fog":
			return "Fog"
	return ""


static func weather_does(codes: Array) -> String:
	var said: Array[String] = []
	for code in codes:
		match str(code):
			"pace-halt":
				said.append("nearly halts an advance")
			"pace-slow":
				said.append("slows an advance")
			"attack":
				said.append("blunts attacks")
			"air-ground":
				said.append("grounds aircraft")
			"air-hamper":
				said.append("hampers aircraft")
			"cold":
				said.append("bitter cold wears troops down")
			"heat":
				said.append("the heat wears troops down")
	if said.is_empty():
		return "good weather for an offensive"
	var out := ""
	for index in range(said.size()):
		if index > 0:
			out += " and " if index == said.size() - 1 else ", "
		out += said[index]
	return out


static func posture_key(posture: String) -> String:
	match posture:
		"patrol":
			return "Patrol"
		"blockade":
			return "Blockade"
		"assaulting":
			return "Seek battle"
		"holding":
			return "Hold"
		"withdrawing":
			return "Withdraw"
	return "Escort"


static func posture_word(posture: String) -> String:
	match posture:
		"patrol":
			return "patrolling"
		"blockade":
			return "blockading"
		"assaulting":
			return "seeking battle"
		"holding":
			return "holding"
		"withdrawing":
			return "withdrawing"
		"transit":
			return "under way"
		"massing":
			return "massing"
		"exercise":
			return "on exercise"
	return "at sea"


static func fleet_order_line(fleet: Dictionary) -> String:
	var order: Variant = fleet.get("order")
	if typeof(order) != TYPE_DICTIONARY:
		return "No standing order."
	var standing: Dictionary = order
	if str(standing.get("kind", "")) == "patrol":
		return "Patrolling within %d km of its station." % int(round(float(standing.get("radiusKm", 0))))
	return "Under way, about %d km to go." % int(fleet.get("togo", 0))


static func level_word(level: int) -> String:
	if level <= 3:
		return "Palisade"
	match level:
		4:
			return "Earthworks"
		5:
			return "Rampart"
		6:
			return "Redoubts"
		7:
			return "Bastions"
		8:
			return "Fortress line"
		9:
			return "Great wall"
	return "Impassable"


static func build_time(time: Dictionary) -> String:
	var count := int(time.get("count", 1))
	match str(time.get("unit", "day")):
		"day":
			return "About a day to build" if count == 1 else "About %d days to build" % count
		"week":
			return "About %d weeks to build" % count
		"month":
			return "About %d months to build" % count
	return "About %d years to build" % count


static func plan_tone(plan: Dictionary, theirs := false) -> String:
	if theirs:
		return "known"
	var kind := str(plan.get("kind", ""))
	if kind == "deploy":
		return "deploy"
	if kind == "diversion":
		return "decoy"
	if kind == "project":
		return "project" if bool(plan.get("live", false)) and not bool(plan.get("done", false)) else "idle"
	if not str(plan.get("project", "")).is_empty():
		return "project"
	return "own"


static func line_colour(level: int) -> Color:
	var colours := {3: "#d8c27a", 4: "#d9ad4f", 5: "#e09440", 6: "#e07a36", 7: "#d95f30", 8: "#c9452c", 9: "#b02d2a", 10: "#f4f7fb"}
	return Color(str(colours.get(clampi(level if level != 0 else 5, 3, 10), "#e09440")))
