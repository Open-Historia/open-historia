class_name SharedGame
extends RefCounted

const HOST_DID_NOT_TAKE_MESSAGE := "The host did not take the message."
const HOST_DID_NOT_TAKE_ORDER := "The host did not take the order."
const REFUSAL := "In a shared game the host's computer runs the game; this is done there."
const SKIP_REFUSAL := "In a shared game the host's timer ends each round, or enough players pressing Ready on the round bar at the top."


static func active(link: EngineLink) -> bool:
	if link == null or not link.is_ready():
		return false
	var reply: Dictionary = await link.request("multiplayer.active")
	if not reply.get("ok", false) or typeof(reply.get("result")) != TYPE_DICTIONARY:
		return false
	return bool((reply["result"] as Dictionary).get("active", false))


static func ask(link: EngineLink, kind: String, fields: Dictionary, timeout_ms := 0) -> Dictionary:
	if link == null:
		return {"ok": false, "error": "Not in a shared game."}
	var args := {"t": kind, "fields": fields}
	if timeout_ms > 0:
		args["timeoutMs"] = timeout_ms
	var reply: Dictionary = await link.request("multiplayer.request", args)
	if not reply.get("ok", false):
		return {"ok": false, "error": str(reply.get("error", ""))}
	var result: Variant = reply.get("result")
	if typeof(result) != TYPE_DICTIONARY:
		return {"ok": false, "error": ""}
	var answer: Dictionary = result
	var error: Variant = answer.get("error")
	return {"ok": answer.get("ok", false) == true, "error": str(error) if error != null else "", "result": answer.get("result")}
